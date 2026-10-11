#!/bin/sh
# Browser build of FM-1 Doom: rp2040-doom's tiny engine + src/fm1 platform layer -> build/doom.{js,wasm} + index.html
#   web/build.sh            (first: cd rp2040-doom && ./cup.sh FILE.whx   to embed the game data)
#   FM6=1 web/build.sh      the prototype with Felucca's six-operator FM engine playing the music's melodic notes
#                           (firmware/fm1_fm6.c) and its drum voices as a drum machine in time with the song
#                           (firmware/fm1_drums.c); needs ./Felucca built, for its tables; into web/build-fm6
# Uses the same engine configuration as the size check (sizecheck/defs.txt), i.e. the 32-bit small-memory layout.
set -e
cd "$(dirname "$0")/.."
OUT=web/build; [ -n "$FM6" ] && OUT=web/build-fm6; OBJ=$OUT/obj; mkdir -p $OBJ
D=""; for d in $(cat sizecheck/defs.txt); do case $d in TINY_WAD_ADDR=*|FM1_SHORTPTR_BASE=*) ;; *) D="$D -D$d";; esac; done
D="$D -DFM1=1 -DFM1_WEB=1 -DFM1_SHORTPTR_VAR=1 -Dmalloc=fm1_malloc -Dcalloc=fm1_calloc -Dfree=fm1_free"
I="-Irp2040-doom/src/fm1/shim -Isizecheck/stubs -Irp2040-doom/src -Irp2040-doom/src/doom -Irp2040-doom/src/pico -Irp2040-doom/src/fm1 -Irp2040-doom/opl -Irp2040-doom/textscreen -Irp2040-doom/src/adpcm-xq -Irp2040-doom"
for d in pico-sdk/src/common/*/include pico-sdk/src/host/*/include pico-extras/src/common/*/include pico-sdk/src/rp2_common/pico_stdio/include pico-extras/src/rp2_common/pico_scanvideo_dpi/include pico-extras/src/rp2_common/pico_audio_i2s/include; do I="$I -I$d"; done
# link order matters for the short-pointer window: big never-short-pointed buffers first, the heap block last (fm1_web_ram.c)
FILES="src/fm1/fm1_video.c src/fm1/fm1_web.c $(cat sizecheck/files.txt | tr ' ' '\n' | grep -v pd_render | tr '\n' ' ') src/pico/i_picosound.c opl/opl_pico.c ../pico-sdk/src/common/pico_util/pheap.c src/fm1/fm1_debug.c src/fm1/fm1_audio.c src/fm1/fm1_controls.c src/fm1/fm1_platform.c src/fm1/fm1_sdk.c src/fm1/fm1_web_ram.c"
FILES="src/pd_render.cpp $FILES"
if [ -n "$FM6" ]; then D="$D -DFM1_FM6=1 -DFM1_DRUMS=1"; I="$I -IFelucca/build/gen -IFelucca/firmware/src"; FILES="$FILES ../firmware/fm1_fm6.c ../firmware/fm1_drums.c"; fi
# as firmware/build_in.sh: reuse an object only if no header, define list or script changed since the last complete build
STAMP=$OBJ/.complete
if [ ! -f $STAMP ] || [ -n "$(find rp2040-doom/src rp2040-doom/opl rp2040-doom/textscreen sizecheck web/build.sh \( -name '*.h' -o -name '*.txt' -o -name '*.sh' -o -name '*.inc' \) -newer $STAMP 2>/dev/null | head -1)" ]; then
  FORCE=1; echo "shared files changed (or first build): recompiling everything"
fi
rm -f $STAMP
OBJS=""; fail=0
for f in $FILES; do
  o=$OBJ/$(echo $f | tr '/' '_').o; OBJS="$OBJS $o"
  [ "$o" -nt "rp2040-doom/$f" ] && [ -z "$FORCE" ] && continue
  case $f in opl/*.cpp) X="-std=c++14 -fno-exceptions -fno-rtti -UPICO_ON_DEVICE -DPICO_ON_DEVICE=0";; opl/*.c) X="-std=gnu11 -UPICO_ON_DEVICE -DPICO_ON_DEVICE=0";; *.cpp) X="-std=c++14 -fno-exceptions -fno-rtti";; *) X="-std=gnu11";; esac
  emcc -O2 -fms-extensions -w -include rp2040-doom/src/fm1/fm1_compat.h $D $X $I -c rp2040-doom/$f -o $o 2>$OUT/err.tmp || { echo "FAIL $f"; grep -m4 "error" $OUT/err.tmp; fail=1; }
done
[ $fail = 0 ] || exit 1
touch $STAMP
emcc -O2 --profiling-funcs -Wl,-Map=$OUT/doom.map $OBJS -o $OUT/doom.js -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576 -sEXPORTED_FUNCTIONS=_main,_fm1_web_panel,_fm1_web_enc,_fm1_web_underruns,_fm1_web_exit_level,_fm1_web_dump,_fm1_web_split_at,_fm1_web_warp,_fm1_web_awake,_fm1_web_lcd,_fm1_web_frames,_fm1_web_audio,_fm1_web_music,_fm1_web_osd,_fm1_web_filter_at$([ -n "$FM6" ] && echo ,_fm1_fm6_voices,_fm1_drums_hits) -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16
# the page names the build in the addresses of the game's two files, so that a browser cannot show an older one
sed -e "s/@BUILD@/$(date +%s)/g" -e "s/@BUILT@/$(date '+%-d %b %H:%M')/" web/index.html > $OUT/index.html
# the prototype says what it is, and where its patches are
[ -n "$FM6" ] && sed -i.bak 's|<p>FM-1 Doom \&mdash;|<p><b>PROTOTYPE with Felucca\&rsquo;s sounds.</b> Drum machine: <b>B</b> (SEQ) brings in a beat and steps through the patterns, <b>K</b> (ARP) through the kits, <b>N</b> (SAVE) through five loudnesses.<br>FM engine: PRESETS (keys 7 / 8), the first eight clicks are its patches, then the game\&rsquo;s own instruments.</p><p>FM-1 Doom \&mdash;|' $OUT/index.html && rm -f $OUT/index.html.bak
echo "web: $OUT ($(wc -c < $OUT/doom.wasm | tr -d ' ') B wasm)"
