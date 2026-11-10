# Issue #34: rendering-effects comparison

Reporter videos from [November 10 feedback](https://github.com/asdf17128/bili-webos/issues/34#issuecomment-6759783175) show irregular focus movement before scrubbing; preview loading cannot explain all remaining symptoms. The remote itself is not visible, so the footage does not establish an exact input-to-display latency. No physical television was operated for this experiment.

## Local isolation experiment

Baseline: `1dc68fa`, legacyfix.3. Four CSS variants, each in a fresh browser context, run in forward then reverse order. Each performs 24 trusted right-arrow taps, 160ms apart, under 6× CPU throttling. Every key must select the next enabled button. API/media fixtures remain synthetic, without actual decoding.

| Variant | Main-thread task time, run 1 / run 2 (ms) |
| --- | --- |
| Unchanged | 285.6 / 266.8 |
| Single text shadow and no SVG filters | 255.7 / 278.6 |
| No focus scaling, transition or icon will-change | 171.7 / 198.8 |
| Collapsed recommendation panel hidden | 229.7 / 205.0 |

This is an exploratory two-pass comparison, not a statistically established performance gain on webOS. Motion removal is the clearest local signal. The shadow-only difference is small and inconsistent. Hiding the shelf changes the product and is **not shipped**. Its draw-layer count fell from 14 to 13, but layer geometry is not a VRAM measurement.

The test also records input-to-two-rAF timing. That is a scheduling proxy, not proof of pixels presented on a physical display. LayerTree emitted no paint events in this setup; zero events must not be reported as zero paint work. Raw measurements, original source hashes and limitations: [JSON](issue34-controls-paint.json).

## Test build scope

legacyfix.4 only simplifies text/icon effects and makes button focus immediate without scaling. The focus fill and ring, action success/pending feedback, controls geometry, recommendation preview and shelf expansion animation remain. The 720p comment-rail focus override follows the same policy. Media, CDN, input scheduling and seek logic are unchanged from legacyfix.3, making comparison easier.

Reproduce the diagnostic variants on the legacyfix.3 source using the current harness:

```sh
CONTROLS_URL=http://127.0.0.1:5179 CONTROLS_OUTPUT=/tmp/bili-paint-ab CONTROLS_FILTER='paint comparison' CONTROLS_PAINT_COMPARE=1 node tools/test-player-controls.mjs
```

The harness applies overrides to the served baseline; serving legacyfix.4 instead would measure a different starting point. Keep the recorded source hashes with each run.

## Validation

- Final source: 76/76 local control regression cases passed, with source hashes stable throughout. Includes focus styles, short/held seeking, engagement success/failure/hold, 720p large text/comment rail, bright/dark screenshots, card geometry, shelf transitions and rapid reversal.
- 254 unit tests passed; one existing optional Dolby fixture skipped.
- Production build, seven JavaScript bundles parsed as ES2016, and 393 source translation keys covered in English/Spanish.
- Packaged IPK assets byte-match the built assets and contain the visible legacyfix.4 label.
- Manually inspected selected-focus and bright-scene screenshots. No physical-TV latency or GPU-performance claim.
