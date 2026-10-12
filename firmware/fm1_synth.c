/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: three of Felucca's synth sounds to play the game's music on. Part of fm1_sound.c.
 *
 * PRESETS 1 to 3 are Felucca's ANALOG presets SAW LEAD, ACID and RAVE, the ones Sean picked by ear from
 * recordings of all 66 (NOTES.md, 2026-10-11), as Felucca's own PRESETS knob sets them: two oscillators into a
 * filter with an envelope on it, then the preset's distortion and its sends into the chorus, the delay (an
 * eighth of the song's beat) and the room reverb, and Felucca's master limiter. With one chosen, the music's
 * melodic notes come here and not to the emulated sound chip, which keeps the percussion.
 *
 * All three are sounds Felucca plays one note at a time. Each of the music's channels gets a line of its own
 * (four lines; E1M1 uses three), so the song keeps its parts; within a line the last note pressed sounds, as
 * on Felucca.
 *
 * Felucca's whole synth is far too large for the game's flash (firmware/fm1_felucca.c has all of it, for the
 * browser, and is what this file is tested against: firmware/tests/synth_test.c asks for the same samples
 * from both). What is here is the path those three presets take through it, copied and cut down:
 *   eng_analog.c analog_render   the saw and the pulse only, no noise (none of the three has any)
 *   voice.c                      one-note playing (trk_note_on, trk_note_off, mono_play, voice_start), the
 *                                envelope (env_tick), a block's values (track_render); no LFO, glide, bend,
 *                                tuning or modulation matrix, which the presets leave at rest
 *   fx.c                         a part into the mix and the sends (mix_part), the buses (fx_buses, rev_room)
 * with the envelope's steps and the single table values it needs worked out at build time (fm1_sound_gen.h).
 * The functions keep the names of the first prototype's (fm1_fm6_*), which the game's hooks call. */
#define LINES 4                          /* Felucca's parts */
#define SYNTH_GAIN 96                    /* the synth into the game's mix, of 256: RAVE about 3.5 dB over the chip's music */
#define DLY_LEN 16384u                   /* the delay line: 0.37 s (an eighth down to 81 beats a minute); Felucca's is 65,536 */
#define CHO_LEN 2048u

volatile uint8_t fm1_fm6_on;             /* 0: off; 1 .. 3: FM1_SOUNDS[n - 1] plays the melodic notes */
extern unsigned int fm1_drums_bpm100;    /* rp2040-doom src/i_oplmusic.c: the song's tempo, beats a minute x 100 */

int fm1_fm6_count(void) { return (int)(sizeof FM1_SOUNDS / sizeof FM1_SOUNDS[0]); }
const char *fm1_fm6_name(int n) { return n >= 1 && n <= fm1_fm6_count() ? FM1_SOUNDS[n - 1].name : ""; }

/* ---- a line: one of Felucca's parts playing one note at a time (voice.c's voice_t and what of track_t it needs) */
typedef struct {
    uint8_t note, vel, gate, active;
    uint8_t stage;                       /* envelope: 0 off, 1 attack, 2 decay / sustain, 3 release */
    uint8_t mono_note;                   /* the note it plays, 0: none */
    uint8_t nmono, mono_stack[8];        /* the notes held, in the order pressed */
    uint8_t tail;                        /* blocks of the distortion's state still to run out */
    int32_t env;                         /* Q24 */
    int32_t env_out;                     /* the last block's amplitude, Q15 */
    int32_t pitch16;                     /* 1/16 semitone */
    uint32_t ph[2];                      /* the oscillators */
    int32_t ic[2];                       /* the filter */
    fm1_dist_t dist;
} line_t;
static line_t line[LINES];
static const fm1_sound_t *sound;         /* what the lines play (0: nothing yet) */
static uint8_t sound_of;                 /* the fm1_fm6_on that is */

/* (voice.c mono_remove) */
static void mono_remove(line_t *t, uint32_t note)
{
    uint32_t j, k = 0;
    for (j = 0; j < t->nmono; j++)
        if (t->mono_stack[j] != note)
            t->mono_stack[k++] = t->mono_stack[j];
    t->nmono = (uint8_t)k;
}

/* (voice.c mono_play as LEGATO plays it, with voice_start and eng_analog.c analog_note_on) */
static void mono_play(line_t *v, uint32_t note, uint32_t vel, int retrig)
{
    if (retrig || !v->active || !v->gate) {
        int sounding = v->active && v->stage != 0;
        v->note = (uint8_t)note;
        v->vel = (uint8_t)vel;
        v->gate = v->active = 1;
        v->stage = 1;
        v->pitch16 = (int32_t)note * 16;
        if (!sounding) {                 /* (sounding: the attack starts from where the level is, phases and filter kept) */
            v->env = v->env_out = 0;
            v->ph[1] = v->ph[0] + 0x40000000u;
            v->ic[0] = v->ic[1] = 0;
        }
    } else {                             /* legato: a new pitch, the same envelope */
        v->note = (uint8_t)note;
        v->pitch16 = (int32_t)note * 16;
        if (vel > v->vel)
            v->vel = (uint8_t)vel;
    }
    v->mono_note = (uint8_t)note;
}

/* (voice.c trk_note_on, LEGATO, the last note pressed) */
static void line_on(line_t *t, uint32_t note, uint32_t vel)
{
    uint32_t sounding = t->mono_note && t->active && t->gate;
    mono_remove(t, note);
    if (t->nmono >= 8u)
        mono_remove(t, t->mono_stack[0]);
    t->mono_stack[t->nmono++] = (uint8_t)note;
    if (sounding && note == t->mono_note)
        return;                          /* (it plays that note already) */
    mono_play(t, note, vel, !sounding);
}

/* (voice.c trk_note_off) */
static void line_off(line_t *t, uint32_t note)
{
    mono_remove(t, note);
    if (t->mono_note == note) {
        if (t->nmono) {                  /* fall back to a held note, legato */
            mono_play(t, t->mono_stack[t->nmono - 1u], t->vel, 0);
        } else {
            if (t->gate) {
                t->gate = 0;
                t->stage = 3;
            }
            t->mono_note = 0;
        }
    }
    if (t->note == note && t->gate) {    /* (a fallback above already has its new pitch) */
        t->gate = 0;
        t->stage = 3;
    }
}

/* ---- the music's notes */
static struct { uint8_t used, channel, key, note; } held[16];   /* the music's notes that are down */
static uint8_t part_of[16], nparts;      /* the line each of the music's channels plays on (0xFF: none yet) */
static struct { uint16_t at; uint8_t on, part, note, vel; } ev[32];   /* what the music did during this pass */
static uint8_t nev;

/* the lines on sound fm1_fm6_on; notes of the old sound are let go */
static void synth_use(void)
{
    uint8_t want = fm1_fm6_on;
    if (want == sound_of || want > fm1_fm6_count())
        return;
    sound_of = want;
    nev = 0;
    memset(held, 0, sizeof held);
    memset(part_of, 0xFF, sizeof part_of);
    nparts = 0;
    for (uint32_t k = 0; k < LINES; k++) {                   /* (voice.c trk_all_off) */
        line[k].gate = 0;
        line[k].stage = line[k].active ? 3 : 0;
        line[k].nmono = line[k].mono_note = 0;
    }
    if (want)
        sound = &FM1_SOUNDS[want - 1];
}

static void synth_do(uint32_t i)         /* event i, now */
{
    if (ev[i].on)
        line_on(&line[ev[i].part], ev[i].note, ev[i].vel);
    else
        line_off(&line[ev[i].part], ev[i].note);
}

static void synth_event(int on, uint32_t part, uint32_t note, uint32_t vel)
{
    if (nev == sizeof ev / sizeof ev[0]) {                   /* (full: the oldest plays now, a little early) */
        synth_do(0);
        for (uint32_t i = 1; i < nev; i++)                   /* (no memmove: the firmware has Felucca's small libc) */
            ev[i - 1] = ev[i];
        nev--;
    }
    ev[nev].at = (uint16_t)fm1_pass_frames;
    ev[nev].on = (uint8_t)on;
    ev[nev].part = (uint8_t)part;
    ev[nev].note = (uint8_t)note;
    ev[nev++].vel = (uint8_t)vel;
}

/* a note of the music's is let go: all of a channel's if key < 0 */
static void synth_release(int channel, int key)
{
    for (uint32_t i = 0; i < sizeof held / sizeof held[0]; i++)
        if (held[i].used && held[i].channel == (channel & 15) && (key < 0 || held[i].key == key)) {
            held[i].used = 0;
            synth_event(0, part_of[channel & 15], held[i].note, 0);
        }
}

/* `key` names the note for its note-off; `note` is what sounds (the key moved by the pitch knob and the
 * instrument's own offset); `velocity` the note's and `volume` its channel's, both 0 .. 127 */
void fm1_fm6_note_on(int channel, int key, int note, int velocity, int volume)
{
    int i, slot = 0, vel = velocity * (volume > 127 ? 127 : volume < 0 ? 0 : volume) / 127;
    synth_use();
    if (!sound_of)
        return;
    channel &= 15;
    if (part_of[channel] == 0xFF)
        part_of[channel] = (uint8_t)(nparts++ % LINES);
    synth_release(channel, key);                             /* the same key again: let the old one go first */
    for (i = 0; i < (int)(sizeof held / sizeof held[0]); i++)
        if (!held[i].used)
            slot = i;
    if (held[slot].used)                                     /* (16 notes down: not in this music) */
        synth_event(0, part_of[held[slot].channel], held[slot].note, 0);
    held[slot].used = 1;
    held[slot].channel = (uint8_t)channel;
    held[slot].key = (uint8_t)key;
    held[slot].note = (uint8_t)(note < 0 ? 0 : note > 127 ? 127 : note);
    synth_event(1, part_of[channel], held[slot].note, (uint32_t)(vel < 1 ? 1 : vel > 127 ? 127 : vel));
}
void fm1_fm6_note_off(int channel, int key) { synth_release(channel, key); }
void fm1_fm6_channel_off(int channel) { synth_release(channel, -1); }

#if FM1_WEB
/* (test hooks) how many lines are sounding; how many of the music's channels have a line */
int fm1_fm6_voices(void)
{
    int n = 0;
    for (uint32_t k = 0; k < LINES; k++)
        n += line[k].active != 0;
    return n;
}
int fm1_fm6_parts(void) { return nparts > LINES ? LINES : nparts; }
#endif

/* ---- the sound */
static const uint16_t REV_COMB[4] = {1116, 1188, 1277, 1356};
static const uint16_t REV_AP[2] = {556, 441};
static int16_t dly_buf[DLY_LEN], cho_buf[CHO_LEN], rev_comb[1116 + 1188 + 1277 + 1356], rev_ap[556 + 441];
static struct {
    uint32_t dly_w, cho_w, cho_ph;
    int32_t dly_lp, comb_lp[4];
    uint16_t comb_i[4], ap_i[2];
} fx;
static fm1_master_t synth_master = {{0, 0}, {0, 0}, LIM_T};
static int32_t synth_block[CTL + 1];     /* the last block, and before it the sample that ended the one before */
static uint32_t synth_at = (uint32_t)CTL << 16;   /* where the mixer is in it, 16.16 (at the end: render another) */
#define QUIET_BLOCKS (3u * FS / CTL)     /* this long with nothing sounding and nothing coming out: stop rendering */
static uint32_t quiet = QUIET_BLOCKS;

/* One block of a line added to out; 0 if it has nothing to play. voice.c env_tick and track_render for the
 * line's values, then eng_analog.c analog_render. */
static int line_render(line_t *v, int32_t *out)
{
    const int8_t *p = sound->e;
    vmod_t m;
    tsvf_t flt;
    int32_t env, cut, drive = 32768 + p[6] * 512, m2 = p[2] * 258, m1 = 32767 - m2, ic1, ic2;
    uint32_t inc1, inc2, ph0, ph1, i;
    if (!v->active)
        return 0;
    switch (v->stage) {
    case 1:
        v->env += (int32_t)sound->attack;
        if (v->env >= (1 << 24)) {
            v->env = 1 << 24;
            v->stage = 2;
        }
        break;
    case 2:
        v->env += mulq16(((int32_t)sound->sustain << 17) - v->env, sound->decay);
        break;
    default:
        v->env -= mulq16(v->env, sound->release);
        if (v->env < (1 << 12)) {
            v->env = 0;
            v->stage = 0;
            v->active = 0;
        }
        break;
    }
    env = v->env >> 9;
    m.amp1 = mulq15(env, v->vel * 258);
    m.amp0 = v->env_out;
    v->env_out = m.amp1;
    if (!env && !m.amp0 && v->stage == 2)
        return 0;                        /* held at a silent sustain: nothing to render */
    m.pitch16 = clamp(v->pitch16, 0, 2047);
    m.inc = pitch_inc((uint32_t)m.pitch16);
    m.cutoff = (env * sound->fenv) >> 7;
    if (v->vel > 110)                    /* an accent opens the filter with the envelope */
        m.cutoff += (env * 24) >> 7;
    cut = (p[4] << 8) + m.cutoff + (p[7] * (v->pitch16 - 60 * 16) >> 4);
    inc1 = m.inc;
    inc2 = p[1] ? cents_inc(m.pitch16, p[1], 0) : inc1;      /* the second oscillator, detuned in cents */
    ph0 = v->ph[0];
    ph1 = v->ph[1];
    ic1 = v->ic[0];
    ic2 = v->ic[1];
    tsvf_coef(&flt, cut, p[5]);
    for (i = 0; i < CTL; i++) {
        int32_t a, b, s, y;
        if (p[0] == 4) {                 /* PWM at rest: a square */
            a = osc_pulse(ph0, inc1, 0x80000000u);
            b = osc_pulse(ph1, inc2, 0x80000000u);
        } else {
            a = osc_saw(ph0, inc1);
            b = osc_saw(ph1, inc2);
        }
        ph0 += inc1;
        ph1 += inc2;
        s = mulq15(a, m1) + mulq15(b, m2);
        if (p[6])
            s = softclip(((s >> 2) * (drive >> 2)) >> 11);
        y = tsvf_lp(&flt, s >> 1, &ic1, &ic2);
        y = soft_knee(y, 16000);         /* linear up to half scale: only resonance peaks saturate */
        out[i] += voice_amp(y << 1, &m, i) << 1;
    }
    v->ph[0] = ph0;
    v->ph[1] = ph1;
    v->ic[0] = ic1;
    v->ic[1] = ic2;
    return 1;
}

/* The next block of CTL samples at 44,100 Hz into synth_block[1 ..]: fx.c mix_block for parts at rest but for
 * their sound (LVL as it starts, no pan, the preset's DIST and sends), its buses and its master. */
static void synth_render(void)
{
    int32_t part[CTL], mix[CTL], send_c[CTL], send_d[CTL], send_r[CTL], any = 0;   /* any: a line is sounding, or something comes out */
    const int32_t c = sound->chorus * 258, d = sound->delay * 258, r = sound->reverb * 258;
    const int32_t xmax = 0x7FFFFFFF / ((c > d ? c > r ? c : r : d > r ? d : r) | 1);
    uint32_t bpm = fm1_drums_bpm100 / 100u, dl, i, k;
    bpm = bpm < 40u ? 40u : bpm > 240u ? 240u : bpm;
    dl = (uint32_t)FS * 60u / bpm / FM1_DELAY_DIV;           /* the delay keeps the song's time */
    dl = dl < 16u ? 16u : dl >= DLY_LEN ? DLY_LEN - 1u : dl;
    memset(mix, 0, sizeof mix);
    memset(send_c, 0, sizeof send_c);
    memset(send_d, 0, sizeof send_d);
    memset(send_r, 0, sizeof send_r);
    for (k = 0; k < LINES; k++) {
        line_t *t = &line[k];
        memset(part, 0, sizeof part);
        if (line_render(t, part))
            t->tail = 16;
        else if (!t->tail || !sound->dist || !--t->tail)
            continue;
        if (sound->dist)
            fm1_dist(&t->dist, sound->dist, part, CTL);
        for (i = 0; i < CTL; i++) {
            int32_t x = ((part[i] >> 2) * FM1_LEVEL_Q12) >> 10, xs = clamp(x, -xmax, xmax);
            if (c)
                send_c[i] += mulq15(xs, c);
            if (d)
                send_d[i] += mulq15(xs, d);
            if (r)
                send_r[i] += mulq15(xs, r);
            mix[i] += x;
        }
    }
    synth_block[0] = synth_block[CTL];
    for (i = 0; i < CTL; i++) {
        int32_t y, x, rr, a = 0, in, lr[2];
        int16_t *b;
        /* chorus: a modulated short delay, 5 .. 15 ms */
        cho_buf[fx.cho_w & (CHO_LEN - 1u)] = (int16_t)clamp(send_c[i] >> 1, -32768, 32767);
        fx.cho_ph += FM1_CHORUS_INC;
        rr = (400 << 8) + ((osc_sine(fx.cho_ph) + 32768) * FM1_CHORUS_DEPTH >> 8);
        {
            uint32_t ri = (uint32_t)rr >> 8;
            int32_t f = rr & 255, c0 = cho_buf[(fx.cho_w - ri) & (CHO_LEN - 1u)];
            int32_t c1 = cho_buf[(fx.cho_w - ri - 1u) & (CHO_LEN - 1u)];
            y = (c0 + (((c1 - c0) * f) >> 8)) << 1;
        }
        fx.cho_w++;
        /* delay with a low-passed feedback */
        x = dly_buf[(fx.dly_w - dl) & (DLY_LEN - 1u)];
        fx.dly_lp += mulq15(x - fx.dly_lp, FM1_DELAY_COLOR);
        dly_buf[fx.dly_w & (DLY_LEN - 1u)] = (int16_t)clamp((send_d[i] >> 1) + mulq15(fx.dly_lp, FM1_DELAY_FB), -32768, 32767);
        fx.dly_w++;
        y += mulq15(x << 1, FM1_DELAY_MIX);
        /* room reverb: 4 damped combs and 2 allpasses */
        in = mulq15(send_r[i], 2580);
        b = rev_comb;
        for (k = 0; k < 4u; k++) {
            int32_t o = b[fx.comb_i[k]];
            fx.comb_lp[k] = o + mulq15(fx.comb_lp[k] - o, 32767 - FM1_REVERB_DAMP);
            b[fx.comb_i[k]] = (int16_t)clamp(in + mulq15(fx.comb_lp[k], FM1_REVERB_SIZE), -32768, 32767);
            if (++fx.comb_i[k] >= REV_COMB[k])
                fx.comb_i[k] = 0;
            a += o;
            b += REV_COMB[k];
        }
        b = rev_ap;
        for (k = 0; k < 2u; k++) {
            int32_t o = b[fx.ap_i[k]];
            b[fx.ap_i[k]] = (int16_t)clamp(a + (o >> 1), -32768, 32767);
            a = o - a;
            if (++fx.ap_i[k] >= REV_AP[k])
                fx.ap_i[k] = 0;
            b += REV_AP[k];
        }
        y += a;
        lr[0] = lr[1] = ((mix[i] + y) >> 2) << 2;            /* (the master's level at full, as fx.c scales it) */
        fm1_master(&synth_master, lr);
        synth_block[i + 1] = lr[0];
        any |= lr[0] > 8 || lr[0] < -8;
    }
    for (k = 0; k < LINES; k++)
        any |= line[k].active;
    quiet = any ? 0 : quiet + 1u;
}

/* Add the synth's sound to `frames` frames of the mixer's 16-bit stereo: the pass the queued notes belong to. */
void fm1_fm6_mix(int16_t *stereo, uint32_t frames)
{
    uint32_t f, q;
    synth_use();
    if (!sound || (!nev && quiet >= QUIET_BLOCKS)) {         /* silent, and nothing to play: no work */
        synth_at = (uint32_t)CTL << 16;
        synth_block[CTL] = 0;
        return;
    }
    for (f = 0; f < frames; f++, stereo += 2) {
        int32_t a, b, s, l, r;
        if (synth_at >= (uint32_t)CTL << 16) {
            synth_at -= (uint32_t)CTL << 16;
            for (q = 0; q < nev; q++)                        /* notes whose time has come, in the order they were played */
                if (ev[q].at <= f && ev[q].on != 0xFF) {
                    synth_do(q);
                    ev[q].on = 0xFF;
                }
            synth_render();
        }
        a = synth_block[synth_at >> 16];
        b = synth_block[(synth_at >> 16) + 1u];
        s = a + (int32_t)(((int64_t)(b - a) * (int32_t)(synth_at & 0xFFFFu)) >> 16);
        synth_at += MIX_STEP;
        s = (s * SYNTH_GAIN) >> 8;
        l = stereo[0] + s;
        r = stereo[1] + s;
        stereo[0] = (int16_t)clamp(l, -32768, 32767);
        stereo[1] = (int16_t)clamp(r, -32768, 32767);
    }
    for (q = 0; q < nev; q++)                                /* (any left fell in the pass's last block: play them now) */
        if (ev[q].on != 0xFF)
            synth_do(q);
    nev = 0;
}
