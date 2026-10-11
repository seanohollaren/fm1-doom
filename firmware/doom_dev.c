/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: the device side. One compilation unit on Felucca's header-only HAL and its lcd / usb / ota sources
 * (Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments, GPL-3.0-only), put together the way
 * Felucca's own firmware/src/main.c and firmware/loader/loader.c are. It provides what the game's platform layer
 * asks for (rp2040-doom/src/fm1/fm1.h).
 *
 * RECOVERY FIRST. Everything in this file except the two game hooks at the end is the "recovery core": it must be
 * able to take a new firmware over USB whatever state the game or its data are in. The boot order is built for that:
 *
 *   1. watchdog armed, boot guard counted                         (Felucca's code, first thing)
 *   2. RAM set up, fault vectors and guards                       (Felucca's code)
 *   3. flash probed, screen and keys up, keys scanned once
 *   4. SAFE MODE is chosen if any of these holds:
 *        - the previous start died in its first 30 s              (amber screen)
 *        - HOME is held while switching on                        (cyan screen)
 *        - there is no game data, or it fails its checksums       (blue screen; one white corner = none,
 *                                                                  two = the second block is missing or damaged)
 *      Safe mode starts USB and the 10 kHz tick and then only answers the update protocol. It never touches the
 *      audio hardware, never calls into the game and never reads the game data again.
 *   5. otherwise the audio output is started and the game runs.
 *
 * Ways out that need nothing from the game: USB update (web installer / fm1_install.py) in either mode;
 * OCT- + OCT+ held 5 s -> mask-ROM UBOOT; USB SysEx F0 22 24 35 7D F7 -> UBOOT; three failed starts in a row
 * (i.e. safe mode itself keeps dying) -> UBOOT. On the amber screen, PLAY pressed and held 2 s forgets the
 * failure and restarts (a key that reads as stuck down from the start does nothing).
 *
 * Safe mode does not trust itself. Until a host has completed the update protocol's handshake over USB-MIDI
 * (proof that enumeration, MIDI receive and our reply all work) it counts as unreachable:
 *   - the watchdog is fed only while the millisecond tick advances, so a dead tick interrupt ends in a reset;
 *   - a reset before the handshake counts as a failed start (three -> UBOOT), however long the start lasted;
 *   - DEV_DEADMAN_MS after power-on without a handshake it enters UBOOT by itself, where tools/fm1boot.py and
 *     tools/fm1restore.py reach it over the same cable. A bar along the bottom of the screen shows the time
 *     left; it turns green once a host has been heard.
 *
 * NOT YET RUN ON HARDWARE. */
#include <stdint.h>
#include <stddef.h>
#define FELUCCA_FLASH 1
#define FELUCCA_OTA 1
#define FELUCCA_OTA_DRYRUN 0
#define FELUCCA_CDC 0
#define FELUCCA_UAC 0
#define FELUCCA_USB_LAYOUT 0
#ifndef FELUCCA_ID
#define FELUCCA_ID "FM-1_666"            /* what the update handshake reports: an identity of our own, so an installer
                                          * page can tell this firmware from Felucca (FM-1_9xx) and stock (FM-1_015)
                                          * before it sends anything only this firmware understands */
#endif
/* Where Felucca's RAM flash driver may erase and program in this firmware: the game data's second block and the
 * update staging area, and nothing else (Felucca's own default also allows its settings and autosave sectors). */
#define FL_RANGE_OK(off, n) (FL_IN(off, n, 0x00093000u, 0x000E5000u))
#define RING_PUBLISH() __asm__ volatile("" ::: "memory")
#define BOOTGUARD_MAGIC 0x42475244u

#include "fm1_time.h"
#include "fm1_sys.h"
#include "fm1_irq.h"
#include "fm1_guard.h"
#include "fm1_input.h"
#include "fm1_timer.h"
#include "fm1_audio.h"
#include "fm1_adc.h"
#include "fm1_lcd_hw.h"

static volatile uint32_t fm1_ms;
struct { uint32_t magic, failed, pending; } bootguard __attribute__((section(".noinit")));

#include "libc.c"
#include "lcd.c"
#include "usb.c"                          /* Felucca's, with our own USB names: firmware/gen_usb.py writes build/gen/usb.c */
#include "fm1_flash.h"

#include "fm1.h"                         /* the game's platform interface */

extern uint32_t _data_start[], _data_end[], _data_load[], _bss_start[], _bss_end[], _bigbss_start[], _bigbss_end[];
extern uint32_t _rt_start[], _rt_end[], _rt_load[];
extern uint8_t _heap_start[], _heap_end[];
extern const uint8_t _desc_load[];
extern void (*_init_array_start[])(void), (*_init_array_end[])(void);
int main(void);

enum { MODE_GAME, SAFE_FAILED, SAFE_KEY, SAFE_NODATA, SAFE_PART2 };
static uint8_t dev_mode;
static uint8_t dev_host_seen;            /* a host completed the update handshake during this start */
#define DEV_DEADMAN_MS 180000u           /* safe mode without a handshake: UBOOT after this long */
static uint8_t flash_ok;                 /* the expected 1 MiB part answered (as Felucca's persist_boot) */

/* ------------------------------------------------------------------ flash (as Felucca's storage_hw.c) --- */
static int st_read(uint32_t off, void *dst, uint32_t n)   /* 256-byte IRQ-off windows */
{
    uint8_t *d = dst;
    while (n) {
        uint32_t k = n > 256u ? 256u : n, f = irq_save();
        int rc = FL_FAR(fl_read_ram)(off, d, k);
        irq_restore(f);
        if (rc)
            return rc;
        off += k;
        d += k;
        n -= k;
    }
    return 0;
}

/* ------------------------------------------------------------------ audio out (game mode only) --- */
#define HALF_FRAMES 128u
#define HALF_WORDS (HALF_FRAMES * 2u)
#define OUT_RATE 44118u                  /* the I2S frame rate Felucca measured: 24 MHz / 544 */
#include "dev_volume.h"                  /* the MASTER knob -> gain, as Felucca maps it */
static volatile uint32_t dev_gain_q12;   /* what the audio interrupt multiplies by; written by the game loop only */
static int32_t dev_knob16;               /* the knob x16, smoothed */
#include "fm1_filter.h"                  /* rp2040-doom/src/fm1: the filter KNOB 1 and KNOB 2 play with (fm1_controls.c) */
static fm1_filter_t dev_filter;          /* touched by the audio interrupt only */
static int32_t abuf[2u * HALF_WORDS] __attribute__((aligned(4)));
static int16_t apcm[HALF_WORDS];

/* before the audio starts: the knob as it stands, no glide (as Felucca's master_boot; the first conversion after
 * the pin set-up is dropped). No reading at all: silent until the game loop's polls get one. */
static void dev_volume_boot(void)
{
    uint32_t i;
    (void)fm1_adc_read(FM1_ADC_MASTER);
    for (i = 0; i < 3u; i++) {
        int32_t a = fm1_adc_read(FM1_ADC_MASTER);
        if (a >= 0) {
            dev_knob16 = a * 16;
            dev_gain_q12 = dv_gain((uint32_t)a);
            return;
        }
    }
}
/* once per game tic, from the game loop (a conversion is a bounded wait: fm1_adc_read gives up after 20000 spins) */
static void dev_volume_poll(void)
{
    dev_knob16 = dv_smooth(dev_knob16, fm1_adc_read(FM1_ADC_MASTER));
    dev_gain_q12 = dv_gain((uint32_t)(dev_knob16 / 16));
}

void fm1_alnk0_irq(void)                 /* via isr_alnk0 (hal/fm1_isr.S) */
{
    uint8_t p = fm1_audio_pending();
    fm1_audio_ack_aux(p);
    if (p & FM1_AUDIO_HALF) {
        int32_t *o = &abuf[fm1_audio_free_half() * HALF_WORDS];
        uint32_t i, g = dev_gain_q12;
        fm1_audio_read(apcm, HALF_FRAMES, OUT_RATE);         /* resampled from the game's ring (fm1_audio.c) */
        fm1_filter_run_at(&dev_filter, apcm, HALF_FRAMES,                                  /* off: returns at once */
                          fm1_filter_swing(&dev_filter, HALF_FRAMES, fm1_filter_pos, fm1_filter_wobble), fm1_filter_res);
        for (i = 0; i < HALF_WORDS; i++)
            o[i] = dv_sample(apcm[i], g);
        fm1_audio_ack_half();
    }
}
extern void isr_alnk0(void);

static void audio_silence(void)
{
    uint32_t i;
    for (i = 0; i < 2u * HALF_WORDS; i++)
        abuf[i] = 0;
}

/* ------------------------------------------------------------------ 10 kHz tick (as Felucca's main.c) --- */
static uint32_t tick_last;               /* TIMER4 count at the previous tick; set when the tick is started, so
                                          * fm1_ms counts from our own start even if TIMER4 was left running */
void fm1_timer5_irq(void)
{
    static uint32_t sub, acc;
    uint32_t t0 = fm1_ticks();
    fm1_timer5_ack();
    fm1_input_tick();
    acc += t0 - tick_last;
    tick_last = t0;
    while (acc >= 1000u * FM1_TICKS_PER_US) {
        acc -= 1000u * FM1_TICKS_PER_US;
        fm1_ms++;
    }
    if (sub % 5u == 0u) {
        usb_poll();                      /* 2 kHz: all USB traffic */
        mi_r = mi_w;                     /* MIDI notes / clock from the host: dropped. Felucca's audio interrupt
                                          * empties this ring; if nobody did, usb.c would stop accepting EP1 OUT
                                          * packets once it filled, and the update SysEx with them */
        midi_in_overflow = 0;
    }
    if (++sub == 10u)
        sub = 0;
}
extern void isr_timer5(void);

/* ------------------------------------------------------------------ update entry hooks (as ota_hw.c) --- */
static void dev_feed(void)               /* only a running tick interrupt keeps the watchdog quiet */
{
    static uint32_t fed_ms;
    if (fm1_ms != fed_ms) {
        fed_ms = fm1_ms;
        fm1_wdt_feed();
    }
}
static uint32_t ota_now_ms(void) { return fm1_ms; }
static void ota_idle(void) { dev_feed(); }
#define DEV_OTA_AREA 0x000E0000u
#define DEV_OTA_LEN 0x5000u
static int ota_in_area(uint32_t off, uint32_t n) { return FL_IN(off, n, DEV_OTA_AREA, DEV_OTA_AREA + DEV_OTA_LEN); }
static int ota_erase(uint32_t off)
{
    uint32_t took;
    if (!flash_ok || !ota_in_area(off, 0x1000u) || (off & 0xFFFu))
        return -8;
    audio_silence();
    return fl_erase4k(off, &took);
}
static int ota_prog(uint32_t off, const void *p, uint32_t n)
{
    if (!flash_ok || !ota_in_area(off, n))
        return -8;
    return fl_write(off, p, n);
}
static int ota_fread(uint32_t off, void *p, uint32_t n) { return flash_ok ? st_read(off, p, n) : -8; }
/* The screen link's clock is lsb / (n + 1); Felucca runs it at n = 4 ("12 MHz", so lsb is taken to be 60 MHz).
 * The game's picture goes out at n = 0 ("60 MHz"): clean and smooth on Sean's unit 2026-10-09, and the link is
 * what limits the frame rate. Every screen this file draws itself goes out at Felucca's proven rate. */
#define DEV_LCD_GAME 0u
static uint8_t dev_lcd_fast;             /* the game's rate is set now */
static void dev_lcd_rate(uint32_t fast)
{
    lcd_sync();                          /* no transfer in flight while the clock changes */
    dev_lcd_fast = (uint8_t)fast;
    fm1_lcd_baud(fast ? DEV_LCD_GAME : LCD_BAUD);
}
static void dev_screen(uint16_t c)
{
    if (dev_lcd_fast)
        dev_lcd_rate(0);
    lcd_fill(0, 0, 240, 240, c);
}
static void dev_mode_screen(void);
static void ota_show(uint32_t step, int32_t code)   /* no font in this build: a white bar per step on blue, red = failed */
{
    if (step < 9u) {
        dev_screen(0x0010);
        lcd_fill(20, 110, 40u * (step < 6u ? step : 5u), 20, 0xFFFF);
        return;
    }
    dev_screen(code == 1 ? 0x07E0 : 0xF800);
    fm1_delay_ms(1500);
}
static void ota_commit(const uint8_t *parm)
{
    bootguard.pending = 0;               /* intentional reset, and the next firmware starts with a clean record */
    bootguard.failed = 0;
    usb_detach();
    fm1_delay_ms(30);
    fm1_enter_update(parm);
}
#include "ota.c"

/* ------------------------------------------------------------------ crash: red screen, then reset --- */
static void fm1_fault(const fm1_crash_t *c)
{
    uint32_t t0;
    (void)c;                             /* the record stays in .noinit for a debugger / the next boot */
    fm1_audio_stop();
    dev_screen(0xF800);
    t0 = fm1_ticks();
    while ((uint32_t)(fm1_ticks() - t0) < 3000u * 1000u * FM1_TICKS_PER_US)
        ;
    fm1_reboot();
}

void fm1_dev_panic(void)                 /* the game's panic() / I_Error (fm1_sdk.c) */
{
    fm1_irq_off();
    fm1_audio_stop();
    dev_screen(0xF81F);                  /* magenta: the game stopped itself (red: a CPU fault) */
    fm1_delay_ms(3000);
    fm1_reboot();
}

/* ------------------------------------------------------------------ housekeeping --- */
static const uint8_t DEV_BTN[14] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1};   /* label -> matrix id (panel.c PANEL_DEFAULT) */
static const uint8_t DEV_ENC[FM1_NKNOB] = {0, 1, 6, 2, 3, 4, 5};                    /* role -> matrix encoder */

static void dev_enter_uboot(void)
{
    if (dev_mode == MODE_GAME)
        fm1_audio_stop();
    dev_screen(0x0010);
    usb_detach();
    fm1_delay_ms(30);
    bootguard.pending = 0;
    fm1_enter_uboot();
}

static void dev_data_request(uint32_t len, uint32_t crc, uint32_t flags);

/* watchdog, boot guard, the UBOOT key chord, the update protocol. Game mode: once per game tic; safe mode: its loop */
static void dev_service(void)
{
    static uint32_t both_t0;
    uint32_t both = (1u << DEV_BTN[FM1_BTN_OCTDN]) | (1u << DEV_BTN[FM1_BTN_OCTUP]);
    dev_feed();
    usb_retry(fm1_ms);
    if (dev_mode == MODE_GAME) {
        if (fm1_ms > 30000u && bootguard.pending) {
            bootguard.pending = 0;       /* this start survived its first 30 s (as Felucca) */
            bootguard.failed = 0;
        }
        dev_volume_poll();               /* game mode only: safe mode makes no sound and reads no knob */
    } else if (dev_host_seen)
        bootguard.pending = 0;           /* safe mode: reachable only once a host was heard; the failure count is
                                          * kept, so it stays in safe mode across resets */
    if ((fm1_in.buttons & both) != both)
        both_t0 = fm1_ms;
    else if (fm1_ms - both_t0 > 5000u)
        dev_enter_uboot();               /* OCT- + OCT+ held 5 s */
    {                                    /* update handshake (ota.c ota_service, plus the note that a host is there) */
        uint32_t d = ota_take();
        if (d == 7u && ota_dec[2] == 0x11) {
            ota_reply_identity();
            dev_host_seen = 1;
        } else if (d == 19u && ota_dec[2] == 0x44) {         /* "here is your second data block": length, CRC, flags */
            dev_host_seen = 1;
            dev_data_request(ota_rd32(ota_dec + 6), ota_rd32(ota_dec + 10), ota_rd32(ota_dec + 14));
        }
    }
    if (usb.ota_req) {                   /* the host starts an update */
        usb.ota_req = 0;
        dev_host_seen = 1;
        audio_silence();
        ota_session();                   /* returns only if nothing was committed */
        if (dev_mode == MODE_GAME)
            dev_screen(0);
        else
            dev_mode_screen();
    }
    if (usb.uboot_req)
        dev_enter_uboot();
}

/* ------------------------------------------------------------------ game data: where it is and whether it is whole --- */
/* firmware/pack.py writes this 64-byte descriptor right after the image; block 1 of the data follows it (inside
 * the app slot), block 2 is at flash offset off2 (0x93000 up, readable as plain XIP once the flash is probed) */
typedef struct {
    uint8_t magic[4];                    /* "FM1D" */
    uint32_t ver, total, split, crc1, off2, crc2, rsv[8], dcrc;
} dev_desc_t;
_Static_assert(sizeof(dev_desc_t) == 64, "descriptor layout");
#define DEV_DESC ((const dev_desc_t *)(const void *)_desc_load)

static uint32_t dev_crc(const uint8_t *p, uint32_t n)       /* CRC16 in 4 KiB steps, the watchdog fed */
{
    uint32_t c = 0;
    while (n) {
        uint32_t k = n > 4096u ? 4096u : n;
        c = ota_crc16(p, k, c);
        fm1_wdt_feed();
        p += k;
        n -= k;
    }
    return c;
}

static int dev_desc_ok(void)
{
    const dev_desc_t *d = DEV_DESC;
    return d->magic[0] == 'F' && d->magic[1] == 'M' && d->magic[2] == '1' && d->magic[3] == 'D' && d->ver == 1u &&
           ota_crc16((const uint8_t *)d, 60, 0) == d->dcrc && d->split <= d->total && d->total <= 0x100000u;
}

static uint8_t dev_data_check(void)      /* MODE_GAME if everything the game will read is there and intact */
{
    const dev_desc_t *d = DEV_DESC;
    const uint8_t *b1 = _desc_load + sizeof(dev_desc_t);
    if (!dev_desc_ok())
        return SAFE_NODATA;
    if (b1[0] != 'I' || b1[1] != 'W' || b1[2] != 'H' || b1[3] != 'X' || dev_crc(b1, d->split) != d->crc1)
        return SAFE_NODATA;
    if (d->split < d->total) {           /* a second block, above the app area */
        if (!flash_ok || d->off2 < 0x93000u || d->off2 + (d->total - d->split) > 0xE0000u)
            return SAFE_PART2;
        if (dev_crc(fm1_xip_ptr(d->off2), d->total - d->split) != d->crc2)
            return SAFE_PART2;
    }
    return MODE_GAME;
}

static void dev_mode_screen(void)
{
    switch (dev_mode) {
    case SAFE_FAILED: dev_screen(0xFD20); break;                                     /* amber: the last start failed */
    case SAFE_KEY: dev_screen(0x07FF); break;                                        /* cyan: HOME was held */
    case SAFE_PART2: dev_screen(0x0010); lcd_fill(0, 0, 24, 24, 0xFFFF); lcd_fill(216, 0, 24, 24, 0xFFFF); break;
    default: dev_screen(0x0010); lcd_fill(0, 0, 24, 24, 0xFFFF); break;              /* blue: no game data */
    }
}

/* ------------------------------------------------------------------ the second data block over USB (safe mode) --- */
/* An installer page that has just put this firmware on (with block 1 behind it) sends cmd 0x44 with the length and
 * CRC of the block 2 it holds. We answer cmd 0x44: code 0 = send it (we then ask for it piece by piece with the
 * update protocol's own read requests, addresses = offsets in the block, and finish with the protocol's "success"
 * exchange at 0xF0000000), 1 = nothing to do (the game is running), 2 = that is not this firmware's data,
 * 3 = the flash is not the expected part; then mode, flash flag and the descriptor's total / split / CRC / build.
 * Flags: bit 0 = rewrite sectors even if they already match (a test of the write path), bit 1 = only say what
 * the answer would be, start nothing. Only in safe mode; the writing itself is firmware/dev_data.h. A good write
 * restarts into the game, where the start-up check has the last word. */
static int dd_pull(uint32_t off, uint8_t *dst, uint32_t n) { return ota_read(off, dst, n); }
static int dd_finish(void)
{
    uint8_t b[8];
    uint32_t i;
    for (i = 0; i < 4u; i++)
        if (!ota_read(0xF0000000u, b, 8) && ota_memeq(b, (const uint8_t *)"success", 8))
            return 0;
    return -1;
}
static int dd_fread(uint32_t off, uint8_t *dst, uint32_t n) { return st_read(off, dst, n); }
static int dd_erase(uint32_t off) { uint32_t took; return fl_erase4k(off, &took); }
static int dd_prog(uint32_t off, const uint8_t *src, uint32_t n) { return fl_write(off, src, n); }
static void dd_progress(uint32_t done, uint32_t total) { lcd_fill(20, 110, 1u + done / (total / 199u + 1u), 20, 0xFFFF); }
static void dd_feed(void) { dev_feed(); }
#include "dev_data.h"

static void dev_data_reply(uint32_t code)
{
    uint8_t r[20];
    const dev_desc_t *d = DEV_DESC;
    int ok = dev_desc_ok();
    r[0] = (uint8_t)code;
    r[1] = dev_mode;
    r[2] = flash_ok;
    r[3] = 0;
    ota_wr32(r + 4, ok ? d->total : 0u);
    ota_wr32(r + 8, ok ? d->split : 0u);
    ota_wr32(r + 12, ok ? d->crc2 : 0u);
    ota_wr32(r + 16, ok ? d->rsv[0] : 0u);              /* which firmware image this is (firmware/pack.py) */
    ota_send_msg(0x44, r, sizeof r);
}

static void dev_data_request(uint32_t len, uint32_t crc, uint32_t flags)
{
    const dev_desc_t *d = DEV_DESC;
    uint32_t written;
    int rc;
    if (dev_mode == MODE_GAME) {
        dev_data_reply(1);
        return;
    }
    if (!flash_ok) {
        dev_data_reply(3);
        return;
    }
    if (!dev_desc_ok() || d->off2 != DD_LO || d->split >= d->total || len != d->total - d->split || crc != d->crc2) {
        dev_data_reply(2);
        return;
    }
    dev_data_reply(0);
    if (flags & 2u)
        return;                          /* a question only */
    dev_screen(0x0010);
    ota_deadline = ota_now_ms() + 600000u;
    /* the game's heap is free in safe mode: two sector buffers from its start */
    rc = dd_write(DD_LO, len, (int)(flags & 1u), _heap_start, _heap_start + DD_SECTOR, &written);
    ota_deadline = 0;
    if (rc == DD_OK) {
        dev_screen(0x07E0);
        fm1_delay_ms(600);
        bootguard.pending = 0;
        bootguard.failed = 0;
        usb_detach();
        fm1_delay_ms(30);
        fm1_reboot();
    }
    dev_screen(0xF800);
    fm1_delay_ms(1500);
    dev_mode_screen();
}

/* ------------------------------------------------------------------ the game's platform interface --- */
void fm1_lcd_blit(unsigned x, unsigned y, unsigned w, unsigned h, const uint16_t *px)
{
    if (!dev_lcd_fast)
        dev_lcd_rate(1);                 /* (one of this file's own screens was drawn since: back to the game's rate) */
    lcd_blit(x, y, w, h, px);            /* waits for the previous strip's DMA, starts this one and returns: the game
                                          * composes the next strip (in its other buffer) while this one goes out */
}
uint32_t fm1_millis(void) { return fm1_ms; }
void fm1_alive(void)                     /* the game's loops are turning: feed the watchdog (at most once a ms) */
{
    static uint32_t last;
    if (fm1_ms != last) {
        last = fm1_ms;
        fm1_wdt_feed();
    }
}
void fm1_poll_panel(uint32_t *notes, uint32_t *buttons, int8_t enc[FM1_NKNOB])
{
    uint32_t i, b = 0;
    dev_service();
    for (i = 0; i < 14u; i++)
        if (fm1_in.buttons & (1u << DEV_BTN[i]))
            b |= 1u << i;
    *notes = fm1_in.notes;
    *buttons = b;
    for (i = 0; i < FM1_NKNOB; i++)
        enc[i] = (int8_t)fm1_enc_take(DEV_ENC[i]);
}
const uint8_t *fm1_whd_base(void) { return _desc_load + sizeof(dev_desc_t); }
const uint8_t *fm1_whd_part2(uint32_t *split)
{
    if (DEV_DESC->split >= DEV_DESC->total)
        return NULL;
    *split = DEV_DESC->split;
    return fm1_xip_ptr(DEV_DESC->off2);
}
uint8_t *fm1_heap(uint32_t *size)
{
    *size = (uint32_t)(_heap_end - _heap_start);
    return _heap_start;
}

/* ------------------------------------------------------------------ boot (as Felucca's fm1_cstart / fm1_main) --- */
void fm1_cstart(void)
{
    uint32_t *s, *d, p3, src, wdt, i;
    void (**f)(void);
    fm1_time_init();
    fm1_reset_reason();
    p3 = fm1_boot.p3_rst;
    src = fm1_boot.rst_src;
    wdt = fm1_boot.wdt_con;
    fm1_wdt_arm(0x0D);                   /* ~8 s */
    if (bootguard.magic != BOOTGUARD_MAGIC) {
        bootguard.magic = BOOTGUARD_MAGIC;
        bootguard.failed = 0;
        bootguard.pending = 0;
    }
    if (bootguard.pending)
        bootguard.failed++;              /* the last start never reached 30 s */
    bootguard.pending = 1;
    if (bootguard.failed >= 3u) {        /* the game failed, then safe mode failed twice: the mask ROM's turn */
        bootguard.failed = 0;
        bootguard.pending = 0;
        fm1_enter_uboot();
    }
    fm1_irq_init();
    for (d = _bigbss_start; d < _bigbss_end; d++)
        *d = 0;
    for (d = _bss_start; d < _bss_end; d++)
        *d = 0;
    for (s = _data_load, d = _data_start; d < _data_end; s++, d++)
        *d = *s;
    for (s = _rt_load, d = _rt_start; d < _rt_end; s++, d++)
        *d = *s;                         /* flash driver code that must run from RAM */
    fm1_mailbox_clear();
    fm1_guard_enable(FM1_GUARD_STACK | FM1_GUARD_WRITE | FM1_GUARD_BUS | FM1_GUARD_PC);
    fm1_boot.p3_rst = (uint8_t)p3;
    fm1_boot.rst_src = src;
    fm1_boot.wdt_con = (uint8_t)wdt;

    {   /* the flash, as Felucca's persist_boot: only the expected part is ever used */
        uint32_t k = irq_save();
        flash_ok = FL_FAR(fl_jedec_ram)() == 0x856014u;
        irq_restore(k);
        if (flash_ok) {
            fl_plain_window_init();      /* flash from 0x93000 up reads unencrypted */
            ota_boot_cleanup();          /* a staging area left by an update */
        }
    }
    lcd_init();
    fm1_input_init();
    fm1_adc_init();
    for (i = 0; i < 12u; i++)            /* the keys as they are now, before anything else runs (a press: 2 frames) */
        fm1_input_scan();

    dev_mode = MODE_GAME;
    if (bootguard.failed)
        dev_mode = SAFE_FAILED;
    else if (fm1_in.buttons & (1u << DEV_BTN[FM1_BTN_HOME]))
        dev_mode = SAFE_KEY;
    else
        dev_mode = dev_data_check();

    if (dev_mode == MODE_GAME) {         /* the audio interrupt has to be attached before the vectors are locked */
        fm1_wdt_arm(0x0F);               /* ~32 s: a level load must not look like a hang */
        audio_silence();
        dev_volume_boot();               /* the first sound plays at the knob's level */
        fm1_audio_init(abuf, HALF_WORDS, isr_alnk0, 3);
    }
    usb_start();
    tick_last = fm1_ticks();
    fm1_timer5_start(isr_timer5, 4);
    fm1_guard_lock_top();
    fm1_irq_enable_all();

    if (dev_mode != MODE_GAME) {         /* SAFE MODE: updatable, nothing else */
        uint32_t t_safe = fm1_ms, play_t0 = 0, play_armed = 0, bar_s = 0xFFFFFFFFu;
        dev_mode_screen();
        for (;;) {
            uint32_t now = fm1_ms - t_safe;      /* ms in safe mode */
            dev_service();
            if (!dev_host_seen && now > DEV_DEADMAN_MS)
                dev_enter_uboot();       /* nobody reached us over USB: the mask ROM can be reached */
            if (now / 1000u != bar_s) {  /* once a second: time left (white), or green = a host was heard */
                uint32_t w = dev_host_seen || now >= DEV_DEADMAN_MS ? 0u : 240u - now / (DEV_DEADMAN_MS / 240u);
                bar_s = now / 1000u;
                if (w > 240u)
                    w = 240u;
                if (dev_host_seen)
                    lcd_fill(0, 232, 240, 8, 0x07E0);
                else {
                    if (w)
                        lcd_fill(0, 232, w, 8, 0xFFFF);
                    if (w < 240u)
                        lcd_fill(w, 232, 240u - w, 8, 0x0000);
                }
            }
            if (!(fm1_in.buttons & (1u << DEV_BTN[FM1_BTN_PLAY]))) {
                play_t0 = now;
                play_armed = 1;                  /* seen released: a key stuck down can never do the restart below */
            } else if (dev_mode == SAFE_FAILED && play_armed && now - play_t0 > 2000u) {
                /* PLAY pressed and held 2 s after a failed start: forget the failure, start again */
                bootguard.failed = 0;
                bootguard.pending = 0;
                usb_detach();
                fm1_delay_ms(30);
                fm1_reboot();
            }
            fm1_delay_ms(5);
        }
    }
    for (f = _init_array_start; f < _init_array_end; f++)
        (*f)();                          /* C++ static constructors, if any */
    main();                              /* rp2040-doom/src/fm1/fm1_platform.c: never returns */
    fm1_dev_panic();
}
