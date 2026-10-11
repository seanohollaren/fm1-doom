/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom, PROTOTYPE (browser build only so far): the game's music played by Felucca's six-operator FM engine.
 *
 * Doom's own instruments are two-operator patches for the sound cards of 1992; Felucca's FM6 engine is a
 * six-operator synth of the DX7 kind, and its eight factory patches sound a great deal fuller. With one of them
 * chosen (fm1_fm6_on), the music's melodic notes go here and not to the emulated chip (rp2040-doom
 * src/i_oplmusic.c, under FM1_FM6); the chip keeps the percussion. Everything is on one patch, as with the
 * PRESETS knob's own instruments.
 *
 * The synthesis is Felucca's, unchanged, read from the Felucca checkout beside this repository:
 *   Felucca/firmware/src/fm6_core.c   msfa (Dexed's FM core, Google Inc. and Pascal Gauthier), ported to integer C
 *                                     by Leo Kuroshita, Hügelton Instruments: Apache-2.0
 *   Felucca/build/gen/*.h             its tables and its factory patches (made by Felucca's build): GPL-3.0-only
 * fm6_unpack and the output stage below follow Felucca's firmware/src/eng_fm6.c (Copyright (C) 2026 Leo Kuroshita
 * (@kurogedelic), Hügelton Instruments, GPL-3.0-only).
 *
 * The engine runs at the 44,100 Hz its tables are made for, a block of 32 samples at a time, and is brought to
 * the mixer's 49,716 Hz by straight-line interpolation, so its pitch and its envelopes are Felucca's. */
#include <stdint.h>
#include <string.h>
#include "felucca_tables.h"
#include "fm6_core.c"
#include "felucca_fm6.h"

#define FM6_VOICES 6                     /* Felucca's own cap for this engine on the FM-1's chip */
#define MIX_RATE 49716u                  /* the game's mixer (rp2040-doom src/fm1/fm1_audio.c) */

volatile uint8_t fm1_fm6_on;             /* 0: off; 1 .. FM6_NFACTORY: that factory patch plays the melodic notes */
extern volatile int8_t fm1_music_depth;  /* the FM depth knob (fm1_controls.c): here, the level of every modulator */

static uint8_t patch[FP_SIZE + 1u];      /* the patch in use, unpacked */
static uint8_t patch_of;                 /* the fm1_fm6_on it was unpacked for */
static fm6_lfo_t lfo;
static struct {
    fm6_note_t n;
    uint8_t channel, key, volume;        /* which note of the music this is; its channel's volume, 0 .. 127 */
    int16_t note;                        /* MIDI note sounding (the key, moved by the pitch knob) */
    uint32_t born;
} voice[FM6_VOICES];
static uint32_t births;
static int32_t block[FM6_N + 1];         /* the engine's last block, and before it the sample that ended the one before */
static uint32_t at = (uint32_t)FM6_N << 16;   /* where the mixer is in it, 16.16 (at the end: render another) */

/* 128-byte packed record (a 32-voice bank's) -> 155-byte voice (Felucca's eng_fm6.c fm6_unpack, less its range
 * checks: the records here are Felucca's own) */
static void unpack(const uint8_t *b, uint8_t *v)
{
    uint32_t k, i;
    for (k = 0; k < 6u; k++) {
        const uint8_t *o = b + k * 17u;
        uint8_t *d = v + k * FP_OP;
        for (i = 0; i < 11u; i++)
            d[i] = o[i] & 0x7Fu;
        d[FP_LC] = o[11] & 3u;
        d[FP_RC] = (o[11] >> 2) & 3u;
        d[FP_RS] = o[12] & 7u;
        d[FP_DET] = (o[12] >> 3) & 15u;
        d[FP_AMS] = o[13] & 3u;
        d[FP_KVS] = (o[13] >> 2) & 7u;
        d[FP_OL] = o[14] & 0x7Fu;
        d[FP_MODE] = o[15] & 1u;
        d[FP_FC] = (o[15] >> 1) & 31u;
        d[FP_FF] = o[16] & 0x7Fu;
    }
    for (i = 0; i < 9u; i++)
        v[FP_PR1 + i] = b[102 + i] & 0x7Fu;
    v[FP_ALG] &= 31u;
    v[FP_FB] = b[111] & 7u;
    v[FP_OKS] = (b[111] >> 3) & 1u;
    for (i = 0; i < 4u; i++)
        v[FP_LFS + i] = b[112 + i] & 0x7Fu;
    v[FP_LKS] = b[116] & 1u;
    v[FP_LFW] = (b[116] >> 1) & 7u;
    v[FP_LPMS] = (b[116] >> 4) & 7u;
    v[FP_TRNSP] = b[117] & 0x7Fu;
    for (i = 0; i < 10u; i++)
        v[FP_NAME + i] = b[118 + i] & 0x7Fu;
    v[FP_SIZE] = 0;
}

/* the name of factory patch n (1 .. FM6_NFACTORY), ten characters padded with spaces */
const char *fm1_fm6_name(int n)
{
    static char name[11];
    if (n < 1 || n > FM6_NFACTORY)
        return "";
    for (int i = 0; i < 10; i++)
        name[i] = (char)(FM6_FACTORY[n - 1][118 + i] & 0x7F);
    for (int i = 9; i >= 0 && name[i] == ' '; i--)
        name[i] = 0;
    return name;
}

static void use_patch(void)              /* the patch fm1_fm6_on names; notes of another patch are cut */
{
    uint8_t want = fm1_fm6_on;
    if (want == patch_of || want < 1u || want > FM6_NFACTORY)
        return;
    unpack(FM6_FACTORY[want - 1u], patch);
    fm6_lfo_reset(&lfo, patch);
    for (int i = 0; i < FM6_VOICES; i++)
        voice[i].n.live = 0;
    patch_of = want;
}

void fm1_fm6_note_on(int channel, int key, int note, int velocity, int volume)
{
    int i, pick = -1;
    use_patch();
    if (!patch_of)
        return;
    for (i = 0; i < FM6_VOICES; i++)                         /* the same key again: the same voice goes on */
        if (voice[i].n.live && voice[i].channel == channel && voice[i].key == key)
            pick = i;
    for (i = 0; pick < 0 && i < FM6_VOICES; i++)             /* else one that is free */
        if (!voice[i].n.live)
            pick = i;
    if (pick < 0)                                            /* else the oldest that has been let go, else the oldest */
        for (int held = 0; pick < 0 && held < 2; held++)
            for (i = 0; i < FM6_VOICES; i++)
                if (voice[i].n.down == held && (pick < 0 || voice[i].born < voice[pick].born))
                    pick = i;
    fm6_note_init(&voice[pick].n, patch, note + patch[FP_TRNSP] - 24, velocity < 1 ? 1 : velocity > 127 ? 127 : velocity,
                  !voice[pick].n.live);
    fm6_lfo_key(&lfo);
    voice[pick].channel = (uint8_t)channel;
    voice[pick].key = (uint8_t)key;
    voice[pick].note = (int16_t)note;
    voice[pick].volume = (uint8_t)(volume > 127 ? 127 : volume < 0 ? 0 : volume);
    voice[pick].born = ++births;
}

void fm1_fm6_note_off(int channel, int key)
{
    for (int i = 0; i < FM6_VOICES; i++)
        if (voice[i].n.live && voice[i].n.down && voice[i].channel == channel && voice[i].key == key)
            fm6_note_key(&voice[i].n, patch, 0);
}

void fm1_fm6_channel_off(int channel)
{
    for (int i = 0; i < FM6_VOICES; i++)
        if (voice[i].n.live && voice[i].n.down && voice[i].channel == channel)
            fm6_note_key(&voice[i].n, patch, 0);
}

/* how many voices are sounding (a test hook, and a measure of the work) */
int fm1_fm6_voices(void)
{
    int n = 0;
    for (int i = 0; i < FM6_VOICES; i++)
        n += voice[i].n.live;
    return n;
}

/* the engine's next block of FM6_N samples at 44,100 Hz into block[1 ..]; one full carrier at full volume is 2032
 * (a chord on a loud patch then lies where the chip's music does, with room for six voices and the game's sounds) */
static void render(void)
{
    static const int32_t no_detune[6];
    const uint32_t alg = patch[FP_ALG] & 31u;
    int32_t bus[FM6_N], lfo_v, lfo_d;
    block[0] = block[FM6_N];
    memset(block + 1, 0, sizeof(int32_t) * FM6_N);
    if (!patch_of)
        return;
    lfo_v = fm6_lfo_sample(&lfo);
    lfo_d = fm6_lfo_delay(&lfo);
    for (int i = 0; i < FM6_VOICES; i++) {
        fm6_note_t *n = &voice[i].n;
        if (!n->live)
            continue;
        if (fm6_note_done(n, patch, alg)) {
            n->live = 0;
            continue;
        }
        /* (the FM depth knob: 1.5 dB of every modulator a step; 2^24 is 6 dB) */
        if (!fm6_note_compute(n, patch, bus, lfo_v, lfo_d,
                              fm6_note_logfreq((voice[i].note + patch[FP_TRNSP] - 24) * 16, 0), alg, patch[FP_FB],
                              no_detune, (int32_t)fm1_music_depth * (1 << 22)))
            continue;
        for (int k = 0; k < FM6_N; k++) {
            int32_t x = bus[k] - n->dc;
            n->dc += x >> 10;                                /* as Felucca: FM leaves sidebands at 0 Hz */
            block[k + 1] += (int32_t)(((int64_t)x * voice[i].volume) >> 21);
        }
    }
}

/* Add the engine's sound to `frames` frames of the mixer's 16-bit stereo. */
void fm1_fm6_mix(int16_t *stereo, uint32_t frames)
{
    const uint32_t step = (uint32_t)(((uint64_t)FS << 16) / MIX_RATE);   /* engine samples a mixer frame, 16.16 */
    use_patch();
    if (!fm1_fm6_on && !fm1_fm6_voices())
        return;
    for (; frames; frames--, stereo += 2) {
        int32_t a, b, s, l, r;
        if (at >= (uint32_t)FM6_N << 16) {
            at -= (uint32_t)FM6_N << 16;
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
}
