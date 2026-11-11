# Issue #34: playback-only control stalls

## Reporter footage

Source: [November 10 reply](https://github.com/asdf17128/bili-webos/issues/34#issuecomment-6770711243), three videos (60.30s, 50.74s and 30.12s, all 30fps). Downloaded originals and inspected contact sheets across their duration, plus 5fps detail sequences around playback control movement. Local review files: `/tmp/bili-issue34-new/`.

- Video 1 shows a stationary scene and play icon during the first ~18s, moving footage around 20s, then a paused comparison around 48–54s. The remote is visible. This directly supports comparing pause and play on the same device rather than assuming quality or network latency explains the problem.
- Video 2 includes scrubbing with the underlying video still changing while the target time remains unchanged over multiple samples. This does not establish whether input delivery, rejected repeats, JavaScript scheduling or presentation caused the stall.
- Video 3 shows repeated button navigation over moving footage. The highlight sometimes stays in place while the footage changes.

No exact remote-contact-to-photon latency is claimed: finger contact and the physical key switch cannot be reliably timestamped from these recordings. No local physical TV was operated.

## Changes in legacyfix.5

1. Timeline: compare media clock samples before calling React state updates. Display clock uses integer-second precision; the danmaku consumer retains fractional precision. Stop clock polling on pause/end; sample play, seeked, duration/metadata events immediately and resume polling on play. Scrubbing stops unrelated playback-clock polling while retaining the selected target.
2. Progress fill: retain fixed layout width and use scaleX for position. Promote only the small progress, time and button-row surfaces while visible, leaving the existing shelf geometry and animation intact. Actual old-TV compositor benefit remains a hypothesis, not a measured GPU result.
3. Cast progress: deduplicate identical integer-second payloads; allow at most one request in flight and keep only the newest pending position. Backward seeks are preserved. Failure retries wait for the next sample; unmount prevents queued work from sending. Ordinary playback no longer sends identical integer positions twice per second, and a stalled service cannot accumulate concurrent reports.
4. Bounded diagnostics: at most 120 directional key samples for each of playing/paused per player mount, with at most one pending rAF callback. Export only numeric counts, stale/coalesced counts, maximum event timestamp age and maximum wait to the next rAF. No key names, media IDs, wall-clock timestamps, account data or URLs. A rAF callback is a scheduling proxy, **not display latency**. These measurements can distinguish repeat rejection and event-loop pressure from perceived lag; they cannot alone identify decoder or GPU bottlenecks.

The underlying input gate, seek step, media quality, CDN selection and video decoding configuration are unchanged. Do not declare the issue solved until the original device responds.

## Verification

- Final control regression: 78/78, source hashes unchanged during the run. Includes playing/paused clock, transform-only fill, numeric timing groups, repeat/seek cancellation, engagement, 720p/1080p, bright/dark scenes and recommendation animations.
- Resume 19/19 and adjacent-video navigation 20/20.
- Unit suite: 259 passed, one existing optional Dolby fixture skipped; separate diagnostic allowlist suite 8/8.
- Production build, seven ES2016-compatible bundles and translation coverage checks passed. Packaged assets match the build byte-for-byte and contain legacyfix.5.
- Same synthetic 2.1s idle clock observation: prior build rendered PlayerTimeline four times, new build twice. PlayerPage and recommendation renders remained zero. [Recorded comparison](issue34-playing-clock.json). This is an update-count reduction, not a whole-device performance percentage.
- Screenshot of resumed playback after paused seek inspected. No physical TV/GPU claim; reporter must verify the result.
