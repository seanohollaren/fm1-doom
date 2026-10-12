/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: makes firmware/fm1_sound_gen.h, what the firmware's drum machine and synth need from Felucca's
 * set-up code and tables, worked out here on the build machine so that the set-up code and most of the tables
 * need no room in the FM-1's flash (15.7 KB was free when this was written).
 *   - the drum kit: Felucca's own kit as designed (drum_voice.c dv_default, dv_setup), one set of coefficients
 *     for every way the patterns strike a voice (how hard, how accented, a tom's pitch)
 *   - the three sounds: Felucca's ANALOG presets SAW LEAD, ACID and RAVE as its PRESETS knob sets them
 *     (eng_analog.c ANALOG_PRESETS, ui.c apply_preset_to), their envelope times as the steps its tables give
 *   - the single values the firmware uses of Felucca's larger tables
 * tools/gen_sound.sh builds and runs this (cc on the Mac); firmware/test.sh checks that the header in the
 * repository is what it prints. Felucca: Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton
 * Instruments, GPL-3.0-only. */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#define bootguard gen_bootguard
#define __attribute__(x)
#include "felucca_tables.h"
#include "core.h"
#include "dsp.c"
#include "drum_voice.c"
#include "eng_analog.c"

/* every way the patterns strike a voice (firmware/fm1_drums.c fm1_drums_step): the voice, semitones from its
 * pitch, the accent, how hard of 127 */
static const struct { const char *name; uint8_t type; int8_t st; uint8_t accent, vel; } HITS[] = {
    {"K_KICK", DVT_PUNCH, 0, 110, 127},      /* on a beat */
    {"K_KICK_8", DVT_PUNCH, 0, 60, 108},     /* a fast foot plays lighter the faster it goes: eighths, */
    {"K_KICK_16", DVT_PUNCH, 0, 60, 92},     /* sixteenths, */
    {"K_KICK_32", DVT_PUNCH, 0, 60, 76},     /* thirty-seconds */
    {"K_SNARE", DVT_SNARE, 0, 110, 127},     /* on a beat */
    {"K_SNARE_END", DVT_SNARE, 0, 60, 127},  /* off the beat at the end of a fill */
    {"K_SNARE_OFF", DVT_SNARE, 0, 60, 108},  /* off the beat */
    {"K_TOM_HIGH", DVT_TOM, 5, 110, 127},
    {"K_TOM_LOW", DVT_TOM, -4, 110, 127},
    {"K_HAT", DVT_HATC, 0, 60, 127},         /* on a beat */
    {"K_HAT_OFF", DVT_HATC, 0, 0, 100},
    {"K_OPEN", DVT_HATO, 0, 70, 127},        /* on a beat */
    {"K_OPEN_OFF", DVT_HATO, 0, 30, 127},
    {"K_CRASH", DVT_CYM, 0, 127, 127},
};
static const uint8_t SOUNDS[] = {0, 4, 6};   /* ANALOG_PRESETS: SAW LEAD, ACID, RAVE */

int main(void)
{
    static const uint8_t FX_DEF[4] = {0, 24, 28, 36};       /* (hostsim.c host_preset_values; ui.c) */
    uint32_t i, k;
    printf("/* SPDX-License-Identifier: GPL-3.0-only */\n");
    printf("/* MADE BY firmware/gen_sound.c (tools/gen_sound.sh) from Felucca " "v1.1.5" "'s set-up code and tables: do not edit.\n");
    printf(" * Felucca: Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments, GPL-3.0-only. */\n\n");
    printf("/* the drum kit: Felucca's own, as designed; a dv_coef_t (drum_voice.c) as words for each way a voice is struck */\n");
    printf("#define FM1_KIT_WORDS %uu\n", (unsigned)(sizeof(dv_coef_t) / 4u));
    printf("enum {");
    for (i = 0; i < NELEM(HITS); i++)
        printf(" %s,", HITS[i].name);
    printf(" K_COUNT };\n");
    printf("static const uint32_t FM1_KIT[K_COUNT][FM1_KIT_WORDS] = {\n");
    for (i = 0; i < NELEM(HITS); i++) {
        dv_param_t p;
        dv_coef_t c;
        uint32_t w[sizeof(dv_coef_t) / 4u];
        memset(&c, 0, sizeof c);
        dv_default(&p, HITS[i].type);
        p.level = (uint8_t)(p.level * HITS[i].vel / 127u);
        p.tune = (int16_t)(HITS[i].st * 16);
        p.accent = HITS[i].accent;
        dv_setup(&c, &p);
        if (dv_uses_metal(c.type) && c.span[1]) {           /* (fm1_drums.c lane_run leaves dv_run's branch for it out) */
            fprintf(stderr, "%s mixes noise into the metal source: only a model kit's voice does\n", HITS[i].name);
            return 1;
        }
        memcpy(w, &c, sizeof w);
        printf("    {");
        for (k = 0; k < sizeof w / 4u; k++)
            printf("%s0x%08Xu", k ? ", " : "", (unsigned)w[k]);
        printf("},   /* %s */\n", HITS[i].name);
    }
    printf("};\n\n");
    printf("/* the three sounds: the engine's eight values, the envelope (attack: what a control tick adds, Q24; decay\n");
    printf(" * and release: the share a tick takes, Q16; sustain 0 .. 127), envelope to filter, and the four sends */\n");
    printf("typedef struct {\n    const char *name;\n    int8_t e[8];\n    uint32_t attack;\n    uint16_t decay, release;\n");
    printf("    uint8_t sustain;\n    int8_t fenv;\n    uint8_t dist, chorus, delay, reverb;\n} fm1_sound_t;\n");
    printf("static const fm1_sound_t FM1_SOUNDS[%u] = {\n", (unsigned)NELEM(SOUNDS));
    for (i = 0; i < NELEM(SOUNDS); i++) {
        const preset_t *p = &ANALOG_PRESETS[SOUNDS[i]];
        if (!p->mono) {
            fprintf(stderr, "%s is not a one-note preset: the synth has no chords\n", p->name);
            return 1;
        }
        printf("    {\"%s\", {", p->name);
        for (k = 0; k < 8u; k++)
            printf("%s%d", k ? ", " : "", p->e[k]);
        printf("}, %uu, %u, %u, %u, %d", (unsigned)ENV_LIN[p->env[0] & 127], ENV_EXP[p->env[1] & 127], ENV_EXP[p->env[3] & 127], p->env[2], p->fenv);
        for (k = 0; k < 4u; k++)
            printf(", %u", p->fx[k] ? p->fx[k] - 1 : FX_DEF[k]);
        printf("},\n");
    }
    printf("};\n\n");
    printf("/* single values of Felucca's tables and defaults (params.c TP, GP) */\n");
    printf("#define FM1_LEVEL_Q12 %d           /* LEVEL_Q12[%d]: a part's level, LVL as it starts */\n", LEVEL_Q12[104], 104);
    printf("#define FM1_CHORUS_INC %uu      /* LFO_INC[%d] / CTL: the chorus's rate a sample */\n", (unsigned)(LFO_INC[40] / CTL), 40);
    printf("#define FM1_CHORUS_DEPTH %d        /* CDP %d: x 6 */\n", 60 * 6, 60);
    printf("#define FM1_DELAY_FB %d          /* FDBK %d: x 230 */\n", 60 * 230, 60);
    printf("#define FM1_DELAY_COLOR %d       /* COLR %d: 2000 + x 240 */\n", 2000 + 70 * 240, 70);
    printf("#define FM1_DELAY_MIX %d         /* MIX %d: x 258 */\n", 90 * 258, 90);
    printf("#define FM1_DELAY_DIV %d             /* TIME: an eighth (fx.c DIV_DEN[%d]) */\n", 2, 1);
    printf("#define FM1_REVERB_SIZE %d       /* SIZE %d: 25000 + x 50 */\n", 25000 + 90 * 50, 90);
    printf("#define FM1_REVERB_DAMP %d       /* DAMP %d: 32767 - x 200 */\n", 32767 - 60 * 200, 60);
    return 0;
}
