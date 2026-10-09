/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom memory map (after Felucca's firmware/app.ld).
 * Code and constants execute in place from flash (XIP). RAM 0x01C00000..0x01C80000:
 *   0x01C00000  4 KB    .ram_text: the flash driver, which must run while XIP is off (2.9 KB)
 *   0x01C01000  24 KB   main stack above a 256-byte guard band
 *   0x01C07000  4 KB    left alone: Felucca's crt0.S (used unchanged) stores the state the boot loader handed
 *                       over at 0x01C07F00, in what Felucca keeps as its RAM-run debug area
 *   0x01C08000  8 KB    supervisor stack above a 256-byte guard band
 *   0x01C0A000  200 KB  .bigbss: buffers the game never "short-points" at (frame buffers, renderer work areas,
 *                       audio and USB buffers)
 *   0x01C3C000  256 KB  the short-pointer window: .data, the rest of .bss, then the game heap up to 0x01C7C000.
 *                       The engine's 16-bit pointers reach exactly this window (FM1_SHORTPTR_BASE = 0x01C3C000 in
 *                       firmware/build_in.sh; nothing is placed in its first 4 bytes: short pointer 0 is NULL).
 *   0x01C7C000  .noinit (survives resets), then boot info, mailbox and vectors from 0x01C7FD50
 * In flash the image is followed (64-byte aligned) by a 64-byte data descriptor and the first block of the game
 * data, all inside Felucca's standard app slot: _desc_load (firmware/pack.py, doom_dev.c). */
MEMORY
{
    XIP     (rx)  : ORIGIN = 0x02000120, LENGTH = 0xF7EE0
    RAMTEXT (rwx) : ORIGIN = 0x01C00000, LENGTH = 0x1000
    BIG     (rw)  : ORIGIN = 0x01C0A000, LENGTH = 0x32000
    WIN     (rwx) : ORIGIN = 0x01C3C004, LENGTH = 0x3FFFC   /* (not the first 4 bytes: short pointer 0 is NULL) */
    NOINIT  (rw)  : ORIGIN = 0x01C7C000, LENGTH = 0x3D50
}
SECTIONS
{
    .text : {
        KEEP(*(.text.crt0)) *(.text*) *(.rodata*)
        . = ALIGN(4); _init_array_start = .; KEEP(*(.init_array*)) KEEP(*(.ctors*)) _init_array_end = .;
        . = ALIGN(4); _etext = .;
    } > XIP
    .ram_text : { _rt_start = .; KEEP(*(.ram_text*)) . = ALIGN(4); _rt_end = .; } > RAMTEXT AT > XIP
    _rt_load = LOADADDR(.ram_text);
    .bigbss (NOLOAD) : {
        _bigbss_start = .;
        *fm1_video*.o(.bss* COMMON) *pd_render*.o(.bss* COMMON) *doom_dev*.o(.bss* COMMON) *fm1_audio*.o(.bss* COMMON)
        . = ALIGN(4); _bigbss_end = .;
    } > BIG
    .data : { . = ALIGN(4); _data_start = .; *(.data*) *(.sdata*) . = ALIGN(4); _data_end = .; } > WIN AT > XIP
    _data_load = LOADADDR(.data);
    .bss (NOLOAD) : { _bss_start = .; *(.bss*) *(.sbss*) *(COMMON) . = ALIGN(4); _bss_end = .; } > WIN
    _heap_start = _bss_end;
    _heap_end = 0x01C7C000;
    .noinit (NOLOAD) : { *(.noinit*) } > NOINIT
    _guard0 = 0x01C01000; _ustack_lo = 0x01C01100; _ustack_top = 0x01C07000;
    _guard1 = 0x01C08000; _sstack_lo = 0x01C08100; _sstack_top = 0x01C0A000;
    _image_end = _data_load + SIZEOF(.data);
    _desc_load = (_image_end + 63) / 64 * 64;
    /DISCARD/ : { *(.comment) *(.note*) *(.binary_info*) }
}
