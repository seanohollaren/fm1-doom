#!/bin/sh
# What the firmware's Felucca sound costs on the FM-1: compiles firmware/fm1_sound.c (the drum machine and the
# synth) and, for comparison, firmware/fm1_felucca.c (Felucca's whole synth) with the device's compiler (the JieLi
# pi32v2 clang, in Docker, at the firmware's own flags) and leaves each object's section and symbol tables in
# firmware/build/probe/ (NAME.sec, NAME.syms: sizes per function and table).
# Nothing is linked and nothing here talks to the device.   tools/size_probe.sh
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.docker/bin:$PATH"
mkdir -p firmware/build/probe
cat > firmware/build/probe/run.sh <<'IN'
cd /p
CC="/opt/jieli/pi32v2/bin/clang -target pi32v2"
O=firmware/build/probe
F="-Os -ffunction-sections -fdata-sections -fno-builtin -w -isystem /opt/jieli/pi32v2/include -Ifirmware -IFelucca/build/gen -IFelucca/firmware/src -IFelucca/firmware/hal"
for n in sound felucca; do
  $CC $F -c firmware/fm1_$n.c -o $O/$n.o 2>$O/$n.err || { echo "FAIL $n"; head -8 $O/$n.err; exit 1; }
  /opt/jieli/common/bin/objdump -t $O/$n.o > $O/$n.syms
  /opt/jieli/common/bin/objdump -h $O/$n.o > $O/$n.sec
done
IN
docker run --rm --platform linux/amd64 -v "$PWD":/p -v "${JIELI_TOOLCHAIN:-$HOME/.jieli/toolchain}":/opt/jieli:ro debian:bookworm-slim sh /p/firmware/build/probe/run.sh
python3 - <<'PY'
import re
for n in ('sound', 'felucca'):
    t = {}
    for l in open(f'firmware/build/probe/{n}.sec'):
        m = re.match(r'\s*\d+\s+(\S+)\s+([0-9a-f]{8})\s', l)
        if m: t[m.group(1)] = int(m.group(2), 16)
    s = lambda p: sum(v for k, v in t.items() if k.startswith(p))
    print(f'{n}: code {s(".text")}  constants {s(".rodata")}  data {s(".data")}  bss {s(".bss")}')
PY
