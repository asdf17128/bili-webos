# Issue #34: isolate callback scheduling from control handler work

Reporter [legacyfix.5 diagnostic](https://github.com/asdf17128/bili-webos/issues/34#issuecomment-6786817763): Chrome 53 / Node 0.12.2; playing ageMax 2377ms and frameMax 1424ms, paused ageMax 174ms and frameMax 12ms. Reporter sees no material improvement over legacyfix.4. These are maxima, not a latency distribution or proof of a specific decoder/GPU fault.

Source review: with danmaku disabled, its media-clock polling and mask animation loop are inactive. Dolby fragment transforms return without processing ordinary unbound media responses. Casting progress was already bounded in legacyfix.5. None of these observations rules out other event-loop or native media work; do not label the root cause solved.

## Isolated rendering change

Remove the permanently requested transform layer on the entire controls/shelf wrapper. CSS transitions and smaller independent button/timeline surfaces remain. No changes to video decoding, frame rate, CDN routing, focus policy, shelves or optional background tasks, so the new package is a focused comparison with legacyfix.6.

Two pairs in baseline/panel/panel/baseline order, 24 trusted keys each, 6× CPU throttle, synthetic playing media:

| Variant | Task duration ms | Draw layers | Sum of layer dimensions in pixels |
| --- | --- | --- | --- |
| baseline | 179.9 | 8 | 8651020 |
| no permanent wrapper promotion | 164.0 | 7 | 7733260 |
| no permanent wrapper promotion | 172.8 | 7 | 7733260 |
| baseline | 165.6 | 8 | 8651020 |

There is no stable large main-thread improvement here. Layer area is geometry, not measured VRAM or GPU time. Physical webOS benefit remains unverified. [Raw experiment](issue34-panel-isolation.json).

Reproduce against d24167c using the current harness:

```sh
CONTROLS_URL=http://127.0.0.1:5179 CONTROLS_OUTPUT=/tmp/bili-panel-ab CONTROLS_FILTER='paint comparison' CONTROLS_PAINT_COMPARE=1 CONTROLS_PAINT_VARIANTS=baseline,panel,panel,baseline node tools/test-player-controls.mjs
```

## Paired scheduling diagnostics

Each bounded sample schedules a zero-delay timer and a rAF from the same point. There is at most one outstanding pair; both must finish before another pair can start, and each playback state is limited to 120 directional inputs. Reset invalidates both pending callbacks. The synchronous player key handler is measured separately. All exported fields are numeric and allowlisted.

- High timerMax plus frameMax indicates broader scheduling/event-loop pressure, but does not identify which task caused it.
- Low timerMax with high frameMax points more toward render callback scheduling than synchronous handler work; this is not definitive proof of a GPU fault.
- handlerMax measures only the synchronous custom key handler, excluding subsequent React work and native input delivery.
- Timestamp age may also depend on old Chromium event timestamp behavior. Zero/invalid timestamps are ignored.
- No automatic diagnostic upload and no video URLs/account data.

Validation deliberately queues a 100ms main-thread microtask after the key handler; both callback delays should detect it without attributing it to handlerMax. Unit tests independently simulate fast timer / delayed frame and resets.

Initial development-run diagnostic tests imported a second module instance because the live Vite server had HMR timestamped imports; those results were invalid for singleton inspection. Restarted Vite and reran the suite from a clean server. Production bundle imports are unaffected.

## Final validation

- Clean-server control regression: 80/80 passed, production source hashes stable throughout. Includes expansion/reversal under 6× CPU slowdown, card continuity, large text, seeking, engagement, settings and scheduling diagnostics.
- Synthetic 100ms post-handler block measured timerMax 103ms, frameMax 102ms, handlerMax 1ms. This validates measurement separation, not the reporter's root cause.
- 259 unit tests passed with one existing optional Dolby fixture skipped; diagnostic allowlist suite 9/9.
- Production build, seven ES2016 bundles, translations, packaged asset byte equality and legacyfix.7 label verified.
- Expanded recommendation screenshot inspected. No physical TV was operated and no formal/Homebrew release made.
