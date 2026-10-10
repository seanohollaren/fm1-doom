/* SPDX-License-Identifier: GPL-3.0-only */
/* PC test of firmware/dev_volume.h.   cc -o volume_test volume_test.c && ./volume_test */
#include <stdint.h>
#include <stdio.h>
#include "../dev_volume.h"

static int bad;
static void check(const char *name, int ok) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", name); bad += !ok; }

int main(void)
{
    uint32_t k, prev = 0;
    int mono = 1, i;
    int32_t knob;
    for (k = 0; k <= 1023u; k++) {
        if (dv_gain(k) < prev)
            mono = 0;
        prev = dv_gain(k);
    }
    check("the bottom of the knob is silent (readings 0..15 give no gain)", dv_gain(0) == 0 && dv_gain(15) == 0 && dv_gain(16) == 1);
    check("the top of the knob is Felucca's full level (4088 in Q12)", dv_gain(1023) == 4088);
    check("a reading out of range counts as the top", dv_gain(5000) == 4088);
    check("turning up never turns down", mono);
    check("half-way round is a quarter of the level (square law)", dv_gain(512) == 1024);
    check("silence stays silence at any setting", dv_sample(0, 4088) == 0 && dv_sample(0, 0) == 0);
    check("no gain, no sound", dv_sample(32767, 0) == 0 && dv_sample(-32768, 0) == 0);
    check("full gain is the mix shifted up 7 bits, less 0.2 %", dv_sample(1000, 4088) == 127750 && dv_sample(-1000, 4088) == -127750);
    check("the loudest samples fit the codec's 24-bit word", dv_sample(32767, 4088) < (1 << 23) && dv_sample(-32768, 4088) >= -(1 << 23));
    check("the old fixed 5 % is the knob at about 22 %", dv_gain(229) == 204 && dv_sample(1000, 204) == 6375);
    knob = 0;
    for (i = 0; i < 60; i++)
        knob = dv_smooth(knob, 1023);
    check("the smoothed knob reaches a new position within 60 polls (under two seconds of play)", knob / 16 >= 1021);
    knob = 500 * 16;
    check("a failed reading leaves the volume where it was", dv_smooth(knob, -1) == knob);
    check("a steady knob gives a steady level", dv_smooth(knob, 500) == knob);
    for (i = 0; i < 80; i++)
        knob = dv_smooth(knob, 0);
    check("turned right down, it reaches silence", dv_gain((uint32_t)(knob / 16)) == 0);
    puts(bad ? "VOLUME TEST FAILED" : "VOLUME TEST PASSED");
    return bad != 0;
}
