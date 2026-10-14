# Stability follow-up evidence

Source marker: `2.3.0 stability-test.5`; no release or TV installation in this follow-up. `source-sha256.json` identifies tested source, including earlier uncommitted fixes. Candidate 4 TV results remain in the sibling `2026-10-13-stability` directory.

## Regression evidence

- `live-before`: original network-CDN preference and initial 7-second stall target fail; short stall/pause passes.
- `live-after`: first fix, 11/12; the 7-second target still fails because polling plus retry backoff must be included. This failure is preserved.
- `live-stall-before` / `live-stall-after`: explicit 8-second source-assignment boundary, old LivePlayerPage fails and new passes.
- `live-rotation-before.log`: added multi-failed-host and malformed-host cases fail on the first candidate fix. `live-rotation-final.log`: all 10 selection cases pass after rotation/validation repair. `live-rotation-after.log` is an intermediate pass before equivalent compatibility cleanup.
- `live-final/results.json`: all 14 controlled-media React cases, from the final UX gate. This is not real HLS decoding.
- `update-before`: old production client passes 2/9. `update-after`: initial fix passes 9/9. `update-final`: final suite passes 10/10, including both sources hanging. Uses an accelerated clock and asserts logical deadline values, not elapsed network time.
- `verify-final-ux.log`: final full local gate, exit 0. Actual legacy Node runtimes, production build/ES2016 parse, controlled browser UX, failure paths and service stress.
- `verify-final-sim.log` and `simulator-final-results.json`: final network simulator gate. Anonymous isolated service state; account-required features are explicitly skipped.

Reproduce from the repository root:

```sh
bash tools/verify.sh --no-tv --ux
BILI_DEV_STATE_DIR=/tmp/bili-followup-state SIM_OUTPUT=/tmp/bili-followup-sim bash tools/verify.sh --sim --no-tv
```

## Memory investigation

`heap-browser-summary.json` / `heap-type-summary.json`: 3 warmup + 40 same-document cycles. `heap-120-summary.json` / `heap-120-type-summary.json`: independent 3 warmup + 120 cycles. Safe type/self-size aggregates only; not dominator retained sizes and not TV memory.

`heap-cycle-browser*.mjs` retain the exact controlled-decoder investigation fixtures. Start Vite on an unused port, then run:

```sh
LOADING_BASE_URL=http://127.0.0.1:5186 LOADING_TEST_OUTPUT=/tmp/bili-private-heap node docs/ux-evidence/2026-10-13-stability-fixes/heap-cycle-browser-120.mjs
```

This command creates raw `.heapsnapshot` files with mode 0600: never upload them. No account is used by the fixture. Real TV heap snapshots may contain credentials and signed URLs. Local raw artifacts and interrupted TV attempts remain under `/tmp/bili-stability-fixes-20261013/`; only numeric summaries are public. The TV finding remains open because the app moved to the background during sampling.
