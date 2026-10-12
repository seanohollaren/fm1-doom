/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: a drum machine under the game's music, with Felucca's drum voices. Part of fm1_sound.c.
 *
 * KNOB 4 brings a beat in under the song, in time with it: double bass, a gallop, a thrash beat, a blast, rock,
 * four on the floor, half time; most with a crash every fourth bar and a fill before it. While it plays, the
 * sound chip's own percussion is silent.
 *
 * One kit, the one Sean picked by ear from recordings of thirteen (NOTES.md, 2026-10-11, "CRUNCH"): Felucca's
 * own drum kit as designed, through the stages Felucca has behind its voices: drive on each voice (eng_drum.c
 * drum_render's DRV at 70), distortion on the kit (fx.c track_dist at 30), and the whole of the game's sound
 * through the master limiter with the drums, the music going in at twice its level, so that every hit pushes
 * the music down for a moment and it comes back between hits.
 *
 * The voices are Felucca's drum_voice.c, unchanged: the five kinds this kit has (kick, snare, tom, hats, cymbal).
 * Their coefficients are worked out at build time (fm1_sound_gen.h: one set for each way a pattern strikes a
 * voice), so Felucca's set-up code is not in the firmware.
 *
 * Time: the music's player calls fm1_drums_step for every thirty-second of the bar that has a hit, from the same
 * timer its own notes come from, so the two cannot drift apart. */
_Static_assert(sizeof(dv_coef_t) == 4u * FM1_KIT_WORDS, "fm1_sound_gen.h was made for another dv_coef_t");

#define BAR 32                           /* steps in a bar: thirty-seconds */
#define DRV_GAIN 10868                   /* DRV 70: each voice x 2.65 into the soft clip (4096 + 70 * 3 * 4096 / 127, Q12) */
#define KIT_DIST 30                      /* DIST on the kit */
#define KIT_LEVEL 161                    /* the kit into the limiter, of 256: a rock beat 3 dB over the music as it goes in */
#define MUSIC_PUSH 2                     /* the rest of the game's sound into the limiter: twice its level */

volatile uint8_t fm1_drums_pattern;      /* 0: off; 1 .. NPATTERNS: PATTERNS[n - 1] */

/* ---- the patterns: a bar of 32 steps, bit n = step n (a beat is 8 steps, a sixteenth 2) */
#define P_CRASH 1                        /* a crash on the first beat of every fourth bar */
#define P_FILL 2                         /* the second half of every fourth bar is a fill: snare, then toms */
static const struct {
    const char *name;
    uint32_t kick, snare, hat, open;
    uint8_t flags;
} PATTERNS[] = {
    {"DOUBLE BASS",       0x55555555, 0x01000100, 0, 0x01010101, P_CRASH | P_FILL},   /* kick on every sixteenth; snare on 2 and 4; an open hat on the beats */
    {"GALLOP",            0x51515151, 0x01000100, 0x11111111, 0, P_CRASH | P_FILL},   /* kick: an eighth and two sixteenths, every beat */
    {"THRASH",            0x01010101, 0x10101010, 0x11111111, 0, P_CRASH | P_FILL},   /* kick on the beats, snare between them: twice as fast as rock */
    {"BLAST",             0x11111111, 0x44444444, 0, 0x11111111, P_CRASH},            /* kick and snare by turns in sixteenths under an open hat */
    {"MACHINE GUN",       0xFFFFFFFF, 0x01000100, 0, 0x01010101, P_CRASH | P_FILL},   /* kick on every thirty-second */
    {"ROCK",              0x00110001, 0x01000100, 0x11111111, 0, P_FILL},             /* kick on 1, 3 and the "and" after; snare on 2 and 4 */
    {"FOUR ON THE FLOOR", 0x01010101, 0x01000100, 0, 0x10101010, 0},                  /* kick on every beat; open hats between */
    {"HALF TIME",         0x00100001, 0x00010000, 0x01010101, 0, P_CRASH},            /* one snare a bar, on 3 */
};
#define NPATTERNS (sizeof PATTERNS / sizeof PATTERNS[0])
static const uint32_t FILL_SNARE = 0x00550000, FILL_TOM = 0x55000000;   /* sixteenths: beat 3 on the snare, beat 4 down the toms */

int fm1_drums_patterns(void) { return (int)NPATTERNS; }               /* settings of fm1_drums_pattern above 0 */
const char *fm1_drums_pattern_name(int n) { return n >= 1 && n <= (int)NPATTERNS ? PATTERNS[n - 1].name : "OFF"; }

/* ---- the voices: one a lane */
enum { KICK, SNARE, TOM, HAT, OPEN, CRASH, LANES };
static const uint8_t LANE_OF[K_COUNT] = {KICK, KICK, KICK, KICK, SNARE, SNARE, SNARE, TOM, TOM, HAT, HAT, OPEN, OPEN, CRASH};
static const dv_coef_t *coef[LANES];     /* how each lane was last struck (0: never) */
static dv_voice_t voice[LANES];
static dv_metal_t metal;                 /* the hats' and the cymbal's source */
static struct {                          /* hits waiting for their sample in the pass being mixed */
    uint16_t at;                         /* mixer frame of the pass */
    uint8_t hit;                         /* K_*; 0xFF: played */
} queue[12];
static uint8_t queued;
#if FM1_WEB
static uint32_t hits;                    /* (test hook) since the start */
int fm1_drums_hits(void) { return (int)hits; }
#endif

static void later(uint32_t hit)
{
    if (queued == sizeof queue / sizeof queue[0])
        return;
    queue[queued].at = (uint16_t)fm1_pass_frames;
    queue[queued++].hit = (uint8_t)hit;
}

static void strike(uint32_t hit)
{
    uint32_t lane = LANE_OF[hit];
    coef[lane] = (const dv_coef_t *)FM1_KIT[hit];
    if (lane >= HAT)                     /* (the hats and the cymbal share the metal source, each at its pitch) */
        dv_metal_tune(&metal, coef[lane]);
    if (lane == HAT)
        dv_choke(&voice[OPEN]);          /* a closed hat stops the open one */
    dv_trigger(&voice[lane]);
#if FM1_WEB
    hits++;
#endif
}

/* what the pattern has at a step: `step` counts thirty-seconds through four bars, 0 .. 4 * BAR - 1 */
static uint32_t at_step(uint32_t step, uint32_t *kick, uint32_t *snare, uint32_t *hat, uint32_t *open, uint32_t *crash, uint32_t *tom)
{
    uint32_t n = fm1_drums_pattern, bit = 1u << (step % BAR), last = step / BAR == 3, fill;
    *kick = *snare = *hat = *open = *crash = *tom = 0;
    if (n < 1 || n > NPATTERNS)
        return 0;
    fill = last && (PATTERNS[n - 1].flags & P_FILL) && (step % BAR) >= BAR / 2;
    *kick = PATTERNS[n - 1].kick & bit;
    *snare = (fill ? FILL_SNARE : PATTERNS[n - 1].snare) & bit;
    *tom = fill ? FILL_TOM & bit : 0;
    *hat = fill ? 0 : PATTERNS[n - 1].hat & bit;
    *open = fill ? 0 : PATTERNS[n - 1].open & bit;
    *crash = (PATTERNS[n - 1].flags & P_CRASH) && step == 0;
    return *kick | *snare | *hat | *open | *crash | *tom;
}
/* whether anything sounds at a step (the music's player asks, and sets a timer only for those that do) */
int fm1_drums_wants(int step)
{
    uint32_t a, b, c, d, e, f;
    return at_step((uint32_t)step & (4 * BAR - 1), &a, &b, &c, &d, &e, &f) != 0;
}
/* a step has come */
void fm1_drums_step(int step)
{
    uint32_t kick, snare, hat, open, crash, tom, s = (uint32_t)step & (4 * BAR - 1), beat = !(s & 7), in = s % BAR;
    if (!at_step(s, &kick, &snare, &hat, &open, &crash, &tom))
        return;
    /* the beats hardest: a fast foot plays lighter the faster it goes (eighths, sixteenths, thirty-seconds) */
    if (kick) later(beat ? K_KICK : !(in & 3) ? K_KICK_8 : !(in & 1) ? K_KICK_16 : K_KICK_32);
    if (snare) later(beat ? K_SNARE : in >= BAR / 2 + 4 ? K_SNARE_END : K_SNARE_OFF);
    if (tom) later(in < 28 ? K_TOM_HIGH : K_TOM_LOW);                       /* a high tom, then a low one */
    if (hat) later(beat ? K_HAT : K_HAT_OFF);
    if (open) later(beat ? K_OPEN : K_OPEN_OFF);
    if (crash) later(K_CRASH);
}

/* ---- the sound */
static int32_t drum_block[CTL + 1];      /* the kit's last block, and before it the sample that ended the one before */
static uint32_t drum_at = (uint32_t)CTL << 16;   /* where the mixer is in it, 16.16 (at the end: render another) */
static uint8_t ringing;                  /* something sounded in the last block */
static fm1_dist_t kit_dist;
static fm1_master_t limiter = {{0, 0}, {0, 0}, LIM_T};
static int32_t engaged;                  /* how far the limiter is faded in, 0 .. 4096 */

/* One block of a lane into y: drum_voice.c dv_run for the five kinds of voice the kit has (dv_run itself names
 * all twelve, and the linker would keep the seven that never play: about 0.8 KB). metal: the metal source's block. */
static void lane_run(uint32_t lane, const int32_t *metal, int32_t *y)
{
    const dv_coef_t *c = coef[lane];
    dv_voice_t *v = &voice[lane];
    if (v->trig)
        dv_strike(c, v);
    if (!v->live) {
        memset(y, 0, CTL * sizeof *y);
        return;
    }
    if (lane == KICK)
        dv_kick_run(c, v, y, CTL);
    else if (lane == SNARE)
        dv_snare_run(c, v, y, CTL);
    else if (lane == TOM)
        dv_tom_run(c, v, y, CTL);
    else if (lane == CRASH)
        dv_cym_run(c, v, metal, y, CTL);
    else
        dv_hat_run(c, v, metal, y, CTL);
    dv_out(c, y, CTL);
}

static void drum_render(void)
{
    /* Felucca's DRV (eng_drum.c drum_render): each voice into the soft clip with its level kept */
    const int32_t keep = (int32_t)((19661u << 15) / (uint32_t)softclip((19661 * DRV_GAIN) >> 12));
    int32_t y[CTL], m[CTL], sum[CTL];
    uint32_t lane, i, any = 0, needs_metal = 0;
    drum_block[0] = drum_block[CTL];
    memset(sum, 0, sizeof sum);
    for (lane = HAT; lane < LANES; lane++)
        if (coef[lane] && (voice[lane].live || voice[lane].trig))
            needs_metal = 1;
    if (needs_metal)
        dv_metal_run(&metal, m, CTL);
    for (lane = 0; lane < LANES; lane++) {
        if (!coef[lane] || !(voice[lane].live || voice[lane].trig))
            continue;
        lane_run(lane, m, y);
        for (i = 0; i < CTL; i++) {      /* ... and its voice level: x 1.25 under a knee, then x 1.46 onto the track */
            int32_t v = (softclip((y[i] * DRV_GAIN) >> 12) * keep) >> 15;
            sum[i] += (soft_knee(v + (v >> 2), 24000) * 47840) >> 15;
        }
        any = 1;
    }
    if (any || ringing)
        fm1_dist(&kit_dist, KIT_DIST, sum, CTL);
    for (i = 0; i < CTL; i++)
        drum_block[i + 1] = (sum[i] * KIT_LEVEL) >> 8;
    ringing = (uint8_t)(any || kit_dist.lp2 > 8 || kit_dist.lp2 < -8);
}

/* The drums into `frames` frames of the mixer's 16-bit stereo: the pass the queued hits belong to. While a
 * beat is chosen, the whole of it (the game's sounds, its music or the synth's, pushed) goes through the
 * limiter with the drums; the limiter fades in and out over about 40 ms with the beat. */
void fm1_drums_mix(int16_t *stereo, uint32_t frames)
{
    const int32_t want = fm1_drums_pattern ? 4096 : 0;
    uint32_t f, q;
    if (!queued && !ringing && !engaged && !want) {         /* nothing playing, nothing to come: no work */
        drum_at = (uint32_t)CTL << 16;
        drum_block[CTL] = 0;
        limiter.env = LIM_T;
        return;
    }
    for (f = 0; f < frames; f++, stereo += 2) {
        int32_t a, b, s, lr[2];
        if (drum_at >= (uint32_t)CTL << 16) {
            drum_at -= (uint32_t)CTL << 16;
            for (q = 0; q < queued; q++)                     /* hits whose sample has come, in the order they were made */
                if (queue[q].at <= f && queue[q].hit != 0xFF) {
                    strike(queue[q].hit);
                    queue[q].hit = 0xFF;
                }
            drum_render();
        }
        a = drum_block[drum_at >> 16];
        b = drum_block[(drum_at >> 16) + 1u];
        s = a + (int32_t)(((int64_t)(b - a) * (int32_t)(drum_at & 0xFFFFu)) >> 16);
        drum_at += MIX_STEP;
        lr[0] = stereo[0] * MUSIC_PUSH + s;
        lr[1] = stereo[1] * MUSIC_PUSH + s;
        fm1_master(&limiter, lr);
        engaged += engaged < want ? 2 : engaged > want ? -2 : 0;
        stereo[0] = (int16_t)(stereo[0] + (((lr[0] - stereo[0]) * (engaged >> 4)) >> 8));
        stereo[1] = (int16_t)(stereo[1] + (((lr[1] - stereo[1]) * (engaged >> 4)) >> 8));
    }
    for (q = 0; q < queued; q++)                             /* (any left fell in the pass's last block: play them next) */
        if (queue[q].hit != 0xFF)
            strike(queue[q].hit);
    queued = 0;
}
