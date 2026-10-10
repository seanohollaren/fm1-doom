/* SPDX-License-Identifier: GPL-3.0-only */
/* PC test of firmware/dev_data.h: a simulated NOR flash (programming only clears bits; any erase or program outside
 * [0x93000, 0xE0000) is counted as a violation) and a simulated host.   cc -o data_test data_test.c && ./data_test */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t nor[0x100000], block[0x4D000];
static uint32_t block_len, pulls, erases, progs, bad_range, fail_prog_at = 0xFFFFFFFFu, fail_prog_n, bad_prog_at = 0xFFFFFFFFu;
static uint32_t dead_pull_at = 0xFFFFFFFFu, finish_ok = 1, flip_host_at = 0xFFFFFFFFu, last_done, last_total, erase_noop_at = 0xFFFFFFFFu;

static int dd_pull(uint32_t off, uint8_t *dst, uint32_t n)
{
    pulls++;
    if (off + n > block_len || n > 512u || off >= dead_pull_at)
        return -1;
    memcpy(dst, block + off, n);
    if (flip_host_at >= off && flip_host_at < off + n)
        dst[flip_host_at - off] ^= 0x04;
    return 0;
}
static int dd_finish(void) { return finish_ok ? 0 : -1; }
static int dd_fread(uint32_t off, uint8_t *dst, uint32_t n) { memcpy(dst, nor + off, n); return 0; }
static int dd_erase(uint32_t off)
{
    erases++;
    if (off < 0x93000u || off >= 0xE0000u || (off & 0xFFFu)) { bad_range++; return -8; }
    if (off != erase_noop_at)
        memset(nor + off, 0xFF, 0x1000);
    return 0;
}
static int dd_prog(uint32_t off, const uint8_t *src, uint32_t n)
{
    uint32_t i;
    progs++;
    if (off < 0x93000u || off + n > 0xE0000u) { bad_range++; return -8; }
    if (off == fail_prog_at && fail_prog_n) { fail_prog_n--; return -3; }
    for (i = 0; i < n; i++)
        nor[off + i] &= src[i];
    if (off == bad_prog_at) { bad_prog_at = 0xFFFFFFFFu; nor[off + 7] ^= 0x01; }   /* one bad write, once */
    return 0;
}
static void dd_progress(uint32_t done, uint32_t total) { last_done = done; last_total = total; }
static void dd_feed(void) {}

#include "../dev_data.h"

static int bad;
static void check(const char *name, int ok) { printf("  %s  %s\n", ok ? "ok  " : "FAIL", name); bad += !ok; }
static uint8_t buf[0x1000], chk[0x1000], before[0x100000];

static void reset(uint32_t len)
{
    uint32_t i;
    srand(11);
    for (i = 0; i < sizeof nor; i++)
        nor[i] = (uint8_t)rand();                           /* other firmware's bytes everywhere */
    memset(nor + 0x93000, 0xFF, 0xE0000 - 0x93000);        /* a blank data region */
    for (i = 0; i < sizeof block; i++)
        block[i] = (uint8_t)(rand() >> 3);
    block_len = len;
    memcpy(before, nor, sizeof nor);
    pulls = erases = progs = bad_range = 0;
    fail_prog_at = bad_prog_at = dead_pull_at = flip_host_at = erase_noop_at = 0xFFFFFFFFu;
    fail_prog_n = 0;
    finish_ok = 1;
}
static int outside_untouched(void) { return !memcmp(nor, before, 0x93000) && !memcmp(nor + 0xE0000, before + 0xE0000, 0x20000); }
static int region_is_block(void)
{
    uint32_t i, end = (block_len + 0xFFFu) & ~0xFFFu;
    if (memcmp(nor + 0x93000, block, block_len))
        return 0;
    for (i = block_len; i < end; i++)
        if (nor[0x93000 + i] != 0xFF)
            return 0;
    return !memcmp(nor + 0x93000 + end, before + 0x93000 + end, 0xE0000 - 0x93000 - end);
}

int main(void)
{
    uint32_t w;
    int rc;
    reset(312348);
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("a blank region: the block is written and verified", rc == DD_OK && region_is_block() && w == 77);
    check("  nothing outside [0x93000, 0xE0000) touched, no out-of-range call", outside_untouched() && !bad_range);
    check("  progress reached the end", last_done == block_len && last_total == block_len);
    pulls = erases = progs = 0;
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("the same block again: nothing erased or programmed", rc == DD_OK && w == 0 && !erases && !progs && pulls > 600);
    rc = dd_write(0x93000, block_len, 1, buf, chk, &w);
    check("force: every sector rewritten, result the same", rc == DD_OK && w == 77 && erases == 77 && region_is_block());

    reset(312348);
    nor[0x93000 + 0x21000 + 5] = 0x00;                       /* one sector holds something else */
    memcpy(nor + 0x93000, block, 0x21000);
    memcpy(nor + 0x93000 + 0x22000, block + 0x22000, block_len - 0x22000);
    memcpy(before, nor, sizeof nor);
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("one wrong sector among right ones: only that one is rewritten", rc == DD_OK && w == 1 && erases == 1 && region_is_block());

    reset(312348);
    bad_prog_at = 0x93000 + 0x30000;
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("a sector that programs wrongly once is done again", rc == DD_OK && region_is_block() && erases == 78);

    reset(312348);
    fail_prog_at = 0x93000 + 0x10000;
    fail_prog_n = 99;
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("a sector that never programs: gives up after three tries, reports it", rc == DD_E_WRITE && w == 16 && outside_untouched());

    reset(312348);
    erase_noop_at = 0x93000 + 0x8000;
    nor[0x93000 + 0x8000 + 3] = 0x00;
    memcpy(before, nor, sizeof nor);
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("a sector that will not erase: reported, not counted as written", rc == DD_E_WRITE && w == 8);

    reset(312348);
    dead_pull_at = 0x20000;
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("the host stops answering part way: reported", rc == DD_E_PULL && w == 32 && outside_untouched() && !bad_range);

    reset(312348);
    finish_ok = 0;
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("the host does not confirm at the end: reported", rc == DD_E_HOST);

    reset(1000);
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("a block shorter than one sector: written, the rest of the sector blank", rc == DD_OK && w == 1 && region_is_block());

    reset(0x4D000);
    rc = dd_write(0x93000, block_len, 0, buf, chk, &w);
    check("a block that fills the region exactly", rc == DD_OK && w == 77 && region_is_block() && outside_untouched() && !bad_range);

    reset(312348);
    check("refused: one byte too long", dd_write(0x93000, 0x4D001, 0, buf, chk, &w) == DD_E_RANGE);
    check("refused: empty", dd_write(0x93000, 0, 0, buf, chk, &w) == DD_E_RANGE);
    check("refused: any other address (0x92000)", dd_write(0x92000, 0x1000, 0, buf, chk, &w) == DD_E_RANGE);
    check("refused: any other address (0x94000)", dd_write(0x94000, 0x1000, 0, buf, chk, &w) == DD_E_RANGE);
    check("refused: the application area", dd_write(0x4000, 0x1000, 0, buf, chk, &w) == DD_E_RANGE);
    check("  and none of the refusals pulled, erased or programmed anything", !pulls && !erases && !progs && !memcmp(nor, before, sizeof nor));
    puts(bad ? "DATA TEST FAILED" : "DATA TEST PASSED");
    return bad != 0;
}
