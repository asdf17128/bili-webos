# v2.5.2 release validation — 2026-11-01

Scope: WBI/PGC v2 playback, bounded current-device activation, media keys, diagnostics/QR navigation, and explicit Back dismissal that ignores pointer jitter until deliberate input.

## Local regression

- `bash tools/verify.sh --no-tv --ux`: service ES5, app ES2016 production build, static gates, unit tests (243 passed; external Dolby fixture skipped), account repair, lifecycle/transport stress, WBI/risk handling, remote UX (70/70), session proxy, recommendation menu (62/62), and account-repair UI (26/26) passed.
- This aggregate command initially exposed a VM fixture missing the native `crypto` dependency; the fixture was corrected. The subsequent run stopped on a media-key test race: initial autoplay was counted as a remote Play command. The test now waits for startup completion before installing the counter.
- After that correction, the complete `test-player-loading.mjs` suite passed **83/83**, including explicit Back + repeated pointer movement, wheel/D-pad reopening, automatic hiding, and media-key idempotence.
- The remaining aggregate gates were executed sequentially and all exited successfully: `test-player-controls` (**38/38**), `test-author-followers`, `test-danmaku-render`, `test-playback-end` (**26/26**), `test-live-loading` (**15/15**), `test-playback-health`, `test-cdn-auto`, `test-diagnostic-cdn`, `test-diagnostic-privacy`, and `test-region-probe`.
- `test-device-activation.mjs`: **7/7** integration cases passed; this suite is now included in `verify.sh`.
- `bash tools/test-node8/test.sh`: actual Docker **Node 0.12.2 and 8.17.0** passed service smoke tests and a new isolated filesystem/crypto test of production activation atomic persistence and cooldown. Atomic writes use explicit file positions for old runtimes.

The aggregate command itself was not rerun to a zero exit after the fixture correction; its failed player gate and every remaining gate were completed separately, as recorded above.

## Actual-network simulator

The anonymous simulator uses `BILI_DEV_STATE_DIR` isolation and the production service bridge. Its failure-injection fixture initially still matched the legacy playurl path, so the new WBI request played normally instead of producing the simulated refusal. The matcher now covers both legacy and WBI endpoints; the full suite was rerun after this correction: **54 passed, 0 failed, 3 skipped** (logged-out like/coin/favorite surface, Watch Later, follow badges). Real VOD and live playback, primary-CDN failure recovery, error-to-diagnostics navigation, CDN throughput, large-text layout, and runtime health passed. Command: `SIM_URL=http://127.0.0.1:5187 SIM_STRICT=1 node tools/test-sim.mjs`.

## Device evidence and limits

- [#65 user confirmation](https://github.com/asdf17128/bili-webos/issues/65#issuecomment-6517650073): playback restored, no further problem reported.
- [#57 user confirmation](https://github.com/asdf17128/bili-webos/issues/57#issuecomment-6524863174): playback restored, stability still under observation; reported pointer jitter motivated the additional Back fix.
- These are reporter tests of prior test packages. No fresh physical-TV validation or long-duration soak is claimed for this release candidate. Local Chromium tests do not establish hardware decoder performance or every webOS browser's behavior.
- Anonymous simulator testing does not verify account writes or member-only playback. Those paths have controlled fixtures and reporter evidence, not a new authenticated end-to-end run here.
