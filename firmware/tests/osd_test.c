/* SPDX-License-Identifier: GPL-3.0-only */
/* PC test of rp2040-doom/src/fm1/fm1_osd.h, the large message line.
 *   cc -I rp2040-doom/src/fm1 -o osd_test firmware/tests/osd_test.c && ./osd_test [OUT.pgm] */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "fm1_osd.h"

#define W 240
static int bad;
static void check(const char *name, int ok) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", name); bad += !ok; }
static uint16_t swap(uint16_t v) { return (uint16_t)(v << 8 | v >> 8); }

/* every message the firmware can make, and every instrument name the game has, must fit and be legible */
static const char *const SAID[] = {
    "LOW PASS 955 HZ", "HIGH PASS 8000 HZ", "FILTER OFF", "RESONANCE 7", "MUSIC AS WRITTEN", "MUSIC 87 LEAD 7 (5TH SAWTOOTH)",
    "MUSIC 27 * Electric Guitar (clean)", "MUSIC 128 Rhodes Paino", "FM DEPTH +8", "FM DEPTH -3", "FM DEPTH AS WRITTEN", "PITCH -12",
    "TEMPO 200%", "ENVELOPE SHORT 6", "ENVELOPE LONG 1", "ENVELOPE AS WRITTEN", "WOBBLE 0.35 HZ: TURN KNOB 1 TOO", "WOBBLE 5.6 HZ",
    "WOBBLE OFF", "KNOBS 3 AND 4: ENVELOPE, WOBBLE", "KNOBS 3 AND 4: PITCH, TEMPO", "SOUND AS IT WAS", "VIEW 240 X 150",
    "VIEW FULL SCREEN", "35 FRAMES A SECOND",
};

int main(int argc, char **argv)
{
    static uint16_t px[80][W];
    fm1_osd_t o;
    unsigned i;
    int ok, y, x, lit, dim, same;

    /* ---- breaking into lines */
    for (ok = 1, i = 0; i < sizeof SAID / sizeof *SAID; i++) {
        char joined[80] = "";
        int l;
        memset(&o, 0, sizeof o);
        fm1_osd_set(&o, SAID[i], 0);
        for (l = 0; l < o.lines; l++) {
            if (strlen(o.text[l]) > FM1_OSD_COLS || !o.text[l][0] || o.text[l][0] == ' ') ok = 0;
            if (l) strcat(joined, " ");
            strcat(joined, o.text[l]);
        }
        for (l = 0; SAID[i][l]; l++)                        /* the same words in the same order, in capitals */
            if (joined[l] != (SAID[i][l] >= 'a' && SAID[i][l] <= 'z' ? SAID[i][l] - 32 : SAID[i][l])) ok = 0;
        if (joined[l] || o.lines < 1 || o.lines > 2) ok = 0;
        for (l = 0; joined[l]; l++)                         /* and a letter for every character but the space */
            if (joined[l] != ' ' && !memcmp(FM1_OSD_FONT[(unsigned char)joined[l] - 32], "\0\0\0\0\0\0\0", 7)) ok = 0, printf("        no letter for '%c'\n", joined[l]);
        if (!ok) { printf("        \"%s\" -> %d lines\n", SAID[i], o.lines); break; }
    }
    check("every message fits in one or two lines of 20, whole words, and every character in it has a letter", ok);
    memset(&o, 0, sizeof o);
    fm1_osd_set(&o, "", 0);
    ok = o.lines == 0 && !fm1_osd_on(&o, 0);
    fm1_osd_set(&o, "   ", 0);
    ok &= o.lines == 0;
    fm1_osd_set(&o, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 A B C D E F G H I J K L M N O P Q R S T U V W X Y Z", 0);
    ok &= o.lines == FM1_OSD_LINES && strlen(o.text[0]) == FM1_OSD_COLS && strlen(o.text[2]) <= FM1_OSD_COLS;
    check("nothing to say is nothing shown; far too much is cut to three lines, not run past them", ok);
    fm1_osd_set(&o, "PITCH +3", 1000);
    check("a message stays three seconds", fm1_osd_on(&o, 1000) && fm1_osd_on(&o, 3999) && !fm1_osd_on(&o, 4000) && !fm1_osd_on(&o, 0x80000000u));
    fm1_osd_set(&o, "X", 0xFFFFFF00u);
    check("... also across the millisecond clock's wrap", fm1_osd_on(&o, 0xFFFFFFFFu) && fm1_osd_on(&o, 100) && !fm1_osd_on(&o, 0xFFFFFF00u + FM1_OSD_MS));

    /* ---- drawing: a grey picture, the band over its top */
    fm1_osd_set(&o, "MUSIC 20 Church Organ", 0);
    for (y = 0; y < 80; y++)
        for (x = 0; x < W; x++)
            px[y][x] = swap(0x8410);                        /* mid grey */
    for (y = 0; y < 80; y++)
        fm1_osd_row(&o, px[y], W, y - 10);                  /* the band starts at row 10 */
    lit = dim = same = 0;
    for (ok = 1, y = 0; y < 80; y++)
        for (x = 0; x < W; x++) {
            uint16_t v = swap(px[y][x]);
            int in = y >= 10 && y < 10 + fm1_osd_height(&o);
            if (v == 0xFFFF) lit++; else if (v == 0x2104) dim++; else if (v == 0x8410) same++; else ok = 0;
            if (in ? v == 0x8410 : v != 0x8410) ok = 0;
        }
    check("inside the band every pixel is a quarter as bright or white; outside it nothing is touched", ok && fm1_osd_height(&o) == 40 && same == (80 - 40) * W);
    {   /* "MUSIC 20 CHURCH" over "ORGAN": the dots of both lines, each 2 x 2 pixels */
        int dots = 0, l, r;
        for (l = 0; l < o.lines; l++)
            for (i = 0; o.text[l][i]; i++)
                for (r = 0; r < 7; r++)
                    dots += __builtin_popcount(FM1_OSD_FONT[(unsigned char)o.text[l][i] - 32][r]);
        check("the white pixels are the letters' dots, four pixels each", lit == dots * 4 && !strcmp(o.text[0], "MUSIC 20 CHURCH") && !strcmp(o.text[1], "ORGAN"));
    }
    {   /* centred: as much band left of the first white pixel as right of the last, to a pixel */
        int first = W, last = -1;
        for (x = 0; x < W; x++)
            for (y = 10 + FM1_OSD_PAD; y < 10 + FM1_OSD_PAD + 14; y++)
                if (swap(px[y][x]) == 0xFFFF) { if (x < first) first = x; if (x > last) last = x; }
        check("a line is centred", abs(first - (W - 1 - last)) <= 1);
    }
    fm1_osd_set(&o, "WWWWWWWWWWWWWWWWWWWW", 0);                 /* the widest line there can be */
    for (ok = 1, y = 0; y < 30; y++) {
        uint16_t row[W + 2];
        for (x = 0; x < W + 2; x++) row[x] = 0x1234;
        fm1_osd_row(&o, row + 1, W, y);
        ok &= row[0] == 0x1234 && row[W + 1] == 0x1234;
    }
    check("the widest line stays inside the row", ok);
    if (argc > 1) {                                             /* a picture to look at */
        FILE *f = fopen(argv[1], "wb");
        fm1_osd_set(&o, "WOBBLE 0.35 HZ: TURN KNOB 1 TOO", 0);
        fprintf(f, "P5\n%d 60\n255\n", W);
        for (y = 0; y < 60; y++) {
            for (x = 0; x < W; x++) px[y][x] = swap((uint16_t)(((x ^ y) & 8) ? 0xC618 : 0x8410));
            fm1_osd_row(&o, px[y], W, y - 4);
            for (x = 0; x < W; x++) fputc((swap(px[y][x]) >> 5 & 63) * 255 / 63, f);
        }
        fclose(f);
    }
    puts(bad ? "MESSAGE LINE TEST FAILED" : "MESSAGE LINE TEST PASSED");
    return bad != 0;
}
