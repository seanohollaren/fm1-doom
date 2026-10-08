#!/bin/sh
# Host tests of the Doom package against Felucca's simulated flash and fake update host. Run after
# firmware/build.sh, firmware/pack.py and a stock Felucca build (Felucca/build/felucca.fwsc).
set -e
cd "$(dirname "$0")/.."
T=firmware/build/tests; mkdir -p $T
CC="${CC:-cc} -O1 -Wall -Wno-unused-function"
fail=0
run() { echo "== $1"; shift; "$@" || fail=1; }
$CC -DOWN_PKG=1 -o $T/ota_test Felucca/tests/ota_test.c
run "Felucca's update entry accepts the Doom package and stages its loader (Felucca's own test, unmodified)" $T/ota_test firmware/build/doom.fwsc
$CC -o $T/doom_ldr_test firmware/tests/doom_ldr_test.c
run "extended loader: Felucca installed -> Doom package (code + game data)" $T/doom_ldr_test Felucca/build/felucca.fwsc firmware/build/doom.fwsc
run "extended loader: Doom installed -> Doom package again" $T/doom_ldr_test firmware/build/doom.fwsc firmware/build/doom.fwsc
$CC -o $T/ldr_test Felucca/tests/ldr_test.c
run "way back: Doom installed -> Felucca package with Felucca's own loader (Felucca's own test, unmodified)" $T/ldr_test firmware/build/doom.fwsc Felucca/build/felucca.fwsc
if [ -f firmware/build/doom_nodata.fwsc ]; then
  run "code-only package: Felucca's update entry accepts it (Felucca's own test, unmodified)" $T/ota_test firmware/build/doom_nodata.fwsc
  run "code-only package: Felucca installed -> it, Felucca's own loader (Felucca's own test, unmodified)" $T/ldr_test Felucca/build/felucca.fwsc firmware/build/doom_nodata.fwsc
  run "code-only package: it installed -> Felucca (Felucca's own test, unmodified)" $T/ldr_test firmware/build/doom_nodata.fwsc Felucca/build/felucca.fwsc
fi
[ $fail = 0 ] && echo "ALL DOOM PACKAGE TESTS PASSED" || echo "DOOM PACKAGE TESTS FAILED"
exit $fail
