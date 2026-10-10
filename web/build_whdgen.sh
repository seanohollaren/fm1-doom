#!/bin/sh
# Browser build of rp2040-doom's data converter (whd_gen): build/whdgen/whd_gen.{js,wasm}
#   web/build_whdgen.sh
# The installer page runs it on a WAD the user picks, so that no game data has to be hosted.
# Assertions stay ON (they are the converter's only checks on its input) and -DLOOKAHEAD=5 gives the sound
# encoding of a release build: the output is byte-for-byte what tools/whd_gen (native, -DNDEBUG) writes.
set -e
cd "$(dirname "$0")/.."
OUT=web/build/whdgen; OBJ=$OUT/obj; mkdir -p $OBJ
S=rp2040-doom/src
F="-O2 -DIS_WHD_GEN=1 -DLOOKAHEAD=5 -w -I$S -I$S/doom -I$S/whd_gen -I$S/adpcm-xq"
STR='-D__STRING(x)=#x'     # a BSD/glibc macro the sources rely on; emscripten's C library has none
OBJS=""
for f in whd_gen/whd_gen.cpp whd_gen/mus2seq.cpp whd_gen/huff.cpp whd_gen/lodepng.cpp whd_gen/compress_mus.cpp whd_gen/wad.cpp; do
  o=$OBJ/$(basename $f).o; OBJS="$OBJS $o"
  em++ -std=c++17 -fexceptions -Wno-missing-template-arg-list-after-template-kw $F "$STR" -c $S/$f -o $o &
done
for f in tiny_huff.c musx_decoder.c image_decoder.c adpcm-xq/adpcm-lib.c; do
  o=$OBJ/$(basename $f).o; OBJS="$OBJS $o"
  emcc $F "$STR" -c $S/$f -o $o &
done
wait
for o in $OBJS; do [ -f $o ] || { echo "FAIL $o"; exit 1; }; done
em++ -O2 -fexceptions $OBJS -o $OUT/whd_gen.js \
  -sMODULARIZE=1 -sEXPORT_NAME=WhdGen -sENVIRONMENT=web,worker,node -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=4194304 -sEXPORTED_RUNTIME_METHODS=FS,callMain
echo "whdgen: $OUT ($(wc -c < $OUT/whd_gen.wasm | tr -d ' ') B wasm, $(wc -c < $OUT/whd_gen.js | tr -d ' ') B js)"
