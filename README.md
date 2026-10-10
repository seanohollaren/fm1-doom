# Doom for the M-VAVE FM-1

The first level of Doom, running as firmware on an M-VAVE FM-1 pocket synthesizer: its own 240×240 screen, its
own keys and knobs, its own speaker. The chip has 1 MB of flash and 512 KB of RAM, so this is one level (E1M1)
with the title screen, sound and music, on the engine of [rp2040-doom](https://github.com/kilograham/rp2040-doom)
and the hardware layer and update loader of [Felucca](https://github.com/hugelton/Felucca).

**Experimental.** It has been installed and played on one FM-1. It replaces the synth firmware (which can be
put back). Use it at your own risk.

Install it from the browser: <https://doom.deadlockinteractive.com> (Chrome or Edge, USB).

## What is here

| Path | What |
| --- | --- |
| `firmware/` | The device firmware: `doom_dev.c` (recovery-first start-up, USB update, screen, sound, input on Felucca's HAL), the build and packaging scripts, host tests. |
| `engine/` | The game engine's source: a patch series on upstream rp2040-doom, and a script that fetches and applies it. |
| `web/` | The install logic as plain JavaScript modules (cut a WAD, convert it, pack it, the update protocol), a single-file installer page, and the browser build of the game used for development. |
| `site/` | The public installer site (Vite + React) and its AWS set-up (CDK). See `site/README.md`. |
| `tools/` | Mac-side tools: cutting the game data, and boot-mode backup / restore of the FM-1's flash. |
| `NOTES.md` | The running log: every measurement, decision, build and device result, in order. Start here for detail. |

No game data is in this repository, and none may be added: no WAD, nothing cut or converted from one.
The site downloads id Software's shareware `DOOM1.WAD` into the visitor's browser (or takes their own copy) and
prepares it there.

## Building

The firmware builds with JieLi's pi32v2 toolchain and AC79 SDK, set up as Felucca's `BUILDING.md` describes
(on macOS: in a `linux/amd64` Docker container). It also needs, cloned next to this file:

| Clone | Version |
| --- | --- |
| `Felucca` | tag `v1.1.5` (`276f72a`), <https://github.com/hugelton/Felucca> |
| `rp2040-doom` | `sh engine/get.sh` (upstream `29a453c` plus `engine/rp2040-doom/*.patch`) |
| `pico-sdk` | tag `2.3.1`, <https://github.com/raspberrypi/pico-sdk> (headers only) |
| `pico-extras` | tag `sdk-2.3.0`, <https://github.com/raspberrypi/pico-extras> (headers only) |

```bash
sh firmware/build.sh                               # the firmware image
python3 firmware/pack.py data/e1m1_6h.whx          # installable packages (needs game data you cut yourself)
sh firmware/test.sh                                # host tests of the update and data paths
```

The game data file comes from your own `doom1.wad`: `tools/cut_wad.py wads/doom1.wad data/e1m1_6h.wad 6 --half-sfx`,
then rp2040-doom's `whd_gen`. `NOTES.md` has the exact commands, the environment variables, and what each step
was checked against. The site and the browser tools are described in `site/README.md`.

## Safety

The firmware is built to stay recoverable: it never writes the boot code, it accepts a new firmware over USB in
every state (hold HOME while switching on for a screen that only waits for one), and a start that fails drops
back to that screen by itself. `tools/fm1boot.py` and `tools/fm1restore.py` can read and restore the whole
flash through the chip's built-in USB boot mode. A firmware that fails before any of that runs can only be
recovered with extra hardware (see `NOTES.md`, "Recovery").

## Licence

Copyright (C) 2026 Sean O'Hollaren. This project is free software under the GNU General Public License,
version 3 only (`LICENSE`). It is built from, and its firmware contains, other people's work:

- **Doom** source © id Software, via **Chocolate Doom** © Simon Howard and **rp2040-doom** © Graham Sanderson:
  GPL-2.0-or-later (engine), BSD-3-Clause (rp2040-doom's additions).
- **Felucca** © 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments: GPL-3.0-only. Its hardware layer, USB
  and update code and update loader are used unmodified; `web/vendor/felucca/` holds unmodified copies of its
  package and update-protocol scripts.
- Three files of the **JieLi AC79 SDK** inside every firmware package: Apache-2.0.
- **adpcm-xq** © David Bryant, in the data converter: BSD-3-Clause.

The licence texts that travel with the firmware and the converter are in `site/frontend/public/licenses/`.

DOOM is a trademark of id Software. M-VAVE and FM-1 are trademarks of their owners. This project is not
affiliated with or endorsed by id Software, ZeniMax, M-VAVE or Hügelton Instruments.
