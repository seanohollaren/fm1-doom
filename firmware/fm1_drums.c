/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom, PROTOTYPE (browser build only so far): a drum machine over the game's music, with Felucca's drums.
 *
 * A press of a button and a beat comes in under the song, in time with it: a pattern of the machine's own
 * (double bass, a gallop, a thrash beat, a blast, rock, four on the floor, half time; some with a crash every
 * fourth bar and a fill before it), or the song's own drum part played on real drum voices in place of the
 * sound-card chip's. While it plays, the chip's percussion is silent.
 *
 * The voices are Felucca's DRUM engine, unchanged, read from the Felucca checkout beside this repository:
 *   Felucca/firmware/src/drum_voice.c, dsp.c   Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton
 *                                              Instruments, GPL-3.0-only
 *   Felucca/build/gen/felucca_tables.h         its tables (made by Felucca's build)
 * The kits: two set up here from those voices for weight (METAL, PUNCH: the voices' own knobs turned, a second
 * voice struck with the kick and the snare, the whole kit driven into a soft clip, the music stepping back a
 * little under each hit), then Felucca's own kit and its five model kits as designed. The map from the song's
 * drum notes to voices is Felucca's (eng_drum.c DRUM_GM, DV_TYPE_LANE), copied here.
 *
 * Time: the music's player (rp2040-doom src/i_oplmusic.c, under FM1_DRUMS) calls fm1_drums_step for every
 * thirty-second of the bar that has a hit and fm1_drums_hit for every drum note of the song, from the same timer its own notes
 * come from, so the two cannot drift apart; each call lands inside a mixer pass, and where in the pass
 * (fm1_pass_frames) is kept with the hit, so that it sounds on its sample and not at the start of the pass.
 * The voices run at the 44,100 Hz they are made for, 32 samples at a time, and are brought to the mixer's
 * 49,716 Hz by straight-line interpolation. */
#include <stdint.h>
#include <string.h>
#include "felucca_tables.h"
typedef struct {                         /* Felucca's core.h vmod_t: dsp.c names it; nothing here uses it */
    uint32_t inc;
    int32_t pitch16, amp0, amp1, cutoff, shape, envq15, fine;
} vmod_t;
#include "dsp.c"
#include "drum_voice.c"

#define MIX_RATE 49716u                  /* the game's mixer (rp2040-doom src/fm1/fm1_audio.c) */
#define BAR 32                           /* steps in a bar: thirty-seconds */

volatile uint8_t fm1_drums_pattern;      /* 0: off; 1 .. NPATTERNS: PATTERNS[n - 1]; NPATTERNS + 1: the song's own drum part */
volatile uint8_t fm1_drums_kit = 9;      /* KITS[n]; CRUNCH to begin with (Sean's pick by ear, with the level and push below) */
volatile uint8_t fm1_drums_loud = 2;     /* the kit against the music: LOUD[n], 0 .. 4 */
static const uint16_t LOUD[5] = {128, 181, 256, 362, 512};   /* x 256: 3 dB a step, the kit's own level in the middle */
volatile uint8_t fm1_drums_dip = 3;      /* how far the music steps back under a hit: DIP[n] of the kit's own depth */
static const uint16_t DIP[5] = {0, 64, 128, 256, 384};       /* x 256: not at all, a quarter, half, the kit's own, half as much again */
void fm1_osd_say(const char *text);      /* rp2040-doom src/fm1: a message across the top of the picture */
extern unsigned int fm1_pass_frames;     /* rp2040-doom opl/opl_pico.c: mixer frames of this pass made so far */

/* ---- the kits */
/* A sound: one of Felucca's voices with its knobs set (0 .. 127; the designed sound is DV_DEF's). */
typedef struct {
    uint8_t type;                        /* DVT_*; 0xFF: none */
    int8_t tune;                         /* semitones from the voice's own pitch */
    uint8_t decay, tone, extra, level;
} sound_t;
#define NONE {0xFF, 0, 0, 0, 0, 0}
typedef struct {
    const char *name;
    uint8_t model;                       /* 0: the sounds below; 1 .. DV_NKIT: Felucca's model kit, as designed; 0xFF: its own kit, as designed */
    sound_t kick, kick2, snare, snare2, hat, open, crash, tom;   /* kick2, snare2: struck with the kick / the snare, a layer */
    uint16_t drive;                      /* the drums together into a soft clip, x 256 (256: no clip at all) */
    uint16_t level;                      /* ... and out of it, x 256 */
    uint8_t duck;                        /* how far the music steps back under a kick or a snare, of 256 */
    /* Felucca's own chain after the voices, as its firmware has it (eng_drum.c, fx.c): */
    uint8_t drv;                         /* DRV, each voice x1 .. x4 into a soft clip with its level kept, 0 .. 127 */
    uint8_t dist;                        /* DIST on the kit as one track: drive, a lopsided clip, a tone filter; 0 .. 127 */
    uint8_t limit;                       /* 1: the whole mix through Felucca's master limiter and soft clip, where a hit
                                          * pushes everything else down for a moment (in place of `duck` and the soft top) */
    uint8_t crush;                       /* CRUSH, of Felucca's live effects (perform.c): fewer bits and a held sample,
                                          * 0 .. 100; there on the whole mix, here on the kit only (the music stays whole) */
} kit_t;
static const kit_t KITS[] = {
    /* a metal kit: a short, high, driven kick with a hard beater click, so that fast double bass stays apart; a
     * bright snare with all its wires and a clap's crack on top; a low open hat for a china; everything into a clip */
    {"METAL", 0,
     {DVT_PUNCH, 7, 30, 100, 90, 127}, {DVT_CLAVE, 3, 0, 0, 64, 75},
     {DVT_SNARE, 2, 80, 127, 127, 127}, {DVT_CLAP, 4, 20, 110, 0, 60},
     {DVT_HATC, 0, 45, 80, 80, 80}, {DVT_HATO, -3, 40, 64, 100, 75}, {DVT_CYM, 0, 100, 90, 110, 110},
     {DVT_TOM, 0, 70, 100, 60, 120}, 330, 150, 90, 0, 0, 0},
    /* a big rock kit: the round, long kick with a rim's knock on it, a fat long snare */
    {"PUNCH", 0,
     {DVT_ROUND, 0, 58, 80, 90, 127}, {DVT_RIM, -5, 20, 40, 40, 55},
     {DVT_SNARE, 0, 100, 95, 115, 127}, {DVT_CLAP, 0, 45, 70, 40, 50},
     {DVT_HATC, 0, 60, 64, 64, 80}, {DVT_HATO, 0, 50, 64, 64, 75}, {DVT_CYM, 0, 90, 70, 90, 105},
     {DVT_TOM, 0, 80, 64, 50, 120}, 300, 150, 70, 0, 0, 0},
    /* Felucca's own kit and its five model kits, as designed, clean */
    {"STD", 0xFF, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 110, 0, 0, 0, 0},
    {"80", 1, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 110, 0, 0, 0, 0},
    {"10", 2, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 110, 0, 0, 0, 0},
    {"66", 3, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 110, 0, 0, 0, 0},
    {"55", 4, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 110, 0, 0, 0, 0},
    {"77", 5, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 110, 0, 0, 0, 0},
    /* after a video of Felucca itself with the sound Sean is after ("FM-1 Cyberpunk Jam", Felucca 1.1.5.1): the same
     * voices through Felucca's own drive, distortion, bit crusher and master limiter, which the kits above only
     * imitate. LIMIT is Felucca's kit as it comes out of Felucca: clean, and loud enough to move the limiter.
     * Their levels are set so that a rock beat has the same strength (RMS 6,200 into the limiter, 3 dB over the
     * music as it goes in) whichever kit plays it: the kits differ in what the hits are, not in how loud. */
    {"LIMIT", 0xFF, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 132, 0, 0, 0, 1, 0},
    {"CRUNCH", 0xFF, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 161, 0, 70, 30, 1, 0},
    {"SLAM", 0,
     {DVT_PUNCH, 7, 30, 100, 90, 127}, {DVT_CLAVE, 3, 0, 0, 64, 75},
     {DVT_SNARE, 2, 80, 127, 127, 127}, {DVT_CLAP, 4, 20, 110, 0, 60},
     {DVT_HATC, 0, 45, 80, 80, 80}, {DVT_HATO, -3, 40, 64, 100, 75}, {DVT_CYM, 0, 100, 90, 110, 110},
     {DVT_TOM, 0, 70, 100, 60, 120}, 256, 139, 0, 100, 40, 1, 0},
    {"FUZZ 80", 1, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 150, 0, 127, 105, 1, 0},
    {"CRUSH", 0xFF, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, 256, 113, 0, 60, 0, 1, 50},
};
#define NKITS (sizeof KITS / sizeof KITS[0])

/* ---- the patterns: a bar of 32 steps, bit n = step n (a beat is 8 steps, a sixteenth 2) */
#define P_CRASH 1                        /* a crash on the first beat of every fourth bar */
#define P_FILL 2                         /* the second half of every fourth bar is a fill: snare, then toms */
static const struct {
    const char *name;
    uint32_t kick, snare, hat, open;
    uint8_t flags;
} PATTERNS[] = {
    {"DOUBLE BASS",       0x55555555, 0x01000100, 0, 0x01010101, P_CRASH | P_FILL},   /* kick on every sixteenth; snare on 2 and 4; china on the beats */
    {"GALLOP",            0x51515151, 0x01000100, 0x11111111, 0, P_CRASH | P_FILL},   /* kick: an eighth and two sixteenths, every beat */
    {"THRASH",            0x01010101, 0x10101010, 0x11111111, 0, P_CRASH | P_FILL},   /* kick on the beats, snare between them: twice as fast as rock */
    {"BLAST",             0x11111111, 0x44444444, 0, 0x11111111, P_CRASH},            /* kick and snare by turns in sixteenths under a cymbal */
    {"MACHINE GUN",       0xFFFFFFFF, 0x01000100, 0, 0x01010101, P_CRASH | P_FILL},   /* kick on every thirty-second */
    {"ROCK",              0x00110001, 0x01000100, 0x11111111, 0, P_FILL},             /* kick on 1, 3 and the "and" after; snare on 2 and 4 */
    {"FOUR ON THE FLOOR", 0x01010101, 0x01000100, 0, 0x10101010, 0},                  /* kick on every beat; open hats between */
    {"HALF TIME",         0x00100001, 0x00010000, 0x01010101, 0, P_CRASH},            /* one snare a bar, on 3 */
};
#define NPATTERNS (sizeof PATTERNS / sizeof PATTERNS[0])
#define SONG (NPATTERNS + 1u)            /* fm1_drums_pattern: the song's own drum part */
static const uint32_t FILL_SNARE = 0x00550000, FILL_TOM = 0x55000000;   /* sixteenths: beat 3 on the snare, beat 4 down the toms */

int fm1_drums_patterns(void) { return (int)SONG; }                    /* settings of fm1_drums_pattern above 0 */
int fm1_drums_kits(void) { return (int)NKITS; }
const char *fm1_drums_pattern_name(int n) { return n == (int)SONG ? "THE SONG'S OWN" : n >= 1 && n <= (int)NPATTERNS ? PATTERNS[n - 1].name : "OFF"; }
const char *fm1_drums_kit_name(int n) { return KITS[n >= 0 && n < (int)NKITS ? n : 0].name; }

/* the song's own part: General MIDI notes 35 .. 81 as a voice and semitones from its pitch (Felucca's eng_drum.c) */
static const int8_t DRUM_GM[47][2] = {
    {DVT_PUNCH, -2}, {DVT_PUNCH, 0}, {DVT_RIM, 0}, {DVT_SNARE, 0}, {DVT_CLAP, 0}, {DVT_SNARE, 2},
    {DVT_TOM, -7}, {DVT_HATC, 0}, {DVT_TOM, -4}, {DVT_HATC, -2}, {DVT_TOM, 0}, {DVT_HATO, 0},
    {DVT_TOM, 3}, {DVT_TOM, 5}, {DVT_CYM, 0}, {DVT_TOM, 8}, {DVT_CYM, -3}, {DVT_CYM, 2},
    {DVT_BELL, 5}, {DVT_HATC, 5}, {DVT_CYM, 4}, {DVT_BELL, 0}, {DVT_CYM, 1}, {DVT_CLAVE, -12},
    {DVT_CYM, -2}, {DVT_CONGA, 5}, {DVT_CONGA, 2}, {DVT_CONGA, 0}, {DVT_CONGA, 0}, {DVT_CONGA, -5},
    {DVT_TOM, 10}, {DVT_TOM, 7}, {DVT_BELL, 7}, {DVT_BELL, 3}, {DVT_HATC, 3}, {DVT_HATC, 7},
    {DVT_CLAVE, 7}, {DVT_CLAVE, 5}, {DVT_HATC, -4}, {DVT_HATC, -6}, {DVT_CLAVE, 0}, {DVT_CLAVE, -4},
    {DVT_CLAVE, -7}, {DVT_CONGA, 7}, {DVT_CONGA, 3}, {DVT_BELL, 12}, {DVT_BELL, 12},
};
static const uint8_t DV_TYPE_LANE[DVT_COUNT] = {
    DV_KICK, DV_KICK, DV_SNARE, DV_CLAP, DV_HATC, DV_HATO, DV_TOM, DV_TOM, DV_RIM, DV_RIM, DV_BELL, DV_BELL,
};

/* ---- the voices: one a lane, as on the synth */
static dv_param_t par[DV_NLANE];
static dv_coef_t coef[DV_NLANE];
static dv_voice_t voice[DV_NLANE];
static dv_metal_t metal;                 /* the hats' and cymbals' source */
static uint8_t have[DV_NLANE];           /* coef[] has been made */
static uint32_t hits;                    /* (test hook) since the start */
static int32_t ducked;                   /* how far the music is stepped back now, Q15 of the kit's depth */

/* hits waiting for their sample in the pass being mixed */
enum { KICK, SNARE, HAT, OPEN, CRASH, TOM, ROLES };
static struct {
    uint16_t at;                         /* mixer frame of the pass */
    uint8_t type;                        /* DVT_*: what the kit plays it on is decided when it sounds */
    int8_t st;                           /* semitones from the sound's pitch */
    uint8_t accent;
    uint8_t vel;                         /* how hard, of 127: the sound's level is scaled by it */
} queue[24];
static uint8_t queued;

static void sound(uint32_t type, int tune, uint32_t decay, uint32_t tone, uint32_t extra, uint32_t level, uint32_t accent, int designed)
{
    uint32_t lane = DV_TYPE_LANE[DV_KITOF(type) ? DVT_PUNCH : type];
    dv_param_t p;
    if (DV_KITOF(type))
        lane = type & 7u;
    dv_default(&p, type);
    if (!designed) {
        p.decay = (uint8_t)decay;
        p.tone = (uint8_t)tone;
        p.extra = (uint8_t)extra;
        p.level = (uint8_t)level;
    } else
        p.level = (uint8_t)(p.level * level / 127u);        /* (designed: `level` is how hard it is struck, of 127) */
    p.tune = (int16_t)(tune * 16);
    p.accent = (uint8_t)accent;
    if (!have[lane] || memcmp(&p, &par[lane], sizeof p)) {
        par[lane] = p;
        dv_setup(&coef[lane], &p);
        have[lane] = 1;
    }
    if (dv_uses_metal(coef[lane].type))
        dv_metal_tune(&metal, &coef[lane]);
    if (lane == DV_HATC)
        dv_choke(&voice[DV_HATO]);       /* a closed hat stops the open one */
    dv_trigger(&voice[lane]);
}

/* one hit, on whatever the kit has for it */
static void strike(uint32_t type, int st, uint32_t accent, uint32_t vel)
{
    const kit_t *k = &KITS[fm1_drums_kit < NKITS ? fm1_drums_kit : 0];
    const sound_t *own = 0, *layer = 0;
    hits++;
    if (type == DVT_PUNCH || type == DVT_ROUND || type == DVT_SNARE)
        ducked = 32767;
    if (k->model == 0xFF || k->model) {                     /* Felucca's kits, as designed */
        sound(k->model == 0xFF ? type : DV_KTYPE(k->model, DV_TYPE_LANE[type]), st, 0, 0, 0, vel, accent, 1);
        return;
    }
    switch (type) {
    case DVT_PUNCH: case DVT_ROUND: own = &k->kick; layer = &k->kick2; break;
    case DVT_SNARE: own = &k->snare; layer = &k->snare2; break;
    case DVT_HATC: own = &k->hat; break;
    case DVT_HATO: own = &k->open; break;
    case DVT_CYM: own = &k->crash; break;
    case DVT_TOM: own = &k->tom; break;
    }
    if (!own || own->type == 0xFF) {                        /* nothing of the kit's own for it: Felucca's */
        sound(type, st, 0, 0, 0, vel, accent, 1);
        return;
    }
    sound(own->type, own->tune + st, own->decay, own->tone, own->extra, own->level * vel / 127u, accent, 0);
    if (layer && layer->type != 0xFF)
        sound(layer->type, layer->tune, layer->decay, layer->tone, layer->extra, layer->level * vel / 127u, accent, 0);
}

static void later(uint32_t type, int st, uint32_t accent, uint32_t vel)
{
    if (queued == sizeof queue / sizeof queue[0])
        return;
    queue[queued].at = (uint16_t)fm1_pass_frames;
    queue[queued].type = (uint8_t)type;
    queue[queued].st = (int8_t)st;
    queue[queued].accent = (uint8_t)accent;
    queue[queued].vel = (uint8_t)vel;
    queued++;
}

/* a drum note of the song (General MIDI note, volume 0 .. 127): played only when the song's own part is chosen */
void fm1_drums_hit(int note, int volume)
{
    if (fm1_drums_pattern != SONG || note < 35 || note > 81)
        return;
    later((uint32_t)DRUM_GM[note - 35][0], DRUM_GM[note - 35][1], volume > 100 ? 100 : volume > 70 ? 50 : 0, 127);
}

/* what the pattern has at a step: `step` counts thirty-seconds through four bars, 0 .. 4 * BAR - 1 */
static uint32_t at_step(int step, uint32_t *kick, uint32_t *snare, uint32_t *hat, uint32_t *open, uint32_t *crash, uint32_t *tom)
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
    return at_step(step & (4 * BAR - 1), &a, &b, &c, &d, &e, &f) != 0;
}
/* a step has come */
void fm1_drums_step(int step)
{
    uint32_t kick, snare, hat, open, crash, tom, s = (uint32_t)step & (4 * BAR - 1), beat = !(s & 7), in = s % BAR;
    if (!at_step((int)s, &kick, &snare, &hat, &open, &crash, &tom))
        return;
    /* the beats hardest: a fast foot plays lighter the faster it goes (eighths, sixteenths, thirty-seconds) */
    if (kick) later(DVT_PUNCH, 0, beat ? 110 : 60, beat ? 127 : !(in & 3) ? 108 : !(in & 1) ? 92 : 76);
    if (snare) later(DVT_SNARE, 0, beat ? 110 : 60, beat || in >= BAR / 2 + 4 ? 127 : 108);
    if (tom) later(DVT_TOM, in < 28 ? 5 : -4, 110, 127);                    /* a high tom, then a low one */
    if (hat) later(DVT_HATC, 0, beat ? 60 : 0, beat ? 127 : 100);
    if (open) later(DVT_HATO, 0, beat ? 70 : 30, 127);
    if (crash) later(DVT_CYM, 0, 127, 127);
}

int fm1_drums_hits(void) { return (int)hits; }                       /* (test hook) */

/* (the prototype page's M key; no button of the panel has this yet) the music's dip under a hit, a step less each
 * time and round to the most; says which, and returns it */
int fm1_drums_dip_next(void)
{
    static char text[] = "MUSIC DIP 0 OF 5", push[] = "MUSIC PUSH 0 OF 5";
    fm1_drums_dip = (uint8_t)((fm1_drums_dip + 4u) % 5u);
    text[10] = push[11] = (char)('1' + fm1_drums_dip);
    fm1_osd_say(KITS[fm1_drums_kit < NKITS ? fm1_drums_kit : 0].limit ? push : text);   /* (a kit on the limiter: how hard the music goes in) */
    return fm1_drums_dip;
}

/* ---- the sound */
static int32_t block[CTL + 1];           /* the kit's last block, and before it the sample that ended the one before */
static uint32_t at = (uint32_t)CTL << 16;
static uint8_t ringing;                  /* a voice was live in the last block */
static int32_t dist_hp, dist_lp1, dist_lp2;     /* DIST's filters */
static int32_t crush_held;                      /* CRUSH's held sample ... */
static uint8_t crush_n;                         /* ... and how long it has been held */
static int32_t lim_env = 18000;                 /* the master limiter's envelope */
static int32_t dc_l, dc_r, dce_l, dce_r;        /* ... and the DC blocker in front of it */
static int32_t engaged;                         /* how far the limiter's chain is faded in, 0 .. 4096 */
#define LIM_T 18000                      /* Felucca's master limiter: its threshold */
static const uint16_t PUSH[5] = {181, 256, 362, 512, 724};   /* the mix into the limiter, x 256: the M key's five steps */

/* Felucca's DIST (fx.c track_dist), on the kit as one track: a low cut, drive of 1 to 9 times, a lopsided soft clip
 * (a little bias: even harmonics), a two-pole tone filter that closes as the drive rises, make-up */
static int32_t dist_run(int32_t x, int32_t d)
{
    const int32_t g = 4096 + d * d * 2, k = 32000 - d * 95, mk = 30000 - d * 120, bias = 2400;
    int32_t y;
    dist_hp += (x - dist_hp + 64) >> 7;
    x = clamp(x - dist_hp, -230000, 230000);
    y = softclip((((x >> 2) * g) >> 10) + bias) - softclip(bias);
    dist_lp1 += mulq15(y - dist_lp1, k);
    dist_lp2 += mulq15(dist_lp1 - dist_lp2, k);
    return mulq15(dist_lp2, mk);
}

static void render(void)
{
    const kit_t *k = &KITS[fm1_drums_kit < NKITS ? fm1_drums_kit : 0];
    int32_t y[CTL], m[CTL], sum[CTL], g = 0, mk = 0;
    uint32_t lane, i, any = 0, needs_metal = 0;
    block[0] = block[CTL];
    memset(sum, 0, sizeof sum);
    if (k->drv) {                        /* Felucca's DRV (eng_drum.c drum_render): x1 .. x4 into the soft clip, the level kept */
        g = 4096 + k->drv * 3 * 4096 / 127;
        mk = (int32_t)((19661u << 15) / (uint32_t)softclip((19661 * g) >> 12));
    }
    for (lane = 0; lane < DV_NLANE; lane++)
        if (have[lane] && (voice[lane].live || voice[lane].trig) && dv_uses_metal(coef[lane].type))
            needs_metal = 1;
    if (needs_metal)
        dv_metal_run(&metal, m, CTL);
    for (lane = 0; lane < DV_NLANE; lane++) {
        if (!have[lane] || !(voice[lane].live || voice[lane].trig))
            continue;
        dv_run(&coef[lane], &voice[lane], needs_metal ? m : 0, y, CTL);
        for (i = 0; i < CTL; i++) {
            int32_t v = y[i];
            if (g)
                v = (softclip((v * g) >> 12) * mk) >> 15;
            if (k->limit)                /* ... and its voice level: x1.25 under a knee, then x1.46 onto the track */
                v = (soft_knee(v + (v >> 2), 24000) * 47840) >> 15;
            sum[i] += v;
        }
        any = 1;
    }
    for (i = 0; i < CTL; i++) {
        int32_t v = sum[i];
        if (k->dist)
            v = dist_run(v, k->dist);
        if (k->crush && (any || v)) {    /* Felucca's CRUSH (perform.c perf_block): 12 .. 5 bits, each held 1 .. 8 samples */
            const uint32_t sh = 4u + k->crush * 7u / 100u;
            if (++crush_n >= sh - 3u) {
                crush_n = 0;
                crush_held = ((v >> sh) << sh) + (1 << (sh - 1u));
            }
            v = crush_held;
        }
        if (k->drive != 256)             /* (the kits made here: all of it together into a soft clip) */
            v = softclip(clamp((v * k->drive) >> 8, -65535, 65535));
        block[i + 1] = (((v * k->level) >> 8) * LOUD[fm1_drums_loud < 5 ? fm1_drums_loud : 2]) >> 8;
    }
    ringing = (uint8_t)(any || (k->dist && (dist_lp2 > 8 || dist_lp2 < -8)));
}

/* Felucca's DC blocker (fx.c dc_block), about 2 Hz: a leaky integrator of the input taken from it, the step's
 * remainder kept. (The chip's music is lopsided: MEASURED, the game's own mix sits 1,400 above zero, which would
 * otherwise use up one side of the limiter's room.) */
static inline int32_t dc_block(int32_t x, int32_t *dc, int32_t *err)
{
    int32_t e = (x << 6) - *dc + *err, d = e >> 12;
    *err = e - (d << 12);
    *dc += d;
    return x - ((*dc + 32) >> 6);
}

/* Felucca's master stage (fx.c master_out) on one frame: the DC blocker, then a peak limiter (it gives way in a
 * tenth of a millisecond and comes back over a tenth of a second) in front of a soft clip, so that a hit pushes
 * everything else down */
static void master(int32_t *l, int32_t *r)
{
    int32_t al, ar, a;
    *l = dc_block(*l, &dc_l, &dce_l);
    *r = dc_block(*r, &dc_r, &dce_r);
    al = *l < 0 ? -*l : *l;
    ar = *r < 0 ? -*r : *r;
    a = al > ar ? al : ar;
    if (a > lim_env)
        lim_env += (a - lim_env) >> 2;
    else if (lim_env > LIM_T)
        lim_env -= ((lim_env - LIM_T) >> 12) + 1;
    if (lim_env > LIM_T) {
        int32_t g = (int32_t)(((uint32_t)LIM_T << 15) / (uint32_t)lim_env);
        *l = ((*l >> 4) * g) >> 11;
        *r = ((*r >> 4) * g) >> 11;
    }
    *l = softclip(*l);
    *r = softclip(*r);
}

/* Add the drums to `frames` frames of the mixer's 16-bit stereo: the pass the queued hits belong to.
 * The kits made here: under a kick or a snare the rest steps back a little (the kit says how far) and comes back
 * over about a tenth of a second, and the sum has a soft top above half scale. The kits on Felucca's chain: the
 * whole mix, pushed by the M key's setting, goes through Felucca's master limiter for as long as a pattern is on. */
void fm1_drums_mix(int16_t *stereo, uint32_t frames)
{
    const uint32_t step = (uint32_t)(((uint64_t)FS << 16) / MIX_RATE);   /* voice samples a mixer frame, 16.16 */
    const kit_t *k = &KITS[fm1_drums_kit < NKITS ? fm1_drums_kit : 0];
    const int32_t depth = (k->duck * DIP[fm1_drums_dip < 5 ? fm1_drums_dip : 3]) >> 8;
    const int32_t push = PUSH[fm1_drums_dip < 5 ? fm1_drums_dip : 3], want = k->limit && fm1_drums_pattern ? 4096 : 0;
    uint32_t f, q;
    if (!queued && !ringing && !engaged && !want) {   /* nothing playing (the last block was silence), nothing to come: no work */
        at = (uint32_t)CTL << 16;
        block[CTL] = 0;
        ducked = 0;
        lim_env = LIM_T;
        return;
    }
    for (f = 0; f < frames; f++, stereo += 2) {
        int32_t a, b, s, g, l, r;
        if (at >= (uint32_t)CTL << 16) {
            at -= (uint32_t)CTL << 16;
            for (q = 0; q < queued; q++)                     /* hits whose sample has come, in the order they were made */
                if (queue[q].at <= f && queue[q].type != 0xFF) {
                    strike(queue[q].type, queue[q].st, queue[q].accent, queue[q].vel);
                    queue[q].type = 0xFF;
                }
            render();
        }
        a = block[at >> 16];
        b = block[(at >> 16) + 1u];
        s = a + (int32_t)(((int64_t)(b - a) * (int32_t)(at & 0xFFFFu)) >> 16);
        at += step;
        g = 256 - ((depth * ducked) >> 15);
        ducked -= (ducked * 15) >> 16;                       /* about 90 ms to a third */
        l = soft_knee(((stereo[0] * g) >> 8) + s, 16384);    /* the kits made here */
        r = soft_knee(((stereo[1] * g) >> 8) + s, 16384);
        if (engaged || want) {                               /* Felucca's master, faded in and out over about 40 ms */
            int32_t fl = ((stereo[0] * push) >> 8) + s, fr = ((stereo[1] * push) >> 8) + s;
            master(&fl, &fr);
            engaged += engaged < want ? 2 : engaged > want ? -2 : 0;
            l += ((fl - l) * (engaged >> 4)) >> 8;
            r += ((fr - r) * (engaged >> 4)) >> 8;
        }
        stereo[0] = (int16_t)clamp(l, -32767, 32767);
        stereo[1] = (int16_t)clamp(r, -32767, 32767);
    }
    for (q = 0; q < queued; q++)                             /* (any left fell in the pass's last block: play them next) */
        if (queue[q].type != 0xFF)
            strike(queue[q].type, queue[q].st, queue[q].accent, queue[q].vel);
    queued = 0;
}
