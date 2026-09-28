#!/bin/sh
# Runs every test with Node 18+. No browser, GPU or network needed.
cd "$(dirname "$0")" && ./sync.sh || exit 1
fail=0
for t in test_*.mjs; do echo "--- $t"; node "$t" || fail=1; done
[ $fail = 0 ] && echo "ALL TESTS PASSED" || { echo "SOME TESTS FAILED"; exit 1; }
