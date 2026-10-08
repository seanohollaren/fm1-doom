#!/bin/sh
# runs inside the container: compile each rp2040-doom source to an object with JieLi clang, report sizes
cd /p
D=""; for d in $(cat sizecheck/defs.txt); do D="$D -D$d"; done
I="-Isizecheck/stubs -Irp2040-doom/src -Irp2040-doom/src/doom -Irp2040-doom/src/pico -Irp2040-doom/opl -Irp2040-doom/textscreen -Irp2040-doom/src/adpcm-xq -Irp2040-doom"
for d in pico-sdk/src/common/*/include pico-sdk/src/host/*/include pico-extras/src/common/*/include pico-sdk/src/rp2_common/pico_stdio/include pico-extras/src/rp2_common/pico_scanvideo_dpi/include pico-extras/src/rp2_common/pico_audio_i2s/include pico-sdk/src/rp2_common/hardware_base/include pico-sdk/src/rp2040/hardware_regs/include pico-sdk/src/rp2040/pico_platform/include; do I="$I -I$d"; done
mkdir -p sizecheck/obj; rm -f sizecheck/obj/* sizecheck/errors.log
for f in $(cat sizecheck/files.txt); do
  o=sizecheck/obj/$(echo $f | tr '/' '_').o
  case $f in *slot_render.cpp) X="-std=c++14 -fno-exceptions -fno-rtti -Isizecheck/stubs/cxx -UPICO_ON_DEVICE -DPICO_ON_DEVICE=0";; *.cpp) X="-include stdlib.h -DUSBCTRL_DPRAM_BASE=0x01C00000 -std=c++14 -fno-exceptions -fno-rtti -Isizecheck/stubs/cxx -Isizecheck/stubs/hw";; *) X="-std=gnu11";; esac
  if /opt/jieli/pi32v2/bin/clang -target pi32v2 -Os -ffunction-sections -fdata-sections -fms-extensions -w -isystem /opt/jieli/pi32v2/include $D $X $I -c rp2040-doom/$f -o $o 2>sizecheck/err.tmp; then :; else echo "FAIL $f" >> sizecheck/errors.log; grep -m3 "error" sizecheck/err.tmp >> sizecheck/errors.log; fi
done
for o in sizecheck/obj/*.o; do echo "== $o"; /opt/jieli/common/bin/objdump -h $o | grep -E "^ +[0-9]+ \\."; done > sizecheck/sizes.txt
