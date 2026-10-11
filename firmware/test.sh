#!/bin/sh
# Host tests of the Doom packages against Felucca's simulated flash and fake update host. Run after
# firmware/build.sh, firmware/pack.py DATA.whx and a stock Felucca build (Felucca/build/felucca.fwsc).
set -e
cd "$(dirname "$0")/.."
B=firmware/build; T=$B/tests; F=Felucca/build/felucca.fwsc
python3 firmware/tests/gen_tests.py >/dev/null
CC="${CC:-cc} -O1 -Wall -Wno-unused-function"
fail=0
run() { echo "== $1"; shift; "$@" || fail=1; }
$CC -DOWN_PKG=1 -o $T/ota_test Felucca/tests/ota_test.c       # Felucca's tests, unmodified
$CC -o $T/ldr_test Felucca/tests/ldr_test.c
$CC -o $T/ldr_test_ext $T/ldr_test_ext.c                      # Felucca's checks, the loader variant's core
$CC -o $T/doom_ldr_test $T/doom_ldr_test.c                    # the variant with a long package

for p in doom_code doom_part1 doom_full; do
  run "$p: Felucca's update entry accepts it and stages its loader [Felucca's test]" $T/ota_test $B/$p.fwsc
done
for p in doom_code doom_part1; do
  run "$p: Felucca installed -> $p, Felucca's loader [Felucca's test]" $T/ldr_test $F $B/$p.fwsc
  run "$p: $p installed -> Felucca, Felucca's loader [Felucca's test]" $T/ldr_test $B/$p.fwsc $F
done
run "doom_part1 after doom_code, Felucca's loader [Felucca's test]" $T/ldr_test $B/doom_code.fwsc $B/doom_part1.fwsc
run "loader variant, ordinary package: Felucca -> Felucca's own build, every Felucca check" $T/ldr_test_ext $F $F
run "loader variant, ordinary package: full Doom installed -> Felucca (the way out), every Felucca check" $T/ldr_test_ext $B/doom_full.fwsc $F
run "loader variant, ordinary package: full Doom installed -> doom_code, every Felucca check" $T/ldr_test_ext $B/doom_full.fwsc $B/doom_code.fwsc
run "loader variant, long package: doom_part1 installed -> doom_full (app area must not be touched)" $T/doom_ldr_test $B/doom_part1.fwsc $B/doom_full.fwsc same-app
run "loader variant, long package: Felucca installed -> doom_full" $T/doom_ldr_test $F $B/doom_full.fwsc
run "loader variant, long package: doom_full again" $T/doom_ldr_test $B/doom_full.fwsc $B/doom_full.fwsc same-app
run "full Doom installed -> Felucca, Felucca's loader [Felucca's test]" $T/ldr_test $B/doom_full.fwsc $F
$CC -Wextra -o $T/data_test firmware/tests/data_test.c            # the second data block written by our own firmware
run "data block 2 over USB: firmware/dev_data.h against a simulated flash and host" $T/data_test
$CC -Wextra -o $T/volume_test firmware/tests/volume_test.c        # the MASTER knob as the game's volume
run "volume: firmware/dev_volume.h" $T/volume_test
$CC -Wextra -I rp2040-doom/src/fm1 -o $T/filter_test firmware/tests/filter_test.c -lm   # the filter on KNOB 1 / KNOB 2
run "filter: rp2040-doom/src/fm1/fm1_filter.h" $T/filter_test
[ $fail = 0 ] && echo "ALL DOOM PACKAGE TESTS PASSED" || echo "DOOM PACKAGE TESTS FAILED"
exit $fail
