# The engine source

The game engine is [rp2040-doom](https://github.com/kilograham/rp2040-doom) by Graham Sanderson (itself built on
Chocolate Doom), with the FM-1 work on top of it. That work is the patch series in `rp2040-doom/`: twelve commits
against upstream commit `29a453c` (branch `rp2`, 2024-08-11), exported with `git format-patch`.

```bash
sh engine/get.sh        # clones upstream at that commit into ./rp2040-doom and applies the series as branch fm1-port
```

The build scripts expect the result in `./rp2040-doom`. Licences: the Doom engine code is GPL-2.0-or-later;
rp2040-doom's own additions are BSD-3-Clause; the FM-1 additions follow the file they are in.

To update the series after new commits on `fm1-port`:

```bash
rm engine/rp2040-doom/*.patch
git -C rp2040-doom format-patch -N --zero-commit --no-signature -o "$PWD/engine/rp2040-doom" 29a453c..fm1-port
```

No game data is in the series, and none may be added: `src/tiny.whd.h` (the embedded data of a host or browser
build) is made from a WAD and stays untracked.
