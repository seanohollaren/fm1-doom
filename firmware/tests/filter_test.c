/* SPDX-License-Identifier: GPL-3.0-only */
/* PC test of rp2040-doom/src/fm1/fm1_filter.h, the filter over the game's sound.
 *   cc -I rp2040-doom/src/fm1 -o filter_test firmware/tests/filter_test.c -lm && ./filter_test */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "fm1_filter.h"

#define FS 44118.0
#define BLOCK 128
static int bad;
static void check(const char *name, int ok) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", name); bad += !ok; }

/* a sine of the given level through the filter at one setting: the level that comes out, in dB against what went in */
static double gain_db(int pos, int res, double hz, double amp)
{
    fm1_filter_t f;
    int16_t buf[2 * BLOCK];
    double in2 = 0, out2 = 0, ph = 0, w = 2 * M_PI * hz / FS;
    int b, i;
    memset(&f, 0, sizeof f);
    for (b = 0; b < 400; b++) {
        for (i = 0; i < BLOCK; i++, ph += w)
            buf[2 * i] = buf[2 * i + 1] = (int16_t)lrint(amp * sin(ph));
        if (b >= 200)
            for (i = 0; i < BLOCK; i++)
                in2 += (double)buf[2 * i] * buf[2 * i];
        fm1_filter_run(&f, buf, BLOCK, pos, res);
        if (b >= 200)                                   /* after it has settled */
            for (i = 0; i < BLOCK; i++)
                out2 += (double)buf[2 * i + 1] * buf[2 * i + 1];
    }
    return 10 * log10((out2 + 1e-9) / in2);
}

int main(void)
{
    static int16_t a[2 * BLOCK], b[2 * BLOCK];
    fm1_filter_t f;
    int i, n, pos, res, ok, worst;
    double d;

    /* the tables are what the comment says they are */
    ok = 1;
    for (i = 0; i < FM1_FILTER_STEPS; i++) {
        double hz = 80.0 * pow(100.0, i / (double)(FM1_FILTER_STEPS - 1));
        if (labs((long)FM1_FILTER_G[i] - lrint(tan(M_PI * hz / FS) * 16777216.0)) > 1 || fabs(FM1_FILTER_HZ[i] - hz) > hz * 0.03)
            ok = 0;
        if (i && (FM1_FILTER_G[i] <= FM1_FILTER_G[i - 1] || FM1_FILTER_HZ[i] <= FM1_FILTER_HZ[i - 1]))
            ok = 0;
    }
    check("cutoff table: 80 Hz to 8 kHz in equal ratios, rising, and the Hz shown agree with it", ok);
    check("knob positions map to the table: far left and just right of centre are 80 Hz, just left and far right 8 kHz",
          fm1_filter_step(-FM1_FILTER_STEPS) == 0 && fm1_filter_step(1) == 0 && fm1_filter_step(-1) == FM1_FILTER_STEPS - 1 &&
          fm1_filter_step(FM1_FILTER_STEPS) == FM1_FILTER_STEPS - 1);

    /* off is off */
    memset(&f, 0, sizeof f);
    srand(3);
    ok = 1;
    for (n = 0; n < 50; n++) {
        for (i = 0; i < 2 * BLOCK; i++)
            a[i] = b[i] = (int16_t)(rand() - RAND_MAX / 2);
        fm1_filter_run(&f, a, BLOCK, 0, n % FM1_FILTER_RES);
        if (memcmp(a, b, sizeof a))
            ok = 0;
    }
    check("off: every sample comes out as it went in, whatever the resonance knob does", ok);

    /* what each side of the knob does (resonance 0: no peak) */
    /* positions -19 and 22 are the same cutoff, 955 Hz, from either side */
    check("low-pass at 1 kHz: 200 Hz passes (within 0.5 dB)", fabs(gain_db(-19, 0, 200, 8000)) < 0.5);
    d = gain_db(-19, 0, 5000, 8000);
    check("low-pass at 1 kHz: 5 kHz is down more than 24 dB", d < -24);
    check("high-pass at 1 kHz: 5 kHz passes (within 0.5 dB)", fabs(gain_db(22, 0, 5000, 8000)) < 0.5);
    d = gain_db(22, 0, 200, 8000);
    check("high-pass at 1 kHz: 200 Hz is down more than 24 dB", d < -24);
    check("far left: only the bottom is left (1 kHz down more than 36 dB)", gain_db(-FM1_FILTER_STEPS, 0, 1000, 8000) < -36);
    check("far right: only the top is left (500 Hz down more than 36 dB)", gain_db(FM1_FILTER_STEPS, 0, 500, 8000) < -36);
    check("one step left of centre: all but the very top passes (1 kHz within 0.2 dB)", fabs(gain_db(-1, 0, 1000, 8000)) < 0.2);
    check("one step right of centre: all but the very bottom passes (1 kHz within 0.2 dB)", fabs(gain_db(1, 0, 1000, 8000)) < 0.2);
    /* the cutoff is where the table says: -3 dB there without resonance (Q = 0.707) */
    ok = 1;
    for (pos = -FM1_FILTER_STEPS; pos <= FM1_FILTER_STEPS; pos += 3)
        if (pos && fabs(gain_db(pos, 0, 80.0 * pow(100.0, fm1_filter_step(pos) / 39.0), 6000) + 3.01) > 0.35)
            ok = 0;
    check("the cutoff sits where the table says, both sides, all along the knob (-3 dB there, within 0.35 dB)", ok);
    /* resonance: a peak at the cutoff that grows with the knob */
    ok = 1;
    for (res = 1; res < FM1_FILTER_RES; res++)
        if (gain_db(-19, res, 1000, 2000) <= gain_db(-19, res - 1, 1000, 2000) + 0.5)
            ok = 0;
    check("resonance: each step raises the peak at the cutoff", ok);
    /* at the cutoff itself a filter of quality Q is Q times louder: Q = 8 is +18.1 dB, and the level it gives up
     * there (0.5625) is -5.0 dB */
    d = gain_db(-19, FM1_FILTER_RES - 1, 80.0 * pow(100.0, 21 / 39.0), 2000);
    check("resonance at the top: the peak at the cutoff is 13.1 dB, within 0.3 dB (Q 8, less the level it gives up)", fabs(d - 13.06) < 0.3);
    d = gain_db(22, FM1_FILTER_RES - 1, 80.0 * pow(100.0, 21 / 39.0), 2000);
    check("... and the same on the high-pass side", fabs(d - 13.06) < 0.3);
    check("resonance does not change what is far below a low-pass's cutoff by more than its level drop (6 dB)",
          gain_db(-19, FM1_FILTER_RES - 1, 100, 8000) > -6 && gain_db(-19, FM1_FILTER_RES - 1, 100, 8000) < 0.1);

    /* it cannot run away: the loudest noise, the worst resonance, every position, the knob spinning */
    memset(&f, 0, sizeof f);
    srand(7);
    worst = 0;
    for (n = 0; n < 4000; n++) {
        pos = (n * 7) % (2 * FM1_FILTER_STEPS + 1) - FM1_FILTER_STEPS;
        for (i = 0; i < 2 * BLOCK; i++)
            a[i] = (rand() & 1) ? 32767 : -32768;
        fm1_filter_run(&f, a, BLOCK, pos, FM1_FILTER_RES - 1);
        for (i = 0; i < 2; i++) {
            if (labs((long)f.ic1[i]) > worst) worst = (int)labs((long)f.ic1[i]);
            if (labs((long)f.ic2[i]) > worst) worst = (int)labs((long)f.ic2[i]);
        }
    }
    check("full-scale square noise, top resonance, the knob jumping about for 12 s: the state stays far inside its guard", worst < (1 << 28));
    /* ... and it dies away to nothing when the sound stops */
    for (n = 0; n < 2000; n++) {
        memset(a, 0, sizeof a);
        fm1_filter_run(&f, a, BLOCK, -30, FM1_FILTER_RES - 1);
    }
    ok = 1;
    for (i = 0; i < 2 * BLOCK; i++)
        if (a[i])
            ok = 0;
    check("silence in: silence out, even at top resonance after that abuse", ok);

    /* no clicks: a steady tone while the knob is turned through off and back, one step per block */
    memset(&f, 0, sizeof f);
    {
        double ph = 0, w = 2 * M_PI * 440 / FS;
        int prev = 0, jump = 0, first = 1;
        for (n = 0; n < 200; n++) {
            pos = n < 40 ? -n / 4 : n < 80 ? -10 + (n - 40) / 4 : n < 120 ? (n - 80) / 4 : 10 - (n - 120) / 8;
            for (i = 0; i < BLOCK; i++, ph += w)
                a[2 * i] = a[2 * i + 1] = (int16_t)lrint(8000 * sin(ph));
            fm1_filter_run(&f, a, BLOCK, pos, 3);
            for (i = 0; i < BLOCK; i++) {
                if (!first && abs(a[2 * i] - prev) > jump)
                    jump = abs(a[2 * i] - prev);
                prev = a[2 * i];
                first = 0;
            }
        }
        /* a 440 Hz sine of 8000 moves 501 a sample at most; resonance may add to it, a click would dwarf it */
        check("turning the knob through off and back under a steady tone makes no click (no step over 1.6x the tone's own)", jump < 800);
    }

    /* both channels are filtered alike and do not leak into each other */
    memset(&f, 0, sizeof f);
    ok = 1;
    for (n = 0; n < 100; n++) {
        for (i = 0; i < BLOCK; i++) {
            a[2 * i] = (int16_t)(rand() - RAND_MAX / 2);
            a[2 * i + 1] = 0;
        }
        fm1_filter_run(&f, a, BLOCK, -15, 4);
        for (i = 0; i < BLOCK; i++)
            if (a[2 * i + 1])
                ok = 0;
    }
    check("the two channels are separate: a silent right stays silent while the left plays", ok);
    check("no block at all is no work and no crash", (fm1_filter_run(&f, a, 0, 5, 2), 1));

    /* ---- between two knob steps, and the wobble that needs it */
    ok = 1;
    for (pos = -FM1_FILTER_STEPS; pos <= FM1_FILTER_STEPS; pos++)
        if (pos && fm1_filter_g(pos * 256) != FM1_FILTER_G[fm1_filter_step(pos)])
            ok = 0;
    for (i = -FM1_FILTER_STEPS * 256 + 1; i < -256; i++)         /* low-pass side: opening as the position rises */
        if (fm1_filter_g(i) < fm1_filter_g(i - 1))
            ok = 0;
    for (i = 257; i <= FM1_FILTER_STEPS * 256; i++)              /* high-pass side the same */
        if (fm1_filter_g(i) < fm1_filter_g(i - 1))
            ok = 0;
    d = 0;
    for (i = 0; i < 256 * (FM1_FILTER_STEPS - 1); i++) {         /* against the curve the table is cut from */
        double hz = 80.0 * pow(100.0, i / 256.0 / (FM1_FILTER_STEPS - 1)), e = fm1_filter_g(i + 256) / (tan(M_PI * hz / FS) * 16777216.0) - 1;
        if (fabs(e) > d) d = fabs(e);
    }
    printf("        (a position between two steps is within %.2f %% of the true cutoff)\n", d * 100);
    check("on a knob step the cutoff is the table's; between steps it lies between, within half a percent of the curve", ok && d < 0.005);

    memset(&f, 0, sizeof f);
    ok = fm1_filter_swing(&f, BLOCK, -20, 0) == -20 * 256 && fm1_filter_swing(&f, BLOCK, 0, 5) == 0 && fm1_filter_swing(&f, BLOCK, 7, -3) == 7 * 256;
    check("no wobble, or no filter to wobble: the position is the knob's", ok);
    for (ok = 1, n = 1; n <= FM1_WOBBLE_STEPS; n++) {
        int lo = 1 << 30, hi = -(1 << 30), last, turns = 0, rising = 0, first = -1, lastpeak = 0, at;
        double hz = 0.25 * pow(2.0, (n - 1) / 2.0), got;
        memset(&f, 0, sizeof f);
        fm1_filter_swing(&f, BLOCK, -20, 0);                     /* idle: it waits in the middle */
        last = fm1_filter_swing(&f, BLOCK, -20, n);
        if (abs(last + 20 * 256) >= 256) ok = 0;                 /* ... and sets off from there: less than a knob step in a block */
        for (i = 1; i < (int)(FS / BLOCK * 20); i++) {           /* 20 seconds */
            at = fm1_filter_swing(&f, BLOCK, -20, n);
            if (at < lo) lo = at;
            if (at > hi) hi = at;
            if (rising && at < last) {                           /* a peak */
                if (first < 0) first = i; else turns++;
                lastpeak = i;
            }
            rising = at > last ? 1 : at < last ? 0 : rising;
            last = at;
        }
        got = turns * FS / BLOCK / (lastpeak - first);
        if (fabs(got / hz - 1) > 0.02 || abs(lo - (-20 - FM1_WOBBLE_DEPTH) * 256) > 40 || abs(hi - (-20 + FM1_WOBBLE_DEPTH) * 256) > 40)
            ok = 0, printf("        speed %d: %.3f Hz (wanted %.3f), swing %d .. %d\n", n, got, hz, lo, hi);
    }
    check("the wobble swings 8 knob steps each way about the knob's position, at 0.25 Hz to 8 Hz as its table says", ok);
    for (ok = 1, pos = -FM1_FILTER_STEPS; pos <= FM1_FILTER_STEPS; pos++) {
        memset(&f, 0, sizeof f);
        for (i = 0; pos && i < 3000; i++) {
            int at = fm1_filter_swing(&f, BLOCK, pos, FM1_WOBBLE_STEPS);
            if (pos < 0 ? at > -256 || at < -FM1_FILTER_STEPS * 256 : at < 256 || at > FM1_FILTER_STEPS * 256)
                ok = 0;
        }
    }
    check("... and never across the centre or past either end, wherever the knob is", ok);
    {   /* a tone an octave above a low-pass's cutoff: the wobble makes it come and go, without a click */
        double lo = 1e9, hi = 0, ph = 0, w = 2 * M_PI * 1700 / FS, biggest = 0, prev = 0;
        memset(&f, 0, sizeof f);
        for (n = 0; n < (int)(FS / BLOCK * 6); n++) {
            double sq = 0;
            for (i = 0; i < BLOCK; i++, ph += w)
                a[2 * i] = a[2 * i + 1] = (int16_t)lrint(8000 * sin(ph));
            fm1_filter_run_at(&f, a, BLOCK, fm1_filter_swing(&f, BLOCK, -20, 7), 5);
            for (i = 0; i < BLOCK; i++) {
                sq += (double)a[2 * i] * a[2 * i];
                if (n > 4 && fabs(a[2 * i] - prev) > biggest) biggest = fabs(a[2 * i] - prev);
                prev = a[2 * i];
            }
            if (n > 20) {
                if (sq < lo) lo = sq;
                if (sq > hi) hi = sq;
            }
        }
        d = 10 * log10(hi / lo);
        printf("        (a 1700 Hz tone through an 850 Hz low-pass wobbling at 2 Hz: %.1f dB between its loudest and quietest; largest step %.0f)\n", d, biggest);
        check("a tone above the cutoff comes and goes with the wobble (over 12 dB), with no click", d > 12 && biggest < 8000 * 4.0 * w * 1.6);
    }
    puts(bad ? "FILTER TEST FAILED" : "FILTER TEST PASSED");
    return bad != 0;
}
