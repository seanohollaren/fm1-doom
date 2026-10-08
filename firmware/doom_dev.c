/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: the device side. One compilation unit on Felucca's header-only HAL and its lcd / usb / ota sources
 * (Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments, GPL-3.0-only), put together the way
 * Felucca's own firmware/src/main.c and firmware/loader/loader.c are. It provides what the game's platform layer
 * asks for (rp2040-doom/src/fm1/fm1.h) and keeps every safety net Felucca has:
 *   - the watchdog is armed first thing and fed from the game loop;
 *   - two boots in a row that die in their first 30 s -> mask-ROM UBOOT;
 *   - OCT- + OCT+ held 5 s -> UBOOT;  USB SysEx F0 22 24 35 7D F7 -> UBOOT;
 *   - the USB-MIDI update entry (the web installer / fm1_install.py) works while the game runs, and also
 *     when there is no game data at all.
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
#define FELUCCA_ID "FM-1_900"            /* package identity: the same as a Felucca development build */
#endif
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
#include "usb.c"
#include "fm1_flash.h"

#include "fm1.h"                         /* the game's platform interface */

extern uint32_t _data_start[], _data_end[], _data_load[], _bss_start[], _bss_end[], _bigbss_start[], _bigbss_end[];
extern uint32_t _rt_start[], _rt_end[], _rt_load[];
extern uint8_t _heap_start[], _heap_end[], _whd_load[];
extern void (*_init_array_start[])(void), (*_init_array_end[])(void);
int main(void);

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

/* ------------------------------------------------------------------ audio out --- */
#define HALF_FRAMES 128u
#define HALF_WORDS (HALF_FRAMES * 2u)
#define OUT_RATE 44118u                  /* the I2S frame rate Felucca measured: 24 MHz / 544 */
#define OUT_SHIFT 7                      /* 16-bit -> the codec's 24-bit words, -6 dBFS ceiling (as Felucca) */
static int32_t abuf[2u * HALF_WORDS] __attribute__((aligned(4)));
static int16_t apcm[HALF_WORDS];
static volatile uint32_t audio_halves;

void fm1_alnk0_irq(void)                 /* via isr_alnk0 (hal/fm1_isr.S) */
{
    uint8_t p = fm1_audio_pending();
    fm1_audio_ack_aux(p);
    if (p & FM1_AUDIO_HALF) {
        int32_t *o = &abuf[fm1_audio_free_half() * HALF_WORDS];
        uint32_t i;
        fm1_audio_read(apcm, HALF_FRAMES, OUT_RATE);         /* resampled from the game's ring (fm1_audio.c) */
        for (i = 0; i < HALF_WORDS; i++)
            o[i] = (int32_t)apcm[i] * (1 << OUT_SHIFT);
        fm1_audio_ack_half();
        audio_halves++;
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
void fm1_timer5_irq(void)
{
    static uint32_t sub, last, acc;
    uint32_t t0 = fm1_ticks();
    fm1_timer5_ack();
    fm1_input_tick();
    acc += t0 - last;
    last = t0;
    while (acc >= 1000u * FM1_TICKS_PER_US) {
        acc -= 1000u * FM1_TICKS_PER_US;
        fm1_ms++;
    }
    if (sub % 5u == 0u)
        usb_poll();                      /* 2 kHz: all USB traffic */
    if (++sub == 10u)
        sub = 0;
}
extern void isr_timer5(void);

/* ------------------------------------------------------------------ update entry hooks (as ota_hw.c) --- */
static uint32_t ota_now_ms(void) { return fm1_ms; }
static void ota_idle(void) { fm1_wdt_feed(); }
#define DEV_OTA_AREA 0x000E0000u
#define DEV_OTA_LEN 0x5000u
static int ota_in_area(uint32_t off, uint32_t n) { return FL_IN(off, n, DEV_OTA_AREA, DEV_OTA_AREA + DEV_OTA_LEN); }
static int ota_erase(uint32_t off)
{
    uint32_t took;
    if (!ota_in_area(off, 0x1000u) || (off & 0xFFFu))
        return -8;
    audio_silence();
    return fl_erase4k(off, &took);
}
static int ota_prog(uint32_t off, const void *p, uint32_t n)
{
    if (!ota_in_area(off, n))
        return -8;
    return fl_write(off, p, n);
}
static int ota_fread(uint32_t off, void *p, uint32_t n) { return st_read(off, p, n); }
static void dev_screen(uint16_t c) { lcd_fill(0, 0, 240, 240, c); }
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
    bootguard.pending = 0;               /* intentional reset */
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

/* ------------------------------------------------------------------ housekeeping, once per game tic --- */
static const uint8_t DEV_BTN[14] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1};   /* label -> matrix id (panel.c PANEL_DEFAULT) */
static const uint8_t DEV_ENC[FM1_NKNOB] = {0, 1, 6, 2, 3, 4, 5};                     /* role -> matrix encoder */

static void dev_enter_uboot(void)
{
    fm1_audio_stop();
    dev_screen(0x0010);
    usb_detach();
    fm1_delay_ms(30);
    bootguard.pending = 0;
    fm1_enter_uboot();
}

static void dev_service(void)
{
    static uint32_t both_t0;
    uint32_t both = (1u << DEV_BTN[FM1_BTN_OCTDN]) | (1u << DEV_BTN[FM1_BTN_OCTUP]);
    fm1_wdt_feed();
    usb_retry(fm1_ms);
    if (fm1_ms > 30000u && bootguard.pending) {
        bootguard.pending = 0;
        bootguard.failed = 0;
    }
    if ((fm1_in.buttons & both) != both)
        both_t0 = fm1_ms;
    else if (fm1_ms - both_t0 > 5000u)
        dev_enter_uboot();               /* OCT- + OCT+ held 5 s */
    ota_service();                       /* update handshake */
    if (usb.ota_req) {                   /* the host starts an update */
        usb.ota_req = 0;
        audio_silence();
        ota_session();                   /* returns only if nothing was committed */
        dev_screen(0);
    }
    if (usb.uboot_req)
        dev_enter_uboot();
}

/* ------------------------------------------------------------------ the game's platform interface --- */
void fm1_lcd_blit(unsigned x, unsigned y, unsigned w, unsigned h, const uint16_t *px)
{
    lcd_blit(x, y, w, h, px);            /* waits for the previous strip's DMA, starts this one and returns: the game
                                          * composes the next strip (in its other buffer) while this one goes out */
}
uint32_t fm1_millis(void) { return fm1_ms; }
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
const uint8_t *fm1_whd_base(void) { return (const uint8_t *)_whd_load; }
uint8_t *fm1_heap(uint32_t *size)
{
    *size = (uint32_t)(_heap_end - _heap_start);
    return _heap_start;
}

/* ------------------------------------------------------------------ boot (as Felucca's fm1_cstart / fm1_main) --- */
static int dev_have_data(void)
{
    const uint8_t *w = fm1_whd_base();
    return w[0] == 'I' && w[1] == 'W' && w[2] == 'H' && w[3] == 'X';
}

void fm1_cstart(void)
{
    uint32_t *s, *d, p3, src, wdt;
    void (**f)(void);
    fm1_time_init();
    fm1_reset_reason();
    p3 = fm1_boot.p3_rst;
    src = fm1_boot.rst_src;
    wdt = fm1_boot.wdt_con;
    fm1_wdt_arm(0x0D);
    if (bootguard.magic != BOOTGUARD_MAGIC) {
        bootguard.magic = BOOTGUARD_MAGIC;
        bootguard.failed = 0;
        bootguard.pending = 0;
    }
    if (bootguard.pending)
        bootguard.failed++;
    bootguard.pending = 1;
    if (bootguard.failed >= 2u) {
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

    fl_plain_window_init();              /* flash from 0x93000 up reads unencrypted (game data lives there) */
    ota_boot_cleanup();                  /* a staging area left by an update */
    lcd_init();
    fm1_input_init();
    fm1_adc_init();
    audio_silence();
    fm1_audio_init(abuf, HALF_WORDS, isr_alnk0, 3);
    usb_start();
    fm1_timer5_start(isr_timer5, 4);
    fm1_guard_lock_top();
    fm1_irq_enable_all();

    if (!dev_have_data()) {              /* nothing to play: stay updatable (blue screen, white corner) */
        dev_screen(0x0010);
        lcd_fill(0, 0, 24, 24, 0xFFFF);
        for (;;) {
            dev_service();
            fm1_delay_ms(5);
        }
    }
    for (f = _init_array_start; f < _init_array_end; f++)
        (*f)();                          /* C++ static constructors, if any */
    main();                              /* rp2040-doom/src/fm1/fm1_platform.c: never returns */
    fm1_dev_panic();
}
