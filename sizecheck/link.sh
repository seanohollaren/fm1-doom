#!/bin/sh
# inside the container: link the size-check objects (stubs for the unwritten platform layer) with dead-code removal
cd /p/sizecheck
/opt/jieli/pi32v2/bin/clang -target pi32v2 -c stubs/link_stubs.S -o obj_stubs.o || exit 1
ROOTS=""
for o in obj/src_pd_render.cpp.o obj/opl_opl_api.c.o obj/src_musx_decoder.c.o obj/src_i_sound.c.o obj/src_i_oplmusic.c.o obj/src_doom_s_sound.c.o; do
  for s in $(/opt/jieli/pi32v2/bin/nm $o | awk '$2=="T"{print $3}'); do ROOTS="$ROOTS -u $s"; done
done
/opt/jieli/pi32v2/bin/ld --gc-sections -e fm1_entry $ROOTS -T link.ld obj_stubs.o obj/*.o --start-group /opt/jieli/pi32v2/lib/libc.a /opt/jieli/pi32v2/lib/libcompiler-rt.a /opt/jieli/pi32v2/lib/libm.a --end-group -Map link.map -o doom_size.elf 2> link.err
echo "ld=$?"; head -30 link.err
/opt/jieli/common/bin/objdump -h doom_size.elf 2>/dev/null | grep -E "^ +[0-9]+ \."
