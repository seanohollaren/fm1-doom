#!/bin/sh
# runs inside the container (firmware/build.sh)
cd /p
CC="/opt/jieli/pi32v2/bin/clang -target pi32v2"
OUT=firmware/build; OBJ=$OUT/obj; mkdir -p $OBJ
D=""; for d in $(cat sizecheck/defs.txt); do case $d in TINY_WAD_ADDR=*|FM1_SHORTPTR_BASE=*) ;; *) D="$D -D$d";; esac; done
D="$D -DFM1=1 -DFM1_DEVICE=1 -DFM1_SHORTPTR_BASE=0x01C3C000 -Dmalloc=fm1_malloc -Dcalloc=fm1_calloc -Dfree=fm1_free"
I="-Irp2040-doom/src/fm1/shim -Isizecheck/stubs -Irp2040-doom/src -Irp2040-doom/src/doom -Irp2040-doom/src/pico -Irp2040-doom/src/fm1 -Irp2040-doom/opl -Irp2040-doom/textscreen -Irp2040-doom/src/adpcm-xq -Irp2040-doom"
for d in pico-sdk/src/common/*/include pico-sdk/src/host/*/include pico-extras/src/common/*/include pico-sdk/src/rp2_common/pico_stdio/include pico-extras/src/rp2_common/pico_scanvideo_dpi/include; do I="$I -I$d"; done
FILES="src/pd_render.cpp src/fm1/fm1_video.c $(cat sizecheck/files.txt | tr ' ' '\n' | grep -v pd_render | tr '\n' ' ') src/pico/i_picosound.c opl/opl_pico.c ../pico-sdk/src/common/pico_util/pheap.c src/fm1/fm1_audio.c src/fm1/fm1_controls.c src/fm1/fm1_platform.c src/fm1/fm1_sdk.c"
# An object is reused only if its own source is older AND nothing shared changed since the last complete build:
# any header, the define list, this script. (2026-10-09: a header-only change, the two-block lump_data(), had left
# 102 stale objects in an installed build.)
STAMP=$OBJ/.complete
if [ ! -f $STAMP ] || [ -n "$(find rp2040-doom/src rp2040-doom/opl rp2040-doom/textscreen sizecheck firmware/build_in.sh firmware/doom.ld \( -name '*.h' -o -name '*.txt' -o -name '*.sh' -o -name '*.ld' -o -name '*.inc' \) -newer $STAMP 2>/dev/null | head -1)" ]; then
  FORCE=1; echo "shared files changed (or first build): recompiling everything"
fi
rm -f $STAMP
OBJS=""; fail=0
for f in $FILES; do
  o=$OBJ/$(echo $f | tr '/' '_').o; OBJS="$OBJS $o"
  [ "$o" -nt "rp2040-doom/$f" ] && [ -z "$FORCE" ] && continue
  CXX="-std=c++14 -fno-exceptions -fno-rtti -fno-threadsafe-statics -include stdlib.h -Irp2040-doom/src/fm1/shim/cxx"
  case $f in opl/*.cpp) X="$CXX -UPICO_ON_DEVICE -DPICO_ON_DEVICE=0";; opl/*.c) X="-std=gnu11 -UPICO_ON_DEVICE -DPICO_ON_DEVICE=0";; *.cpp) X="$CXX";; *) X="-std=gnu11";; esac
  $CC -Os -ffunction-sections -fdata-sections -fms-extensions -w -isystem /opt/jieli/pi32v2/include -include rp2040-doom/src/fm1/fm1_compat.h $D $X $I -c rp2040-doom/$f -o $o 2>$OUT/err.tmp || { echo "FAIL $f"; grep -m4 "error" $OUT/err.tmp; fail=1; }
done
F=Felucca/firmware
# doom_dev.c includes "usb.c": the copy with our own USB names (firmware/gen_usb.py) must be the one it finds
[ -f firmware/build/gen/usb.c ] || { echo "FAIL no firmware/build/gen/usb.c: run firmware/build.sh, which makes it"; exit 1; }
$CC -c $F/crt0.S -o $OBJ/crt0.o && $CC -c $F/hal/fm1_vec.S -o $OBJ/fm1_vec.o && $CC -c $F/hal/fm1_isr.S -o $OBJ/fm1_isr.o || fail=1
$CC -Os -ffunction-sections -fno-builtin -Wall -Wno-unused-function -Ifirmware/build/gen -I$F/hal -I$F/src -Irp2040-doom/src/fm1 -c firmware/doom_dev.c -o $OBJ/doom_dev.o 2>$OUT/err.tmp || { echo "FAIL doom_dev.c"; grep -m12 "error" $OUT/err.tmp; fail=1; }
$CC -Os -ffunction-sections -fno-builtin -isystem /opt/jieli/pi32v2/include -c firmware/fm1_printf.c -o $OBJ/fm1_printf.o 2>$OUT/err.tmp || { echo "FAIL fm1_printf.c"; grep -m6 "error" $OUT/err.tmp; fail=1; }
[ $fail = 0 ] || exit 1
touch $STAMP
/opt/jieli/pi32v2/bin/ld --gc-sections -e _start -T firmware/doom.ld $OBJ/crt0.o $OBJ/fm1_vec.o $OBJ/fm1_isr.o $OBJ/doom_dev.o $OBJ/fm1_printf.o $OBJS \
   --start-group /opt/jieli/pi32v2/lib/libc.a /opt/jieli/pi32v2/lib/libcompiler-rt.a /opt/jieli/pi32v2/lib/libm.a --end-group -Map $OUT/doom.map -o $OUT/doom.elf 2>$OUT/link.err || { sort -u $OUT/link.err | head -60; exit 1; }
/opt/jieli/common/bin/objdump -h $OUT/doom.elf | grep -E "^ +[0-9]+ \." 
/opt/jieli/common/bin/objdump -t $OUT/doom.elf > $OUT/doom.syms
for s in text ram_text data; do /opt/jieli/common/bin/objcopy -O binary -j .$s $OUT/doom.elf $OUT/$s.bin; done
# identity of the recovery core: the device unit, Felucca's start-up / vector / interrupt stubs and the memory map.
# The same id as a build that has already run on the device = the same recovery code (before linking).
cat $OBJ/doom_dev.o $OBJ/crt0.o $OBJ/fm1_vec.o $OBJ/fm1_isr.o firmware/doom.ld | sha256sum | cut -c1-16 > $OUT/core.id
echo "recovery core id $(cat $OUT/core.id)"
