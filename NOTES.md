# FM-1 Doom — running notes

Tags: **VERIFIED** = seen in code, build output or a repo's docs on this machine. **ASSUMED** = inferred or
from memory, not yet confirmed. Nothing here was measured on my FM-1; "verified on hardware" claims are the
upstream authors', and are tagged VERIFIED (upstream).

Phase 0 ran 2026-10-07. The FM-1 was never connected, flashed or written.

## Phase 0 verdict (short)

**NO-GO for the plan as written** (doomgeneric + shareware `doom1.wad` in flash). Two hard limits:

1. **Flash is 1 MiB in total.** The shareware WAD is ~4.2 MB; even rp2040-doom's most compressed form of it
   (`doom1.whx`) is 1.80 MB. Neither fits, before any code.
2. **RAM is 512 KB, no external RAM in use.** Stock doomgeneric wants a multi-megabyte zone heap.

RAM alone is solvable (rp2040-doom runs in 264 KB). Flash is the blocker. Options are in "Go / no-go" below.

## Environment (this Mac)

- VERIFIED: macOS Darwin 24.6.0, arm64 (Apple silicon). Docker Desktop 29.8.2 running; the `docker` CLI is at
  `~/.docker/bin/docker` and is **not on the default PATH** of non-login shells (prepend it).
- VERIFIED: Felucca cloned at `./Felucca`, commit `276f72a` ("Felucca 1.1.5"). It is bare-metal: its own
  `crt0.S`, linker script and HAL. It links **no** SDK code; the SDK only supplies three files for the package
  (`uboot.boot`, `cfg_tool.bin`, `cfg/eq_cfg_hw.bin`).
- Installed in Phase 0:
  - `pip3 install Pillow fonttools` → fontTools 4.60.2 (Pillow 11.3.0 was already present), system Python 3.9.6
  - JieLi toolchain via `tools/get_toolchain.sh` → `~/.jieli/toolchain` (`jieli-linux-toolchains-20250324.1`, 135 MB)
  - AC79 SDK tag `AC79NN_SDK_V1.2.1_2023-12-13` → `~/fw-AC79_AIoT_SDK` (1.0 GB)
  - `brew install fribidi` (1.0.17) — not in BUILDING.md, see next point
  - Docker image `debian:bookworm-slim` (pulled by the build)
  - Reference clones: `./FM-1-transporter`, `./doomgeneric`, `./rp2040-doom` (shallow)
- Not installed: Emscripten (`emcc`) — needed for the browser emulator in Phase 2. Node 22 is present.

### Build gotcha on this Mac (VERIFIED)

`./build.sh` fails in `gen_aa_font.py` with `KeyError: ... not supported without libraqm`. Cause: Pillow's
wheel needs FriBiDi at runtime for Raqm text layout; macOS has none, and after `brew install fribidi` the
library is in `/opt/homebrew/lib`, which Apple's Python does not search. `DYLD_FALLBACK_LIBRARY_PATH` fixes
that, but macOS strips `DYLD_*` variables when passing through `/bin/sh` and `/usr/bin/python3`, so
`build.sh` (a `/bin/sh` script) cannot carry it. Working command, equivalent to `build.sh`:

```bash
export PATH="$HOME/.docker/bin:$PATH"
cd Felucca && JIELI_TOOLCHAIN=$HOME/.jieli/toolchain AC79_SDK=$HOME/fw-AC79_AIoT_SDK \
  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
  /Library/Developer/CommandLineTools/usr/bin/python3 tools/build.py
```

No Felucca source was modified (`git status` clean).

### Build and test results (VERIFIED)

- Build OK: `felucca.bin` 447,568 B, `loader/ota.bin` 6,930 B, `felucca.fwsc` 610,086 B, identity `FM-1_900`
  (sha256 `ece5dc7a…d63e`). Build self-checks passed (`.ram_text` has no calls, register access only in `hal/`).
- `tests/run_tests.sh`: 76 suites ran. All passed **except** `text spacing`, which failed for the same Raqm
  reason (the script runs `python3` through `sh`). Re-run on its own with the library path set, it passes.
  The script therefore printed `HOST TESTS FAILED` / exit 1; I count that as an environment failure, not a
  Felucca failure. Browser-emulator tests were skipped (no `emcc`).

## Hardware answers

### SoC and CPU

- VERIFIED: JieLi AC791N (WL82), pi32v2 architecture. Package chip id `AC791N`; ROM UBOOT reports vendor `WL82`.
- ASSUMED: exact package/variant unknown. Nothing in Felucca or Transporter names it.
- ASSUMED: **CPU clock unknown.** Felucca never touches the PLL or system clock; it runs at whatever the SPL
  sets from the `isd_config` in the device's own flash head. The SDK's default is `SYS_CLK=320MHz`, but that
  is the SDK's default, not the FM-1's. One hint: `lcd.c` says SPI1 `lsb/(BAUD+1)`, `4 = 12 MHz`, so the
  low-speed bus is 60 MHz (VERIFIED as a comment only). Measure in Phase 2 with a timed loop against TIMER4.
- ASSUMED: FPU present per public specs. Felucca's DSP is all fixed point and it builds with plain `-Os`.
- VERIFIED: Felucca uses one core only (no second-core bring-up anywhere).

### RAM

- VERIFIED: internal SRAM is `0x01C00000–0x01C80000` = **512 KB**. The SDK's linker script agrees
  (`ram0` ends at `0x1C7FE00`). The "~578 KB" in the brief is not what is addressable here.
- Felucca's map (`firmware/app.ld`):

  | Range | Size | Use |
  | --- | --- | --- |
  | `0x01C00000–0x01C06000` | 24 KB | `.ram_text`: flash driver code that must run while XIP is off (2.9 KB used) |
  | `0x01C06000–0x01C08000` | 8 KB | reserved for RAM-run debug |
  | `0x01C08000–0x01C20000` | 96 KB | `.data` + `.bss` (91,220 B used) |
  | `0x01C20000–0x01C74000` | 336 KB | `.pool`: big zeroed buffers (331,204 B used) |
  | `0x01C74000–0x01C7C000` | 32 KB | user stack 24 KB + supervisor stack 8 KB, 256 B guard bands |
  | `0x01C7C000–0x01C7FD50` | 15.7 KB | `.noinit` (crash record, debug counters; survives reset) |
  | `0x01C7FD50–0x01C80000` | 0.7 KB | boot info, boot-state mailbox, vector table (write-protected) |

- VERIFIED: **Felucca leaves almost nothing free** (about 7 KB of RAM, 13 KB of pool). That is the synth
  (FX delay lines, voices, canvases), not the HAL.
- ASSUMED: with the synth removed, the HAL + USB + LCD + audio need roughly 10–20 KB, leaving **~450–480 KB**
  for a new program. To confirm in Phase 2 from the test program's map file.
- PSRAM / SDRAM: VERIFIED that Felucca uses none. The SDK maps SDRAM at `0x04000120` on AC791N variants that
  have it. Whether the FM-1's chip has any is **ASSUMED no** (Felucca squeezing into 512 KB suggests it).
  Could be probed later with a read-only RAM-run through UBOOT, with approval.

### Flash

- VERIFIED: **1 MiB SPI NOR**, JEDEC id `0x856014`. Chip key `0x980F`.
- VERIFIED: **memory-mapped (XIP)** through the SFC with an instruction/data cache. Flash offset `off`
  (>= 0x4000) reads at `0x02000000 + off - 0x4000`. The app runs in place from `0x02000120`. Constant data
  can stay in flash, as hoped.
- VERIFIED: the app area is stored encrypted (SFC cipher, per 32-byte block) and decrypted on read; Felucca
  maps everything from `0x93000` up as a plain (unencrypted) window.
- VERIFIED layout:

  | Flash range | Size | Contents |
  | --- | --- | --- |
  | `0x00000–0x04000` | 16 KB | flash header, SPL (`uboot.boot`), `isd_config` — never written by any tool |
  | `0x04000–0x93000` | 585,728 B | application. Max app image 581,564 B (`0x8DFBC`). Felucca uses 447,568 B |
  | `0x93000–0x97000` | 16 KB | unused gap / update records |
  | `0x97000–0xE0000` | 299,008 B | Felucca's store (projects, user samples). Stock uses this region for VM/BTIF/user data |
  | `0xE0000–0xE7000` | 28 KB | update-loader staging + autosave |
  | `0xFC000–0xFF000` | 12 KB | Felucca superblock / settings |

- VERIFIED: runtime erase/program works by switching XIP off and bit-driving SPI0 from RAM code with
  interrupts off (4 KB erase up to ~400 ms, audio stops meanwhile).
- VERIFIED: the installer path (update loader) and FM-1 Transporter both write **only** `0x4000–0x93000`.
  Anything placed above that has to be written by the running app itself (as Felucca does for samples).

### Display

- VERIFIED: ST7789-class **240x240** IPS panel, **RGB565**, 4-wire SPI on SPI1 (PC9 CLK, PC10 DO, PC7 CS,
  PC8 D/C), backlight PA2 active low. Write-only (no MISO, no tearing signal).
- VERIFIED: SPI clock 12 MHz (`LCD_BAUD 4`). Pixels go out by **DMA from a RAM buffer** (the source must be
  in RAM, not XIP), big-endian byte order. Transfers are polled, not interrupt-driven; the last one is left
  running while the main loop continues.
- VERIFIED: Felucca has no full framebuffer. It draws into a strip canvas (max 240x124) and blits strips.
- Derived: at 12 MHz a full 240x240 frame takes 77 ms (**13 fps ceiling**). A 240x150 Doom view (320x200
  scaled 3:4) takes 48 ms (~20 fps ceiling). ASSUMED: a lower BAUD divisor (20–30 MHz) works; the ST7789
  allows it, but nobody has tested it on this board.

### Keys, buttons, encoders

- VERIFIED: one 11-column x 6-row diode matrix behind two 74HC595 shift registers (PA4 SER, PA3 SRCLK,
  PA1 RCLK); rows on PA0, PA5–PA8, PB7. No ghosting. 41 switches: ids 0–13 buttons, 14–40 the 27 note keys
  (F3–G5). 7 encoders are read through the same matrix (quadrature, one step per detent).
- VERIFIED: scanned from the TIMER5 interrupt at 10 kHz, one column per tick (full frame 1.1 ms), debounced
  in the ISR. The app reads `fm1_in.notes` / `fm1_in.buttons` bitmasks and `fm1_enc_take()`.
- VERIFIED: the same columns drive the key LEDs. Master volume pot and battery are on the SAR ADC (PB6, PB1).
- VERIFIED: button labels: FX, SCL, ENV, LFO, EDIT, GLO, HOME, SAVE, ARP, SEQ, PLAY, REC, OCT-, OCT+.
  Encoders: SELECT, ALGORITHM, PRESETS, KNOB 1–4.
- Note: OCT- + OCT+ held 5 s enters UBOOT in Felucca. A Doom build should keep that escape hatch.

### Audio

- VERIFIED: I2S (ALNK0) to an external codec (control lines PC0/1/2/6), then speaker/headphones. Stereo,
  24-bit left-justified in 32-bit words, **44.1 kHz** (44,117.6 Hz actual).
- VERIFIED: double-buffered DMA; an interrupt per half buffer (128 frames = 2.9 ms) asks the app to fill
  the free half. Doom SFX mixing drops straight into that callback.
- VERIFIED: USB audio and USB MIDI are separate features of Felucca's USB driver and can be compiled out.

### Timers

- VERIFIED: TIMER4 free-runs at 24 MHz from the crystal (32-bit, wraps every 178.9 s): `fm1_ticks()`,
  `fm1_micros()`, busy-wait delays.
- VERIFIED: TIMER5 is the 10 kHz system tick: input scan, USB poll (2 kHz), and the millisecond counter
  `fm1_ms`. It has higher priority than audio and nests inside the audio interrupt.
- No RTOS, no sleep: Doom's `DG_SleepMs` would be a busy wait on `fm1_ms`; `DG_GetTicksMs` is `fm1_ms`.

### Boot and update flow

- VERIFIED: chain is mask ROM → SPL (`uboot.boot` in the flash head) → app. The SPL maps the app at
  `0x02000120` and jumps to its first byte.
- VERIFIED: the SPL runs the update loader instead when it finds a valid update record (`UPDATA_PARM`,
  112 bytes) in RAM at `0x01C7FD88` after a warm reset, or in flash at a "4 KB boundary minus 256" position
  between `0x93000` and `0xFC000` after a power cycle. It then loads `usb_hid_ota.bin` from the staging
  area to RAM `0x01C0A800` and runs it.
- VERIFIED install sequence: host sends an "upgrade" SysEx → the app pulls the package over USB MIDI,
  stages the loader at `0xE0000`, writes the record, resets → the loader (RAM only, own USB MIDI device
  "Felucca Update") checks the package decrypts with this chip's key and matches its CRC **before erasing
  anything**, then writes only differing 4 KB sectors of the app area, verifies each, clears the record
  and resets. Power loss mid-write: the flash record survives, the loader runs again and the host resumes.
- VERIFIED: the app arms the watchdog (~8 s) as its very first action. A boot guard counts boots that die
  within 30 s; after two in a row the app jumps to ROM UBOOT by itself (`WL80UBOOT`, `4C4A:8057`).
  SysEx `F0 22 24 35 7D F7` also enters UBOOT. Any firmware we build on this HAL inherits all three.
- VERIFIED: hardware guards (stack limits, write-protected vector area, PC limit to the app's text, bus
  faults) end in a crash screen and reset.

## Recovery: FM-1 Transporter (read fully)

What it is (VERIFIED from its README and docs; hardware results are upstream's, dated 2026-10-01):

- Firmware for a **Seeed XIAO RP2040** that acts as a USB host to the FM-1 and talks to the chip's mask-ROM
  bootloader. The Mac drives it with `tools/fm1t.py` (needs `pyserial`). MIT licensed.
- **Wiring: three wires only** — XIAO D6 (GP0) → FM-1 USB D+, D7 (GP1) → D-, GND → GND. **Never connect
  VBUS/5 V**; the FM-1 runs on its battery. This means cutting open a USB cable or using a USB-C breakout.
  Only the XIAO RP2040 is confirmed; the Waveshare RP2350-USB-A is known not to work.
- Building it needs pico-sdk 2.2.0, ARM GCC, CMake, picotool, and `wl82loader.bin` from jl-uboot-tool
  (not included in the repo). None of this is installed yet.

Procedure:

1. Wire up, flash the XIAO with `fm1_transporter.uf2`.
2. Get the FM-1 into ROM UBOOT. Three ways: (a) running firmware accepts the USB-MIDI soft key (stock V15
   and Felucca both do; `fm1t.py` sends it itself); (b) for a dead unit, connect the XIAO first, then
   switch the FM-1 on — the XIAO sends a "USB_KEY" pattern at power-on that the ROM listens for;
   (c) after a watchdog reset the ROM also accepts the key (`fm1t.py rekey`), no power cycle needed.
3. `fm1t.py info` — expect key `980F`, flash id `856014`.
4. `fm1t.py dump backup.bin` — full 1 MiB in about 3 s. **This is the backup to take before Phase 1.**
5. `fm1t.py write --package FM-1_vNN.fwsc --ref backup.bin` — a dry run unless `--write` is added. It
   requires a fresh read to match `--ref`, writes only differing sectors in `0x4000–0x93000`, reads each
   back, then does a final full compare.
6. Power-cycle the FM-1 afterwards to get normal USB back.

Limits that matter to us:

- It can only write the app area. It cannot repair the flash head (SPL, `isd_config`), and it does not
  restore anything above `0x93000`. Neither does any tool we have. So: **never write below `0x4000`**.
- `write` refuses packages that are not stock V15 or do not carry a "PASSED" review manifest from the
  author's research tooling (`fm-1-research-lab`, which I have not seen). ASSUMED: a custom Doom package
  would need that check satisfied or bypassed. For recovery we only ever need to write **stock** firmware,
  which is accepted, so this does not weaken the recovery path.
- The ROM drops back to booting flash when the host disconnects, so dump, compare and write happen in one
  session.
- There is no USB-only hard reset; a truly hung unit with no watchdog needs one power-off/on.

## Licences (VERIFIED from the files)

- Felucca: GPL-3.0-only. Its ported parts are MIT / Apache-2.0. SDK files in the package: Apache-2.0.
- doomgeneric: `LICENSE` is GPL v2; 177 source files carry "version 2 … or (at your option) any later
  version". The few files without that header are doomgeneric's own platform shims, which we would not use.
- rp2040-doom: Chocolate-Doom-derived code is GPL-2.0-or-later (checked in `d_main.c`); its new code is
  BSD-3; emu8950 is MIT.
- Conclusion: a combined work under GPL-3 is fine with either Doom base. Per-file headers should be
  re-checked for whatever subset we actually compile.
- WADs: shareware `doom1.wad` may be used but not redistributed in modified form; Freedoom is BSD-style
  and can be cut down and redistributed. ASSUMED from memory, check before publishing anything.

## Go / no-go: Doom's memory against what exists

| Need | Size | Available | Fits? |
| --- | --- | --- | --- |
| `doom1.wad` (shareware, v1.9) | ~4.2 MB (ASSUMED, not downloaded) | 1 MiB flash total | No, 4x over |
| `doom1.whx` (rp2040-doom's compressed shareware) | 1,800,344 B (VERIFIED, file in repo) | ≤ ~1.0 MB even using every writable byte | No, 1.8x over |
| Doom engine code + tables in flash | ASSUMED 300–400 KB on pi32v2 | 581 KB app slot | Yes |
| RAM, stock doomgeneric | several MB (default zone 6 MB) | ~450–480 KB | No |
| RAM, rp2040-doom approach | designed for 264 KB total | ~450–480 KB | Yes, with margin |
| Framebuffer 240x150 RGB565 | 72 KB (or 36 KB 8-bit + strip conversion) | from the above | Yes |

Realistic storage on an unmodified FM-1: 581 KB (app slot, installable and recoverable) plus ~299–430 KB
above it (only writable by our own running code, and it overwrites the synth's stored data).

### Ways forward, best first

1. **Cut-down game data ("E1M1 only").** Build a reduced data file holding one level and only the textures,
   sprites and sounds it uses, in rp2040-doom's compressed format, on rp2040-doom's engine. Target: engine
   in the app slot, data in the ~300–430 KB above it or, if small enough, all inside the 581 KB slot.
   ASSUMED feasible; nobody has published sizes for a single-level WHX, so the first task would be to
   measure it on the Mac with `whd_gen` before writing any firmware. Matches the brief's first target
   ("E1M1 title screen, then gameplay") but not full shareware Doom.
2. **Replace the flash chip** with a pin-compatible 4–16 MB SPI NOR. Makes full shareware Doom possible.
   Needs fine soldering and re-creating the flash head, which no current tool writes; a mistake there is
   not recoverable with Transporter. High risk.
3. **Host-tethered data over USB.** Serve WAD data from the Mac. Too slow and too RAM-hungry to be playable.
   Not recommended.

### Main risks

- **Flash size** (above). Decides the whole project.
- **Engine choice changes.** Phase 3 as written (doomgeneric) does not fit in RAM. The port has to start
  from rp2040-doom, which is far more intricate code and is tied to its own data format.
- **CPU speed is unknown.** rp2040-doom needs a 270 MHz dual-core overclock for 30+ fps and does not use an
  FPU. One pi32v2 core at an unknown clock, executing from cached SPI flash, may be much slower.
- **Display throughput**: 13–20 fps ceiling at the current SPI clock, before any rendering cost.
- **Flash cache misses**: all code and data run through a small XIP cache; hot loops may need to live in
  RAM (`.ram_text` exists for this, 24 KB).
- **Data above `0x93000` is outside every safety net** — the installer and Transporter never write it, so
  a Doom build must upload its own data, and doing so erases Felucca/stock presets stored there.
- **Recovery hardware is not on hand yet** (XIAO RP2040, cut cable, pico-sdk toolchain, `wl82loader.bin`),
  and a custom package may be refused by `fm1t.py write`'s review check (irrelevant for restoring stock).
- **Build fragility on this Mac**: the Raqm/FriBiDi workaround above is needed for every build.

## Open questions for later phases

- Actual CPU clock, and whether the second core and FPU are usable from bare metal.
- Size of a single-level WHX (measure on the Mac first).
- Whether the LCD runs reliably above 12 MHz.
- Whether the region `0x93000–0x97000` and `0xE7000–0xFC000` is truly free on a stock unit.
- Whether M-VAVE's official `FM-1.fwsc` (V15) is downloaded and its hash matches what Transporter expects.

## 2026-10-07 — Single-level data size (Mac only, no device)

Direction chosen by Sean: MVP = shareware E1M1 only, full colour, sound, controls, reasonable frame rate.

- VERIFIED: shareware `doom1.wad` v1.9 downloaded to `wads/doom1.wad` (4,196,020 B, MD5
  `f0cefca49926d00903cf57551d901abe`). Two mirrors failed first (ibiblio 404, Doomworld 403); a GitHub
  mirror worked and the checksum matches v1.9. Do not commit or redistribute it or anything cut from it.
- Installed: `brew install cmake sdl2 sdl2_mixer sdl2_net` (Homebrew supplied sdl2-compat/SDL3 and audio
  codec dependencies). rp2040-doom's CMake still could not find SDL2, so `whd_gen` was compiled by hand
  (it needs no SDL): its six `.cpp` files plus `tiny_huff.c`, `musx_decoder.c`, `image_decoder.c`,
  `adpcm-xq/adpcm-lib.c`, with `-DIS_WHD_GEN=1 -DNDEBUG -Wno-missing-template-arg-list-after-template-kw`.
  Check: it converts the full WAD to 1,800,312 B (repo's copy is 1,800,344 B).
- `tools/cut_wad.py SRC DST LEVEL` writes a cut-down WAD; `tools/wad_stats.py` prints sizes by category.
- VERIFIED sizes after `whd_gen` (WHX format):

  | Cut | WHX size |
  | --- | --- |
  | Full shareware WAD | 1,800,312 B |
  | 1: E1M1 only, its sprites, one music track | 1,210,540 B |
  | 2: + only E1M1's wall textures and flats | 1,022,372 B |
  | 3: + only E1M1's sound effects, no multiplayer sprites, no help/credit/intermission-map screens | 714,332 B |
  | 4: + no title picture | 677,308 B |

  Cut 3 breakdown: walls + sprites 344 KB, sound effects 169 KB, status bar / fonts / menu art 113 KB,
  flats 28 KB, level 16 KB, music 7 KB, misc 11 KB.
- ASSUMED further savings: ~50 KB from unused menu/intermission art, ~80 KB from halving the sound-effect
  sample rate. A floor of roughly 550 KB looks reachable without touching the level itself.
- NOT YET TESTED: whether rp2040-doom's engine runs a WHX with lumps missing. `whd_gen` accepted the cut
  WADs, but the engine has hard references (other maps' names, intermission, demos) that need stubbing.
- Budget: 581,564 B app slot + 299,008 B (Felucca's store) = 880 KB conservatively; up to ~1,011 KB if
  everything from `0x93000` to `0xFC000` is used. With 680–715 KB of data that leaves **165–330 KB for
  the engine**, or 330–460 KB if data is trimmed to ~550 KB.
- ASSUMED: engine code is 250–350 KB. This is now the deciding unknown, and it can be measured without
  the device by compiling rp2040-doom's engine sources with the JieLi compiler.
- Data will not fit in the app slot alongside the code, so part of it must live above `0x93000`, where
  only our own running firmware can write it.

## 2026-10-07 — Engine code size on the FM-1's CPU (Mac only, no device)

MVP confirmed by Sean: E1M1, single player only, title screen → gameplay if possible, the E1M1 music track
if possible. Both title and music may be deferred if they threaten the fit.

- VERIFIED: rp2040-doom's published `doom_tiny.uf2` is 522,240 B, i.e. ~255 KB of ARM Thumb code and
  tables (its WAD sits at a 256 KB offset). That is the reference point.
- VERIFIED: all 98 engine source files of the `doom_tiny` build compile with the JieLi pi32v2 compiler at
  `-Os` (objects only, not linked). Setup is in `sizecheck/` (`run.sh` runs in Docker, `totals.py` sums):
  **text 157,954 + rodata 99,953 + data 1,917 = 259,824 B of flash**; static RAM 72.9 KB (62.7 KB of it the
  renderer's buffers).
- What that number leaves out: the platform layer (video, input, sound, timer, main — rp2040-doom's
  `src/pico/*` and `opl_pico.c` were excluded because they are RP2040-specific and get rewritten), Felucca's
  HAL/USB/update entry, and libc. ASSUMED 30–40 KB together. It also has no linker dead-code removal, which
  will take some back.
- VERIFIED breakdown: music (OPL emulator + player) is 19.7 KB of code. Removable for an MVP: savegames
  13.5 KB, AES/SHA 16.6 KB, intermission 5.6 KB, automap 5.9 KB, net stubs ~2 KB — about 45 KB.
- Changes needed just to compile, committed on branch `fm1-port` in `./rp2040-doom` (2 files): Thumb
  inline assembly in `m_fixed.h` and a breakpoint in `doomtype.h` guarded by `__arm__`; short-pointer
  base made overridable. Stand-ins used only for the size check (`sizecheck/stubs/`): a tiny C++
  `<algorithm>/<set>/<atomic>` (the JieLi toolchain ships **no C++ standard library**), and a fake RP2040
  "interpolator" header.
- Porting facts learned (VERIFIED in source):
  - The code uses `PICO_ON_DEVICE` to mean both "small-memory layout" (needed) and "RP2040 hardware"
    (not available). These have to be separated file by file.
  - The renderer (`pd_render.cpp`) and the OPL slot renderer use the RP2040's hardware interpolator and
    ARM assembly fast paths. Both have plain-C fallbacks (slower).
  - Objects are addressed by 16-bit "short pointers" that reach only 256 KB above a base address; the
    game heap must sit inside one 256 KB window of our RAM.
  - It is written for two cores (render on one, game/sound on the other). Felucca uses one.
- Data, corrected: my cut 3 had dropped `GENMIDI` (the music instrument table). Kept now:

  | Cut | WHX size |
  | --- | --- |
  | 3: E1M1, title picture, E1M1 music + instruments | 726,256 B |
  | 5: as 3 but no intermission art and no title picture | 653,964 B |
  | 5 + title picture (~37 KB) | ~691 KB (derived) |

### Fit, with title screen and music

| Item | Size |
| --- | --- |
| Data: cut 5 + title | ~691 KB |
| Engine as compiled | 260 KB |
| Platform + HAL + libc (ASSUMED) | 30–40 KB |
| **Total** | **~985 KB** |
| Conservative ceiling (app slot + Felucca's store) | 880 KB |
| Stretch ceiling (everything `0x4000–0xFC000`) | ~1,011 KB |

It fits the stretch ceiling as is, with ~25 KB spare. To fit the conservative ceiling: drop savegames,
crypto, intermission, automap (−45 KB, VERIFIED sizes) and halve the sound-effect sample rate (ASSUMED
−85 KB) → ~855 KB. **Go, but tight**; title and music together cost ~65 KB and are the first things to
defer if needed.

### Safety plan for when the device is connected (nothing done yet)

- Baud Girl's FM-1+VA installer (`baudgirl.com/work/FM-1+VA/install`) is a second third-party firmware
  installed by the same browser/USB-MIDI route as Felucca, and states that saved presets and patterns are
  not overwritten. VERIFIED only that the page says so; it supports the view that the app-area install
  path is routine. I did not go past the first page.
- Order of operations I intend to propose, each write needing a yes:
  1. Transporter built and wired; `fm1t.py info` then two full dumps that must be identical (read-only on
     the flash, but it does run a loader in the FM-1's RAM, so I will ask first).
  2. Have M-VAVE's stock `FM-1.fwsc` downloaded and checked.
  3. Install stock Felucca by the normal route (Phase 1) and prove a round trip back to stock.
  4. Only then our own builds, which keep Felucca's boot code unchanged: watchdog first, boot guard
     (two bad boots → ROM boot mode), OCT- + OCT+ hold, the USB "enter boot mode" message, and the update
     entry. A broken game then still leaves a device that can be re-installed over USB.
  5. Never write below `0x4000`. Game data above `0x93000` goes only into `0x97000–0xE0000`, the range
     Felucca already uses, written by our own firmware with verify.
- Known gap: no existing tool restores the region above `0x93000`. The full dump from step 1 is the only
  copy; putting it back would need our own writer. ASSUMED stock re-creates its settings there if blank.

## 2026-10-07 — Device-free steps 1–3 (Mac only)

Decisions from Sean: drop savegames, automap and the end-of-level stats screen; keep sound effects at
full quality unless the image does not fit. Emscripten install and local-branch edits approved.

Installed: `brew update`, then `emscripten` 6.0.10 (1 GB), `pkgconf`, `sdl2_image` (plus image-codec
dependencies). Cloned `./pico-host-sdl`.

### Step 1 — the cut-down data really plays (VERIFIED)

- rp2040-doom's host build (`doom_tiny`, `PICO_PLATFORM=host` + pico-host-sdl) builds in `./host-build`.
  Needed on Apple silicon: `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` and C/C++ flags
  `-D__sev=host_sev -D__wfe=host_wfe -D__wfi=host_wfi` (Apple clang treats those names as builtins).
  The data is embedded via `./cup.sh file.whx` → `src/tiny.whd.h` (git-excluded: it is WAD data).
- Test hooks (host builds only), committed on `fm1-port`: `FM1_AUTOSTART=1` starts E1M1 directly,
  `FM1_AUTOPLAY=1` walks/turns/fires on a script and logs player state. Uncommitted local edit in
  `pico-host-sdl/sdl_video.c`: `FM1_SHOT_DIR=dir` dumps a raw frame every 2 s; `tools/shot2png.py`
  converts. Run headless with `SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy`.
- Result with cut 3 (726 KB, the other 8 maps, demos, help/credit screens, unused sounds/sprites all
  missing): 45 s of scripted play with no crash or missing-lump error. Screenshots show walls, floors,
  status bar, HUD message font, weapon, muzzle flash, a barrel explosion, an item pickup, enemy sprites
  and the death view. Ammo fell 50 → 21 and the player died at about tic 800, so input, shooting, damage
  and death all ran. Game logic ticks at 35 Hz.
- NOT tested: the title screen → new game menu path, level exit (needs the intermission stubbed since
  its art is cut), sound output (audio driver was the dummy one), and cut 5.

### Step 2 — linked image size (VERIFIED)

- `sizecheck/link.sh` links the 98 engine objects with the toolchain's libc/compiler-rt, dead-code
  removal on, and empty stubs for the 80 symbols the unwritten platform layer must provide
  (`I_*` video/timer/input, semaphores, `printf` family, `malloc`, the network lobby, flash save).
- Result: **`.text` + constants 222,420 B, `.data` 2,164 B → 224.6 KB of flash** (was 260 KB unlinked).
  Static RAM `.bss` 81.6 KB; plus the 256 KB game heap → about 340 KB of the 512 KB, before stacks and
  the platform layer.
- The JieLi libc has no `printf`/`malloc` (they showed up as unresolved); a small `printf` and the
  engine's own zone allocator will cover them.
- Updated fit: data 691 KB (cut 5 + title) + engine 225 KB + platform/HAL (ASSUMED 30–40 KB) ≈ 950 KB.
  After dropping savegames/automap/intermission code: roughly 915–925 KB. That is over the 880 KB
  conservative ceiling by ~40 KB and under the ~1,011 KB stretch ceiling. With full-quality sound the
  build needs either some of the stretch area (`0x93000–0x97000`, `0xE7000–0xFC000`) or ~40 KB more
  trimming.

### Step 3 — browser emulator

- VERIFIED: stock Felucca's emulator builds with Emscripten (`web/emu/build.sh` → `build/emu/felucca.wasm`,
  650,446 B) and runs in a browser from `python3 -m http.server -d build/emu 8790`: the synth's home
  screen draws on the emulated display with no console errors. A preview entry `fm1-emu` was added to
  `/Users/sean/code/.claude/launch.json`.

## 2026-10-07 — Step 3 done: the game runs in a browser model of the FM-1 panel (Mac only)

- VERIFIED: `web/build.sh` compiles rp2040-doom's engine plus a new FM-1 platform layer
  (`rp2040-doom/src/fm1/`, branch `fm1-port`) to WebAssembly: `web/build/doom.{js,wasm}` + `index.html`.
  Serve with `python3 -m http.server -d web/build 8791` (preview entry `fm1-doom`). In the browser:
  title screen → menu → New Game → skill → E1M1, walking and turning, at 35–36 fps. That frame rate is the
  Mac's and says nothing about the FM-1's CPU.
- It is 32-bit and uses the device's small-memory layout (`PICO_ON_DEVICE=1` + `FM1=1`), so it is the
  closest thing to the firmware that can run without hardware. It is our own page with a 240x240 canvas,
  not Felucca's emulator page; both model the panel at the same level (`lcd_blit` into a 240x240 RGB565
  buffer), so the platform layer's `fm1_lcd_blit` maps straight onto Felucca's `lcd_blit` on the device.
- How video works (VERIFIED in code): the engine keeps two 8-bit 320x168 frame buffers (107 KB) and
  composes each of the 200 output lines on the fly (palette lookup, then status bar / menu / HUD patches).
  `fm1_video.c` reuses that code unchanged, squeezes each line 320 → 240 (outer pixels kept, middle two
  averaged), drops every 4th line (200 → 150) and sends 10-line strips (4.8 KB) to the panel, centred
  with black bars above and below. No full-colour frame buffer is needed.
- One CPU core (VERIFIED): the renderer already shares its work between cores by taking jobs from a
  common list, so core 0 alone draws everything. The semaphores it would block on now run the "other
  core's" job inline (`fm1_platform.c`): show the finished frame, or acknowledge.
- `FM1=1` changes in the engine: no RP2040 interpolator, run-time short-pointer base, WAD address from
  the platform, title screen waits for a key instead of cycling demos/credits, flash savegames stubbed.
- Short pointers (VERIFIED the hard way): they point at some of the engine's static variables as well as
  the heap (`thinkercap` trapped first). So the 256 KB window must cover those statics *and* the heap.
  Total statics are ~199 KB; of that the frame buffers (107 KB) and renderer work areas (63 KB) seem not
  to be short-pointed, and with those placed below the window the browser build runs with a 200 KB heap.
  The firmware's linker script has to arrange RAM the same way. ASSUMED: nothing else outside the window
  is short-pointed — only E1M1's start area has been exercised so far.
- Data: the title music the OPL player wants is `D_INTROA`, not `D_INTRO`; `tools/cut_wad.py` keeps it.
  Current data file `data/e1m1_cut3.whx` = 726,648 B (WAD-derived: never commit). `tools/whd_gen` is the
  Mac build of the converter.
- Not done / known gaps: no sound or music (stubs report "no device"); keys are PC keys, not the FM-1
  panel; the episode menu still lists three episodes; finishing the level will hit the cut intermission
  art; savegame menu entries exist but do nothing; `Ctrl` (fire) could not be exercised through the
  browser automation, though firing worked in the native scripted test.
- Browser build is 1.12 MB of wasm, of which 727 KB is the embedded data; not comparable to the pi32v2
  size (225 KB engine).

## 2026-10-07/08 — Sound, controls, one-level flow, and a linked firmware image (Mac only)

### Sound (browser build)
- VERIFIED: rp2040-doom's own mixer (`src/pico/i_picosound.c`) and OPL music player (`opl/opl_pico.c`) compile
  unchanged against a small shim (`src/fm1/shim/pico/audio_i2s.h`, `src/fm1/fm1_audio.c`): they fill a ring
  buffer at 49,716 Hz (the OPL chip's rate); the output side pulls with linear resampling to its own rate
  (44.1 kHz on the FM-1, the AudioContext's in the browser).
- VERIFIED by measurement only: the title screen produces a signal peaking around 0.5 of full scale and, once
  running, 4 s of play had 0 underrun frames. **Nobody has listened to it yet** — I cannot hear the output.
- One core means the mixer only runs when the game calls it: once per shown frame plus the engine's own wait
  loops. A level load leaves a gap of silence.

### Controls (VERIFIED in the browser build)
`src/fm1/fm1_controls.c` maps the panel to Doom keys; the page now feeds the game only through a panel model.

| FM-1 control | Action |
| --- | --- |
| G#3 / A#3 | forward |
| G3, B3 | turn left, right |
| A3 | back |
| F3, C4 | strafe left, right |
| F#3, F#5 | run |
| E5, F5, REC button | fire |
| D5, G5 | use / open |
| HOME | menu (Esc) |
| PLAY | select (Enter) |
| OCT-, OCT+, KNOB 4 | previous / next weapon |
| SELECT knob | move through menus (weapons while playing) |
| FX | "yes" |
| OCT- + OCT+ held 5 s | boot-ROM mode (firmware build only; handled below the game) |

### One-level flow (VERIFIED in the browser build, except level exit)
Title waits for a key; main menu has NEW GAME and OPTIONS only; NEW GAME goes straight to skill; finishing
the level returns to the title (code path written, **not exercised**: nobody has reached the exit switch).

### Data (VERIFIED sizes)
| File | Contents | Size |
| --- | --- | --- |
| `data/e1m1_6.whx` | E1M1, title picture, title + level music, no intermission art, full-rate sound | 691,380 B |
| `data/e1m1_6h.whx` | the same with every sound effect at half rate (5,512 Hz) | 604,936 B |
`tools/cut_wad.py SRC DST 6 [--half-sfx]`. The browser build currently embeds `e1m1_6h.whx` and plays.

### Firmware image (VERIFIED: it compiles and links; NOT run on hardware)
- `firmware/build.sh` → `firmware/build/doom.elf`. Sources: the engine and `src/fm1` platform layer, plus
  `firmware/doom_dev.c` (one compilation unit on Felucca's HAL with Felucca's `lcd.c`, `usb.c`, `ota.c`
  included unmodified from `./Felucca`, GPL-3.0-only), `firmware/doom.ld`, `firmware/fm1_printf.c`.
- **Sizes: `.text` 255,700 B + `.ram_text` 2,924 B + `.data` 3,576 B = 262,200 B of flash**, everything
  included (engine, music, mixer, platform, HAL, USB, update entry, printf).
- RAM map (`doom.ld`): 4 KB flash-driver code, 32 KB stacks, 205 KB big buffers (frame buffers, renderer
  work areas, audio/USB) below a 256 KB short-pointer window at `0x01C3C000` holding 28.5 KB of statics and a
  **227 KB game heap** (the browser build runs in 200 KB).
- What `doom_dev.c` does: Felucca's boot sequence (watchdog first, boot guard, fault vectors, guards),
  panel scan and millisecond tick at 10 kHz, I2S output fed from the game's ring, USB-MIDI with the update
  entry and the "enter boot mode" SysEx, OCT- + OCT+ 5 s → boot mode. If no game data is found it shows a
  blue screen and stays updatable instead of starting the game. Crash = red screen, game panic = magenta,
  then reset (two early failures in a row → boot mode, as Felucca).
- Known weak spots, all unverifiable without the device: untested on hardware in every respect; the LCD
  write blocks ~3 ms per strip (15 strips a frame, so ≥ 48 ms of every frame is spent waiting on SPI — the
  first thing to optimise); the stack is 24 KB against an unmeasured need; the progress display during an
  update is coloured bars, not text.

### The flash layout problem (VERIFIED from `tools/fm1pkg_make.py` and Felucca's `ota.c`)
- The engine needs its data as one contiguous block.
- Felucca's package puts `cfg_tool.bin` and an EQ table right after a fixed 581,564-byte app slot, i.e. at
  flash `0x920DC–0x93000`. Data cannot run through that.
- `0xE0000–0xE7000` is the update staging area and update-record position; any update writes there.
- So the only contiguous run long enough is: **code, then the cfg files, then data up to `0xE0000`**. With a
  262 KB image that leaves about **631 KB** — enough for the half-rate-sound data (605 KB), not for the
  full-rate data (691 KB, 60 KB over).
- That layout needs two things no existing tool does, both still to be built and both boot-relevant:
  1. a package whose app slot is only as long as the code (cfg files moved up behind it). ASSUMED the SPL
     follows the directory entries rather than fixed offsets; only hardware can confirm.
  2. writing `0x93000–0xE0000`. The standard update loader and Transporter stop at `0x93000`.

## 2026-10-08 — Installable package and update loader (built and host-tested; NOT installed, NOT run on hardware)

- `firmware/pack.py DATA.whx` → `firmware/build/doom.fwsc` (925,482 B with `data/e1m1_6h.whx`).
  VERIFIED layout: directory + code + config files end at `0x445B6`; data at `0x45000–0xD8B08`
  (604,936 B); 29,944 B free below `0xE0000`. Image is 262,216 B.
- What differs from a Felucca package (both ASSUMED to work on the device, neither tried):
  1. the app slot is only as long as the code, the two SDK config files follow it, the data follows them.
     Relies on the boot code finding files through the directory entries rather than at fixed offsets.
  2. data below `0x93000` is stored encrypted exactly like code and data from `0x93000` up is stored plain.
     Relies on the flash decryption being purely address-based across the whole app area.
- The package carries a variant of Felucca's update loader: two constants in `ldr_core.c` and one in
  `loader.c` changed so it writes `[0x4000, 0xE0000)` instead of `[0x4000, 0x93000)`. `pack.py` generates it
  into `Felucca/build/doomldr/` and stops if any replaced line is not found exactly once.
- VERIFIED offline by `pack.py`: the data reads back contiguous through a simulated decrypt; no 4 KB
  boundary in the data region looks like an update record (the boot code scans for those).
- VERIFIED by `firmware/test.sh` on Felucca's simulated flash and fake update host:
  - Felucca's own update-entry test, unmodified, accepts the Doom package and stages its loader, writing
    only `0xE0000–0xE4FFF`;
  - the extended loader installs Doom over Felucca: app area and data region equal the package, the head
    `[0, 0x4000)` untouched, nothing written above `0xE0000` except clearing the two update records, a
    damaged package and a wrong-key package refused before any erase, re-install erases nothing;
  - the way back: Felucca's own loader test, unmodified, installs Felucca over an installed Doom.
  - Felucca's installer (`fm1_install.py` `load_package`) accepts the package (identity `FM-1_900`).
- What those tests do NOT show: that the SPL boots this layout; that the firmware runs at all; that
  Felucca (or stock) copes with game data left in `0x93000–0xE0000` after going back — Felucca's store is
  checksummed so it should treat it as empty (ASSUMED), stock is unknown.
- Consequence for recovery: installing Doom destroys whatever is in `0x93000–0xE0000` (Felucca projects /
  samples, or the stock firmware's saved presets). The Transporter dump taken beforehand is the only copy,
  and the extended loader is the only tool that can write that region back (as a package built from the
  dump — not written yet).
- Other firmware changes: LCD strips now alternate between two buffers so the SPI transfer of one overlaps
  composing the next (strip height 8 lines); no C++ static constructors exist in the image (checked);
  big-buffer area has 964 B to spare.
- VERIFIED in the browser build: forcing the level to finish (`Module._fm1_web_exit_level()` in the page's
  console) returns to the title, and a new game starts normally afterwards, with no errors.
- The project root is now a git repository (branch `work`); clones, WADs, data and build output are ignored.

## Where things stand: device-free work is finished

Everything that can be built or checked without the FM-1 has been. What remains needs the device, and each
item is a first-time-on-hardware unknown:

1. Recovery kit: XIAO RP2040 + wiring + Transporter build (pico-sdk is cloned; ARM GCC, picotool and
   `wl82loader.bin` are not installed), then two matching full dumps.
2. Phase 1 as planned: stock Felucca in and back out.
3. First Doom boot. Unknowns it will settle, in the order they would show up: does the SPL boot the
   shorter app slot; does the screen come up; does the game start or hit a fault (stack size, short-pointer
   window, anything `PICO_ON_DEVICE` still assumes); frame rate; sound.
4. Then tuning: CPU clock, LCD SPI speed, moving hot loops to RAM, full-rate sound if space allows.

Suggested first step on hardware, before any Doom data: install the Doom firmware **without** game data
through the normal Felucca-style package (standard layout, standard loader). It would show the blue
"no data" screen and prove boot, screen, USB update and the way back, without touching `0x93000+`.
That package now exists: `firmware/pack.py --no-data` → `firmware/build/doom_nodata.fwsc` (610,086 B),
Felucca's exact layout with Felucca's own unmodified loader. VERIFIED with Felucca's own unmodified tests:
its update entry accepts it, its loader installs it over Felucca, and Felucca installs back over it.

## 2026-10-08 — "Frozen enemy" report from Sean: a data-cut bug, now fixed; enemy behaviour verified

- Sean saw a figure standing motionless ahead of the start position in the browser build.
- VERIFIED cause: it is not a monster. E1M1 has corpse decorations near the start (thing types 10 "bloody
  mess", 15 "dead player") that are drawn with player sprites (`PLAYW0`, `PLAYN0`). My data cut removed
  all player sprites, and the engine then drew some other picture — a standing figure — in their place.
  The real monsters on this level are all further east (x ≥ 2272; the start is at x = 1056).
- Fix: `tools/cut_wad.py` keeps `PLAYN0` and `PLAYW0`. The converter insists on every frame of a sprite
  being present, so the other player frames get a 1x1 stand-in. Data grows 2 KB:
  `data/e1m1_6h.whx` is now **606,952 B** (27,928 B free below `0xE0000`). The start view now shows the
  gibbed corpse as in the original game.
- Enemy behaviour, VERIFIED in the FM-1 build (the 32-bit small-memory configuration) with a new headless
  test, `node web/test_node.js 2912 -2700`: it starts a game through the panel model, places the player
  in front of a zombieman, fires, and consumes audio as the page does. Result: 2 monsters leave their idle
  states at once, the player's health falls 100 → 25 over 14 s, 35 frames a second throughout, sound
  output active, no audio underruns after start-up. The native reference build behaves the same at the
  same spot (2 awake, health dropping).
- Idle monsters only swap between two standing frames until they see or hear the player; gunfire in the
  start room does not reach them (same in the reference build with the original, uncut data).
- A browser-automation hang during this investigation was my own test hook walking the object list while
  no level was loaded; the hooks now refuse outside a level. It was not a game bug.
- Follow-up check of every object type placed in E1M1 against the sprites kept (VERIFIED): one more was
  missing, the blood-pool decoration (type 24, sprite `POL5`, 7 on the level). Kept now; data is **607,328 B**
  (27,552 B free). The chaingun, rocket launcher and box of rockets on this level are multiplayer-only, so
  their sprites stay cut. No other placed object lacks its sprite.
- Lesson recorded: the cut removes data the level references indirectly. Other candidates to check when
  the level is played through: any thing type whose sprite I dropped, sounds triggered by rarely used
  actions, and textures revealed only by switches or lifts.

## 2026-10-09 — Review for recoverability, and a staged install plan (Mac only; nothing installed)

Sean has no Transporter hardware yet and asked how to minimise the risk of bricking, accepting smaller steps.

### What the review found (all VERIFIED in code or by a build check, all fixed)
1. **Start-up data copy was off by 4 bytes.** My linker script put 4 bytes of padding inside `.data` while the
   start-up code copied from the section's start to a label 4 bytes in. Every initialised variable would have
   been shifted. The packages built on 2026-10-08 had this bug and would not have run correctly.
   Fixed (`doom.ld`: the region starts 4 bytes in instead); `pack.py` now refuses an image whose `.data` /
   `.ram_text` files are not exactly the size the start-up code copies.
2. **My supervisor stack overlapped the place Felucca's start-up code writes to.** `crt0.S` (used unchanged)
   stores the state handed over by the boot loader at `0x01C07F00`, which Felucca keeps free. Harmless at that
   instant, but not something to leave. The memory map now leaves `0x01C07000–0x01C08000` alone.
3. **The loader variant refused ordinary packages** (it required the long flash image). Had it ever been the
   loader left staged by an interrupted install, a plain Felucca package could not have been fed to it to get
   out. It now handles an ordinary package exactly as Felucca's loader does, and Felucca's own loader test
   (one include line changed) passes against it.
4. The flash was used without Felucca's check that the expected chip answers (`0x856014`). Added, as Felucca.
5. The watchdog was only fed once per game tic, so a slow level load could have looked like a hang. The game
   now feeds it from every clock read and every shown frame, and game mode uses the 32 s setting.
6. The audio interrupt did a 64-bit division per call. Now computed once.
- Checked and found fine: no C++ static constructors in the image; the firmware uses no CPU registers outside
  what Felucca's interrupt stubs save (compared against Felucca's own disassembly); engine code is clean for
  CPUs that fault on unaligned access (it targets the Cortex-M0+, which does).

### Toolchain check against a published release (VERIFIED)
Our checkout is Felucca's tag `v1.1.5`. A release build made on this Mac compared with the published
`felucca-1.1.5.fwsc` (downloaded to `refs/`): **the update loader is byte-identical.** The app differs: 8 bytes
longer upstream, with the differences in the generated font / icon tables and the build date (ASSUMED from
where they are; Pillow/FreeType version). So the compiler, linker and loader wrapper here reproduce the
safety-critical binary that is running on other people's FM-1s.

### Design changes for recoverability
- **Recovery-first boot** (`firmware/doom_dev.c`, described at its top). Safe mode = USB update entry only;
  entered after one failed start (amber), with HOME held at power-on (cyan), or when game data is missing or
  fails its checksum (blue; two white corners = second block). Safe mode never starts audio, never calls the
  game, never reads game data. Mask-ROM boot mode is now the third line of defence (3 failures), not the first.
- **Felucca's exact flash layout is kept.** The game data is stored as two blocks (317,824 B inside the app
  slot after the firmware, 289,504 B from `0x93000`); the engine turns data offsets into pointers in exactly
  one function, which now knows the split. VERIFIED: the browser build stores the two blocks far apart with
  64 KB of poison between them and the headless gameplay test gives the same result as before (health 25 at
  t=13). This removes yesterday's two assumptions about the boot code (shorter app slot, config files moved).
- A 64-byte descriptor with checksums of both blocks sits between firmware and data; the firmware verifies
  both blocks at every start before running the game.
- "Recovery core id" (`firmware/build/core.id`, currently `1526164b9edc8f07`): a hash of the device unit's
  object code, Felucca's start-up/vector/interrupt stubs and the linker script. Same id as a build already
  proven on the device = same recovery code. It did not change when only game code was rebuilt.

### Three packages (replacing yesterday's two; `firmware/pack.py DATA.whx`)
| Package | Contents | Loader | Writes above `0x93000`? |
| --- | --- | --- | --- |
| `doom_code.fwsc` | firmware only | Felucca's, unmodified (byte-identical to the published one) | no |
| `doom_part1.fwsc` | firmware + descriptor + data block 1 | Felucca's, unmodified | no |
| `doom_full.fwsc` | the same app area + data block 2 | variant: also writes `[0x93000, 0xE0000)` for a long package | yes |

`firmware/test.sh`: 15 runs, all pass. Felucca's own unmodified tests cover: its update entry accepting each
package; its loader installing `doom_code` and `doom_part1` over Felucca and Felucca back over each; Felucca
back over the full install. The variant is covered by Felucca's checks for ordinary packages (three runs,
including the way out of a full install) and by derived checks for the long package, including "block 2 added
after `doom_part1`: not one sector of the app area erased".

### The staged plan (each step is one install; each is a separate yes from Sean)
| Step | What is installed | New on hardware | If it fails |
| --- | --- | --- | --- |
| 0 | nothing | — | — |
| 1 | published Felucca, from its own web installer | the USB install route on this unit | as for any Felucca user; stock restores via the installer |
| 2 | back to stock V15, then Felucca again | the way back | — |
| 3 | `doom_code.fwsc` | our firmware's start-up, screen, keys, USB update entry (safe mode: blue) | no working USB → mask-ROM boot mode after 3 failed starts, or OCT- + OCT+ → needs a boot-mode tool |
| 4 | Felucca over it, then `doom_code` again; also HOME-at-power-on and PLAY-2-s | the way out of safe mode, the key chords | same as 3 |
| 5 | `doom_part1.fwsc` | data in the app slot reads back and passes its checksum (blue, two corners) | safe mode by design |
| 6 | `doom_full.fwsc` | the loader variant; the game itself | game crash → amber safe mode, update over USB; loader trouble → it still takes any ordinary package |

Step 3 is the one real leap: it is the first time code built here, other than a loader identical to
Felucca's, has to bring up USB on the device. Everything after it is behind safe mode.

### A recovery channel without the XIAO (PROPOSED, not built, needs Sean's approval)
- VERIFIED from the docs: in mask-ROM boot mode the FM-1 shows up on an ordinary USB host as mass storage
  `4C4A:8057`; stock V15 and Felucca both enter it on the SysEx `F0 22 24 35 7D F7`; when the host lets go it
  resets and boots normally; the Transporter's author first did dump and restore straight from a Mac with
  jl-uboot-tool and a macOS USB patch (that repository is not public). jl-uboot-tool (MIT, cloned read-only
  to `./jl-uboot-tool`) includes `wl82loader.bin`, the RAM loader for this chip, but only Linux and Windows
  transports.
- So a Mac-only tool looks feasible: enter boot mode by SysEx, upload the RAM loader, read chip id and flash.
  Read-only, it would give the full backup and prove the recovery channel on a healthy unit before any
  install. ASSUMED hurdles: macOS's own mass-storage driver claims the device first (may need `sudo`), and I
  cannot test any of it without the FM-1 attached. CLAUDE.md lists jl-uboot-tool as reference-only unless
  approved, hence the question.

## 2026-10-09 — Sean's FM-1 already runs Baud Girl's FM-1+VA (Version 97 is current), installed by its web page

- Consequence: the USB install route is already proven on this unit (step 1's purpose). The starting point is
  now Baud Girl's firmware, not stock.
- VERIFIED from Baud Girl's manual (section 13): presets and patterns are kept in a part of memory separate
  from the firmware and survive installs; going back to M-VAVE's firmware is documented — download M-VAVE's
  file, then on the Install page's fourth step choose "Install a file from my computer"; the Device Manager
  saves and restores backups of presets and patterns.
- VERIFIED from Felucca's sources: its installer drives a two-step update in which the *running* firmware
  starts the loader carried in the package. Felucca's own update entry starts only M-VAVE's official loader
  or Felucca's (`ota.c`, refuses anything else before writing). M-VAVE's official loader rewrites the whole
  flash image including the head.
- UNKNOWN: whether Baud Girl's firmware will start the Felucca loader that our packages (and Felucca's)
  carry, whether it answers the installer's identity query, and whether it honours the boot-mode SysEx.
  Stock is the documented starting point for installing Felucca.
- A zero-write probe exists: `python3 Felucca/tools/fm1_install.py --info` sends one identity query and
  prints what the FM-1 reports. Needs `pip3 install mido python-rtmidi` (not installed) and Sean's OK.
- Revised opening of the staged plan: (a) back up presets/patterns in Baud Girl's Device Manager; (b) the
  identity probe; (c) Baud Girl → M-VAVE stock by Baud Girl's documented route, which proves the way back
  to stock on this unit; (d) stock → published Felucca by Felucca's installer; then `doom_code` onwards
  as before.

## 2026-10-09 — Device steps begin: links and facts for the opening steps (Sean does each step and reports)

- VERIFIED from Baud Girl's manual (sections 12.1, 12.2, 12.11, 13.1, 13.5–13.7):
  - Device Manager: `https://baudgirl.com/work/FM-1+VA/device-manager`. Needs Chrome or Edge and Version 96
    or later on the FM-1. Library → **Back up everything** saves `fm1-presets-<date>.syx` (128 presets) and
    `fm1-patterns-<date>.syx` (16 patterns); the manual says this reads only and changes nothing on the FM-1.
    On a Mac the FM-1 is usually listed as "USB Composite Device".
  - Back to M-VAVE: Install page (`https://baudgirl.com/work/FM-1+VA/install`), fourth step "Choose a
    version" → **Install a file from my computer** → M-VAVE's file. The manual gives no download link.
  - If an install stops with the display dark: do not switch off; reload the Install page with the FM-1
    still connected and click Test connection to finish. Switch off only if the page says nothing was
    installed.
- VERIFIED from Felucca (`web/index_pkg.html`, `tools/fm1_install.py`): M-VAVE's downloads are at
  `https://www.m-vave.com/download`; the unmodified official V15 `FM-1.fwsc` has SHA-256
  `db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a` (check the download with
  `shasum -a 256` before it is installed). Felucca's web installer: `https://hugelton.github.io/Felucca/`.
- VERIFIED from the Transporter's DEVLOG: stock V15 enables USB only after a cold power-on; after the
  restart that ends an install it runs but does not appear on USB. ASSUMED consequence: after going back to
  stock, switch the FM-1 off and on before the next installer can see it.
- Decision: skip the identity probe (`fm1_install.py --info`). We go through stock regardless, so its answer
  changes nothing, and it would send a query to firmware whose handling of it is unknown.
- 2026-10-09 13:29: Sean saved `fm1-presets-2026-10-09.syx` with Baud Girl's Device Manager (VERIFIED on
  disk: 29,568 B, 128 SysEx messages of 231 B). The patterns file did not download; Sean chose to skip it
  (only default and Baud Girl patterns on the unit).
- 2026-10-09 13:34: Sean downloaded M-VAVE's `FM-1.fwsc` from
  `https://yms-file-store.oss-cn-hongkong.aliyuncs.com/software/firmware/FM-1.fwsc` (the link on M-VAVE's
  download page). VERIFIED: 699,956 B, SHA-256 `db1642b2…edb8a` = official V15. Copy kept at
  `refs/FM-1-V15-official.fwsc` (not in git).
- 2026-10-09 ~13:45: Sean installed `FM-1.fwsc` (official V15) from Baud Girl's Install page ("Install a file
  from my computer"). VERIFIED by Sean's report: it finished and the FM-1 restarted into stock firmware. So
  Baud Girl → stock works on this unit, and the M-VAVE loader path is proven here.

### Felucca moved on: 1.5 was released today (VERIFIED, `git fetch --tags`, hosted installer page)
- Tags after our checkout (`v1.1.5`): `v1.1.5.1`, `v1.4`, `v1.4.1`, `v1.5` (5 commits). The hosted installer
  (`https://hugelton.github.io/Felucca/` → `webapp/installer/`) has one Install button and installs
  `felucca-1.5.fwsc`; no version choice.
- `git diff v1.1.5 origin/HEAD` for the update path: `firmware/loader/` unchanged; `tools/fm1pkg_make.py`,
  `tools/fm1_install.py`, `web/fm1ota.js`, `web/fm1pkg.js` unchanged; `firmware/src/ota.c` changed only in
  where three buffers are placed (a `.pool` section attribute), no logic; `fm1_flash.h` adds one store
  region, `0xE7000–0xE8000` (FM6 voice bank, 1.4.1). RAM split changed (72 K / 360 K).
- ASSUMED until checked: the published 1.5 loader is still byte-identical to the one in our packages, and
  1.5's update entry accepts our packages as 1.1.5's does. TODO before the `doom_code` step: build or fetch
  1.5 and re-run `firmware/test.sh` against it.
- Our firmware stays on the v1.1.5 copies of `ota.c` / `fm1_flash.h` (1.5's `ota.c` needs a `.pool` section).
- Preset warning for the Felucca step: Felucca's store is `0x97000–0xE0000`, which stock uses for its own
  saved data (exact place of stock presets ASSUMED to be inside it). Expect presets saved on the FM-1 to be
  lost from here on; the copy is `~/Downloads/fm1-presets-2026-10-09.syx`, restorable only with Baud Girl's
  firmware and Device Manager.
- 2026-10-09 ~13:50: Sean installed Felucca from the hosted installer (so 1.5) on stock V15; it restarted
  into Felucca. VERIFIED by Sean's report. Stock → Felucca with Felucca's loader works on this unit.

### Checks before the `doom_code` step (all on the Mac, VERIFIED)
- Felucca 1.5's own `tests/ota_test.c` (extracted with `git archive v1.5` to `refs/felucca-1.5-src`),
  unmodified, accepts `doom_code`, `doom_part1` and `doom_full` and stages their loaders. So the firmware now
  running on the FM-1 should take our packages (host test, not hardware).
- 1.5 did not change the boot guard, the reset-surviving variables, `crt0`, the vectors or the loader; the
  `fm1_input.h` changes are LED animation only.
- The firmware build is reproducible: a fresh `firmware/build.sh` + `pack.py` gave byte-identical
  `text.bin` / `data.bin` / `ram_text.bin` and byte-identical packages. Recovery core id `1526164b9edc8f07`.
  `doom_code.fwsc`: 610,086 B, SHA-256 `49a52fe5f5864d402b5bcec8d8a9e98f246c8e28ebfeea30f9fe297865bb50c5`.
  All 15 package tests pass again.
- Local installer page for `doom_code` generated with Felucca's own `web/make_site.py` into
  `firmware/build/site_code` (the package inside is byte-identical to `doom_code.fwsc`; identity `FM-1_900`).
  The page waits for the FM-1 to come back and report `FM-1_900`, so "Done" on the page = our firmware
  started and its USB answered. Preview entry `fm1-install` (port 8792). NOT served yet; needs Sean's yes.
- STILL MISSING for the brief's precondition ("working recovery path and a full flash backup before the
  first experimental flash"): no boot-mode tool on hand, no flash dump. Put to Sean as a decision.

## 2026-10-09 — Decision: prove a boot-mode backup/recovery channel before `doom_code` (Sean: "go with your recommendation", priority = recoverability)

- Chosen: build a Mac boot-mode tool first (option C), not install `doom_code` now. Reason: a failed first
  boot ends in the chip's boot mode; the tool would be needed then anyway, with no backup and a dead unit.
  Sean's go-ahead is taken as the approval CLAUDE.md requires for using jl-uboot-tool's RAM loader.
- VERIFIED from FM-1 Transporter (`docs/PROTOCOL.md`, `src/jieli_uboot.c`, hardware-verified by its author):
  the full protocol. ROM `UBOOT1.00`: WRITE_MEMORY `FB06`, JUMP `FB08`. Upload `wl82loader.bin` (24,064 B,
  already ciphered, sent raw in 512 B blocks) to `0x1C02000`, `JUMP(0x1C02000, 1)`. Loader: READ_KEY `FC09`
  (expect `0x980F`), GET_ONLINE_DEVICE `FC0A` (type 3, id `0x856014`), GET_USB_BUFF_SIZE `FC14`, READ_FLASH
  `FD05`, ERASE_SECTOR `FB01`, WRITE_FLASH `FB04`, RUN_APP `FC0C`. The ROM waits indefinitely while idle; the
  loader resets the chip ~3 s after the last command and the firmware boots. The author's first Mac flow
  used pyusb, so a Mac host is known to be possible.
- Installed on the Mac: Homebrew `libusb` 1.0.30; `tools/venv` (Python venv, not in git) with `pyusb` 1.3.1
  and `crcmod` (test cross-check only).
- New: `tools/fm1boot.py` (`selftest`, `probe`, `info`, `dump`). READ-ONLY: it holds an allow-list of six
  commands (RAM loader upload, jump, three queries, flash read) and refuses any other opcode; no erase or
  flash-write opcode is in the file. `dump` reads the 1 MiB twice, requires the reads to be identical, saves
  to `backups/` (not in git) with a SHA-256, and logs to `backups/fm1boot.log`.
- VERIFIED on the Mac: `selftest` passes (CRC and cipher equal jl-uboot-tool's own code; a simulated FM-1
  that asserts on any unexpected command; wrong chip key / flash id stop before any read; one flipped bit in
  the second read is refused). The libusb calls for finding a device, walking descriptors and asking about
  macOS's driver work without root (tried on the FM-1 as it runs Felucca: it is `1209:0001` "Felucca", with
  audio, MIDI and a CDC serial interface).
- NOT VERIFIED (needs the FM-1 in boot mode): taking the device over from macOS's mass-storage driver (needs
  root; libusb re-enumerates the device to do it, and the ROM's reaction is unknown), and every bulk
  transfer. A failure there leaves the FM-1 in boot mode; switching it off and on returns it to Felucca.
- Residual risk the tool does not cover: a firmware that dies before its own boot guard runs never reaches
  boot mode by itself; only the Transporter's power-on key (XIAO hardware) gets in then.

## 2026-10-09 14:19 — First full flash backup, taken from the Mac over the ordinary USB cable (VERIFIED on the device)

- Sean held OCT- + OCT+ on Felucca 1.5 → boot mode. The Mac saw `4C4A:8057` "WL80UBOOT1.00", one
  mass-storage interface (class 08/06/50), bulk IN `81`, bulk OUT `01`, macOS's driver attached.
- `sudo tools/venv/bin/python tools/fm1boot.py dump` worked first time: libusb took the device over (as root;
  the ROM survived the re-enumeration), INQUIRY "WL82" / "UBOOT1.00" / "1.00" (first attempt timed out, second
  answered), loader uploaded and running, loader USB buffer 32768 B, chip key `980F`, device type 3, flash id
  `856014`, two reads of 1 MiB identical (1.7 s each).
  File: `backups/fm1-flash-20261009-141944.bin`, SHA-256
  `46955e8d086d1d595df474e0fe0e36bce272b07793ee456014b4070a313e655a`.
- macOS asked twice: "allow accessory to connect" when the FM-1 entered boot mode, and "iTerm would like to
  access files on a removable volume" while libusb took the device over (the call blocked ~5 min on it).
  Both must be allowed. macOS did not mount anything and showed no "unreadable disk" dialog.
- After the tool finished the FM-1 restarted into Felucca by itself (seen on USB as `1209:0001` "Felucca").
- `tools/check_dump.py` (new; Mac only) on the backup: flash header and all four head entries checksum; chip
  key stored in the image is `980F`; app-area head, app-area data, `app.bin` (491,692 B used of 581,564,
  identity `FM-1_915` = Felucca 1.5) and `cfg_tool.bin` all checksum; no update record pending. The head
  `[0, 0x4000)` is byte-identical to the head inside M-VAVE's official V15 package.
- Flash use on this unit now: `0x93000–0xE5000` entirely blank (gap, Felucca's store, update staging);
  `0xE5000–0xE7000` Felucca autosave; `0xE8000–0xFC000` holds data in 19 of 20 sectors, with DX7-style voice
  names ("PIANO 1", "ORGAN 1", "SYN LEAD 1" …): the stock firmware's preset store. Felucca never writes
  there and neither do our packages (`doom_full` writes `[0x93000, 0xE0000)`), so the earlier warning that
  presets would be lost was too pessimistic: they are still on the device (ASSUMED to be what stock / Baud
  Girl will read back) and in this backup.
- Reminder from the boot-flow notes: after a power cycle the SPL looks for an update record at every
  "4 KB boundary minus 256" between `0x93000` and `0xFC000`. Any test write in that range must leave the last
  256 bytes of its sector blank.

## 2026-10-09 — Write side of the boot-mode tooling (built, NOT yet run on the device)

- New: `tools/fm1restore.py` (`selftest`, `compare`, `sectortest`, `restore`). The only flash-changing commands
  in it are ERASE_SECTOR `FB01` and WRITE_FLASH `FB04` (512 B), as FM-1 Transporter uses them. Built-in rules:
  nothing below `0x4000` ever; whole 4 KB sectors only; only sectors that differ; each read back, three tries;
  the backup must pass `check_dump.py` and its first `0x4000` bytes must equal the device's; `restore` without
  `--write` is a dry run; default window is the app area `[0x4000, 0x93000)`, `--all` extends to the end.
  When the directory sector `0x4000` differs it is erased first and programmed last. Ctrl-C is ignored while
  sectors are being written; if sectors still differ the tool keeps the loader alive and offers a retry.
- `sectortest [BACKUP]`: on a sector in the gap `[0x93000, 0x97000)` (default `0x95000`) that must be blank:
  erase → blank? → program a pattern (last 256 bytes left blank, because the SPL looks for update records at
  "4 KB − 256") → reads back? → erase → blank? → neighbours unchanged? → with a backup: full read, every
  sector outside Felucca's own save areas (`0xE5000–0xE8000`, `0xFC000–0x100000`) must equal the backup.
- VERIFIED on the Mac: `fm1restore.py selftest`, 45 checks against a simulated NOR flash (bits only clear on
  program; asserts on any erase/program below `0x4000` or without a prior erase): the sector test, refusals
  outside the gap, the dry run, app-area and full restores, a bad program retried, a sector that never
  erases reported, a foreign head refused, a USB failure reported. The real backup loads as a sound image.
- VERIFIED in Felucca's `fm1_flash.h`: its flash driver erases and programs with plain WREN / `0x20` / `0x02`
  and never touches the status register, and its loader wrote the app area on this unit today. So no
  block-protection is in play; a write test in the gap exercises the same commands a restore would use.
- Decision: no full "rehearsal restore" before `doom_code`. It would run the one risky operation (rewriting
  the whole app area from the Mac) for certain, to protect against needing it with maybe 30–40 %
  probability. The blank-sector test proves the command path without putting anything bootable at risk.
- Process note: I do not run write-capable device commands myself; Sean runs them after seeing the command.

## 2026-10-09 ~14:30 — Write direction proven on the device; firmware hardened; independent review

- VERIFIED on the device: `sudo tools/venv/bin/python tools/fm1restore.py sectortest backups/fm1-flash-20261009-141944.bin`
  (run by Sean): sector `0x95000` erased, programmed with the test pattern, read back, erased, blank again;
  neighbours unchanged; full read afterwards has the same SHA-256 as the backup (`46955e8d…`). The takeover
  from macOS's driver took 1.5 s this time (the 5 min before was the permission prompt). So: full backup +
  a tested way to erase/program/verify from the Mac in boot mode. The brief's precondition is met as far as
  a host tool can meet it.

### Safe mode no longer trusts itself (firmware/doom_dev.c)
- A host counts as "heard" only when it completes the update handshake (`ota_take` → identity reply) or
  sends the upgrade command. Until then, in safe mode: a reset counts as a failed start however long the
  start lasted (three → boot ROM); after `DEV_DEADMAN_MS` = 180 s it enters the boot ROM by itself; a bar
  along the bottom of the screen shows the time left and turns green once a host was heard.
- The watchdog is fed only while the millisecond tick advances (also inside update sessions).

### Independent review of the recovery core (a separate agent, read-only, given code and not conclusions)
No blocker. Three risks, all fixed and confirmed in the new disassembly:
1. **USB-MIDI receive would have gone deaf after ~41 ordinary MIDI messages.** `usb.c` refuses EP1 OUT
   packets when its MIDI-in ring is nearly full; Felucca's audio interrupt empties that ring, ours never did.
   Any host sending notes or MIDI clock to the port would have blocked the update SysEx until a reset.
   Fix: the tick interrupt empties the ring after every USB poll (`mi_r = mi_w`).
2. **"PLAY held 2 s" could loop for ever** if PLAY read as stuck down (it cleared the failure count and
   rebooted before any safety net). Fix: only on the amber screen, and only after PLAY was seen released.
3. **`fm1_ms` could start anywhere in 0–179 s** if TIMER4 is left running across the loader's reset (the first
   tick added the whole count), so the 180 s timeout could have fired after ~1 s. Fix: the tick's reference
   is taken when the tick starts, and the timeout is measured from entering safe mode.
- Confirmed consistent with Felucca by the review: `_start` at `0x02000120`, first in the image; `crt0`
  identical apart from the two stack values; the top of `fm1_cstart` (TIMER4, reset reason, watchdog, boot
  guard) matches Felucca's instruction for instruction; initialisation order; guard ranges; section sizes and
  alignment (`.bigbss` has 700 B spare); `.ram_text` byte-identical to Felucca's; all 128 vectors point at
  fatal stubs and only TIMER5 is enabled in safe mode; the MIDI-only USB descriptors are the ones Felucca's
  loader uses; the update hooks and `ota_commit` match Felucca's step for step.
- Not verifiable from files (ASSUMED): whether the chip's guard registers and TIMER4 survive a reset; the
  SPL's behaviour with an application it cannot start; Felucca 1.5's `.noinit` layout (ours has the boot
  guard at `0x01C7C040`; a stale value there shows amber instead of blue at worst).
- Reading note: in this toolchain's objdump output, an instruction marked `#` and the indented one after it
  execute in the opposite order (indented first).

### Current build (supersedes every earlier core id / hash in this file)
- Recovery core id `e58934d4e5968ae4`; firmware 263,624 B; block 1 has 28 B spare in the app slot.
- `firmware/build/doom_code.fwsc`: 610,086 B, SHA-256
  `35ccf39bc93b12d1c5904bf61c42c42346cfb66e5c2cb9341949bdc34620a59f`. All 15 package tests pass; Felucca 1.5's
  own update test accepts all three packages.
- VERIFIED on the Mac: the flash as it would be after installing `doom_code` (the backup with the app area
  replaced by the package's) passes every `check_dump.py` check with the chip key from the device's own image:
  app-area head, app-area data, `app.bin` (263,624 B used, identity `FM-1_900`), `cfg_tool.bin`. The install
  would change 121 of 143 app-area sectors.
- Installer page regenerated: `firmware/build/site_code` (package inside byte-identical). Not served yet.

### If `doom_code` does not come up (procedure agreed in advance)
1. Do not switch off. Leave it connected for 4 minutes: crashes are counted (three → boot ROM) and safe mode
   gives up after 180 s without a host.
2. Check the Mac for `4C4A:8057` (`tools/venv/bin/python tools/fm1boot.py probe`).
3. In boot mode: `sudo tools/venv/bin/python tools/fm1restore.py restore backups/fm1-flash-20261009-141944.bin --write`
   puts Felucca 1.5 back (Sean runs it, after a yes).
4. If it never reaches boot mode: only the Transporter's power-on key (XIAO RP2040) gets in.

## 2026-10-09 ~15:15 — FIRST RUN OF OUR FIRMWARE ON THE FM-1: `doom_code` installed and running (VERIFIED on the device)

- Sean approved ("Yeah let's do it"), opened `http://localhost:8792/` (Felucca's installer page generated by
  `make_site.py`, serving `doom_code.fwsc` SHA-256 `35ccf39b…a59f`, core id `e58934d4e5968ae4`) and pressed
  Install with Felucca 1.5 running. The page finished; the FM-1 shows the blue screen with the white square
  top-left (no game data) and the bar along the bottom is green.
- What that proves on hardware: Felucca 1.5's update entry accepted our package and its loader wrote it; the
  SPL starts our image; `crt0` → `fm1_cstart` with our memory map; watchdog, guards, flash probe, LCD, key
  scan start-up; the 10 kHz tick; USB enumeration; USB-MIDI receive and transmit; the update handshake
  (green bar = `dev_host_seen`, and the page only says Done after the identity `FM-1_900` comes back).
- VERIFIED from the Mac (descriptors only): the FM-1 is `1209:0001`, release 3.00, "Hügelton Instruments" /
  "Felucca", two interfaces (audio control + MIDI streaming, bulk `01`/`81`): the MIDI-only layout of our
  build, not Felucca 1.5's five interfaces.
- NOT yet proven on hardware: our own update entry (flash writes from our firmware, hand-over to the loader);
  the key chords and HOME-at-power-on; the 180 s timeout into the boot ROM; anything in game mode.

## 2026-10-09 ~15:25 — The ways out of our firmware, all VERIFIED on the device (no writes)

- HOME held at power-on → cyan screen (safe mode by key). Key scanning before interrupts works.
- Normal power-on, no host talking → blue screen, white bar shrinking.
- OCT- + OCT+ held 5 s → dark; `sudo tools/venv/bin/python tools/fm1boot.py dump` then read the flash twice
  (INQUIRY answered at the first attempt this time): `backups/fm1-flash-20261009-151030.bin`, SHA-256
  `4cec8500a40da658053bd3515826378d5c4f6729919cf25aa207fd22f2a6b9a1`. The FM-1 restarted into our firmware.
- That dump is **bit-for-bit the image predicted before the install** (the Felucca backup with the app area
  replaced by `doom_code`'s): 121 app-area sectors changed, nothing else anywhere. So Felucca's loader wrote
  exactly the package and our firmware has written nothing to flash by itself.
- Left alone for 3 minutes → the bar ran out and the screen went dark; from the Mac: `4C4A:8057`
  "WL80UBOOT1.00". The timeout into the boot ROM works.

## Plan change: the loader variant will NOT be used on this unit
- `doom_full.fwsc` carries a loader I modified (it also writes `[0x93000, 0xE0000)`). It has passed host
  tests only. A loader that fails on hardware is the worst place to fail: the SPL would run it at every
  start (the update record stays), our firmware would never run, and nothing could reach the boot ROM.
- Instead: install `doom_part1.fwsc` (same app area as `doom_full`, VERIFIED equal; Felucca's unmodified
  loader), then write data block 2 at `0x93000` from the Mac in boot mode with the sector commands already
  proven on this unit in that very region. The firmware checks block 2's checksum at every start, so a bad
  or partial write only means safe mode (blue, two corners).
- Next install: `doom_part1.fwsc`, 610,086 B, SHA-256
  `3b4013ca55604873f575bcab99d52bfb84b189db4fa4a06509b8b67fd74438c3`, page in `firmware/build/site_part1`
  (preview entry `fm1-install-part1`, port 8793; a new port so Chrome cannot show a cached page). Predicted
  change: 80 app-area sectors (`0x4000` and `0x44000–0x92000`); the predicted image passes `check_dump.py`.
  This is the first use of OUR update entry (flash writes from our firmware, hand-over to the loader).

## 2026-10-09 ~15:40 — `doom_part1` installed through OUR update entry (VERIFIED on the device)

- Sean approved, opened `http://localhost:8793/` and pressed Install on the blue screen. The page finished;
  the FM-1 shows blue with two white squares and a green bar (`SAFE_PART2`).
- Proves on hardware: our firmware's update entry (session over USB-MIDI, erase/program of the staging area
  from our firmware with Felucca's RAM flash driver, the update record, the hand-over through the SPL to
  Felucca's loader); the loader rewriting the app area under our firmware; the descriptor and data block 1
  read back through the encrypted XIP mapping with a correct checksum (317,824 B).
- So firmware updates from our firmware over the web installer are a proven path from now on.

### Block 2 goes on from the Mac (tool ready, not yet run)
- `tools/fm1restore.py data PACKAGE.fwsc [--write]`: writes only `[0x93000, 0xE0000)` from the flash image
  inside a package, and refuses unless the app area on the FM-1 already equals the package's (so data and
  firmware cannot be mismatched). Same sector commands and rules as `restore`; afterwards a full read must
  show the region equal and every other sector unchanged. Self-test now 51 checks, all pass.
- Source of the data: `firmware/build/doom_full.fwsc` (925,589 B, SHA-256 below); only its flash image's
  data region is used, its modified loader is never sent anywhere. 71 sectors, `0x93000–0xD9FFF`.
- VERIFIED on the Mac, on the predicted final flash: the firmware's own start-up check replayed in Python
  passes (descriptor checksum; block 1 "IWHX" + checksum; block 2 range + checksum; block 1 + block 2 equal
  `data/e1m1_6h.whx` byte for byte). None of the 105 update-record positions between `0x93000` and `0xFC000`
  has a matching checksum field or any of the record's marker words.
- Decision: write block 2 for the installed build now and see the game run; the next firmware iteration will
  pin the split point (so later firmware updates do not need block 2 rewritten) and read the volume knob.
  Until then the output level is fixed at what Felucca calls full volume.
- `doom_full.fwsc` SHA-256: `8838842ad73243136f521078d59efe6b4a021a268491f4c8a9bc75d49dcd23d7`

## 2026-10-09 ~15:55 — FIRST RUN OF THE GAME ON THE FM-1 (VERIFIED on the device, by Sean's report)

- Sean ran `sudo tools/venv/bin/python tools/fm1restore.py data firmware/build/doom_full.fwsc --write` from
  boot mode; the FM-1 restarted into game mode.
- Seen: the DOOM title screen; an "intro sound" played; pressing keys produces sound effects.
- So on hardware: both data blocks pass their checksums; the engine initialises (zone heap, WHX data from both
  blocks, OPL / sound); the title picture goes through the whole video path (8-bit frame → RGB565 → squeeze →
  LCD strips by DMA); audio comes out of the codec; the key matrix reaches the game.
- PROBLEM: the picture does not change after the title appears, although key presses produce menu sounds.
  Unknown yet whether the picture is frozen (game running blind) or only the menu overlay is missing.
  The present path and the main loop are the same code as the browser build, which shows the menu.

## 2026-10-09 ~16:10 — Game-mode symptoms and a zero-flash way to look inside (tool ready, not yet run)

- Sean's test at the title: first PLAY no sound; second PLAY a gunshot (menu select); third PLAY a gunshot cut
  short by a red screen (CPU fault / guard) and a restart. The picture never changes, whatever is pressed.
  So two separate problems: (1) nothing reaches the screen after the title; (2) starting E1M1 crashes.
- The crash record (`fm1_crash`, `.noinit`, survives resets) holds pc / rets / sp of the fault, and
  `fm1_enter_uboot()` reaches the boot ROM by a chip reset that leaves RAM alone. The boot ROM can read RAM
  (READ_MEMORY `FD07`, ciphered per 512 B transfer; from the Transporter's protocol notes).
- New, read-only: `tools/fm1boot.py ramdump` reads `0x01C00000–0x01C80000` in the ROM stage (before the RAM
  loader is uploaded, which would overwrite part of it), saves `backups/fm1-ram-<time>.bin`, then starts the
  loader so the FM-1 restarts. Self-test extended (simulated RAM round trip; refused once the loader runs).
- New, Mac only: `tools/ramlook.py RAM.bin [BUILD_DIR]` reads a snapshot with the symbols of the installed
  build: boot guard, crash record with function names, game / video state (`fm1_frames`, `gamestate`,
  `menuactive`, video types, the two frame semaphores …), and writes the two 8-bit frame buffers (through
  the palette in RAM) and the LCD strip buffers as PNG files. Tried on a synthetic image.
- The installed build's ELF, symbols, map, disassembly and binaries are kept in
  `firmware/installed_e58934d4/` (not in git) so later rebuilds cannot lose them.
- ASSUMED until seen: that the ROM answers READ_MEMORY for the whole RAM range and that the game's RAM is
  still there after the reset into the ROM (the ROM uses some RAM of its own).
- 2026-10-09 ~16:20, first `ramdump` on the device: the chord from game mode turned the screen dark (so the
  LCD still takes new pictures while the title is "frozen": the game is not presenting, the panel is fine).
  The RAM read itself STOPPED 0.65 s after INQUIRY with an I/O error, and the FM-1 was then found running
  our firmware again (`1209:0001`): the chip reset while the boot ROM was answering READ_MEMORY. Unknown
  whether a particular address or the time spent does it; the first version read bottom-to-top, logged no
  addresses and kept nothing. Fixed: `ramdump` now reads the most useful ranges first (`.noinit`, `.data/.bss`,
  video state, frame buffers, heap, the rest), logs every block with its time to `backups/fm1boot.log`, and
  saves whatever was read plus a `.ranges` file; `ramlook.py` honours it.

## 2026-10-09 ~16:30 — ROOT CAUSE of the frozen picture and the level-start crash: stale objects (my build scripts)

- VERIFIED from the RAM snapshot (`backups/fm1-ram-20261009-154945.bin`, read with `tools/ramlook.py`):
  - the second `ramdump` read 471,552 of 524,288 B and then failed at `0x01C01000`, the first stack guard
    band: reading a guard band through the boot ROM resets the chip (our guard registers evidently survive
    the reset into the ROM). Everything except `0x01C01000–0x01C0A000` and the top was read.
  - at the "frozen" title: `fm1_frames` = 5433 in 287 s (≈19 presents per second), `menuactive` = 1, video
    type SINGLE, both overlay lists hold 4 well-formed menu entries, palettes fine; the two frame buffers hold
    exactly the title picture. So the game ran and presented; only the overlay graphics drew nothing.
  - crash record: bus-invalid access (`dbg` bit 20) at `draw_regular_columns`, uptime 61 s.
  - `whd_vpatch_numbers` = `0x020AB4AC` = block-1 base + file offset `0x6AD6C`, i.e. the address of lump
    526 (`P_START`, in block 2) computed WITHOUT the two-block translation; `stbar` pointed outside the flash.
- CAUSE: `firmware/build_in.sh` and `web/build.sh` recompiled a source only when that source was newer than
  its object, with no regard for headers. The two-block `lump_data()` lives in `w_wad.h` (changed 12:55);
  102 of 111 engine objects were older. The installed build references `whd_split` in 4 places; a full
  rebuild references it in 48. Block-2 lumps read from stale objects came from 3,904 bytes too low.
- CONSEQUENCE for earlier entries in this file: every "VERIFIED" statement about the GAME made between the
  two-block change (2026-10-09 morning) and now was made on partly stale builds, including "the browser build
  stores the two blocks far apart … same result" (the headless test checks game logic, not pictures). The
  recovery core was not affected: `doom_dev.c`, `crt0`, vectors and interrupt stubs are compiled on every
  build, and its id is unchanged by the full rebuild (`e58934d4e5968ae4`).
- FIX: both scripts now recompile everything whenever any header, the define list, the linker script or the
  script itself is newer than the last complete build.
- VERIFIED after a full rebuild of the browser build: headless test unchanged (awake 2, health 25 at t=13);
  in the browser: title, then the menu drawn over it ("New Game", "Options"), then E1M1 with the status bar.
- Full firmware rebuild: `.text` 0x3F2E4 (+1.4 KB), other sections unchanged, 0 stale objects.

### Split point no longer depends on the firmware (firmware/pack.py)
- The split is now the first lump boundary at which block 2 fits `[0x93000, 0xE0000)`: 294,980. Block 2 is
  312,348 B (3,044 B spare) and depends on the data file alone; block 1 is 294,980 B and the app slot has
  21,208 B spare for firmware growth. Later firmware updates over USB will not need block 2 rewritten.
- Build to install next (NOT installed yet): firmware 265,288 B; `doom_part1.fwsc` SHA-256
  `f82c2608a45307bd09064b6c1379be26baf689c10525c87f651863905978524f`; `doom_full.fwsc` (source of block 2
  only) SHA-256 `365e7e0b6816f1540cfd73c5c73206d591b5cf213d0e55a5823f5f2b914659ce`. All 15 package tests and
  Felucca 1.5's update test pass. Predicted flash after both steps passes `check_dump.py` and the replayed
  start-up check; no update-record lookalikes. After the USB install alone, block 2's checksum fails (old
  block 2 in place), so the FM-1 will show the two-square blue screen until the data write.
- Symbols of this build: `firmware/installed_f82c2608/`. Installer page: `firmware/build/site_b2`, preview
  entry `fm1-install-b2`, port 8794.

## 2026-10-09 ~16:55 — DOOM E1M1 RUNS ON THE FM-1 (VERIFIED on the device, by Sean's report)

- Sean installed the fully rebuilt `doom_part1.fwsc` (`f82c2608…`) from `http://localhost:8794/` in safe mode,
  then wrote block 2 from boot mode with `fm1restore.py data firmware/build/doom_full.fwsc --write`.
  Report: "Incredible! It looks like it works. We probably have some tweaking to do with the controls".
- So the stale-object diagnosis was right, and on hardware now: title, menu, level load, rendering, sound,
  keys. MVP reached in substance; controls need tuning; frame rate, sound quality and the volume knob are
  not yet characterised (the knob is not read: output is at Felucca's full level).
- Open design question from Sean: a hosted one-button web install for other people, without the boot-mode
  shell step. Constraints: a browser has Web MIDI only (WebUSB refuses mass-storage interfaces, so boot mode
  is out of reach of a page); Felucca's unmodified loader writes only the app area. Options: (1) our safe
  mode receives block 2 over the update protocol's own SysEx transport and writes `[0x93000, 0xE0000)` itself,
  driven by the same installer page as a second phase; (2) the modified loader (rejected for this unit: a
  loader that fails cannot be recovered without the power-on key); (3) fit everything in the app slot (not
  possible: 316 KB for 607 KB of data). Recommended: (1).
- To settle before publishing anything: the game data is a cut-down, converted copy of the shareware
  `doom1.wad`, and the shareware licence allows redistribution only unmodified (ASSUMED from the licence's
  usual wording; not checked by a lawyer). A public page should build the data in the browser from the WAD
  the visitor supplies, or the question must be answered first. Also: block 2 overwrites Felucca's store
  (`0x97000–0xE0000`), so Felucca users lose saved projects and samples; only one unit has been tested.

## 2026-10-09 — Filling the square screen (question from Sean; nothing built yet)

- Now: 320x200 is shown as 240x150 (x0.75 both ways, square pixels), 45 black rows above and below.
- The screen link is the frame-rate ceiling for a static picture: 240 x 150 x 16 bits at 12 MHz = 48 ms per
  frame = 20.8 fps, and the snapshot at the title measured 18.9 fps (5433 presents in 287 s). In-level frame
  rate has not been measured. 240x240 at 12 MHz would be 77 ms = 13 fps at best; at 24 MHz, 38 ms.
  Felucca's `LCD_BAUD` 4 = 12 MHz; a faster setting is ASSUMED to work (ST7789, short traces), untested.
- Options: (a) stretch 200 rows to 240 (cheap; everything 1.6x taller relative to its width than now, 1.33x
  versus the 4:3 look Doom was drawn for); (b) 240x180, the 4:3 look, 75 % of the screen; (c) uniform x1.2 and
  crop to the middle 62.5 % of the width (right proportions, loses side view, status bar needs its own
  treatment); (d) anamorphic rendering: change the renderer's vertical scale so the 320x168 view holds a
  taller field, then stretch on output (right proportions, full screen, no extra RAM, but surgery in
  `pd_render.cpp`); (e) a natively taller view (about +77 KB of frame buffers: not affordable).
- Proposal: raise the LCD clock first, then make (a)/(b)/current switchable with a button to judge on the
  device; consider (d) only if the stretch looks wrong.

## 2026-10-09 ~17:30 — Picture shapes, screen link speed, frame-rate readout, 5 % volume (built; NOT installed yet)

- `rp2040-doom/src/fm1/fm1_video.c`: the 200 source lines become 150, 180 or 240 panel rows, centred, by a
  line accumulator (3 of 4 kept / 9 of 10 kept / every fifth doubled); the rows outside the picture are
  blacked once when the shape changes. **SCL** steps through the shapes.
- `firmware/doom_dev.c`: **LFO** steps the screen link clock through divisors 4, 2, 1, 0 of Felucca's `lsb`
  clock, reported as 12 / 20 / 30 / 60 MHz (ASSUMED: derived from Felucca's "4 = 12 MHz"; the frame rate will
  show the truth). The change waits for the transfer in flight. Every screen the device code draws itself
  (safe mode, update progress, crash colours, the dark screen before boot mode) first goes back to
  Felucca's rate, so a setting that garbles the game picture cannot hide those. Not remembered across a
  restart: each start begins at 12 MHz and 240x150.
- **ENV** shows frames presented per second over the last second. All three buttons answer on the game's
  own message line, so only while a level is up.
- Volume: `DEV_VOLUME_PCT 5` (linear, of Felucca's full level) in the audio interrupt; the knob is still unread.
- VERIFIED in the browser build (full rebuild; `node web/test_view.js DIR`, new): picture rows 45..194 (150),
  30..209 (180), 0..239 (240), back to 45..194 with the bands black again; the three message lines appear;
  gameplay test unchanged (health 25 at t=13). The link-speed code is device-only and has not run anywhere.
- Firmware 265,956 B, recovery core id `1fb71fa131d2c49f` (changed: `dev_screen`, the audio gain line, the new
  link function). `doom_part1.fwsc` SHA-256 `65dd0d0928c9c6de67afb3815082cfaa66acbbe37bea72cf086d5f7d108ef585`.
  Split still 294,980 and the data region equals what is on the FM-1, so this is a USB install only (138 of
  143 app sectors change); the predicted image passes `check_dump.py` and the replayed start-up check.
  Symbols: `firmware/installed_65dd0d09/`. Page: `firmware/build/site_b3`, preview `fm1-install-b3`, port 8795.

## 2026-10-09 ~18:30 — One-button browser install: built and tested on the Mac, NOT yet run on the device

- Why not boot mode from a page: browsers offer Web MIDI only; Chrome's WebUSB refuses mass-storage
  interfaces (ASSUMED from Chrome's protected-class list; not tried).
- Design: phase 1 is the standard update (Felucca's unmodified loader writes firmware + data block 1). Phase 2
  is new: the page sends cmd `0x44` (length, CRC-16 and flags of the block 2 it holds) in the update
  protocol's own frame format; our firmware answers `0x44` with a code (0 = send it, 1 = nothing to do, the
  game runs, 2 = not this firmware's data, 3 = wrong flash part) plus mode and the descriptor's total / split
  / CRC / build; on 0 it fetches the block with the protocol's ordinary read requests (offsets in the block,
  512 B each, then the "success" exchange at `0xF0000000`), which the page serves with Felucca's own
  `Updater.serve()`. Flags: bit 0 rewrite even if equal (test), bit 1 answer only.
- Firmware: `firmware/dev_data.h` (sector by sector: fetch, compare with flash, erase + program + read back
  only if different, three tries; only `[0x93000, 0xE0000)`), hooked into safe mode in `doom_dev.c`
  (`dev_data_request`). Work buffers: the first 8 KB of the game's heap, free in safe mode. A good write
  restarts; the start-up check then decides. Never in game mode.
- The RAM flash driver's own window is now `FL_RANGE_OK = [0x93000, 0xE5000)` (data block 2 + update
  staging). VERIFIED in the disassembly of `fl_erase4k_ram` and `fl_prog_ram`: `off - 0x93000 > 0x52000` → refuse.
  The driver cannot touch the app area, Felucca's settings or autosave sectors, whatever calls it. Its code
  is therefore no longer byte-identical to Felucca's (2,784 B vs 2,924 B).
- Identity: our firmware now reports `FM-1_666` (was Felucca's development identity `FM-1_900`), so a page
  can recognise it before sending `0x44`; nothing else is ever sent the new command. The descriptor carries
  a 32-bit build id (first 4 bytes of the image's SHA-256, `rsv[0]`), reported in the `0x44` answer, so the
  page skips phase 1 when the same build is already installed.
- Page: `web/installer.html` + `web/make_installer.py VERSION OUT_DIR` (inlines Felucca's `fm1pkg.js` and
  `fm1ota.js`, GPL-3.0-only; copies `doom_part1.fwsc` and `doom_data2.bin`). `?force=1` = rewrite the data even
  if it matches (needs the safe screen). `pack.py` now also writes `doom_data2.bin` and `doom_install.json`.
- VERIFIED on the Mac: `firmware/tests/data_test.c` (19 checks on a simulated NOR flash and host: write,
  no-op when equal, force, one wrong sector, bad program retried, program that never works, sector that will
  not erase, host stopping, host not confirming, short block, exactly full region, five refusals with nothing
  touched), now part of `firmware/test.sh` (16 runs pass). `node web/test_installer.js SITE` runs the real page
  script against a model of the firmware's side: block sent and game starts; nothing to do when the game
  runs; test mode sets the rewrite flag; test mode in game mode asks for the safe screen; a firmware that
  stops asking is reported. The page's frame builder reproduces Felucca's handshake query byte for byte. The
  page loads in the browser pane ("Ready.", no console errors); Install was not pressed.
- NOT verified: the real protocol end to end (my model of the firmware and the firmware share an author),
  flash writes to the data region from our own firmware, phase 1 from stock or Felucca with this package.
- Build: firmware 266,696 B, recovery core id `9023e355ec4cc30f`, build id `036845b8`; `doom_part1.fwsc` SHA-256
  `1aa8108500b51a8ec66323059dab5ab895e04b63eee6cf2c75715cdc8098ce7e`; `doom_data2.bin` SHA-256
  `e4dcdbba8ca82687864b562c70bd6da8dae8b0db0066b1332b5b7602fce0858f` (equal to what is on the FM-1). Includes
  the screen / volume features of the previous build. Symbols: `firmware/installed_1aa81085/`. Site:
  `firmware/build/site_one`, preview `fm1-install-one`, port 8796 (stopped).

## 2026-10-09 ~19:00 — Results from the device (build "b3") and what changed because of them

- VERIFIED on the device (Sean): the fastest screen link step ("60 MHz") gives a clean picture and the game is
  "super smooth"; the 240x180 shape is fine but he prefers the whole screen. No frame-rate figures given.
  5 % volume: no comment yet.
- So: the game picture now starts on the whole panel (`fm1_view = 2`) and goes out at the fastest link step
  (`dev_lcd_game = 3`). SCL and LFO still step through the others. `fm1_lcd_blit` puts the game's rate back
  whenever one of the device code's own screens (always drawn at Felucca's rate) came in between.
- Installer page reworked at Sean's request (no log scrolling down the page): four stages with a mark each
  (find the FM-1, install the firmware, send the game data, start Doom), one bar with a percentage, one
  status line; the raw log holds only state changes (4–11 lines in the tests) and sits in a closed "Details".
  Looked at in the browser pane in its idle, working, failed and done states; `web/test_installer.js` now also
  checks the stage marks and the bar.
- Build "b5" (NOT installed yet): firmware 266,808 B, recovery core id `97147e870713a75f`, build id `9a3465a8`;
  `doom_part1.fwsc` SHA-256 `adf49dabbed0b7bbd56e237b98f40da83a02646abb24f84ebdeeaeba37e30837`; data block 2
  unchanged (`e4dcdbba…`, equal to the FM-1's). 16 package runs + Felucca 1.5's update test + the page test
  pass; the predicted flash passes `check_dump.py` and the replayed start-up check. Symbols:
  `firmware/installed_adf49dab/`. Site: `firmware/build/site_one` (port 8796).

## 2026-10-09 ~19:45 — A hosted installer with no game data in it: the page converts the visitor's own WAD (built and Mac-tested; nothing new on the device)

Sean's question: could the public page install Freedoom by default and offer "bring your own Doom WAD"?
Short answer: bring-your-own works and is built; Freedoom's levels do not fit.

### Freedoom does not fit (VERIFIED: every Phase 1 level cut and converted)
- Downloaded with Sean's yes: `freedoom-0.13.0.zip` (24,143,781 B) from the project's GitHub releases into `wads/`.
  SHA-256 `3f9b264f…9688f59` equals the project's CHECKSUM file (its PGP signature was not checked).
- Three things stop the converter before size is even a question:
  1. `whd_gen` crashed on a one-colour flat (`__builtin_clz(0)` in its statistics). Fixed on `fm1-port`.
  2. Freedoom's music lumps are MIDI; `whd_gen` reads MUS only ("Expected MUS track").
  3. The WHX format's level encodings are tuned to id's own maps: a line's back sidedef must directly follow its
     front one, the packed sidedefs must be shorter than the packed linedefs, a sidedef at most 7 bytes, fewer
     than 2,048 vertices, sector numbers and tags in a byte. Freedoom's levels break these as shipped.
- `tools/freedoom_survey.py` works around what can be worked around (sidedefs put in linedef order, texture
  offsets reduced to x mod 256 / y mod 128 and made even, lumps the converter ignores dropped, sounds at
  5.5 kHz, stand-in music) and converts each level with an assertion-enabled `whd_gen`:
  **19 of 36 levels convert; the smallest is E2M8 at 781,640 B (an arena with two bosses), then E3M1 964,440 B,
  E2M2 1,031,468 B, E1M5 1,034,092 B … E4M8 1,851,640 B. The other 17 hit hard limits of the format.**
- Room for data with the b5 firmware: **630,044 B** (314,652 B behind the firmware in the app slot + 315,392 B
  at `0x93000`). Doom's E1M1 cut is 607,328 B.
- Where Freedoom's bytes go (E3M1): walls 201 KB (59 patches at 3.4 KB each; Doom's E1M1 has 70 at 2.0 KB),
  sounds 157 KB at 5.5 kHz (Doom's set: 87 KB), monsters 88 + 69 + 45 KB, and 179 KB of status bar, fonts, menu
  art, palette and tables that any level needs. Trimming my survey's excess (a corpse decoration that pulled in
  a whole monster's sprites, multiplayer-only weapons, unused sounds) would bring E3M1 to roughly 790–870 KB:
  still far over. ASSUMED: that estimate; the survey numbers themselves are measured.
- Conclusion: no Freedoom level as shipped can be the default. A free default would have to be a level made to
  this budget from Freedoom's art (about as many textures and monster types as Doom's E1M1). Not built. The
  installer can host such data when it exists (`make_installer.py --bundle`).
- Noticed in passing (upstream rp2040-doom, not fixed): `r_state.h side_rowoffset16()` reads the size of the
  x offset from the FIRST sidedef of the level (`sides_z[0]`) and the low byte of a two-byte row offset from
  `sides_z[pos + 1]`. VERIFIED harmless for Doom's E1M1 (41 sidedefs have a row offset; none is affected); it
  would misalign wall textures on other levels.

### What was built (all VERIFIED on the Mac unless marked)
- `web/build_whdgen.sh` → `web/build/whdgen/whd_gen.{js,wasm}` (647 KB): rp2040-doom's converter for the browser,
  assertions ON (its only input checks), `-DLOOKAHEAD=5`.
  - Finding: `whd_gen`'s output depends on `NDEBUG` (`config.h`: sound encoder look-ahead 5 in a release build,
    3 otherwise). `LOOKAHEAD` can now be set from the command line (`fm1-port`), and with 5 an
    assertion-enabled build, native or WebAssembly, writes the release build's bytes.
  - The output's header carries the input's file name, so the page always names it `E1M1_6H.WAD`.
  - Result for `wads/doom1.wad`: SHA-256 `7450083e…83862d85`, byte-for-byte `data/e1m1_6h.whx`.
- `web/wadcut.js`: `tools/cut_wad.py SRC DST 6 --half-sfx` in JavaScript (byte-identical output for `doom1.wad`),
  plus what a full-game `DOOM.WAD` needs (TEXTURE2 merged, further section markers) and refusals with reasons
  (not a WAD, PWAD, Doom II layout, Freedoom, damaged). `DOOM.WAD` itself is NOT tested: no such file here.
- `web/datapack.js`: `firmware/pack.py`'s split point, descriptor, record-lookalike check and package assembly
  in JavaScript, on Felucca's `Package.setApp` (no packaging code of our own). Input: `doom_code.fwsc` (the
  firmware alone) and the numbers `pack.py` now writes into `doom_install.json` (`img_len`, `desc_at`,
  `app_slot`). For the shareware WAD the install image (SHA-256 `a5fcfee3…b6d1f6b0`) and block 2
  (`e4dcdbba…fce0858f`) are **identical to `pack.py`'s b5 files**, i.e. to what was installed from
  `site_one`.
- `web/convert.js`: the three steps in one call; recognises the shareware 1.9 WAD by SHA-256
  (`1d7d43be…26cac771`) and refuses to go on if its converted data is not the tested one.
- `web/installer.html`, reworked as the public page: step 1 "Game data" (choose or drop a WAD; result line says
  whether it is the tested data), step 2 "Install" (the b5 flow, unchanged), and sections on what changes on
  the FM-1, controls, the plain-colour screens, going back. Other Doom 1 WADs are accepted with a warning that
  the data is untested.
- `web/make_installer.py VERSION OUT_DIR [--source URL] [--wad-help URL] [--bundle "LABEL=FILE.whx[=NOTE]"]`:
  the site is `index.html`, the firmware-only package (`doom_code.fwsc`, SHA-256 `ade8f712…e3196f3f`, checked
  by the page), `whd_gen.js/.wasm` and `LICENSES/`. No game data unless `--bundle` is given.
- `web/test_installer.js SITE [WAD]`: 13 checks; the data step runs the real converter. Passes on both sites.
  In the Browser pane (Chromium): the page prepared `doom1.wad` in 1.1 s with the hashes above; file chooser
  and drop paths both work; no horizontal overflow at 375 px; light and dark.
- Sites: `firmware/build/site_public` (no game data), `firmware/build/site_dev` (the same plus a bundled copy
  of the shareware cut and `_local/` links to the WADs: PRIVATE, never publish), preview `fm1-install-site`
  on port 8797. `site_one` (port 8796, the b5 page Sean is testing) was not touched.

### Open before this page goes public
- NOT run on the device. The install flow is b5's, and what it installs is byte-identical to b5.
- The GPL needs the source address on the page (`--source`): this repository and the `fm1-port` branch of
  rp2040-doom are local only today.
- "Going back: use Felucca's installer" is ASSUMED (same protocol path our own page uses; never done from Doom).
  Installing while the game runs (not from a safe screen) is also not yet VERIFIED on the device.
- The controls section restates `fm1_controls.c` by hand; it must follow any control change.
- The "about the file" link (Doom Wiki, DOOM1.WAD) could not be checked from here: the site answers a bot check.
- A default that needs no file: Sean to choose between (a) the page fetching the unmodified shareware WAD
  from a public mirror in the visitor's browser, checked by SHA-256, (b) a made-to-fit free level, (c) as built.

## 2026-10-09 ~20:30 — The hosted site: Vite + React, AWS set-up, a designed six-step install (built and tested on the Mac; NOT deployed, NOT run against the device)

Sean's request: host the installer as a Vite + React site on AWS like `static-personal-site`, at
`doom.deadlockinteractive.com` (domain newly transferred to Route 53), with a staged install in the manner of
Baud Girl's page, "nice and Doom appropriate".

### Structure (`site/`, described in `site/README.md`)
- `site/frontend`: Vite 7 + React 19 + TypeScript, vitest. Fonts self-hosted through the build (Big Shoulders
  Display, IBM Plex Sans / Mono, all OFL): the page makes no request to any other host.
- `site/infra`: CDK copied from `static-personal-site` and adapted: `DoomSiteCertStack` (us-east-1),
  `DoomSiteFrontendStack` (us-west-2: private bucket, CloudFront with origin access control, A + AAAA alias
  records). Added: a response-headers policy (content security policy, HSTS, no framing), and no single-page
  404→index fallback (a missing firmware file must be a 404).
- `.github/workflows/deploy.yml`: on a push to `main` touching `site/` or `web/`: token check, tests, build,
  `cdk deploy` with the shared `github-actions-deploy` role.
- The firmware and the converter the site serves are **committed build outputs**, copied in by
  `site/sync_firmware.py VERSION` (firmware-only package `doom-b5.fwsc`, SHA-256 `ade8f712…`; `whd_gen_es.js/.wasm`,
  wasm SHA-256 `b625a72a…`): CI needs no firmware toolchain. `*.fwsc` stays ignored everywhere else.

### One install implementation
- `web/install.js` (new): the install flow lifted out of `web/installer.html`, with no page in it; progress goes
  out as events. Both pages use it. Also `probe()`: the identity handshake and, for our firmware, the cmd 0x44
  question with the QUERY flag: asks, never writes.
- `web/vendor/felucca/`: Felucca's `fm1pkg.js` and `fm1ota.js`, unmodified copies from v1.1.5 (the clone is not
  part of this repository). `web/datapack.js` and `convert.js` now import what they use;
  `web/make_installer.py` still inlines everything (it drops the import lines) and its 13 checks still pass.
- `web/build_whdgen.sh` also links an ES-module wrapper (`whd_gen_es.js`; the `.wasm` is byte-identical to the
  classic one). Named `.js` because static hosts do not all serve `.mjs` as JavaScript.

### The page
- Six steps: Check (browser), Game file (pick / drop a WAD; cut, converted and packed in a Web Worker), Prepare
  (checklist, a map of the FM-1's 1 MB of flash showing what is replaced and what is kept, an acknowledgement),
  Connect (asks the FM-1 what it runs; nothing written), Install, Play (controls).
- A drawing of the FM-1 (laid out from Felucca's `docs/controls.jpg`) stays in view; its screen shows what the
  real one should show at that point: the firmware's own plain-colour screens, same colours and squares and bars
  (`doom_dev.c`), dark during the firmware write, then a drawing of the game. Changes of picture use the game's
  column melt. The picture of the game is drawn for the page; nothing from the WAD is on the site.
- Install progress as four cells with numerals built from pixels; the manual section has the controls on the
  same drawing, coloured by what they do.
- During an install: a leave-page warning, a screen wake lock, and the copy says to keep the tab in front
  (Chrome slows background tabs' timers, and Felucca's update code runs on timers).
- VERIFIED from the firmware source while writing the copy: amber appears after ONE start that died within its
  first 30 s (`bootguard.failed`); three in a row drop to the boot ROM (dark).

### Checks (all on the Mac)
- `npm test` in `site/frontend`: 28 tests. The install flow against a stand-in FM-1 (`src/lib/fakeFm1.ts`) that
  models both halves: the standard update (verify reads, loader, whole-image write) and the Doom firmware
  (identity, cmd 0x44, the pull of block 2). Scenarios: from another firmware; safe mode with block 2 missing;
  already installed; an older build with the same data; test mode; a firmware that stops asking; no device;
  `probe`. The WAD pipeline with the ES-module converter: for `doom1.wad` the image and block 2 equal
  `firmware/pack.py`'s. The controls table is compared with `FM1_MAP` in `fm1_controls.c`.
- In the Browser pane: the development server with `?demo` (the stand-in device, development builds only)
  walked through all six steps, a full install, a failed run and the finished state; 1200, 820 and 375 px wide,
  no horizontal overflow. The production build under `npm run preview`, which sends the same security headers
  as CloudFront will: worker, dynamic import and WebAssembly all run under
  `script-src 'self' 'wasm-unsafe-eval'`; the WAD converts in 1.25 s; no console errors; no third-party request.
- `cdk synth` succeeds with a placeholder hosted-zone id (removed afterwards): the templates hold the bucket,
  the distribution with the alias `doom.deadlockinteractive.com`, the certificate, two record sets.
- NOT done: no AWS call (the CLI session had expired), so the hosted zone is not confirmed to exist; nothing
  deployed; no real FM-1 has met this page.

### Open before it goes live
- Hosted zone for `deadlockinteractive.com` (a transferred domain does not get one automatically); a GitHub
  repository with a `main` branch; the repository in the deploy role's trust policy (immutable subject form).
- `sourceUrl` in `site/frontend/src/site.ts` is empty: the GPL needs a public source link (this repository and
  the `fm1-port` branch of rp2040-doom).
- b5 is the build on the site and it still has the 5 % test volume; "going back through Felucca's installer"
  and an install started while the game runs are still unverified on the device.

## 2026-10-09 ~20:50 — A second level does not fit; the site fetches the shareware WAD itself (Mac only)

### Could E1M2 come along? No (VERIFIED by converting it)
Sean asked whether the second level could be included. Cut the same way as E1M1 (single-player things only, each
level's own textures, flats, sprites, sounds and music; scratch script, native `whd_gen`):

| Levels | Game data |
| --- | --- |
| E1M1 | 606,720 B |
| E1M2 alone | 769,644 B |
| E1M1 + E1M2 | 830,428 B |
| E1M1 + E1M3 | 887,344 B |
| E1M1 + E1M2 + E1M3 | 1,014,484 B |

- Room next to the b5 firmware: 630,044 B. E1M1 + E1M2 is 200 KB over, and E1M2 would not fit even by itself:
  it is twice E1M1's size as a map (1,323 sidedefs against 648, 262 things against 138) and uses 64 wall
  textures against 34.
- Even taking every byte of the chip that could be taken (the 92 KB where the original firmware's presets,
  Felucca's autosave and the settings live) gives about 722 KB: still 108 KB short, before asking whether the
  bigger level fits in 512 KB of RAM (not measured).
- Conclusion: one level, E1M1, on this chip with this engine.

### One-click game file (built, tested in a browser; not deployed)
- Sean chose the option of the page fetching the shareware WAD itself.
- Mirrors found and checked (each streamed through `shasum`, nothing saved): both serve the exact v1.9 file,
  SHA-256 `1d7d43be…26cac771`, 4,196,020 B, with cross-site access allowed.
  1. `https://cors.archive.org/cors/doom-shareware_1996/DOOM1.WAD` (the Internet Archive's cross-site endpoint;
     the plain `archive.org/download/…` address sends no such header, so a page cannot read it). Found by
     searching the Archive's file lists for the file's MD5.
  2. `https://raw.githubusercontent.com/Akbar30Bill/DOOM_wads/f412706f…/doom1.wad` (pinned to a commit).
- `site/frontend/src/lib/shareware.ts`: tries the mirrors in order, without cookies or referrer, streams with
  progress, and accepts only the exact size and SHA-256. Anything else from a mirror is refused and the next
  is tried; if none works the visitor is told to use their own copy.
- The Game file step now offers "Fetch it" first and "drop your own" second. `connect-src` in
  `site/security-headers.json` lists the two hosts (a test keeps it in step with `site.ts`).
- VERIFIED in the Browser pane, development server and a production build under the real security headers: the
  page downloaded the file from the Internet Archive, verified, cut, converted and packed it in 4.2–4.6 s; the
  result is the tested data. 32 tests pass.
- This is the first time the page contacts another host, and only on that button.

## 2026-10-09 ~21:30 — Repository, licence, deploy set-up (nothing deployed)

- VERIFIED (AWS, read-only calls): `deadlockinteractive.com` is registered at Amazon Registrar (auto-renew, to
  2028-02), its hosted zone `Z07104152PEL021SX0LUQ` already exists and the registrar's name servers are that
  zone's. The zone holds a Squarespace site's records (apex A, `www` CNAME, a verification CNAME): the CDK must
  not create a zone and does not touch those; it adds `doom.` only. No CAA record, no existing certificate.
  CDK bootstrap version 30 is in us-east-1 and us-west-2, and its roles trust the account.
- `site/infra/cdk.context.json` now holds the real zone id (from `cdk synth`, a read-only look-up), so synth
  needs no AWS access; CI runs it.
- Deploy role: following beverage-chilling, a role of its own (`github-actions-deploy-fm1-doom`) made by
  `scripts/setup-github-oidc.sh`, which Sean runs once. It may only assume the CDK bootstrap roles in the two
  regions. The script asks GitHub for the repository's token subject form (new repositories use the immutable
  one with ids). The shared `github-actions-deploy` role is not used and was not changed.
- Workflows in beverage-chilling's style: `ci.yml` (pull requests: type check, tokens, tests, build, no game data
  in the output, `cdk synth`) and `deploy.yml` (push to `main`: test gate, build, `cdk deploy`, smoke tests that
  compare the live firmware and converter with the committed hashes).
- Licence: Felucca is GPL-3.0-only (its `LICENSE`, `LICENSING.md`), which allows this use on condition that the
  source of what is distributed is offered under the same licence. Added `LICENSE` (GPL-3.0), a `README.md` with
  credits and the build's upstream versions, and `engine/`: our rp2040-doom work as a `git format-patch` series
  on upstream `29a453c`, with `engine/get.sh`. VERIFIED: applying the series to a fresh checkout of that commit
  gives the same tree as the local `fm1-port` branch (`9f6171d8…`).
- QUEUED for the next firmware build (not done; no firmware was rebuilt): the firmware still names itself
  "Felucca" on USB (Felucca's `usb.c`, string descriptor `STR2`, unmodified). That name is Hügelton Instruments'.
  Rename to "FM-1 Doom"; Felucca's and our installer both find ports by `/fm-1|felucca|…/`, so either keeps working.

## 2026-10-09 ~22:00 — Build "b6": the MASTER knob is the volume; the firmware names itself on USB (built and Mac-tested; NOT installed)

Sean asked for both: a name that is not Felucca's, and the real volume knob.

- VERIFIED from Felucca's source: MASTER is not an encoder but an analogue input, SARADC channel 4 on PB6
  (`hal/fm1_adc.h`, `fm1_adc_read(FM1_ADC_MASTER)`, 0..1023, a bounded wait, -1 on timeout). Felucca polls it from
  its main loop once per screen frame, smooths it by an eighth per poll and maps it by a square law to a Q12 gain
  (`master.c`, `fx.c master_of_pot`).
- `firmware/dev_volume.h` (new, 14 host checks in `tests/volume_test.c`): the same mapping. `doom_dev.c` reads the
  knob once before the audio starts (no glide: the first sound is at the knob's level), then once per game tic
  from `dev_service`, **in game mode only**; the audio interrupt multiplies by the gain it finds. Full knob is
  the old "100 %" (the mix shifted up 7 bits); the old fixed 5 % is the knob at about 22 %; the bottom of the
  knob (readings 0..15) is silence. Safe mode reads no knob and makes no sound, as before.
- VERIFIED in the disassembly: the audio loop is b5's with the constant 1638 replaced by the word at
  `dev_gain_q12` and the shift 8 by 5 (same signed multiply, same arithmetic shift).
- USB names. Felucca's `usb.c` reports manufacturer "Hügelton Instruments" and product "Felucca"; our firmware
  compiled that file as it stood, so it claimed both. `firmware/gen_usb.py` (run by `build.sh`) now writes
  `build/gen/usb.c`: Felucca's file with exactly those two string descriptors replaced (it refuses if either is
  not found exactly once), and `build_in.sh` puts it first on the include path. Manufacturer "Deadlock
  Interactive", product "FM-1 Doom". VERIFIED in the image: each new name once as a USB string, the old ones
  not at all. The product name keeps "FM-1" in it because Felucca's and our installers pick MIDI ports by
  `/fm-1|felucca|ota|…/`. During an update the device still shows as "Felucca Update": that is Felucca's own
  loader, unmodified, under its own name.
- b6: firmware 267,048 B (+240 B), recovery core id `c7618ad75e6ba239` (changed: the device unit changed), build
  id `b5fc233a`; `doom_part1.fwsc` SHA-256 `b2ed37e8…6185b646`, `doom_code.fwsc` `fcd9fd37…757112c2`; data block 2
  unchanged (`e4dcdbba…`, what the FM-1 holds). Block 1 has 19,416 B spare.
- Checks: 17 package runs pass (`firmware/test.sh`, now with the volume test); the predicted flash after
  installing b6 over b5 (138 of 143 app sectors change, nothing else) passes `check_dump.py` with the official
  head. Symbols: `firmware/installed_b2ed37e8/`.
- NOT VERIFIED until it runs on the FM-1: that the knob's direction and range feel right (the mapping is
  Felucca's, so it should match the synth), that full volume does not distort on the speaker, and how the Mac
  names the MIDI port after the change (it may keep showing the old name for a while).

## 2026-10-09 ~23:30 — Build "b7": a filter over the game's sound on two knobs (built and Mac-tested; NOT installed)

Sean's idea: this is a synthesizer, so let a knob filter the game's sound while it plays. A party trick.

- **What it is.** KNOB 1 sweeps: left of centre a low-pass closing from 8 kHz down to 80 Hz, right of centre a
  high-pass opening from 80 Hz up to 8 kHz, 40 steps each side in equal ratios, the centre off. Crossing the
  centre stops at off (one more click continues). KNOB 2 is the resonance, 8 settings (Q 0.7 to 8), starting at
  3. EDIT turns the filter off. Each change is said on the game's message line (only while a level is up).
- **Where.** `rp2040-doom/src/fm1/fm1_filter.h` (engine patch 0012): a state-variable filter in its trapezoidal
  form, stable at every setting, fixed point with 64-bit products. `fm1_controls.c` owns the two settings; the
  device's audio interrupt (`doom_dev.c`) and the browser build's audio callback run it on each block, before
  the volume. Off returns without touching a sample, so with the knob at the centre the sound path is b6's.
- VERIFIED in the b6 disassembly first: the CPU multiplies 32x32 into 64 bits in one instruction
  (`r1_r0 = r1 * r0 (s)`, as the engine's own FixedMul compiles), so 64-bit fixed point costs nothing special.
- **Cost** (from the b7 disassembly): at most 73 instructions per sample of one channel, 6.4 million a second
  while the filter is on, none while it is off. The first version of the loop (64-bit saturation, both channels
  in one loop) was 120 and was rewritten. The CPU's clock is still unknown, so what that costs in frame rate is
  for the device to say: ENV shows the rate with the filter off and on.
- **Tests.** `firmware/tests/filter_test.c` (21 checks): the cutoff sits where the table says along the whole
  knob (-3 dB there within 0.35 dB), resonance peaks as computed (13.1 dB at the top setting, both sides), off
  is bit-exact, full-scale square noise at top resonance with the knob jumping about cannot push the state to
  its guard, silence in gives silence out, turning through off under a steady tone makes no click, channels are
  separate. `web/test_filter.js`: in the browser build with the level's music playing, low-pass cuts the top of
  the sound to 1/60, high-pass the bottom to 1/180, EDIT restores it, no audio underruns. The headless gameplay
  test is unchanged (2 awake, health 25 at t = 13).
- b7 = b6 + the filter: firmware 268,428 B, recovery core id `3366af9307ab58fe`, build id `80d062fa`;
  `doom_part1.fwsc` SHA-256 `2ab6deb5…df741f75b`, `doom_code.fwsc` `ef16ba8d…d8c6405c`; data block 2 unchanged.
  18 package runs pass; predicted flash passes `check_dump.py`. Symbols: `firmware/installed_2ab6deb5/`
  (b6's packages are kept in `firmware/installed_b2ed37e8/`). Source commit `7dcc819`.
- The engine patch series is now written without "[PATCH n/m]" in the subjects, so adding a patch no longer
  rewrites the earlier files. VERIFIED again: the series on upstream `29a453c` gives the local branch's tree.
- NOT VERIFIED until it runs on the FM-1: how it sounds on the speaker (the bottom half of the low-pass may leave
  little a small speaker can play), how many clicks of the knob a sweep takes, whether KNOB 1 and KNOB 2 are the
  encoders the HAL's numbering says, and the frame rate with the filter on.
- Local test pages (production builds, static): b6 on port 5183 (`dist-b6`), b7 on port 5184 (`dist-b7`). The
  site in the pull request still serves b5; the working tree holds b7 and its page text, uncommitted.

## 2026-10-10 — Build "b8": a new keyboard layout; no screen link speed button (built and Mac-tested; NOT installed)

Sean's changes after playing b7 (b7 is what `main` and the live site serve, pull request #2).

- **Repository state found first.** `main` served b7 but did not hold its source: the three b7 commits
  (`83f3af3`, `7dcc819`, `cbf6afe`) were pushed to `work` after pull request #1 had merged, and pull request #2
  carried only the site's copy of the build. Branch `controls-b8` (off `main`) starts by merging `work`, so
  engine patch 0012, the filter tests and the b7 notes are back in line. The same pull request #2 had also
  committed `site/frontend/dist-b7/` (my local test build, 25 files, no game data): no longer tracked.
- **Layout** (engine patch 0013, `fm1_controls.c`). Left hand, the six lowest keys: F#3 turn left, G#3 forward,
  A#3 turn right; under them F3 strafe left, G3 back, A3 strafe right. Right hand: F5 fire, G5 use, F#5 run.
  REC still fires. Nothing now: B3, C4 (were turn right, strafe right), D5, E5 (were a second use and fire).
  The low F# no longer runs: it turns.
- **Screen link.** The LFO button stepped the link's clock down from the fastest rate; it only made the
  picture slower. Gone: `fm1_lcd_speed_next` is removed from the engine and from `doom_dev.c`, which now knows
  two rates, the game's (n = 0, "60 MHz", the default since b5) and Felucca's for its own screens. SCL (picture
  shape) and ENV (frame rate) still work; the site no longer mentions them.
- VERIFIED in the browser build, `node web/test_controls.js` (new): each key held in E1M1 and the player's
  position and facing read back: forward +116, back -116, strafe left -106, strafe right +111 (map units in
  0.4 s), turn left +28/256 of a circle, turn right -28, forward with F#5 held 232 (twice the walk); B3, C4, D5,
  E5 change nothing. Gameplay test unchanged (2 awake, health 25 at t = 13); filter-in-game test passes;
  picture-shape test passes (its LFO step removed).
- b8: firmware 268,232 B (-196 B), recovery core id `182d9edc7bc9cbce` (the device unit changed), build id
  `2aee13da`; `doom_part1.fwsc` SHA-256 `cd171ebf…5f8d1e4b`, `doom_code.fwsc` `9376e017…7d6e0075`; data block 2
  unchanged (`e4dcdbba…`). Block 1 has 18,264 B spare. 18 package runs pass (`firmware/test.sh`); the
  predicted flash after b8 over b7 (138 app sectors change, nothing outside the app area) passes
  `check_dump.py`. Symbols: `firmware/installed_cd171ebf/`. Source commit `ff38dea`.
- Build note: `firmware/pack.py` needs `JIELI_TOOLCHAIN=$HOME/.jieli/toolchain AC79_SDK=$HOME/fw-AC79_AIoT_SDK`
  in the environment (for the loader variant), as Felucca's build does.
- Site (branch only): serves `doom-b8.fwsc`; the drawing and list show the new layout; the "Picture and sound"
  group is now "Volume" (MASTER alone). 32 site tests pass, production build is clean.
- NOT VERIFIED until it runs on the FM-1: that the layout feels right in the hand, and nothing else — the
  screen link rate is the one b5 to b7 already used.
- ASSUMED: Sean has run b7 on the device (he merged it and came back with layout changes); he has not said so.

## 2026-10-10 — Site: the controls drawing full width with labelled keys; a real screenshot on its screen

- The drawn FM-1 spans the controls section; the list is under it in two columns. Each note key the game uses
  carries its action (one word, or two with a line each); a button or knob the game uses explains itself under
  the pointer. `KEY_LABELS` and `TIPS` in `site/frontend/src/lib/controls.ts`; a test holds them to the keys,
  buttons and knobs the table lists.
- The screen of the drawn FM-1 showed a drawing made for the page. Sean asked for a real picture:
  `site/capture_screen.js` (new) runs the firmware's browser build headless, starts a game through the panel
  and writes the panel's 240x240 picture two seconds after the level appears to
  `site/frontend/src/assets/e1m1-start.png` (25,735 B, 492 colours: the 320-to-240 scaler blends). VERIFIED: two
  runs give the same file (SHA-256 `fcaa2e16…bbe93903`).
- **This is the first piece of id Software's artwork in the repository and on the site** (Sean's request). It
  is a screenshot of the shareware level, not game data: the rule against committing or hosting a WAD or
  anything cut from one stands, and CI's check for game data in the build is unchanged.
- The drawn screen is now the panel pixel for pixel (240x240, was a 60x60 grid scaled up): the plain-colour
  screens are painted in 4x4 cells, so they look as before, and the melt moves in the same cells.

## 2026-10-10 — Build "b9": drive on KNOB 3, the music's instrument on PRESETS (built and Mac-tested; NOT installed)

Sean asked what else a spare knob could do to the sound; of the ideas he picked drive and the instrument swap.

- VERIFIED in the source: three encoders were free, not one (KNOB 3, PRESETS, ALGORITHM), and the music is played
  by an emulated FM chip (`i_oplmusic.c` over the OPL emulator), each MIDI channel on one of the 128 melodic
  instruments of the game's GENMIDI lump, which also holds their names. ALGORITHM is still free.
- **Drive** (`rp2040-doom/src/fm1/fm1_drive.h`, engine patch 0014). KNOB 3: off, then 16 steps. Each step is
  more gain (4 to 64 times, equal ratios) into a soft clipper (y = 1.5x - 0.5x^3), then a level back down. It
  runs on each block ahead of the filter, in the audio interrupt (`doom_dev.c`) and in the browser build. A step
  is ramped across the block, off/on is a crossfade, and off returns without touching a sample.
- MEASURED first, in the browser build: E1M1's music is quiet against full scale (RMS 1583 of 32768, peaks
  10,696; pistol shots peak 15,104). That is why the gain starts at 4: below it nothing would clip. The 16 levels
  were set on five seconds of that music so that its RMS comes out 1 dB up at step 1 and 4 dB up at step 16.
  At step 16 nearly half the samples are flat-topped and the loudest sample is 3549, a third of the clean
  music's peaks: loud sounds (shots) are squashed down to the music's level, as heavy distortion does.
- **Cost** (from the b9 disassembly): the drive loop is 56 instructions a stereo frame, 28 per sample of one
  channel, 2.5 million a second while it is on, none while off. With the filter on as well: about 101 per
  sample, 8.9 million a second. The CPU's clock is still unknown; ENV shows the frame rate.
- **Instrument** (`i_oplmusic.c`, 6 lines under `#if FM1`). PRESETS: at the bottom the music is as written; each
  click up plays every melodic note on the next of the 128 instruments, and the message line says its number
  and name. Percussion is left alone. Notes already sounding keep their instrument until they end. No cost
  per sample. VERIFIED: as written E1M1 uses instruments 29, 30 and 34 (two guitars and a bass).
- **EDIT** now turns off all three (filter, drive, instrument) and says "SOUND AS IT WAS".
- Tests. `firmware/tests/drive_test.c` (new, 20 checks): off is bit-exact; the clipper never makes a louder
  sample quieter, is the same both ways up, never exceeds its step's level for any input; a tone at the music's
  level gets no quieter and no cleaner with each step (+1.3 dB at step 1, +6.7 dB at step 16, third harmonic
  0.7 % then 32 %, a square wave's being 33 %); full scale in stays in range; silence stays silence; turning
  through off and up and down makes no click; channels are separate. `web/test_sound_knobs.js` (new), on the
  game's music: one click rounds the peaks (peak/RMS 6.6 to 3.1), the top step squares it (1.26, peak exactly
  3549, +4.8 dB), back down restores it; PRESETS up 20 puts every melodic voice on instrument 19, far past the
  top stops at 127, EDIT brings back 29, 30, 34 and the clean sound; no underruns. Gameplay, layout and filter
  tests unchanged.
- b9: firmware 268,992 B (+760 B), recovery core id `3088e3cfe01c1599`, build id `785d78fe`; `doom_part1.fwsc`
  SHA-256 `ef6a2897…e1792a08`, `doom_code.fwsc` `489851ec…cae008c3`; data block 2 unchanged. Block 1 has
  17,496 B spare. 19 package runs pass; the predicted flash (138 app sectors change, nothing else) passes
  `check_dump.py`. VERIFIED: a clean rebuild from the committed source gives the same two files. Symbols:
  `firmware/installed_ef6a2897/`. Source commit `1118d9e`.
- DEAD END avoided: `firmware/build/doom.dis` was from 2026-10-09; the build never rewrote it, so b8's copy in
  `installed_cd171ebf/` was an older build's listing (now regenerated from b8's own ELF). `build_in.sh` writes
  the listing on every build from now on.
- NOT VERIFIED until it runs on the FM-1: how drive sounds on the speaker and whether 4 dB at the top is too
  much or too little; whether KNOB 3 and PRESETS are the encoders the HAL's numbering says; the frame rate with
  drive and filter both on; whether some instruments are too quiet to be worth stopping on.

## 2026-10-10 — Do b8 and b9 raise the risk of a brick? (Sean's question; answered on the Mac)

- New: `tools/core_diff.py OLD_DIR NEW_DIR` compares the recovery core of two builds (start-up code, vectors,
  interrupt stubs, `doom_dev.o` with the Felucca sources in it) function by function, as instruction text with
  link addresses masked. Reads `doom.map` and `doom.dis` only.
- VERIFIED, b7 (`installed_2ab6deb5`) against b9 (`installed_ef6a2897`): of b7's 70 recovery-core functions, 57
  are the same instructions; 10 more are the same instructions with their variables 16 bytes further on (the
  drive's 16 bytes of state), among them `fm1_cstart` (boot, the choice of safe mode, the safe-mode loop),
  `dev_service` (watchdog, boot guard, the boot-mode chord), `usb_start`, `fm1_timer5_irq` and the update
  protocol's functions; `fm1_lcd_speed_next` is gone; two have different code: `fm1_alnk0_irq` (the audio
  interrupt, which now runs the drive) and `fm1_lcd_blit` (the game's picture, always at the fastest rate).
- VERIFIED in the source: both of those run in game mode only. The audio interrupt is attached inside
  `if (dev_mode == MODE_GAME)`; `fm1_lcd_blit` is called only from the game's video code. Safe mode never
  reaches either. The drive is off at power-on, so its loop does not run until KNOB 3 is turned.
- So the worst a fault in the new code can do is stop or spoil the game while it runs: the watchdog or the
  fault handler restarts it, a start that dies in its first 30 s comes back in safe mode (amber), and HOME held
  at switch-on gives safe mode (cyan) before any game code runs. The ladder below that is unchanged and was
  not touched: three failed starts or three minutes unheard in safe mode lead to the chip's boot mode, where
  `fm1restore.py` writes the backup (read and sector write VERIFIED on the device 2026-10-09; a whole restore
  has never been needed, so never run).
- What stays as it always was: an install rewrites the whole application area, recovery core included, through
  Felucca's loader. That risk belongs to every install (b5, b6, b7 too), not to these features.
- ASSUMED, not said by Sean: that b7 has run on his FM-1. The comparison is against b7 because it is the build
  on `main`; if he last ran another build, the same check against that build's `installed_*` directory applies.

## 2026-10-10 — Build "b10": pitch, tempo, FM depth; envelope and filter wobble behind ENV; the drive is gone (built and Mac-tested; NOT installed)

Sean's verdict on b9: the instrument knob and the filter are "awesome", the drive never sounded good at any
setting. (Clipping a whole mix makes every note beat against every other; the lesson taken: change the music
inside its FM voices, or use effects that add nothing new.) He chose pitch and tempo for KNOB 3 and KNOB 4, FM
depth for ALGORITHM, and asked for a toggle so that envelope and filter wobble can be tried on the same build.

- **Layout of the sound controls now.** PRESETS instrument; ALGORITHM FM depth; KNOB 1 filter sweep; KNOB 2
  resonance; KNOB 3 pitch; KNOB 4 tempo. **ENV** swaps KNOB 3 and KNOB 4 to a second pair, envelope and wobble,
  and back; what the first pair was set to stays in force. EDIT puts all of it back. KNOB 4 no longer changes
  weapon (SELECT and OCT-/OCT+ do). The frame-rate readout moved from ENV to **GLO**.
- **Pitch** (`i_oplmusic.c` FrequencyForVoice): semitones added to every melodic note that is not a fixed-pitch
  instrument, 12 each way; `FM1_Retune` rewrites the frequency of the notes sounding, so the knob is heard at once.
- **Tempo** (ScheduleTrack): the time to the music's next event is scaled; 12 steps each way, a twelfth of a
  doubling each, 50 % to 200 %. Takes effect from the next event.
- **FM depth** (`FM1_ShapeVoice`): the modulator's level of every voice in FM mode, 2 register steps (1.5 dB) a
  click, 8 each way. Voices whose two operators are simply added are left alone.
- **Envelope**: of the operators that are heard. Short (6 steps): the note falls to nothing while held (sustain
  level to the bottom, decay rate at least 7 .. 12) and is released no slower. Long (6 steps): attack rate at
  most 6 .. 1, release rate at most 8 .. 3. FIRST VERSION WAS WRONG, found by measuring: it changed only the
  release rate and the "held" flag, and E1M1's guitars (GENMIDI 29, 30: attack 15, decay 0, release 15, not
  held) did not react at all; and an attack capped at rate 3 was still too fast to hear, because the chip's
  attack does most of its rise at the start. MEASURED after the fix: RMS falls 1488 -> 702 -> 163 across the
  short steps; at long 6 the level swing drops from about 12 dB to 4 to 5 dB (everything rings on).
- **Wobble** (`fm1_filter.h`): a triangle that swings the cutoff 8 knob steps each way (about an octave and a
  third) about KNOB 1's position, at 11 speeds from 0.25 Hz to 8 Hz; it never crosses the centre or the ends,
  and does nothing while the filter is off (the message line then says to turn KNOB 1). For this the filter
  takes positions in 256ths of a knob step, the cutoff on a straight line between table entries (within
  0.35 % of the true curve). The state grew by 8 bytes.
- Tests. `firmware/tests/filter_test.c`: its 21 checks unchanged (on a knob step the filter is bit for bit what
  it was) plus 5 for the above. `web/test_sound_knobs.js`, rewritten, 23 checks on the game's own music through
  a test hook (`fm1_music_probe`: instrument, frequency register, modulator level, note as written, ticks
  played): pitch +12 / -3 / clamped at -12 on every note seen; tempo 2x, 0.5x and back by ticks a second; FM
  depth +4 and -8 on each instrument's modulator (29: 6 -> 0 / 22; 30: 13 -> 5 / 29; 34: 15 -> 7 / 31); ENV and
  the second pair (short: a twelfth of the RMS; long: steadier; wobble: the top end's swing 15 -> 24 dB), the
  first pair untouched meanwhile and back after ENV; EDIT restores everything; no underruns. Gameplay, layout,
  filter and picture tests pass. `drive_test.c` and `fm1_drive.h` are deleted.
- b10: firmware 269,920 B, recovery core id `9d99b4e4d399022c`, build id `6b746715`; `doom_part1.fwsc` SHA-256
  `389492de…0a18082a`, `doom_code.fwsc` `b76e1423…8916a57a`; data block 2 unchanged. Block 1 has 16,600 B
  spare. 18 package runs pass; the predicted flash (139 app sectors change, nothing else) passes
  `check_dump.py`. Symbols: `firmware/installed_389492de/`. Source commit `009dd5e`.
- VERIFIED with `tools/core_diff.py` against b7: 61 of the recovery core's functions are the same instructions,
  6 the same with variables 8 bytes on, `fm1_lcd_speed_next` gone, and the two that differ are the audio
  interrupt and the game's picture output, both game-mode only. The same answer as for b9.
- NOT VERIFIED until it runs on the FM-1: how any of it sounds on the speaker; whether ALGORITHM, KNOB 3 and
  KNOB 4 are the encoders the HAL's numbering says; whether the frame rate moves (GLO shows it).
- OPEN, for Sean after trying: which pair KNOB 3 and KNOB 4 should have for good, and whether ENV stays.

## 2026-10-10 — Build "b11": the knob messages large on the screen; the Play step links to the controls (built and Mac-tested; NOT installed)

- Sean asked for the message line that says what a knob has done to be about twice the size, if that was not a
  problem. It was not, done outside the game's own HUD: `rp2040-doom/src/fm1/fm1_osd.h` (engine patch 0016)
  holds a font drawn for it (capitals, digits and the punctuation the messages and GENMIDI's names use: 5 dots by
  7) and writes a message at the panel's own resolution, each dot 2 x 2 pixels, in lines of 20 characters on a
  band dimmed to a quarter, for three seconds. `fm1_video.c` draws it into each panel row on its way out, four
  rows below the top of the picture, so it is also right in the 150- and 180-row shapes, and it shows over the
  title and the menus too. All of the firmware's own messages (`fm1_say`) go there now. The game's own messages
  ("PICKED UP A CLIP") are as they were: small, and squeezed 4 to 3 with the rest of the picture.
- For scale: the game's message font is about 7 x 8 in the 320 x 200 picture, so about 5 x 10 pixels on the
  panel in the full-screen shape; the new letters are 10 x 14 in a 12 x 18 cell.
- VERIFIED on the Mac: `firmware/tests/osd_test.c` (new, 8 checks): each of 25 messages, with the longest
  instrument names, fits in one or two lines of whole words with a letter for every character; the band's
  pixels are a quarter as bright or white and nothing outside it is touched; the widest line stays inside the
  row. Looked at in the browser build ("MUSIC 20 CHURCH / ORGAN", "TEMPO 119%" in the 150-row shape); gone again
  after three seconds. All browser-build tests pass.
- b11: firmware 270,848 B (+928 B), build id `feeacfe6`; `doom_part1.fwsc` SHA-256 `fae910c3…b3f51d4c`,
  `doom_code.fwsc` `93265962…f47aa309`; data block 2 unchanged; block 1 has 15,640 B spare. 19 package runs
  pass; predicted flash (139 app sectors, nothing else) passes `check_dump.py`. Symbols:
  `firmware/installed_fae910c3/`. Source commit `23c28d0`.
- VERIFIED: the recovery core id is b10's (`9d99b4e4d399022c`: the device unit did not change), and
  `tools/core_diff.py` b10 -> b11 finds all 69 functions the same instructions.
- Site: the Play step no longer repeats the controls drawing and list; its forward button is "View controls", a
  link to the manual's controls section further down the page. Checked by walking the stand-in install to the
  Play step in headless Chrome: no controls in the panel, the link lands on `#controls`.
- NOT VERIFIED until it runs on the FM-1: that the letters are a good size on the real panel, and that drawing
  them costs nothing visible in frame rate.

## 2026-10-10 — Build "b12": PRESETS at the bottom says "ORIGINAL MUSIC" (built and Mac-tested; NOT installed)

- Sean's wording, in place of "MUSIC AS WRITTEN" (engine patch 0017). The other three messages that end in
  "AS WRITTEN" (FM depth, pitch, envelope at rest) are as they were: he named only this one.
- b12 = b11 with that string: firmware 270,844 B, build id `fb1e9925`, recovery core id unchanged
  (`9d99b4e4d399022c`), `tools/core_diff.py` b11 -> b12: all 69 functions the same instructions.
  `doom_part1.fwsc` SHA-256 `bd5b6b0f…b7ec2e73`, `doom_code.fwsc` `28814e0a…2520a341`; data block 2 unchanged.
  19 package runs pass. Seen in the browser build. Symbols: `firmware/installed_bd5b6b0f/`. Source commit `b6fd5cd`.

## 2026-10-10 — Build "b13": the large message line in the game's own font (built and Mac-tested; NOT installed)

- Sean on b11/b12's line: "extremely readable but honestly it kind of lacks the charm of the game text"; could
  it be the game's text, larger? Yes. The letters are now the game's message font itself (patches STCFN033 to
  STCFN095, in the data file already): `fm1_video.c` runs the engine's own `draw_vpatch` on each letter, a
  font row at a time, into a row of its own (`fm1_osd_px`), and copies that onto two panel rows with every pixel
  doubled. Straight onto the picture from 4 pixels in and 4 down, as the game's messages sit, no band behind.
  The colours come through the game's palette, so the letters redden and flash with the rest of the status
  display. The font drawn for b11 is deleted. (engine patch 0018)
- A line is 116 of the font's pixels (232 of the panel's 240); `fm1_osd.h` breaks a message into up to three
  lines by the letters' real widths, 9 font rows apart. For scale: a letter is about 16 x 16 pixels on the panel,
  against about 6 x 10 for the game's own messages there (which are squeezed 4 to 3 with the picture).
- VERIFIED in the browser build, `web/test_message_line.js` (new, 8 checks): each of the 128 instrument names
  fits (20 in one line, 97 in two, 11 in three) and so does every other message the knobs and buttons make; a
  three-line message changes only columns 4..219, rows 4..53, all in the font's reds, every font pixel a 2 x 2
  block; three seconds on it is gone and the picture under it is as it was. `firmware/tests/osd_test.c`
  rewritten for the line breaking (7 checks). Every other browser-build test passes.
- b13: firmware 270,540 B (304 B smaller than b12: no font of its own), build id `110d1c01`, recovery core id
  unchanged (`9d99b4e4d399022c`); `tools/core_diff.py` b12 -> b13: all 69 functions the same instructions.
  `doom_part1.fwsc` SHA-256 `8cd1848c…2663358a`, `doom_code.fwsc` `7ab90cfe…26b79839`; data block 2 unchanged;
  block 1 has 15,960 B spare. 19 package runs pass; predicted flash passes `check_dump.py`. Symbols:
  `firmware/installed_8cd1848c/`. Source commit `1e422bb`.
- MEASURED, worth knowing before the next addition: the 200 KB region for large buffers (`.bigbss`, where
  `fm1_video.o`, `pd_render.o`, `doom_dev.o` and `fm1_audio.o` keep their statics) is now full to within 12
  bytes (it ends at `0x01C3BFF4` of `0x01C3C000`). The linker refuses a build that overflows it, so the failure
  would be at build time, not on the device; the game heap in the other region is untouched (233 KB).
- NOT VERIFIED until it runs on the FM-1: the size and legibility on the real panel (red on a dark ceiling is
  how the game does it, but there is no band to help over a bright wall).

## 2026-10-10 — Build "b14": ENV gives four envelope knobs, LFO the wobble (built and Mac-tested; NOT installed)

- Sean on b10's single envelope knob (heard in the browser build or on the device, he did not say which):
  "anything lower than Envelope Short 1 seems to crunch it so much that to my ear there's almost no difference
  between Envelope Short 2 and Envelope Short 6", and asked for attack, decay and so on as separate controls, all
  four knobs turning into envelope knobs on ENV, as he recalled a synth firmware doing.
- VERIFIED in Felucca's source: its operator envelope pages do hold attack, decay, sustain, release (and level)
  per operator (`fm4_convert.c`, `P_FM1_ATK` on). NOT CHECKED: which knob is which there, and Baud Girl.
- CAUSE of his finding, MEASURED: the short steps set decay rates 7 to 12, and E1M1's guitars scale their rates
  with pitch (KSR), so all but the first were a click (RMS 700, then 580 .. 160). The rates a listener can tell
  apart in this music are 1 to 8 for a decay, 1 to 6 for an attack, 2 to 9 for a release.
- **Now** (engine patch 0019). ENV: KNOB 1 attack (6 steps: rate 6 down to 1), KNOB 2 decay (8 steps: rate 8 down
  to 1), KNOB 3 sustain (10 steps: silence, 30 dB down .. full; the note is held there), KNOB 4 release (8
  steps: rate 9 down to 2); a higher number is longer, or for sustain louder; the bottom of each is the
  instrument's own ("ORIGINAL ATTACK", after Sean's "ORIGINAL MUSIC"). As before they act on the operators that
  are heard, of every voice, at once. A sustain setting on an instrument with no decay of its own (E1M1's
  guitars: attack 15, decay 0, sustain 15, release 15, not held) gives it decay rate 6, or the knob would do
  nothing. LFO: KNOB 1 is the wobble's speed (it was KNOB 4 behind ENV). ENV or LFO again, or EDIT, gives the
  knobs their first jobs back; what was set stays in force, except after EDIT.
- MEASURED per step in the browser build (RMS of 2.5 s of the music, which itself moves between about 1900 and
  2600): attack 2509, 1931, 1842, 1755, 315, 47; decay 1069, 1060, 1417, 1747, 1877, 2385, 2723, (1932); sustain
  969 rising to 3083; release: the level swing falls 24 dB -> 2.5 dB and the RMS rises to 5191 (nine voices
  ringing). So attack 6 all but silences fast music, and release 7 and 8 are about 7 dB louder than the tune.
- Tests: `web/test_sound_knobs.js` now reads the envelope back from what was written to the chip (probe 5 to 7)
  for each knob's first step, a middle one and its top, and the wobble from the filter's position (probe
  `fm1_web_filter_at`: -22 swinging between -29.7 and -14.0), 34 checks; the message tests carry the new
  messages. All browser-build tests pass.
- b14: firmware 270,792 B, build id `029458be`, recovery core id unchanged (`9d99b4e4d399022c`);
  `tools/core_diff.py` b13 -> b14: all 69 functions the same instructions. `doom_part1.fwsc` SHA-256
  `a69f245d…ff3b1ba6`, `doom_code.fwsc` `672906bb…fa8776e6`; data block 2 unchanged; block 1 has 15,704 B
  spare. 19 package runs pass; predicted flash passes `check_dump.py`. Symbols:
  `firmware/installed_a69f245d/`. Source commit `e658754`.
- NOT VERIFIED until it runs on the FM-1: everything about how it sounds there; that KNOB 1 to KNOB 4 are the
  encoders in that order.

## 2026-10-10 — Prototype: Doom's music on Felucca's six-operator FM engine (browser build only; nothing for the device yet)

Sean: the game's instruments on PRESETS sound like "cheap mini sounds", Felucca's are "beefy and compelling";
could those be heard in Doom? He agreed to a listening prototype in the browser build first.

- **Licence** (my reading of Felucca's LICENSING.md, not legal advice): GPL-3.0-only covers Felucca's code "and
  its own assets"; the FM6 factory patches are "Felucca's own"; the FM core (`fm6_core.c`) is msfa from Dexed,
  Apache-2.0. Our firmware is already a GPL-3 derivative of Felucca with its source published, so using the
  engine and patches is allowed on the same terms. "Felucca" and "Hügelton Instruments" are the author's names:
  credit, not branding. Its CONTRIBUTING.md points forks and mods to Discussions > Show and tell.
- **Why not just more presets**: a Felucca preset is parameters for one of Felucca's engines; the game's music is
  played by an emulated two-operator chip (9 voices, GENMIDI instruments). The engine has to come along.
- **What was built.** `firmware/fm1_fm6.c`: includes Felucca's `fm6_core.c` and its generated tables and factory
  patches from the Felucca checkout, unchanged, and wraps them as a six-voice synth (Felucca's own cap for this
  engine on the FM-1): note on / off by channel and key, the oldest released voice stolen first, one patch for
  every channel, the DC blocker and output stage as Felucca's `eng_fm6.c`. It renders 32-sample blocks at the
  44,100 Hz its tables are made for and is interpolated to the mixer's 49,716 Hz, so pitch and envelopes are
  Felucca's. Engine hooks (patch 0020, all under `FM1_FM6`): `i_oplmusic.c` sends melodic note-ons and
  note-offs there when a patch is chosen and leaves the chip the percussion; `fm1_audio.c` adds its sound to
  each mixer pass; `fm1_controls.c` puts the eight patches on the PRESETS knob's first eight clicks
  ("FELUCCA 1 TINE EP" .. "FELUCCA 8 NYLON PICK"), the game's 128 instruments after them. The pitch and tempo
  knobs work on it; the FM depth knob is its modulators' level; the envelope knobs do not reach it yet.
- `FM6=1 sh web/build.sh` builds it into `web/build-fm6` (preview entry `fm1-doom-fm6`, port 8798). The ordinary
  browser build and the device firmware are built without the flag and are unchanged (their tests pass; b14 on
  the site is still source commit `e658754`).
- VERIFIED headless, `node web/test_fm6.js` (12 checks): on each of the eight patches the engine sounds the
  melody (up to 6 voices) and the chip only drums; RMS 970 .. 1770 against 1700 for the game's own, no clipping,
  no underruns; PRESETS 9 is the chip again; EDIT restores the game's music. A 64 s recording of the game's own
  music and then each patch on E1M1: `web/build-fm6/doom-on-felucca-fm6.m4a` (not in git).
- **Cost on the device, from Felucca's own test** (`Felucca/build/host/fm6_test`, run here): 34 to 179 host
  instructions per sample and voice depending on the patch, which Felucca's measured ratio (1.7 % of the chip
  per 100) puts at 0.6 % to 3.0 % a voice, about 18 % of the processor for six voices of the heaviest patch.
  Size in Felucca's build: about 13.6 KB of flash and 9.4 KB of RAM for the engine with all four tracks; here
  one patch and six voices need about 1.7 KB of RAM. Block 1 has 15.7 KB of flash spare; the large-buffer RAM
  region is full, so its state would have to live in the other region (the game heap gives way).
- NOT DONE, and what a device build would still need: the size checked in our build, the engine's state placed,
  the frame rate with it measured on the FM-1 (Sean has not yet reported any frame rate), envelope knobs mapped
  onto the patch, and the patch choice somewhere better than the first eight clicks if it stays.
- ASSUMED: that Felucca's 1.7 % per 100 figure carries over to our firmware (same chip, same start-up code and
  clock set-up from Felucca's HAL; not measured by us).

## 2026-10-10 — Prototype: a drum machine under the song, with Felucca's drum voices (browser build only)

Sean: press a button and a drum track starts on the Doom song, "really crunchy snare and bass", maybe four on
the floor; is it possible?

- **Yes, and it is the cheaper of the two prototypes.** `firmware/fm1_drums.c`: Felucca's DRUM engine
  (`drum_voice.c` with `dsp.c`, unchanged, read from the Felucca checkout; GPL-3.0-only like the rest) as an
  eight-lane machine. SEQ steps through: off, the song's own drum part (its General MIDI drum notes on real
  drum voices, through Felucca's own note map), a rock beat, four on the floor, half time. ARP steps through
  the kits: Felucca's own and its five model kits ("80", "10", "66", "55", "77"). While it plays the chip's
  percussion is silent. EDIT turns it off with everything else.
- **Staying in time.** MEASURED from the songs' note times in the WAD: E1M1 is at 110 beats a minute (a bar is
  305.45 of the music's 1/140 s ticks; the song is exactly 44 bars, 13,440 ticks), the title jingle at 140. The
  music's player schedules a callback for every sixteenth that falls before its next event, timed from the event
  before it, on the same timer as its own notes (engine patch 0021, under `FM1_DRUMS`), so the beat cannot
  drift against the tune, restarts with the song's loop and follows the tempo knob. A hit is queued with its
  place in the mixer pass (`fm1_pass_frames`, new in `opl_pico.c`) and struck there, within a 32-sample block
  (under a millisecond).
- DEAD END on the way: the first build crashed about 100 s in, untouched. The small build's callback queue
  (`opl_pico.c`, `LIMITED_CALLBACK_TYPES`) does not store a callback's function: it takes any callback with an
  argument to be the track's and one without to be the song's restart, so each drum step was run as a track
  event on a bogus track. It now knows a third kind (arguments 1 .. 16). The queue holds 10 entries; the
  steps add one or two.
- VERIFIED headless, `node web/test_drums.js` (16 checks): each pattern makes its number of hits per bar of the
  song (13, 10, 7; measured 12.8, 9.7, 7.1 against the music's own tick count), the same at double tempo; the
  chip's drums are silent meanwhile and back afterwards; the five model kits play; it runs together with the
  FM6 prototype; no clipping to speak of (peaks about 20,000 of 32,767), no underruns; the song plays through
  its loop twice with the drums on and off. Recording: `web/build-fm6/doom-drum-machine.m4a` (not in git).
- **Cost on the device, from Felucca's own test** (`Felucca/build/host/drum_test`, run here): a voice costs only
  while it sounds: kick 1.5 %, snare 2.0 %, a hat 1.0 % of the chip by Felucca's ratio, so a busy bar is a few
  per cent. In Felucca's build the voices are a little over 5 KB of flash; their state here is about 1.5 KB.
- NOT DONE: nothing for the device. Notes of the FM6 prototype are still applied at the start of a mixer pass
  (up to 10 ms early); the drums are not.

## 2026-10-11 — Drum machine prototype, second pass: heavier kits and metal patterns (browser build only)

Sean on the first pass: it works, but "not the kind of aggressive punchy drums that I was hoping for"; he wants
"super noticeable options, like metal double bass", and asked for the route.

- **What was wrong with pass one, MEASURED on the drums alone:** Felucca's kits as designed are clean and
  dynamic (peak 9 times RMS on a rock beat) and I had mixed them at a third of their level, under the music.
- **Kits.** Two set up here from Felucca's voices, ahead of its six: METAL (the kick tuned up 7 semitones,
  short, a big sweep, driven, with a 3 kHz clave struck with it as a beater click; the snare bright with all
  its wires and a clap on top; a low short open hat as a china) and PUNCH (the round long kick with a rim's
  knock, a fat long snare). Each kit's sum goes into a soft clip (drive x1.3) and under every kick and snare
  the rest of the mix steps back by about a third for a tenth of a second. Each hit has a strength (a fast foot
  plays lighter). The whole sum has a soft top above half scale in place of hard clipping. SAVE steps five
  loudnesses, 3 dB apart.
- DEAD END: the first settings (drive x2, level 0.8, long cymbals) measured peak 1.4 to 2.7 times RMS and an RMS
  of 9,000 to 17,000 against the music's 1,700: a wall with no hits in it. Now, at the middle loudness: METAL
  double bass RMS 6,300, peak 18,500 (2.9); rock 4,600 (4.0); half time 3,000 (6.2).
- **Patterns**, on a bar of 32 steps (thirty-seconds): DOUBLE BASS (kick on every sixteenth), GALLOP (an
  eighth and two sixteenths a beat, as the riff goes), THRASH (kick on the beats, snare between), BLAST (kick
  and snare by turns), MACHINE GUN (kick on every thirty-second), ROCK, FOUR ON THE FLOOR, HALF TIME, then the
  song's own part. Most have a crash on the first beat of every fourth bar and a snare-and-toms fill before
  it; E1M1 is 44 bars, so the phrases close with the song's loop. Engine patch 0022: a step is a thirty-second
  counted through four bars (0 .. 127) and only steps with a hit get a timer (the queue holds 10).
- VERIFIED headless (`node web/test_drums.js`, 25 checks): each pattern's hits over eight bars of the song are
  the tables' (188, 186, 136, 196, 318, 110, 81, 58), the same at double tempo; all eight kits play; the five
  loudnesses rise and wrap (RMS 3,400 to 13,200 with the music); no flat tops, no underruns at the game's
  own speed. Tour recording: `web/build-fm6/doom-drum-machine-2.m4a`.
- NOT VERIFIED: that it sounds aggressive to Sean. I cannot hear it; the figures only say that the hits now
  stand well clear of the music and of their own tails.
- **The route from here, if synthesised voices are not enough:** (1) recorded drum hits in place of Felucca's
  voices for kick and snare: the usual way to a real metal kit; needs a source we may ship (CC0 or our own
  recording) and flash: about 2 to 4 KB a hit at 22 kHz 8-bit, against 15.7 KB spare, so a kick, a snare and a
  cymbal at most beside nothing else; (2) the game's own sounds as a kit (a shotgun for a snare), which are in
  flash already and cost nothing; (3) more voicing of what is there.

## 2026-10-11 — Why Sean did not see the second pass: the browser's cache

- He loaded the prototype page and saw the first pass's patterns and kits. VERIFIED: the server had the new
  files (curl: the new wasm, 1,077,822 B); the in-app browser, asked for the same address, showed the old
  page and loaded the old `doom.js` and `doom.wasm` without asking the server. Python's plain `http.server`
  sends a last-modified date and nothing else, and a browser then reuses its copy for a share of the file's
  age: hours, for a page a day old.
- Fixed: `web/serve.py DIR PORT` (new) serves a build to this computer only with `Cache-Control: no-store`;
  `web/build.sh` writes the build's time into the page ("built 11 Oct 10:15" under the picture) and into the
  addresses of the two game files. The two preview entries use it. VERIFIED in the in-app browser after one
  reload: the new page, the stamped files, `no-store`.
- LESSON for my own checks: I had confirmed the page with curl and the game with Node, neither of which has a
  cache. A page meant for Sean's browser has to be looked at in a browser.

## 2026-10-11 — Recorded takes for Sean to review away from the computer (a private page, not the site)

- He asked for a page on the site with recordings of the prototype's settings, to be merged and deployed from
  GitHub. Two things stood in the way of doing exactly that, so the page is a private one instead
  (https://claude.ai/artifact/QmL1iJKpxRVwip15HRVbXG, open only to him):
  1. `controls-b8` serves firmware b14 from the installer, and no build after b7 has run on an FM-1 that I know
     of. Merging the branch would put untested firmware in front of the public; the site's rule is that only a
     build that has run on a device goes on it.
  2. The recordings are Doom's own music and sounds. Deployed from GitHub they would have to be committed to
     the public repository, where they would stay in its history; the project keeps game data and what is made
     from it out of the repository (`web/samples/` is ignored for that reason).
  If he still wants a page on the site: a branch off `main` with only that page would leave the installer alone;
  the second point is his to weigh.
- `web/record_sample.js OUT.wav PATTERN KIT LEVEL DIP PATCH` (new) records the same four bars of E1M1 (bars 5 to
  8, found with a new test hook for the song's position) from the prototype build with one set of settings, so
  takes differ only in the settings. 45 takes: the game's own; drum level 1 to 3 against music dip 1 to 4 on
  double bass and on a rock beat (METAL kit); all nine patterns and all eight kits at level 2, dip 2; Felucca's
  eight FM patches; one with drums and a patch together. MP3, 96 kbit/s mono, 4.6 MB in all.
- The page plays a take on a loop, carries on from the same place in the bar when another is tapped, and lets
  him keep takes and copy the list. NOT VERIFIED on a phone by me; the files are served as audio/mpeg.
- The measured levels of the takes, for when he reports back (RMS of the whole mix; the game's own is 2,204):
  double bass at level 1 / 2 / 3 is about 3,700 / 4,800 / 6,500; rock 3,000 / 3,800 / 5,000; the dip changes
  the RMS by under 3 %.

## 2026-10-11 — Drum machine prototype, third pass: Felucca's own effects chain, after a video (browser build only)

Sean sent a YouTube short as "the exact super punchy and crunchy drum sound I'm dreaming of ... supposed to be
running on felucca": https://youtube.com/shorts/9qCd4tj8J3U ("FM-1 Cyberpunk Jam | Felucca 1.1.5.1", Stanley
Gurvich).

- I cannot hear it. VERIFIED from the page's own text: the sounds were made with his own web / phone editor for
  the FM-1, which is not published yet; "the felucca live fx"; "khs limiter on the master" (a studio limiter
  plug-in on the recording). So it is the drum engine we already use (our Felucca checkout is v1.1.5), with
  patches we cannot see, Felucca's effects, and limiting twice over. ASSUMED: the punch is mostly the limiting,
  the crunch the engine's drive, the track distortion or the live CRUSH.
- **What Felucca does after its drum voices** (VERIFIED in its source), none of which passes one and two used:
  `eng_drum.c drum_render`: DRV, each voice x1 to x4 into the soft clip with its level kept, then x1.25 under a
  soft knee at 24,000; `fx.c track_dist`: DIST on the track (a 55 Hz low cut, drive up to x9, a lopsided soft
  clip, a two-pole tone filter that closes as the drive rises, make-up); `perform.c`: CRUSH, of the live
  effects, on the whole mix (12 down to 5 bits, each sample held 1 to 8 times); `fx.c master_out`: a DC blocker,
  a peak limiter (threshold 18,000, gives way in 4 samples, comes back over about 0.1 s), then the soft clip.
- **Built:** five kits after the eight (`firmware/fm1_drums.c`), on those stages copied as they are:

  | kit | voices | DRV | DIST | CRUSH | level x256 |
  |---|---|---|---|---|---|
  | LIMIT | Felucca's own kit | 0 | 0 | 0 | 132 |
  | CRUNCH | Felucca's own kit | 70 | 30 | 0 | 161 |
  | SLAM | the METAL kit's | 100 | 40 | 0 | 139 |
  | FUZZ 80 | Felucca's 80 kit | 127 | 105 | 0 | 150 |
  | CRUSH | Felucca's own kit | 60 | 0 | 50 | 113 |

  All five send the whole mix through the master stage while a pattern is on: the music goes in at twice its
  level (five steps on the page's M key, x0.7 to x2.8; the screen says MUSIC PUSH), so a hit pushes it down and
  it comes back between hits. The chain fades in and out over 40 ms with the pattern. CRUSH is on the kit only,
  not on the music as in Felucca (Sean's earlier verdict on distortion over the whole mix). The levels are set
  so that a rock beat goes into the limiter at the same strength on every kit (RMS 6,200, 3 dB over the music
  as it goes in): the kits differ in what a hit is, not in how loud.
- DEAD END: a make-up gain of x1.56 after the soft clip, to bring its top (16,400) up to the other kits' peaks.
  The limiter lets the first samples of a hit through, the soft clip rounds them off near full scale, and the
  gain then clipped them flat at 32,767. Felucca has no gain there; neither have we now.
- MEASURED, and new to me: **the game's own mix sits 1,431 above zero** (the take "own": RMS 2,204, of which
  1,676 is sound). The chip's music is lopsided (half-wave operator shapes). Harmless at a DAC, but it used up
  one side of the limiter's room, so Felucca's DC blocker went in ahead of the limiter, as in Felucca. Any
  later stage that clips or limits the game's sound needs the same.
- **BUG FOUND AND FIXED** (VERIFIED: six of the first 23 takes stopped with "memory access out of bounds"; none
  after the fix). Since pass two, every step with a hit before the song's next event got a callback of its own.
  The small build's callback queue holds 10, its "full" check is an assert that is compiled out, and a full
  queue writes its entry before the array. A long note with a busy pattern does it: the title tune's last note
  with any pattern of more than 8 hits a bar. E1M1 itself never has such a note, which is why 100 s tests and 45
  takes passed; the new takes needed more key presses at the title and so sat there longer. Engine patch 0025:
  the steps are a chain (one callback waits; when it has played its step it sets the next), and with
  `FM1_DRUMS` a full queue drops the callback. Nothing changes in a build without `FM1_DRUMS` (the device's).
  `web/test_drums.js` now starts with a pattern on through the title tune.
- VERIFIED headless: `node web/test_drums.js` (33 checks: all 13 kits play the pattern; a limiter kit is louder
  than twice the music with no flat tops, and with the drums off the music is back at its level);
  `node web/test_fm6.js`; the normal build's `test_sound_knobs.js`; `sh firmware/test.sh`.
- MEASURED on the takes (bars 5 to 8 of E1M1; RMS of the whole mix, peak; the game's own is 2,204 / 14,260):

  | kit | rock | double bass | four on the floor |
  |---|---|---|---|
  | LIMIT | 4,505 / 22,423 | 6,319 / 21,924 | 4,433 / 21,239 |
  | CRUNCH | 5,718 / 18,230 | 7,963 / 18,234 | 5,352 / 18,149 |
  | SLAM | 5,934 / 18,039 | 7,784 / 18,133 | 5,051 / 18,284 |
  | FUZZ 80 | 6,307 / 17,675 | 8,688 / 17,631 | 6,658 / 18,129 |
  | CRUSH | 4,861 / 21,868 | 7,032 / 21,719 | 4,936 / 20,772 |

  For comparison the second pass's METAL kit at drums 2, dip 2: rock 3,846, double bass 4,828. So these are
  2 to 5 dB louder as a whole, by design: the music between hits is about twice as loud as the game's own.
  With more music pushed in, the whole gets slightly quieter (CRUNCH double bass at drums 3: 8,582, 8,359,
  7,963, 7,536 for push 2 to 5), because the limiter then works harder on every hit.
- **Review page, version 2** (the same private address): a new first section with the five kits against three
  patterns, a grid of drum level 2 to 4 against music push 2 to 5 on CRUNCH with double bass, and one take with
  Felucca's Round bass patch on the melody. 28 new files, 73 in all.
- NOT VERIFIED: how any of it sounds, and whether it is nearer the video. Not measured: the cost on the chip.
  The limiter divides once a frame while it works (49,716 times a second), DIST and the DC blocker are a few
  multiplies a frame; Felucca runs the same stages on the same chip, at 44,100.
- LESSON: I recorded the takes three times (the crash, then the DC offset). Before designing a stage that
  depends on level, measure the input's offset and peaks first; and test a prototype where the recorder will
  use it (at the title, with many presses), not only where the test does.

## 2026-10-11 — Sean's first verdict on the third pass; which Felucca sounds the prototype has

- Sean, by ear, on the review page's grid: the default square (CRUNCH kit, double bass, drums 3, music 4, that is
  the music into the limiter at twice its level) "sounds pretty good to me". That is what the prototype build
  starts with on that kit, so nothing changes. VERIFIED by him on the recording only, not in the game.
- He asked how the Felucca patches on the page were chosen: none of the ones he was most interested in is there.
  They were not chosen by sound. The prototype has one of Felucca's engines, FM6 (the one the brief names for
  Phase 4), and its eight factory patches are all that engine has. VERIFIED in Felucca v1.1.5's source: the
  PRESETS knob there walks twelve engines with about 70 factory presets (ANALOG 12, FM6 8 + 8 converted from
  the retired four-operator engine, PHASE 6, LOFI 5, VOICE 4, TRIO 5, WHEEL 5, GRAIN 4, PHYS 9, NOISE 4, DRUM,
  and SAMPLE's recorded sounds), and every preset also sets chorus, delay and reverb sends, which the prototype
  does not have. So the sounds he likes on the device are most likely another engine's. Open: which ones.

## 2026-10-11 — Felucca's whole synth under the music, with its effects (browser build only); Sean's picks

- Sean, after the list of Felucca's presets: he is interested in RAVE, and thinks what he was missing in the
  first prototype is the chorus, delay and reverb the presets set. Both were right to chase: the first
  prototype (`firmware/fm1_fm6.c`, now removed; last in commit 7099f2e) had one engine of twelve, dry.
- **Built:** `firmware/fm1_felucca.c`: Felucca's sound core as its own host tests build it (`tests/hostsim.c`:
  libc, engines, voices, effects, sequencer in one compilation unit), with the music's melodic notes played on
  it. PRESETS 1 to 66 are its factory presets in the order of its own PRESETS knob (ANALOG 12, FM6 8, PHASE 6,
  LOFI 5, SAMPLE 4, VOICE 4, TRIO 5, WHEEL 5, GRAIN 4, PHYS 9, NOISE 4; DRUM and SLICE left out), then the
  game's 128. A preset is set as Felucca's knob sets it: engine, eight values, envelope, mono or poly, the four
  sends (distortion, chorus, delay, reverb). The delay follows the song's tempo. Notes are queued with their
  place in the mixer's pass, as the drum hits are.
- Felucca is four parts sharing eight voices. Each of the music's channels gets a part (E1M1 uses three), all
  on the same preset, so the 14 presets Felucca plays one note at a time (RAVE among them) keep each line.
  MEASURED on E1M1: a channel holds up to two notes at once, so those presets thin its chords; the recorder
  can force chords (`fm1_fm6_poly`), and the page has RAVE both ways.
- Level: Felucca's output (its own limiter keeps it near 18,000) goes into the game's mix at 96/256. MEASURED on
  the takes: RAVE 2,527 RMS against the game's own 2,204 (of which 1,431 is the chip's offset, so about 3.5 dB
  more sound); the presets range from 700 (plucked PHYS sounds) to 2,970.
- VERIFIED headless: `node web/test_felucca.js` (7 checks): all 66 play the melody with the chip only on
  drums, nothing clipped, every name fits the screen; RAVE uses three parts; PRESETS 67 is the chip again; the
  pitch knob and EDIT work; no underruns. `node web/test_drums.js` passes with it (34 checks).
- The wasm grew from 1,080 KB to 1,348 KB. SAMPLE's second preset is the first again (a retired set's alias).
- **Review page, version 3:** a new first section: RAVE (as Felucca plays it, and with chords), RAVE over the
  CRUNCH drums, and every preset by engine: 69 new takes, 142 in all, recorded eight at a time (3 min 43 s; the
  recorder's underrun count stayed at its start-up value on every take).
- **Sean's verdict by ear (2026-10-11):** "Oh yeah this is awesome. Saw Lead, Rave, Acid, Pulse Lo all sound
  awesome." That is ANALOG SAW LEAD, RAVE and ACID, and LOFI PULSE LD: two engines, all four one-note presets.
- **KNOB 4 is the drum selector** (his request: "I don't like the tempo control anyway"). In the prototype
  (`FM1_DRUMS`) KNOB 4 on the first page picks the beat, off at the bottom, and there is no tempo knob; the kit
  the machine starts on is CRUNCH (his pick), level 3, push 4. Engine patch 0026. The device build (b14) is
  unchanged and still has the tempo knob: it changes when a device build has the drums.

## 2026-10-11 — What could ship: first figures for the drums and the four sounds on the device (desk work)

Sean: "I'd like to start moving toward finding out what's actually feasible to ship in the firmware."
Nothing here ran on the device. Sizes are MEASURED with the device's compiler (`tools/size_probe.sh`:
the JieLi pi32v2 clang at the firmware's own flags on `fm1_drums.c` and `fm1_felucca.c`, sizes from the
objects' symbol tables); processor shares are ESTIMATES from Felucca's own figures.

- **What there is to spend** (VERIFIED earlier): flash, 15.7 KB spare in block 1 of the app slot at b14; RAM,
  the large-buffer region is full (12 B) and the other holds the game's heap, 233 KB, which the browser build
  has run in 200 KB (not measured: how much of it E1M1 really uses); processor, unknown: no frame rate has
  been measured on the FM-1 yet.
- **The drum machine as the prototype has it** (13 kits, all voices): code 12,990 B + constants 6,524 B =
  19.5 KB of flash, 2.2 KB of RAM. Too big as it is. Where it goes: 5.7 KB is setting a voice up from a kit's
  knobs (Felucca's `dv_setup` for all twelve voice kinds, inlined), 3.4 KB the voices themselves, 2.7 KB the
  mix with the chain, 2.05 KB the sine table, 1.4 KB Felucca's model kits, 0.8 KB my kit table, 0.8 KB the
  pitch table. A cut for the device: the CRUNCH kit only, the five voices its patterns use (kick, snare, hat,
  cymbal, tom), their settings worked out at build time (no set-up code, no pitch table), the chain: about
  9 KB of flash, 1.5 KB of RAM. ESTIMATE until it is built.
- **Felucca's synth whole:** code 71 KB, constants 157 KB (126 KB of it the recorded instruments), RAM 315 KB.
  Not a candidate; it was never meant to be.
- **The four sounds, cut to fit:** as Felucca compiles them, `analog_render` 1.7 KB and `lofi_render` 0.9 KB;
  one-note voices with glide about 1.3 KB (no chord allocation is needed: all four are one-note presets);
  envelope, LFO and filter control about 1 KB with 1 KB of tables; distortion 0.3 KB; chorus, delay and reverb
  0.9 KB; the limiter is the drums'; pitch and filter tables 1 KB; glue 1 KB. About 9 KB of flash, of which
  PULSE LD's engine is 1.2 KB. ESTIMATE until it is built.
- **So in flash:** the drums alone fit (about 9 of 15.7 KB), the sounds alone fit, both together come to about
  18 KB: 2 to 3 KB over, by estimate. Room to find: PULSE LD's engine (1.2 KB), a quarter sine table (1 KB),
  the tempo knob and what else the firmware can lose.
- **In RAM** the effects are the cost: Felucca's delay line is 131 KB (1.49 s); an eighth at 110 beats a
  minute needs 24 KB at 44.1 kHz, 12 KB at half that rate; the reverb 10 KB of combs plus its allpasses; the
  chorus 4 KB. With voices and the drums about 30 KB, all of it out of the game's heap (13 % of it). Each
  effect can be dropped on its own, so which of the three the sounds need is a question for Sean's ear.
- **Processor** (Felucca's host counts, `tests/cpu_baseline.txt`, at its measured 1.7 % of the chip per 100
  instructions a sample; ASSUMED to carry over): a RAVE voice about 2.5 %, SAW LEAD 1.9 %, ACID 2.0 %, PULSE LD
  0.9 % (each with a share of the effects in it); three lines of RAVE with effects about 10 %; the drums 4.5 %
  as Felucca's kit, about 6 % with the chain (the limiter divides once a sample). About 16 % together. Against
  that, with both on the emulated chip has nothing left to play and need not run; what it costs now is not
  measured. Only a build on the device with a load meter settles this.
- **The path:** (1) on the Mac: the device-shaped cuts built into the browser prototype in place of whole
  Felucca, compared by ear with the takes Sean liked, and linked into the real firmware for exact sizes, with
  the heap's real use measured; (2) on the device: a test build with a frame-rate and audio-load readout, which
  Sean installs; the recovery core compared as before every build; (3) what ships, and the controls for it.
