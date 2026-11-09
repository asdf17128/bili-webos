# Issue #34: control-row CPU budget

Target: reduce main-thread task time for continuous control-row navigation by at least 30% relative to `f00fcec` (2.6.0 legacyfix.2), with the same functions, nine buttons, layout and focus animation.

## Measurement

Two fresh contexts per variant, five rounds per context, 48 trusted right-arrow presses per round. Every key must reach the next enabled button; dropped input cannot count as an improvement. 1920×1080 Chromium, 6× CPU throttling, synthetic playing video and 12 recommendation cards. Order: baseline, changed, changed, baseline. No other build/test jobs during this final comparison.

CDP Performance metrics, milliseconds per 48-key round; medians over all ten rounds:

| Metric | legacyfix.2 | Optimized | Reduction |
|---|---:|---:|---:|
| Main-thread task time | 229.46 | 128.29 | 44.09% |
| Script time | 98.03 | 35.68 | 63.61% |
| Layout time | 12.73 | 10.70 | 15.93% |
| Style recalculation | 17.35 | 10.23 | 41.05% |

The 30% target is met **for this measured control-row workload**. This is not a 44% reduction in whole-TV CPU usage, GPU use, memory or decoding cost, and does not prove that the reporter's 1–3 second physical-TV latency is gone. Fixed-frame automation and a modern throttled browser do not reproduce old webOS GPU/driver behavior. Raw rounds and source hashes: [JSON evidence](issue34-controls-budget.json).

The first isolation pass reduced script work substantially but did not meet the total-task budget. Final changes also isolate focus subscriptions per button, reuse unchanged icon content, contain button-row layout, and keep icon transform layers ready only while controls are visible. Layer memory is not measured; no memory-reduction claim is made.

## Reproduction

Serve the archived baseline and current `app` from separate local Vite ports. Run the following sequentially, in both orders, with distinct output directories:

```sh
CONTROLS_URL=http://127.0.0.1:5181 CONTROLS_OUTPUT=/tmp/budget-before CONTROLS_FILTER='performance budget' node tools/test-player-controls.mjs
CONTROLS_URL=http://127.0.0.1:5179 CONTROLS_OUTPUT=/tmp/budget-after CONTROLS_FILTER='performance budget' node tools/test-player-controls.mjs
```

Use `checkpoints.budget.rounds` from the result files. Compare medians, retaining every round. Do not run other benchmarks or builds concurrently. The fixture intercepts external APIs and media; it never submits real account actions.

## Regression validation

- Controls: 71/71, including engagement writes intercepted at the fixture boundary, large text, 720p/1080p, English/Chinese, pointer input, long press, scrub, settings, two-row recommendations and animation reversal.
- Additional focus guard: 12 button moves must cause zero PlayerPage renders; 20 repeated direction-key events must reach the expected control.
- Previous/Next: 20/20, including pending navigation and end-of-video interactions.
- Unit tests: 251 pass, 0 fail, 1 existing optional Dolby fixture skipped.
- Production build and ES2016 syntax checks passed; representative control screenshot inspected.
- No television operation or stable release in this optimization round.
