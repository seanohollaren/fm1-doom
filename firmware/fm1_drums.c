/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom, PROTOTYPE (browser build only so far): a drum machine over the game's music, with Felucca's drums.
 *
 * A press of a button and a beat comes in under the song, in time with it: the song's own drum part played on
 * real drum voices in place of the sound-card chip's, or a pattern of the machine's own (a rock beat, four on
 * the floor, half time). While it plays, the chip's percussion is silent.
 *
 * The voices are Felucca's DRUM engine, unchanged, read from the Felucca checkout beside this repository:
 *   Felucca/firmware/src/drum_voice.c, dsp.c   Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton
 *                                              Instruments, GPL-3.0-only
 *   Felucca/build/gen/felucca_tables.h         its tables (made by Felucca's build)
 * Its own kit, or one of its five model kits. The map from the song's drum notes to voices is Felucca's
 * (eng_drum.c DRUM_GM, DV_TYPE_LANE), copied here.
 *
 * Time: the music's player (rp2040-doom src/i_oplmusic.c, under FM1_DRUMS) calls fm1_drums_step for every
 * sixteenth of the bar and fm1_drums_hit for every drum note of the song, from the same timer its own notes
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
#define LEVEL 80                         /* of 256: a kick and a snare struck together, accented, peak near 18,000 of 32,767 */

volatile uint8_t fm1_drums_pattern;      /* 0: off; 1: the song's own drum part; 2 ..: PATTERNS[n - 2] */
volatile uint8_t fm1_drums_kit;          /* 0: Felucca's own kit; 1 .. DV_NKIT: its model kits */
extern unsigned int fm1_pass_frames;     /* rp2040-doom opl/opl_pico.c: mixer frames of this pass made so far */

/* ---- what plays */
static const int8_t DRUM_GM[47][2] = {   /* General MIDI notes 35 .. 81: the voice, and semitones from its own pitch */
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
/* the machine's own patterns: a bar of sixteen steps, bit n = step n; kick, snare, closed hat, open hat, crash */
static const struct {
    const char *name;
    uint16_t kick, snare, hat, open;
} PATTERNS[] = {
    {"ROCK",              0x0501, 0x1010, 0x5555, 0x0000},   /* kick on 1, 3 and the "and" after; snare on 2 and 4; eighths */
    {"FOUR ON THE FLOOR", 0x1111, 0x1010, 0x0000, 0x4444},   /* kick on every beat; snare on 2 and 4; open hats between */
    {"HALF TIME",         0x0401, 0x0100, 0x1111, 0x0000},   /* kick on 1 and late in 3; one snare, on 3; quarters */
};
#define NPATTERNS (sizeof PATTERNS / sizeof PATTERNS[0])
static const char *const KITS[1 + DV_NKIT] = {"STD", "80", "10", "66", "55", "77"};

int fm1_drums_patterns(void) { return 1 + (int)NPATTERNS; }           /* settings of fm1_drums_pattern above 0 */
int fm1_drums_kits(void) { return 1 + DV_NKIT; }
const char *fm1_drums_pattern_name(int n) { return n == 1 ? "THE SONG'S OWN" : n >= 2 && n < 2 + (int)NPATTERNS ? PATTERNS[n - 2].name : "OFF"; }
const char *fm1_drums_kit_name(int n) { return KITS[n >= 0 && n <= DV_NKIT ? n : 0]; }

/* ---- the voices: one a lane, as on the synth */
static dv_param_t par[DV_NLANE];
static dv_coef_t coef[DV_NLANE];
static dv_voice_t voice[DV_NLANE];
static dv_metal_t metal;                 /* the hats' and cymbals' source */
static uint8_t have[DV_NLANE];           /* coef[] has been made */
static uint32_t hits;                    /* (test hook) since the start */

/* hits waiting for their sample in the pass being mixed */
static struct {
    uint16_t at;                         /* mixer frame of the pass */
    uint8_t type;                        /* DVT_* (the lane's own voice or a variant) */
    int8_t st;                           /* semitones from the voice's pitch */
    uint8_t accent;
} queue[24];
static uint8_t queued;

static void strike(uint32_t type, int st, uint32_t accent)
{
    uint32_t lane = DV_TYPE_LANE[type], kit = fm1_drums_kit;
    dv_param_t p;
    dv_default(&p, kit && kit <= DV_NKIT ? DV_KTYPE(kit, lane) : type);
    p.tune = (int16_t)(st * 16);
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
    hits++;
}

static void later(uint32_t type, int st, uint32_t accent)
{
    if (queued == sizeof queue / sizeof queue[0])
        return;
    queue[queued].at = (uint16_t)fm1_pass_frames;
    queue[queued].type = (uint8_t)type;
    queue[queued].st = (int8_t)st;
    queue[queued].accent = (uint8_t)accent;
    queued++;
}

/* a drum note of the song (General MIDI note, volume 0 .. 127): played only when the song's own part is chosen */
void fm1_drums_hit(int note, int volume)
{
    if (fm1_drums_pattern != 1 || note < 35 || note > 81)
        return;
    later((uint32_t)DRUM_GM[note - 35][0], DRUM_GM[note - 35][1], volume > 100 ? 100 : volume > 70 ? 50 : 0);
}

/* a sixteenth of the bar has come (0 .. 15) */
void fm1_drums_step(int step)
{
    uint32_t n = fm1_drums_pattern, bit = 1u << (step & 15), beat = !(step & 3);
    if (n < 2 || n >= 2 + NPATTERNS)
        return;
    if (PATTERNS[n - 2].kick & bit) later(DVT_PUNCH, 0, beat ? 80 : 30);
    if (PATTERNS[n - 2].snare & bit) later(DVT_SNARE, 0, 80);
    if (PATTERNS[n - 2].hat & bit) later(DVT_HATC, 0, beat ? 60 : 0);
    if (PATTERNS[n - 2].open & bit) later(DVT_HATO, 0, 40);
}

int fm1_drums_hits(void) { return (int)hits; }                       /* (test hook) */

/* ---- the sound */
static int32_t block[CTL + 1];           /* the voices' last block, and before it the sample that ended the one before */
static uint32_t at = (uint32_t)CTL << 16;
static uint8_t ringing;                  /* a voice was live in the last block */

static void render(void)
{
    int32_t y[CTL], m[CTL];
    uint32_t lane, i, any = 0, needs_metal = 0;
    block[0] = block[CTL];
    memset(block + 1, 0, sizeof(int32_t) * CTL);
    for (lane = 0; lane < DV_NLANE; lane++)
        if (have[lane] && (voice[lane].live || voice[lane].trig) && dv_uses_metal(coef[lane].type))
            needs_metal = 1;
    if (needs_metal)
        dv_metal_run(&metal, m, CTL);
    for (lane = 0; lane < DV_NLANE; lane++) {
        if (!have[lane] || !(voice[lane].live || voice[lane].trig))
            continue;
        dv_run(&coef[lane], &voice[lane], needs_metal ? m : 0, y, CTL);
        for (i = 0; i < CTL; i++)
            block[i + 1] += (y[i] * LEVEL) >> 8;
        any = 1;
    }
    ringing = (uint8_t)any;
}

/* Add the drums to `frames` frames of the mixer's 16-bit stereo: the pass the queued hits belong to. */
void fm1_drums_mix(int16_t *stereo, uint32_t frames)
{
    const uint32_t step = (uint32_t)(((uint64_t)FS << 16) / MIX_RATE);   /* voice samples a mixer frame, 16.16 */
    uint32_t f, q;
    if (!queued && !ringing) {           /* nothing playing (the last block was silence), nothing to come: no work */
        at = (uint32_t)CTL << 16;
        block[CTL] = 0;
        return;
    }
    for (f = 0; f < frames; f++, stereo += 2) {
        int32_t a, b, s, l, r;
        if (at >= (uint32_t)CTL << 16) {
            at -= (uint32_t)CTL << 16;
            for (q = 0; q < queued; q++)                     /* hits whose sample has come, in the order they were made */
                if (queue[q].at <= f && queue[q].type != 0xFF) {
                    strike(queue[q].type, queue[q].st, queue[q].accent);
                    queue[q].type = 0xFF;
                }
            render();
        }
        a = block[at >> 16];
        b = block[(at >> 16) + 1u];
        s = a + (int32_t)(((int64_t)(b - a) * (int32_t)(at & 0xFFFFu)) >> 16);
        at += step;
        l = stereo[0] + s;
        r = stereo[1] + s;
        stereo[0] = (int16_t)(l > 32767 ? 32767 : l < -32768 ? -32768 : l);
        stereo[1] = (int16_t)(r > 32767 ? 32767 : r < -32768 ? -32768 : r);
    }
    for (q = 0; q < queued; q++)                             /* (any left fell in the pass's last block: play them next) */
        if (queue[q].type != 0xFF)
            strike(queue[q].type, queue[q].st, queue[q].accent);
    queued = 0;
}
