/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom, PROTOTYPE (browser build only): the game's music played by Felucca's synth, whole.
 *
 * The first prototype (fm1_fm6.c, replaced by this file) had one of Felucca's engines, FM6, dry. What Sean hears
 * on the FM-1 under Felucca is more than that: twelve engines with about seventy factory presets, and every
 * preset sends its sound into a chorus, a tempo-timed delay and a reverb, through a distortion of its own and
 * the master limiter. So this file takes Felucca's sound core as it is, the way its own host tests build it
 * (Felucca tests/hostsim.c: its libc, engines, voices, effects and sequencer in one compilation unit), and plays
 * the music's melodic notes on it; the game's chip keeps the percussion. PRESETS: the factory presets in the
 * order Felucca's own PRESETS knob has them, less the two that need more than notes (DRUM, SLICE).
 *
 * Felucca is four parts, each with one sound, sharing eight voices. Each of the music's channels gets a part of
 * its own (the first four channels that play; later ones share), all four on the same preset, so that a preset
 * Felucca plays one note at a time (its basses and leads, RAVE among them) keeps each line of the music.
 *
 * This is far too large for the FM-1 beside the game (Felucca alone fills the chip's flash); it is here so that a
 * sound can be chosen by ear before any of it is fitted to the device.
 *
 * Everything below the includes is Felucca's, unchanged, read from the Felucca checkout beside this repository:
 * Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments, GPL-3.0-only (its FM6 core is msfa,
 * Apache-2.0; its PHYS models are DaisySP, MIT; its samples CC0). fel_init and fel_preset follow its
 * tests/hostsim.c (host_tracks_init, host_preset_values), which follow its ui.c.
 * (The functions keep the first prototype's names, fm1_fm6_*: the game's hooks for them are the same.) */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define bootguard fm1_fel_bootguard      /* (core.h: the one name of Felucca's that is not static) */
#define __attribute__(x)                 /* Felucca's sections and inlining hints mean nothing here */
#define memset felucca_memset
#define memcpy felucca_memcpy
#define memcmp felucca_memcmp
#include "felucca_tables.h"
#include "libc.c"
#undef memset
#undef memcpy
#undef memcmp
static struct { volatile uint32_t notes, buttons; } fm1_in;      /* the FM-1's keys and buttons: none are down */
static const uint8_t fel_no_samples[512];                        /* the user's sample slots in flash: empty */
#define SMP_USER_XIP(k) fel_no_samples
#include "core.h"
#include "engines.c"
#include "params.c"
#include "mod.c"
#include "voice.c"
#include "slicer.c"
#include "fx.c"
static void fm1_delay_ms(uint32_t ms) { (void)ms; }
#include "usb.c"
#include "midi_uart.c"
#include "song_chain.c"
#include "seq.c"

#define MIX_RATE 49716u                  /* the game's mixer (rp2040-doom src/fm1/fm1_audio.c) */
#define FEL_GAIN 96                      /* Felucca's output into the game's mix, x 256 (see NOTES.md for the measure) */
#define QUIET_BLOCKS (3u * FS / CTL)     /* this long with nothing sounding and nothing coming out: stop rendering */

volatile uint8_t fm1_fm6_on;             /* 0: off; 1 .. fm1_fm6_count(): that preset plays the melodic notes */
extern unsigned int fm1_pass_frames;     /* rp2040-doom opl/opl_pico.c: mixer frames of this pass made so far */
extern unsigned int fm1_drums_bpm100;    /* rp2040-doom src/i_oplmusic.c: the song's tempo, beats a minute x 100 */
extern volatile uint32_t fm1_music_time; /* the tempo knob (fm1_controls.c): 65536 = as written */

/* ---- the presets: Felucca's engines in the order its PRESETS knob shows them, each one's factory presets */
static uint8_t list_eng[128], list_pre[128], nlist, ready;
static uint8_t preset_of;                /* the fm1_fm6_on the parts are set to */
static uint8_t all_poly;                 /* 1: a preset Felucca plays one note at a time plays chords here */

static void fel_init(void)
{
    uint32_t i, k, r, e, p;
    if (ready)
        return;
    ready = 1;
    for (i = 0; i < G_COUNT; i++)        /* as Felucca starts (hostsim.c host_tracks_init) */
        song.g[i] = GP[i].def;
    for (k = 0; k < NTRK; k++) {
        for (i = 0; i < P_E0; i++)
            trk[k].p[i] = TP[i].def;
        for (i = 0; i < NSTEP; i++)
            trk[k].step[i].time = ST_REST;
    }
    song.master_q12 = 4096;
    for (r = 0; r < NENG_SHOWN; r++) {
        e = eng_vis(r);
        if (ENGINES[e] == &ENG_DRUM)     /* (a kit of hits, not a sound for notes; the drum machine has its voices) */
            continue;
#if FELUCCA_SLICE
        if (ENGINES[e] == &ENG_SLICE)    /* (plays the user's own recordings) */
            continue;
#endif
        for (p = 0; p < ENGINES[e]->npresets && nlist < sizeof list_eng; p++) {
            list_eng[nlist] = (uint8_t)e;
            list_pre[nlist++] = (uint8_t)p;
        }
    }
}

int fm1_fm6_count(void)
{
    fel_init();
    return nlist;
}

/* the name of preset n (1 .. fm1_fm6_count()): its engine, then its own, as "ANALOG RAVE" */
const char *fm1_fm6_name(int n)
{
    static char name[40];
    const char *a, *b;
    uint32_t i = 0;
    fel_init();
    if (n < 1 || n > nlist)
        return "";
    a = ENGINES[list_eng[n - 1]]->name;
    b = ENGINES[list_eng[n - 1]]->presets[list_pre[n - 1]].name;
    while (*a && i < 18u)
        name[i++] = *a++;
    name[i++] = ' ';
    while (*b && i < sizeof name - 1u)
        name[i++] = *b++;
    name[i] = 0;
    return name;
}

/* ---- the notes */
static struct { uint8_t used, channel, key, part, note; } held[32];   /* the music's notes that are down */
static uint8_t part_of[16], nparts;      /* the part each of the music's channels plays on (0xFF: none yet) */
static uint8_t most_down;                /* (test hook) the most notes one channel has had down at once */
static struct { uint16_t at; uint8_t on, part, note, vel; } ev[96];   /* what the music did during this pass */
static uint8_t nev;

/* All four parts on preset fm1_fm6_on, as Felucca's PRESETS knob sets one (hostsim.c host_preset_values):
 * the engine and its eight values, the envelope, mono or poly, and the sends. Notes of the old sound are let go;
 * Felucca fades them out and changes engine at its next block. */
static void fel_use(void)
{
    static const uint8_t FX_DEF[4] = {0, 24, 28, 36};
    uint8_t want = fm1_fm6_on;
    const preset_t *p;
    uint32_t i, k;
    fel_init();
    if (want == preset_of || want > nlist)
        return;
    preset_of = want;
    nev = 0;
    memset(held, 0, sizeof held);
    memset(part_of, 0xFF, sizeof part_of);
    nparts = most_down = 0;
    for (k = 0; k < NTRK; k++)
        trk_all_off(&trk[k]);
    if (!want)
        return;
    p = &ENGINES[list_eng[want - 1]]->presets[list_pre[want - 1]];
    for (k = 0; k < NTRK; k++) {
        track_t *t = &trk[k];
        t->eng_req = list_eng[want - 1];
        t->preset = list_pre[want - 1];
        for (i = 0; i < 8u; i++)
            t->p[P_E0 + i] = p->e[i];
        t->p[P_ATK] = p->env[0];
        t->p[P_DEC] = p->env[1];
        t->p[P_SUS] = p->env[2];
        t->p[P_REL] = p->env[3];
        t->p[P_ED_FLT] = p->fenv;
        t->p[P_VOICE] = p->mono && !all_poly ? V_LEGATO : V_POLY;
        for (i = 0; i < 4u; i++)
            t->p[P_DIST + i] = (int16_t)(p->fx[i] ? p->fx[i] - 1 : FX_DEF[i]);
        fm6_track_loaded(t);
    }
}

static void fel_do(uint32_t i)           /* event i, now */
{
    if (ev[i].on)
        trk_note_on(&trk[ev[i].part], ev[i].note, ev[i].vel);
    else
        trk_note_off(&trk[ev[i].part], ev[i].note);
}

static void fel_event(int on, uint32_t part, uint32_t note, uint32_t vel)
{
    if (nev == sizeof ev / sizeof ev[0]) {                   /* (full: the oldest plays now, a little early) */
        fel_do(0);
        memmove(&ev[0], &ev[1], sizeof ev - sizeof ev[0]);
        nev--;
    }
    ev[nev].at = (uint16_t)fm1_pass_frames;
    ev[nev].on = (uint8_t)on;
    ev[nev].part = (uint8_t)part;
    ev[nev].note = (uint8_t)note;
    ev[nev++].vel = (uint8_t)vel;
}

/* `key` names the note for its note-off; `note` is what sounds (the key moved by the pitch knob and the
 * instrument's own offset); `velocity` the note's and `volume` its channel's, both 0 .. 127 */
void fm1_fm6_note_on(int channel, int key, int note, int velocity, int volume)
{
    int i, slot = -1, down = 0, vel = velocity * (volume > 127 ? 127 : volume < 0 ? 0 : volume) / 127;
    fel_use();
    if (!preset_of)
        return;
    channel &= 15;
    if (part_of[channel] == 0xFF)
        part_of[channel] = (uint8_t)(nparts++ % NTRK);
    for (i = 0; i < (int)(sizeof held / sizeof held[0]); i++)
        if (held[i].used && held[i].channel == channel && held[i].key == key)
            slot = i;                                        /* the same key again: let the old one go first */
        else if (!held[i].used && slot < 0)
            slot = i;
    if (slot < 0)
        slot = 0;                                            /* (32 notes down: not in this music) */
    if (held[slot].used)
        fel_event(0, held[slot].part, held[slot].note, 0);
    held[slot].used = 1;
    held[slot].channel = (uint8_t)channel;
    held[slot].key = (uint8_t)key;
    held[slot].part = part_of[channel];
    held[slot].note = (uint8_t)(note < 0 ? 0 : note > 127 ? 127 : note);
    for (i = 0; i < (int)(sizeof held / sizeof held[0]); i++)
        down += held[i].used && held[i].channel == channel;
    if (down > most_down)
        most_down = (uint8_t)down;
    fel_event(1, held[slot].part, held[slot].note, (uint32_t)(vel < 1 ? 1 : vel > 127 ? 127 : vel));
}

void fm1_fm6_note_off(int channel, int key)
{
    for (uint32_t i = 0; i < sizeof held / sizeof held[0]; i++)
        if (held[i].used && held[i].channel == (channel & 15) && held[i].key == key) {
            held[i].used = 0;
            fel_event(0, held[i].part, held[i].note, 0);
        }
}

void fm1_fm6_channel_off(int channel)
{
    for (uint32_t i = 0; i < sizeof held / sizeof held[0]; i++)
        if (held[i].used && held[i].channel == (channel & 15)) {
            held[i].used = 0;
            fel_event(0, held[i].part, held[i].note, 0);
        }
}

/* (the recorder's, and a key of the prototype page's to come) 1: every preset plays chords, also those Felucca
 * plays one note at a time (its basses and leads); returns what it was. The preset is set again. */
int fm1_fm6_poly(int on)
{
    int was = all_poly;
    all_poly = (uint8_t)(on != 0);
    if (was != all_poly)
        preset_of = 0xFF;                /* (no preset has this number: fel_use sets the parts again) */
    return was;
}

/* (test hooks) the parts in use; the most notes one of the music's channels has had down at once */
int fm1_fm6_parts(void) { return nparts > NTRK ? NTRK : nparts; }
int fm1_fm6_chord(void) { return most_down; }

/* how many voices are sounding (a test hook, and a measure of the work) */
int fm1_fm6_voices(void)
{
    int n = 0;
    for (uint32_t k = 0; k < NTRK; k++)
        for (uint32_t i = 0; i < NVOICE; i++)
            n += trk[k].v[i].active != 0;
    return n;
}

/* ---- the sound */
static int32_t block[2][CTL + 1];        /* Felucca's last block, left and right, and before each the sample that
                                          * ended the one before */
static uint32_t at = (uint32_t)CTL << 16;   /* where the mixer is in it, 16.16 (at the end: render another) */
static uint32_t quiet = QUIET_BLOCKS;    /* blocks in a row with nothing sounding and nothing coming out */

static void fel_render(void)             /* Felucca's next block of CTL samples at 44,100 Hz */
{
    int32_t o[2 * CTL], any = 0;
    uint32_t bpm = (uint32_t)(((uint64_t)fm1_drums_bpm100 << 16) / (fm1_music_time ? fm1_music_time : 65536u)) / 100u;
    uint32_t i;
    song.g[G_BPM] = (int16_t)(bpm < 40u ? 40u : bpm > 240u ? 240u : bpm);   /* the delay keeps the song's time */
    mix_block(o, CTL);
    block[0][0] = block[0][CTL];
    block[1][0] = block[1][CTL];
    for (i = 0; i < CTL; i++) {
        block[0][i + 1] = o[2u * i];
        block[1][i + 1] = o[2u * i + 1u];
        any |= o[2u * i] > 8 || o[2u * i] < -8 || o[2u * i + 1u] > 8 || o[2u * i + 1u] < -8;
    }
    quiet = any || fm1_fm6_voices() ? 0 : quiet + 1u;
}

/* Add Felucca's sound to `frames` frames of the mixer's 16-bit stereo: the pass the queued notes belong to. */
void fm1_fm6_mix(int16_t *stereo, uint32_t frames)
{
    const uint32_t step = (uint32_t)(((uint64_t)FS << 16) / MIX_RATE);   /* Felucca samples a mixer frame, 16.16 */
    uint32_t f, q;
    fel_use();
    if (!nev && quiet >= QUIET_BLOCKS) { /* silent, and nothing to play: no work */
        at = (uint32_t)CTL << 16;
        block[0][CTL] = block[1][CTL] = 0;
        return;
    }
    for (f = 0; f < frames; f++, stereo += 2) {
        int32_t a, b, l, r;
        if (at >= (uint32_t)CTL << 16) {
            at -= (uint32_t)CTL << 16;
            for (q = 0; q < nev; q++)                        /* notes whose time has come, in the order they were played */
                if (ev[q].at <= f && ev[q].on != 0xFF) {
                    fel_do(q);
                    ev[q].on = 0xFF;
                }
            fel_render();
        }
        a = block[0][at >> 16];
        b = block[0][(at >> 16) + 1u];
        l = a + (int32_t)(((int64_t)(b - a) * (int32_t)(at & 0xFFFFu)) >> 16);
        a = block[1][at >> 16];
        b = block[1][(at >> 16) + 1u];
        r = a + (int32_t)(((int64_t)(b - a) * (int32_t)(at & 0xFFFFu)) >> 16);
        at += step;
        l = stereo[0] + ((l * FEL_GAIN) >> 8);
        r = stereo[1] + ((r * FEL_GAIN) >> 8);
        stereo[0] = (int16_t)(l > 32767 ? 32767 : l < -32768 ? -32768 : l);
        stereo[1] = (int16_t)(r > 32767 ? 32767 : r < -32768 ? -32768 : r);
    }
    for (q = 0; q < nev; q++)                                /* (any left fell in the pass's last block: play them now) */
        if (ev[q].on != 0xFF)
            fel_do(q);
    nev = 0;
}
