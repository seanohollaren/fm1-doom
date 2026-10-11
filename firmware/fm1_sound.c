/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: the two things the firmware has of Felucca's sound, in one compilation unit so that they share its
 * tables: a drum machine under the game's music (fm1_drums.c) and three of Felucca's synth sounds to play the
 * music's melody on, with its chorus, delay and reverb (fm1_synth.c).
 *
 * Felucca's code is used as it is where it fits and copied in cut-down form where it does not; which is which
 * is said at each place. Felucca: Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments,
 * GPL-3.0-only; read from the Felucca checkout beside this repository:
 *   Felucca/build/gen/felucca_tables.h     its tables (made by its build); only those used take room
 *   Felucca/firmware/src/dsp.c             oscillators, the filter, the soft clip: unchanged
 *   Felucca/firmware/src/drum_voice.c      the drum voices: unchanged
 *   firmware/fm1_sound_gen.h               made from its set-up code and presets by firmware/gen_sound.c
 *
 * Both run at the 44,100 Hz Felucca's tables are made for, 32 samples (CTL) at a time, and are brought to the
 * game's mixer (49,716 Hz) by straight-line interpolation. The music's player (rp2040-doom src/i_oplmusic.c,
 * under FM1_DRUMS and FM1_FM6) calls in from inside a mixer pass; how far into the pass (fm1_pass_frames) is kept
 * with each hit and note, so that it sounds on its sample and not at the start of the pass.
 *
 * Size and cost matter here more than anywhere: see NOTES.md, "What could ship". */
#include <stdint.h>
#include <string.h>
#include "felucca_tables.h"
typedef struct {                         /* Felucca's core.h vmod_t, which dsp.c names: a voice's values for a block */
    uint32_t inc;                        /* phase increment of its pitch */
    int32_t pitch16;                     /* the pitch, 1/16 semitone */
    int32_t amp0, amp1;                  /* the amplitude at the block's start and end, Q15 */
    int32_t cutoff, shape, envq15, fine;
} vmod_t;
#include "dsp.c"
#include "drum_voice.c"
#include "fm1_sound_gen.h"

#define MIX_RATE 49716u                  /* the game's mixer (rp2040-doom src/fm1/fm1_audio.c) */
#define MIX_STEP ((uint32_t)(((uint64_t)FS << 16) / MIX_RATE))   /* Felucca samples a mixer frame, 16.16 */
extern unsigned int fm1_pass_frames;     /* rp2040-doom opl/opl_pico.c: mixer frames of this pass made so far */

/* Felucca's DIST (fx.c track_dist), unchanged but for where its state lives: a low cut at about 55 Hz, drive of
 * 1 to 9 times, a lopsided soft clip (a little bias: even harmonics), a two-pole tone filter that closes as the
 * drive rises, make-up. d: 1 .. 127. */
typedef struct { int32_t hp, lp1, lp2; } fm1_dist_t;
static __attribute__((noinline)) void fm1_dist(fm1_dist_t *t, int32_t d, int32_t *b, uint32_t n)
{
    const int32_t g = 4096 + d * d * 2, k = 32000 - d * 95, mk = 30000 - d * 120, bias = 2400, b0 = softclip(bias);
    for (uint32_t i = 0; i < n; i++) {
        int32_t x = b[i], y;
        t->hp += (x - t->hp + 64) >> 7;
        x = clamp(x - t->hp, -230000, 230000);
        y = softclip((((x >> 2) * g) >> 10) + bias) - b0;
        t->lp1 += mulq15(y - t->lp1, k);
        t->lp2 += mulq15(t->lp1 - t->lp2, k);
        b[i] = mulq15(t->lp2, mk);
    }
}

/* Felucca's master stage (fx.c dc_block, master_out), unchanged but for where its state lives: a DC blocker of
 * about 2 Hz, then a peak limiter (it gives way in a tenth of a millisecond and comes back over a tenth of a
 * second) in front of the soft clip: what is loud pushes everything else down for a moment. One frame. */
#define LIM_T 18000                      /* the limiter's threshold */
typedef struct { int32_t dc[2], dce[2], env; } fm1_master_t;
static __attribute__((noinline)) void fm1_master(fm1_master_t *m, int32_t *lr)
{
    int32_t a = 0;
    for (uint32_t c = 0; c < 2u; c++) {
        int32_t e = (lr[c] << 6) - m->dc[c] + m->dce[c], d = e >> 12, x;
        m->dce[c] = e - (d << 12);
        m->dc[c] += d;
        x = lr[c] - ((m->dc[c] + 32) >> 6);
        lr[c] = x;
        x = x < 0 ? -x : x;
        if (x > a)
            a = x;
    }
    if (a > m->env)
        m->env += (a - m->env) >> 2;
    else if (m->env > LIM_T)
        m->env -= ((m->env - LIM_T) >> 12) + 1;
    for (uint32_t c = 0; c < 2u; c++) {
        if (m->env > LIM_T)
            lr[c] = ((lr[c] >> 4) * (int32_t)(((uint32_t)LIM_T << 15) / (uint32_t)m->env)) >> 11;
        lr[c] = softclip(lr[c]);
    }
}

#include "fm1_synth.c"                   /* (first: the drum machine's limiter takes the synth's sound in with the rest) */
#include "fm1_drums.c"
