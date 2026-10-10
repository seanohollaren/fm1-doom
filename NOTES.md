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
  id `b5fbbf3a`; `doom_part1.fwsc` SHA-256 `b2ed37e8…6185b646`, `doom_code.fwsc` `fcd9fd37…757112c2`; data block 2
  unchanged (`e4dcdbba…`, what the FM-1 holds). Block 1 has 19,416 B spare.
- Checks: 17 package runs pass (`firmware/test.sh`, now with the volume test); the predicted flash after
  installing b6 over b5 (138 of 143 app sectors change, nothing else) passes `check_dump.py` with the official
  head. Symbols: `firmware/installed_b2ed37e8/`.
- NOT VERIFIED until it runs on the FM-1: that the knob's direction and range feel right (the mapping is
  Felucca's, so it should match the synth), that full volume does not distort on the speaker, and how the Mac
  names the MIDI port after the change (it may keep showing the old name for a while).
