/* SPDX-License-Identifier: GPL-3.0-only */
/* PC test of rp2040-doom/src/fm1/fm1_osd.h: how a message for the large message line is broken into lines.
 * The letters themselves are the game's font and are drawn by the engine; web/test_message_line.js checks those
 * in the browser build.
 *   cc -I rp2040-doom/src/fm1 -o osd_test firmware/tests/osd_test.c && ./osd_test */
#include <stdio.h>
#include <string.h>
#include "fm1_osd.h"

static int bad;
static void check(const char *name, int ok) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", name); bad += !ok; }

/* widths like the game's font: most letters 8 pixels, a few narrow ones */
static int width(int c) { return c == ' ' ? FM1_OSD_SPACE : c == 'I' || c == '.' || c == ',' || c == ':' || c == '1' ? 4 : c == 'M' || c == 'W' ? 9 : 8; }
static int line_width(const char *t) { int w = 0; for (; *t; t++) w += width(*t); return w; }

static const char *const SAID[] = {
    "LOW PASS 955 HZ", "HIGH PASS 8000 HZ", "FILTER OFF", "RESONANCE 7", "ORIGINAL MUSIC", "MUSIC 87 LEAD 7 (5TH SAWTOOTH)",
    "MUSIC 27 * Electric Guitar (clean)", "MUSIC 128 Rhodes Paino", "FM DEPTH +8", "FM DEPTH -3", "FM DEPTH AS WRITTEN", "PITCH -12",
    "TEMPO 200%", "ATTACK 6", "DECAY 8", "SUSTAIN 10", "RELEASE 8", "ORIGINAL ATTACK", "ORIGINAL DECAY", "ORIGINAL SUSTAIN",
    "ORIGINAL RELEASE", "WOBBLE 0.35 HZ: NEEDS THE FILTER ON", "WOBBLE 5.6 HZ", "WOBBLE OFF", "KNOBS: ENVELOPE", "KNOBS: WOBBLE",
    "KNOBS: FILTER, PITCH, TEMPO", "SOUND AS IT WAS", "VIEW 240 X 150",
    "VIEW FULL SCREEN", "35 FRAMES A SECOND",
};

int main(void)
{
    fm1_osd_t o;
    unsigned i;
    int ok, l, most = 0;

    for (ok = 1, i = 0; i < sizeof SAID / sizeof *SAID; i++) {
        char joined[120] = "";
        memset(&o, 0, sizeof o);
        fm1_osd_set(&o, SAID[i], 0, width);
        for (l = 0; l < o.lines; l++) {
            if (line_width(o.text[l]) > FM1_OSD_WIDTH || !o.text[l][0] || o.text[l][0] == ' ' || o.text[l][strlen(o.text[l]) - 1] == ' ') ok = 0;
            if (l + 1 < o.lines) {                              /* no line was broken sooner than it had to be */
                char next[40];
                sscanf(o.text[l + 1], "%39s", next);
                if (line_width(o.text[l]) + FM1_OSD_SPACE + line_width(next) <= FM1_OSD_WIDTH) ok = 0;
            }
            if (l) strcat(joined, " ");
            strcat(joined, o.text[l]);
        }
        for (l = 0; SAID[i][l]; l++)                            /* the same words in the same order, in capitals */
            if (joined[l] != (SAID[i][l] >= 'a' && SAID[i][l] <= 'z' ? SAID[i][l] - 32 : SAID[i][l])) ok = 0;
        if (joined[l] || o.lines < 1 || o.clipped) ok = 0;
        if (o.lines > most) most = o.lines;
        if (!ok) { printf("        \"%s\" -> %d lines%s\n", SAID[i], o.lines, o.clipped ? ", clipped" : ""); break; }
    }
    check("every message is broken at its spaces into lines no wider than the picture, as few as will do, nothing lost", ok && most <= FM1_OSD_LINES);

    memset(&o, 0, sizeof o);
    fm1_osd_set(&o, "", 0, width);
    ok = o.lines == 0 && !fm1_osd_on(&o, 0);
    fm1_osd_set(&o, "   ", 0, width);
    check("nothing to say is nothing shown", ok && o.lines == 0);
    fm1_osd_set(&o, "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE THIRTEEN FOURTEEN FIFTEEN", 0, width);
    ok = o.lines == FM1_OSD_LINES && o.clipped;
    for (l = 0; l < o.lines; l++)
        ok &= line_width(o.text[l]) <= FM1_OSD_WIDTH && strlen(o.text[l]) <= FM1_OSD_LINE_CHARS;
    check("too many words: three lines, the rest dropped and said to be", ok);
    fm1_osd_set(&o, "A SUPERCALIFRAGILISTICEXPIALIDOCIOUS B", 0, width);
    check("a word wider than a line has a line to itself, is said not to fit, and cannot run past the line's storage",
          o.clipped && o.lines == 3 && !strcmp(o.text[0], "A") && strlen(o.text[1]) == FM1_OSD_LINE_CHARS && !strcmp(o.text[2], "B"));
    fm1_osd_set(&o, "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII", 0, width);       /* 40 narrow letters: 160 pixels */
    check("... nor can narrow letters", strlen(o.text[0]) == FM1_OSD_LINE_CHARS && o.clipped);
    fm1_osd_set(&o, "PITCH +3", 1000, width);
    check("a message stays three seconds", fm1_osd_on(&o, 1000) && fm1_osd_on(&o, 3999) && !fm1_osd_on(&o, 4000) && !fm1_osd_on(&o, 0x80000000u));
    fm1_osd_set(&o, "X", 0xFFFFFF00u, width);
    check("... also across the millisecond clock's wrap", fm1_osd_on(&o, 0xFFFFFFFFu) && fm1_osd_on(&o, 100) && !fm1_osd_on(&o, 0xFFFFFF00u + FM1_OSD_MS));
    puts(bad ? "MESSAGE LINE TEST FAILED" : "MESSAGE LINE TEST PASSED");
    return bad != 0;
}
