#!/bin/sh
# Makes firmware/fm1_sound_gen.h (see firmware/gen_sound.c) from the Felucca checkout beside this repository.
#   tools/gen_sound.sh          writes it
#   tools/gen_sound.sh check    exit 1 if the one in the repository is not what the generator prints now
set -e
cd "$(dirname "$0")/.."
mkdir -p firmware/build
cc -O1 -w -IFelucca/build/gen -IFelucca/firmware/src -o firmware/build/gen_sound firmware/gen_sound.c
if [ "$1" = check ]; then
  firmware/build/gen_sound | cmp -s - firmware/fm1_sound_gen.h || { echo "firmware/fm1_sound_gen.h is stale: run tools/gen_sound.sh"; exit 1; }
  echo "fm1_sound_gen.h is current"
else
  firmware/build/gen_sound > firmware/fm1_sound_gen.h
  echo "wrote firmware/fm1_sound_gen.h ($(wc -c < firmware/fm1_sound_gen.h | tr -d ' ') B)"
fi
