// SPDX-License-Identifier: GPL-3.0-only
// Host test of the drive on KNOB 3 (rp2040-doom/src/fm1/fm1_drive.h): the same code the firmware's audio interrupt
// and the browser build run, fed tones on a PC.
//   cc -I rp2040-doom/src/fm1 -o drive_test firmware/tests/drive_test.c -lm
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "fm1_drive.h"

#define RATE 44118.0
#define BLOCK 128                       /* frames a call, as the audio interrupt uses */
#define MUSIC 2239.0                    /* a tone with the RMS E1M1's music has in the browser build (1583) */
static int fails;
static void check(const char *name, int ok, const char *fmt, ...) __attribute__((format(printf, 3, 4)));
#include <stdarg.h>
static void check(const char *name, int ok, const char *fmt, ...)
{
    char more[160] = "";
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(more, sizeof more, fmt, ap);
    va_end(ap);
    printf("  %s  %s%s%s\n", ok ? "ok  " : "FAIL", name, more[0] ? ": " : "", more);
    fails += !ok;
}

static int16_t buf[BLOCK * 2];
/* blocks of a tone (left) through the drive at one step; the right channel plays `right` times the same */
static double phase;
static void tone_block(double hz, double amp, double right)
{
    for (int i = 0; i < BLOCK; i++, phase += 2 * M_PI * hz / RATE) {
        buf[2 * i] = (int16_t)lrint(amp * sin(phase));
        buf[2 * i + 1] = (int16_t)lrint(right * amp * sin(phase));
    }
}
/* the level of `hz` in n samples of x (Goertzel), as an amplitude */
static double level_at(const double *x, int n, double hz)
{
    double w = 2 * M_PI * hz / RATE, c = 2 * cos(w), s0, s1 = 0, s2 = 0;
    for (int i = 0; i < n; i++) {
        s0 = x[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return 2 * sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / n;
}

#define SETTLE 8
#define LISTEN 64
static double left[LISTEN * BLOCK];
/* a steady tone at one step: RMS and peak of what comes out, and its third harmonic against its fundamental */
static void steady(int amt, double hz, double amp, double *rms, double *peak, double *third)
{
    fm1_drive_t d;
    double sq = 0;
    memset(&d, 0, sizeof d);
    phase = 0;
    *peak = 0;
    for (int b = 0; b < SETTLE + LISTEN; b++) {
        tone_block(hz, amp, 1);
        fm1_drive_run(&d, buf, BLOCK, amt);
        if (b >= SETTLE)
            for (int i = 0; i < BLOCK; i++) {
                double v = buf[2 * i];
                left[(b - SETTLE) * BLOCK + i] = v;
                sq += v * v;
                if (fabs(v) > *peak) *peak = fabs(v);
            }
    }
    *rms = sqrt(sq / (LISTEN * BLOCK));
    *third = level_at(left, LISTEN * BLOCK, 3 * hz) / level_at(left, LISTEN * BLOCK, hz);
}

int main(void)
{
    fm1_drive_t d;
    double rms, peak, third;
    int ok, i, s;

    /* ---- off */
    memset(&d, 0, sizeof d);
    phase = 0;
    ok = 1;
    for (int b = 0; b < 20; b++) {
        int16_t was[BLOCK * 2];
        tone_block(441, 30000, 0.5);
        memcpy(was, buf, sizeof buf);
        fm1_drive_run(&d, buf, BLOCK, 0);
        ok &= !memcmp(was, buf, sizeof buf);
    }
    check("off: not one sample is touched", ok, "");

    /* ---- the clipper itself, at every step and every input value */
    {
        int odd = 1, rising = 1, bounded = 1, worst = 0;
        for (s = 1; s <= FM1_DRIVE_STEPS; s++) {
            int32_t g = FM1_DRIVE_GAIN[s - 1], l = FM1_DRIVE_LEVEL[s - 1], last = -40000;
            for (i = -32768; i <= 32767; i++) {
                int32_t y = fm1_drive_shape(i, g, l);
                rising &= y >= last;
                last = y;
                bounded &= abs(y) <= l;
                if (i > 0 && i < 32768) {
                    int e = abs(y + fm1_drive_shape(-i, g, l));
                    if (e > worst) worst = e;
                    odd &= e <= 2;
                }
            }
        }
        check("the clipper never turns a louder sample into a quieter one", rising, "");
        check("... is the same both ways up", odd, "worst difference %d of 32768", worst);
        check("... and never puts out more than its step's level, whatever goes in", bounded, "");
    }
    check("the table: gain rises from 4 to 64 times", FM1_DRIVE_GAIN[0] == 4 * 256 && FM1_DRIVE_GAIN[FM1_DRIVE_STEPS - 1] == 64 * 256, "");
    for (ok = 1, s = 1; s < FM1_DRIVE_STEPS; s++)
        ok &= FM1_DRIVE_GAIN[s] > FM1_DRIVE_GAIN[s - 1];
    check("... each step more than the last", ok, "");

    /* ---- a tone as loud as the game's music, step by step */
    {
        double clean = MUSIC / sqrt(2), r1, r16, lastthird = 0, lastrms = 0;
        int louder = 1, dirtier = 1;
        for (s = 1; s <= FM1_DRIVE_STEPS; s++) {
            steady(s, 441, MUSIC, &rms, &peak, &third);
            louder &= rms >= lastrms * 0.995;
            dirtier &= third >= lastthird * 0.98;
            lastrms = rms;
            lastthird = third;
            if (s == 1) r1 = rms;
        }
        r16 = rms;
        check("a tone at the music's level is never quieter for a step more of drive", louder, "");
        check("... and never cleaner", dirtier, "");
        check("... it starts within 3 dB of the clean tone", fabs(20 * log10(r1 / clean)) < 3, "%+.1f dB at step 1", 20 * log10(r1 / clean));
        check("... and ends less than 9 dB over it", r16 > clean && 20 * log10(r16 / clean) < 9, "%+.1f dB at step 16", 20 * log10(r16 / clean));
        steady(1, 441, MUSIC, &rms, &peak, &third);
        check("step 1 rounds the tone a little", third > 0.005 && third < 0.12, "third harmonic %.1f %% of the fundamental", third * 100);
        steady(FM1_DRIVE_STEPS, 441, MUSIC, &rms, &peak, &third);
        check("step 16 squares it off: fuzz", third > 0.27 && third < 0.34, "third harmonic %.1f %% (a square wave has 33.3 %%)", third * 100);
        check("... and its peak is the step's level", peak <= FM1_DRIVE_LEVEL[FM1_DRIVE_STEPS - 1] && peak > FM1_DRIVE_LEVEL[FM1_DRIVE_STEPS - 1] * 0.98, "%.0f of %d", peak, FM1_DRIVE_LEVEL[FM1_DRIVE_STEPS - 1]);
    }

    /* ---- full scale in, every step: nothing wraps round */
    for (ok = 1, s = 1; s <= FM1_DRIVE_STEPS; s++) {
        steady(s, 997, 32767, &rms, &peak, &third);
        ok &= peak <= FM1_DRIVE_LEVEL[s - 1];
    }
    check("a full-scale tone at every step stays under that step's level", ok, "");

    /* ---- silence */
    for (ok = 1, s = 1; s <= FM1_DRIVE_STEPS; s++) {
        steady(s, 441, 0, &rms, &peak, &third);
        ok &= peak == 0;
    }
    check("silence in: silence out, at every step", ok, "");

    /* ---- turning the knob under a steady tone: no clicks */
    {
        static const int8_t turns[] = {0, 0, 1, 1, 2, 3, 8, 16, 16, 9, 1, 0, 0, 16, 16, 0, 0, 5, 5};
        double own[FM1_DRIVE_STEPS + 1], last = 0, worst = 0;
        int clean = 1, at = 0;
        /* the largest step between two samples that each setting makes when left alone (0: the tone itself) */
        for (s = 0; s <= FM1_DRIVE_STEPS; s++) {
            double prev = 0;
            fm1_drive_t e;
            memset(&e, 0, sizeof e);
            phase = 0;
            own[s] = 0;
            for (int b = 0; b < 12; b++) {
                tone_block(441, MUSIC, 1);
                fm1_drive_run(&e, buf, BLOCK, s);
                for (i = 0; i < BLOCK; i++) {
                    if (b >= 2 && fabs(buf[2 * i] - prev) > own[s]) own[s] = fabs(buf[2 * i] - prev);
                    prev = buf[2 * i];
                }
            }
        }
        memset(&d, 0, sizeof d);
        phase = 0;
        for (unsigned t = 0; t < sizeof turns; t++) {
            int from = t ? turns[t - 1] : 0, to = turns[t];
            double allowed = 1.6 * (own[from] > own[to] ? own[from] : own[to]) + 2;
            for (int b = 0; b < 3; b++) {
                tone_block(441, MUSIC, 1);
                fm1_drive_run(&d, buf, BLOCK, to);
                for (i = 0; i < BLOCK; i++, at++) {
                    double step = fabs(buf[2 * i] - last);
                    if (at && step > allowed) clean = 0;
                    if (at && step / allowed > worst) worst = step / allowed;
                    last = buf[2 * i];
                }
            }
        }
        check("turning the knob through off, all the way up and back under a steady tone makes no click", clean,
              "no step between samples over 1.6x what the settings either side make left alone (worst %.2fx of that)", worst * 1.6);
    }

    /* ---- a change of step arrives exactly, a block later */
    memset(&d, 0, sizeof d);
    tone_block(441, MUSIC, 1);
    fm1_drive_run(&d, buf, BLOCK, 3);
    tone_block(441, MUSIC, 1);
    fm1_drive_run(&d, buf, BLOCK, 11);
    check("a new step is reached exactly at the end of one block", d.g == FM1_DRIVE_GAIN[10] << 8 && d.l == FM1_DRIVE_LEVEL[10] << 8 && d.wet == 256 << 16, "");
    tone_block(441, MUSIC, 1);
    fm1_drive_run(&d, buf, BLOCK, 0);
    {
        int16_t was[BLOCK * 2];
        tone_block(441, MUSIC, 1);
        memcpy(was, buf, sizeof buf);
        fm1_drive_run(&d, buf, BLOCK, 0);
        check("off again: one block of fade, then not a sample touched", d.wet == 0 && !memcmp(was, buf, sizeof buf), "");
    }

    /* ---- the two channels are separate; odd settings are taken as the nearest real one */
    memset(&d, 0, sizeof d);
    phase = 0;
    for (ok = 1, i = 0; i < 10; i++) {
        tone_block(441, 20000, 0);
        fm1_drive_run(&d, buf, BLOCK, 12);
        for (int k = 0; k < BLOCK; k++)
            ok &= buf[2 * k + 1] == 0;
    }
    check("a silent right channel stays silent while the left is driven hard", ok, "");
    memset(&d, 0, sizeof d);
    tone_block(441, MUSIC, 1);
    fm1_drive_run(&d, buf, BLOCK, 99);
    ok = d.amt == FM1_DRIVE_STEPS;
    fm1_drive_run(&d, buf, BLOCK, -5);
    ok &= d.amt == 0;
    fm1_drive_run(&d, buf, 0, 7);
    check("a setting beyond the ends is the end; no block at all is no work and no crash", ok && d.amt == 0, "");

    puts(fails ? "DRIVE TEST FAILED" : "DRIVE TEST PASSED");
    return fails != 0;
}
