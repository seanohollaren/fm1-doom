/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: receiving the second block of the game data over USB and writing it to flash, so that a web page
 * can install everything (firmware/doom_dev.c includes this; firmware/tests/data_test.c tests it on a PC).
 *
 * The block lives at flash [DD_LO, DD_HI) and nowhere else. One 4 KiB sector at a time: fetch it from the host,
 * compare with what the flash holds, and only if it differs erase, program and read back (three tries).
 * A failure leaves a block that fails its checksum at the next start, i.e. safe mode, from where the same
 * page can run again; the application area is never touched from here.
 *
 * The includer provides:
 *   int  dd_pull(uint32_t off, uint8_t *dst, uint32_t n)        bytes [off, off + n) of the block, n <= DD_PULL; 0 = ok
 *   int  dd_finish(void)                                        the host confirms it sent everything; 0 = ok
 *   int  dd_fread(uint32_t flash_off, uint8_t *dst, uint32_t n) 0 = ok
 *   int  dd_erase(uint32_t flash_off)                           one sector; 0 = ok
 *   int  dd_prog(uint32_t flash_off, const uint8_t *src, uint32_t n)   0 = ok
 *   void dd_progress(uint32_t done, uint32_t total)
 *   void dd_feed(void)                                          watchdog
 */
#define DD_LO 0x00093000u
#define DD_HI 0x000E0000u               /* the update staging area starts here */
#define DD_SECTOR 0x1000u
#define DD_PULL 512u
#define DD_TRIES 3u
enum { DD_OK = 0, DD_E_RANGE = -1, DD_E_PULL = -2, DD_E_READ = -3, DD_E_WRITE = -4, DD_E_HOST = -5 };

static int dd_same(const uint8_t *a, const uint8_t *b, uint32_t n)
{
    while (n--)
        if (*a++ != *b++)
            return 0;
    return 1;
}

/* buf, chk: two sector-sized work buffers. force: rewrite sectors even when they already hold the right bytes
 * (a test of the write path). *written: sectors erased and programmed. */
static int dd_write(uint32_t flash_off, uint32_t len, int force, uint8_t *buf, uint8_t *chk, uint32_t *written)
{
    uint32_t o, i, n, k, t;
    *written = 0;
    if (flash_off != DD_LO || !len || len > DD_HI - DD_LO)
        return DD_E_RANGE;
    for (o = 0; o < len; o += DD_SECTOR) {
        n = len - o < DD_SECTOR ? len - o : DD_SECTOR;
        for (i = 0; i < n; i += k) {
            k = n - i < DD_PULL ? n - i : DD_PULL;
            if (dd_pull(o + i, buf + i, k))
                return DD_E_PULL;
            dd_feed();
        }
        for (i = n; i < DD_SECTOR; i++)
            buf[i] = 0xFFu;                              /* the rest of the last sector stays blank */
        if (dd_fread(flash_off + o, chk, DD_SECTOR))
            return DD_E_READ;
        if (force || !dd_same(buf, chk, DD_SECTOR)) {
            for (t = 0;; t++) {
                if (t == DD_TRIES)
                    return DD_E_WRITE;
                dd_feed();
                if (dd_erase(flash_off + o) || dd_prog(flash_off + o, buf, DD_SECTOR))
                    continue;
                if (!dd_fread(flash_off + o, chk, DD_SECTOR) && dd_same(buf, chk, DD_SECTOR))
                    break;
            }
            (*written)++;
        }
        dd_progress(o + n, len);
    }
    return dd_finish() ? DD_E_HOST : DD_OK;
}
