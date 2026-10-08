# FM-1 Doom Port

Goal: run Doom on an M-VAVE FM-1 pocket synth as a custom firmware, with input from the FM-1's own keys/knobs, video on its TFT, and (stretch goal) music played through an FM synth engine.

This is a hobby project. Correctness and not bricking the device matter more than speed.

## Hard rules

- **Never flash, write, or erase anything on the FM-1 without asking me first and getting a clear yes.** This includes the web installer, `fm1_install.py`, FM-1 Transporter, and any JieLi UBOOT/flash tool. Show me the exact command and file before running it.
- Before the first experimental flash, confirm we have a working recovery path (see Recovery) and a full flash backup.
- Never commit or redistribute a commercial Doom WAD. Use the shareware `doom1.wad` or Freedoom only.
- Keep a running log of findings in `NOTES.md` (facts learned, measurements, dead ends). Mark each fact as VERIFIED (seen in code/on device) or ASSUMED.
- Commit small and often on a working branch. Stock Felucca must always be rebuildable from a clean checkout.

## What we know (from public sources, Oct 2026)

VERIFIED from Felucca's repo/docs:
- The FM-1 uses a JieLi AC79-family SoC. Felucca builds against the JieLi AC79 SDK (`AC79NN_SDK_V1.2.1_2023-12-13`) and uses `cpu/wl82/...` files. WL82 = AC791N.
- Toolchain: JieLi clang 4.0.1 for the **pi32v2** architecture (not ARM). Linux x86-64 only; on macOS Felucca's `build.sh` runs it in a `linux/amd64` Docker container.
- Firmware package format is `.fwsc` (app + update loader). Felucca's install path is USB MIDI (web installer in Chrome/Edge, or `tools/fm1_install.py`).
- Boot ROM mode: a bricked FM-1 enumerates as USB device `WL80UBOOT` (mass-storage, ID `4C4A:8057`).
- Felucca has a hardware layer (`firmware/hal/`), an update loader (`firmware/loader/`), a USB serial console (`FELUCCA_CDC`), host tests, and a WebAssembly browser emulator (`web/emu/`).
- The FM-1 also exposes USB audio and USB MIDI. The panel has 27 keys (F to G), 14 buttons, 7 encoders + a volume knob, a colour TFT, and a speaker.

ASSUMED / TO VERIFY in Phase 0:
- AC791N public specs: dual-core 32-bit with FPU, up to 320 MHz, ~578 KB on-chip SRAM. Which exact package/variant the FM-1 uses, and whether there is PSRAM/SDRAM, is unknown.
- Flash size, whether flash is memory-mapped/XIP (important: Doom's WAD and constant data should live in flash, not RAM), display resolution, pixel format, display bus, and audio sample rate are all unknown.
- Baud Girl's firmware docs describe the chip as low-power with a limited achievable sample rate, so the CPU budget is tight.

## Key repos

- Felucca (base firmware, HAL, installer, emulator): https://github.com/hugelton/Felucca — GPL-3.0-only
- FM-1 Transporter (flash read/write recovery via Seeed XIAO RP2040): https://github.com/kurogedelic/FM-1-transporter
- JieLi AC79 SDK: https://gitee.com/Jieli-Tech/fw-AC79_AIoT_SDK (tag `AC79NN_SDK_V1.2.1_2023-12-13`)
- doomgeneric (portable Doom; implement a few DG_* platform functions): https://github.com/ozkl/doomgeneric
- rp2040-doom (reference for running Doom in very little RAM: WAD in flash, compressed/precomputed data): https://github.com/kilograham/rp2040-doom
- jl-uboot-tool (JieLi UBOOT protocol notes; read-only reference unless I approve use): https://github.com/kagaimiq/jl-uboot-tool
- X0X, a Felucca fork with a browser build: https://github.com/charlesvestal/fm1-x0x

Check each repo's actual license before combining code. Felucca is GPL-3.0-only. My understanding is that the Doom source is GPL-2.0-or-later, which would make a GPL-3 combined work fine — verify this from the license files.

## Recovery

If an install fails and the FM-1 stays black: first retry with a known-good USB data cable and with all other MIDI apps closed. If it stays in `WL80UBOOT` mode, FM-1 Transporter can back up and write the flash, and M-VAVE's official `FM-1.fwsc` restores stock. Read the Transporter README fully and tell me what hardware and wiring it needs before we depend on it.

## Phases (stop at the end of each one and report to me)

**Phase 0 — Environment + investigation (no device writes)**
1. Detect this machine's OS/arch and set up the toolchain + SDK as Felucca's BUILDING.md describes (Docker on macOS). Install anything missing, telling me what you install.
2. Clone Felucca and build stock Felucca. Run `tests/run_tests.sh`.
3. Read the HAL, linker script(s), startup code, and SDK board config, then answer in NOTES.md: RAM regions and sizes, how much is free after the HAL/USB stack, PSRAM yes/no, flash size and whether it is memory-mapped, display resolution/format/bus and how frames are pushed, how keys/encoders are read, audio output path and sample rate, timer/tick source, and how the update loader decides what to boot.
4. Read FM-1 Transporter and summarize the recovery procedure.
5. Give me a go/no-go estimate for Doom's memory needs versus what's available, and the main risks.

**Phase 1 — Flash stock Felucca (with my approval)** to prove the install path end to end.

**Phase 2 — Test program.** Strip Felucca's app down to a minimal program on the HAL: fill the screen with a test pattern, show key/encoder presses on screen, play a test tone, show an FPS counter. Get it working in the browser emulator first, then on hardware (with my approval).

**Phase 3 — Doom.** Port doomgeneric onto the HAL: frame blit (scale/convert 320x200 to the TFT), input mapping, ticks/sleep, WAD read from flash. Apply rp2040-doom-style memory tricks only as needed. Target: the shareware E1M1 title screen first, then gameplay.

**Phase 4 — Sound (stretch).** SFX first, then music. Ideally play Doom's MUS/MIDI music through Felucca's FM6 (Dexed-based) engine.

## Proposed controls (adjust after Phase 0)

The keyboard's white keys work as a D-pad (turn left/right, forward/back), with fire, use, strafe and run on other keys. Use the encoders for weapon select and the menu, and the buttons for Esc, Enter, map and save.

## About me

Dev machine: Sean's Mac (macOS, probably Apple silicon; confirm with `uname -m`). Use Docker Desktop for the JieLi toolchain, as Felucca's BUILDING.md describes. Clone repos into subfolders of this project (e.g. `./Felucca`, `./doomgeneric`), and put the SDK and toolchain where BUILDING.md's defaults expect them unless I say otherwise.


Experienced software engineer (backend/serverless, AWS), but new to JieLi chips and embedded game porting. Explain embedded-specific decisions briefly; skip general programming basics.
