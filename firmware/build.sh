#!/bin/sh
# FM-1 Doom firmware: rp2040-doom's tiny engine + src/fm1 platform layer + firmware/doom_dev.c on Felucca's HAL,
# compiled with the JieLi pi32v2 toolchain in Docker.   firmware/build.sh  ->  firmware/build/doom.{elf,bin,map}
# It does NOT make an installable package and nothing here talks to the device.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.docker/bin:$PATH"
TC="${JIELI_TOOLCHAIN:-$HOME/.jieli/toolchain}"
exec docker run --rm --platform linux/amd64 -v "$PWD":/p -v "$TC":/opt/jieli:ro -e FORCE="$FORCE" debian:bookworm-slim sh /p/firmware/build_in.sh
