/* SPDX-License-Identifier: GPL-3.0-only */
/* PC check of the firmware's synth (firmware/fm1_synth.c, in fm1_sound.c) against Felucca's own: the same notes
 * are played on it and on Felucca's whole sound core (firmware/fm1_felucca.c, which is Felucca's code as its
 * host tests build it), and the two must give the same samples for each of the three sounds. Also: the drum
 * machine's hits and levels, and that silence stays silence.
 *   firmware/test.sh builds and runs it:  cc ... -Dfm1_fm6_X=ref_X firmware/fm1_felucca.c  +  fm1_sound.c */
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
unsigned int fm1_pass_frames, fm1_drums_bpm100 = 11000;
volatile uint32_t fm1_music_time = 65536;
/* the firmware's */
extern volatile uint8_t fm1_fm6_on, fm1_drums_pattern;
int fm1_fm6_count(void); const char *fm1_fm6_name(int n);
void fm1_fm6_note_on(int channel, int key, int note, int velocity, int volume);
void fm1_fm6_note_off(int channel, int key); void fm1_fm6_channel_off(int channel);
void fm1_fm6_mix(int16_t *stereo, uint32_t frames);
int fm1_drums_patterns(void); const char *fm1_drums_pattern_name(int n); int fm1_drums_wants(int step);
void fm1_drums_step(int step); void fm1_drums_mix(int16_t *stereo, uint32_t frames);
/* Felucca whole (its fm1_fm6_* renamed ref_* on the compiler's command line) */
extern volatile uint8_t ref_on;
int ref_count(void); const char *ref_name(int n);
void ref_note_on(int channel, int key, int note, int velocity, int volume);
void ref_note_off(int channel, int key); void ref_channel_off(int channel);
void ref_mix(int16_t *stereo, uint32_t frames);

static int bad;
static void check(const char *name, int ok, const char *more)
{
    if (!ok)
        bad++;
    printf("  %s  %s%s%s\n", ok ? "ok  " : "FAIL", name, *more ? ": " : "", more);
}
static uint32_t rnd_state = 12345;
static uint32_t rnd(void) { rnd_state = rnd_state * 1664525u + 1013904223u; return rnd_state >> 8; }

int main(void)
{
    static int16_t a[1024], b[1024];
    char more[200];
    /* ---- the three sounds against Felucca's: a busy 12 s on three channels (lines that overlap, repeat a key,
     * leave notes hanging for channel_off, loud and soft, low and high), then 4 s to ring out */
    check("the synth has three sounds", fm1_fm6_count() == 3, "");
    for (int n = 1; n <= 3; n++) {
        int ref = 0, differ = 0, peak = 0, worst = 0;
        long frames = 0, at = -1;
        double sq = 0;
        uint8_t down[3][128];
        memset(down, 0, sizeof down);
        for (int k = 1; k <= ref_count(); k++)
            if (!strcmp(ref_name(k) + 7, fm1_fm6_name(n)) && !strncmp(ref_name(k), "ANALOG ", 7))
                ref = k;
        fm1_fm6_on = (uint8_t)n;
        ref_on = (uint8_t)ref;
        rnd_state = 1000u + (uint32_t)n;
        for (int pass = 0; pass < 49716 * 16 / 512; pass++) {
            int playing = pass < 49716 * 12 / 512;
            for (int e = 0; e < 3; e++) {                    /* up to three things happen in a pass, each somewhere in it */
                uint32_t r = rnd();
                int ch = (int)(r % 3u), key = 28 + (int)((r >> 4) % 50u), vel = 40 + (int)((r >> 10) % 88u);
                fm1_pass_frames = (r >> 17) % 512u;
                if (!playing) {
                    if (pass == 49716 * 12 / 512 && e == 0)
                        for (ch = 0; ch < 3; ch++) { fm1_fm6_channel_off(ch); ref_channel_off(ch); }
                    continue;
                }
                if ((r >> 20) % 7u > 2u)
                    continue;
                int n_down = 0;
                for (int j = 0; j < 128; j++)
                    n_down += down[ch][j];
                /* let a note go: this key, or any of the channel's that is down (at most four down on a channel:
                 * E1M1 has two, and the firmware keeps 16 of the music's notes in all) */
                if (down[ch][key] || n_down >= 4 || (r >> 23) % 3u == 0) {
                    for (int j = 0; j < 128 && !down[ch][key]; j++)
                        if (down[ch][j])
                            key = j;
                    if (!down[ch][key])
                        continue;
                    down[ch][key] = 0;
                    fm1_fm6_note_off(ch, key); ref_note_off(ch, key);
                } else {
                    down[ch][key] = 1;
                    fm1_fm6_note_on(ch, key, key + (ch ? 0 : -12), vel, 100 + ch * 13);
                    ref_note_on(ch, key, key + (ch ? 0 : -12), vel, 100 + ch * 13);
                }
            }
            memset(a, 0, sizeof a);
            memset(b, 0, sizeof b);
            fm1_fm6_mix(a, 512);
            ref_mix(b, 512);
            for (int i = 0; i < 1024; i++) {
                int d = abs(a[i] - b[i]);
                if (d && at < 0)
                    at = frames + i / 2;
                differ += d != 0;
                if (d > worst)
                    worst = d;
                if (abs(a[i]) > peak)
                    peak = abs(a[i]);
                sq += (double)a[i] * a[i];
            }
            frames += 512;
        }
        snprintf(more, sizeof more, "%s: %d samples differ of %ld (the first at frame %ld, at most by %d); rms %.0f, peak %d",
                 fm1_fm6_name(n), differ, frames * 2, at, worst, sqrt(sq / (frames * 2)), peak);
        check("a sound gives the samples Felucca's own synth gives for the same notes", ref && !differ && peak > 3000, more);
    }
    /* ---- off, and rung out: nothing */
    fm1_fm6_on = 0;
    {
        int any = 0;
        for (int pass = 0; pass < 49716 * 6 / 512; pass++) {
            memset(a, 0, sizeof a);
            fm1_fm6_mix(a, 512);
            if (pass > 49716 * 5 / 512)
                for (int i = 0; i < 1024; i++)
                    any |= a[i];
        }
        check("PRESETS off the synth: five seconds on, it adds nothing", !any, "");
    }
    /* ---- the drum machine: every beat's hits land, the sum never reaches full scale flat, and off is off */
    for (int p = 1; p <= fm1_drums_patterns(); p++) {
        const double step_frames = 49716.0 * 60 / 110 / 8;
        double next = 0, sq = 0;
        long frame = 0;
        int step = 0, peak = 0, flat = 0, wanted = 0;
        fm1_drums_pattern = (uint8_t)p;
        for (int pass = 0; pass < (int)(step_frames * 128 / 512) + 1; pass++, frame += 512) {
            while (next < frame + 512 && step < 128) {
                fm1_pass_frames = (unsigned)(next - frame);
                if (fm1_drums_wants(step)) { fm1_drums_step(step); wanted++; }
                step++;
                next += step_frames;
            }
            for (int i = 0; i < 512; i++)                    /* a steady tone at the music's level under it */
                a[2 * i] = a[2 * i + 1] = (int16_t)(2400.0 * sin((frame + i) * 2 * 3.14159265 * 110 / 49716));
            fm1_drums_mix(a, 512);
            for (int i = 0; i < 1024; i++) {
                int v = abs(a[i]);
                sq += (double)v * v;
                if (v > peak)
                    peak = v;
                flat += v >= 32767;
            }
        }
        snprintf(more, sizeof more, "%s: %d steps with a hit in four bars, rms %.0f, peak %d", fm1_drums_pattern_name(p), wanted, sqrt(sq / (frame * 2)), peak);
        check("a beat plays over the music, louder than it and never flat at full scale", wanted >= 20 && sqrt(sq / (frame * 2)) > 3400 && peak < 32000 && !flat, more);
    }
    fm1_drums_pattern = 0;
    {
        int differ = 0;
        for (int pass = 0; pass < 49716 * 5 / 512; pass++) {
            for (int i = 0; i < 1024; i++)
                a[i] = b[i] = (int16_t)(rnd() % 4001u) - 2000;
            fm1_drums_mix(a, 512);
            if (pass > 49716 * 4 / 512)
                differ += memcmp(a, b, sizeof a) != 0;
        }
        check("KNOB 4 at the bottom: four seconds on, the game's sound passes untouched", !differ, "");
    }
    printf(bad ? "SOUND TEST FAILED (%d)\n" : "SOUND TEST PASSED\n", bad);
    return bad != 0;
}
