# Issue #66 — Danmaku settings

Implemented a dedicated remote-friendly settings panel with immediate preview, persisted choices, nested selection lists, cancel/back focus restoration and held-OK protection. Existing subtitle/UI font rows retain their order. Point-of-playback settings apply on the next player mount.

Shared renderer supports source modes 1/2/3/6 (scroll/reverse), 4/5 (fixed bottom/top), color filtering, opacity, bounded font sizes/weights/outlines, area, speed and density limits. Scrolling lanes use a common pixel velocity and measured text widths; fixed and opposite-direction comments wait for occupied lanes. Lane timing follows animation time, including pause, rather than accelerated video time. Each update scans at most 128 source entries and holds at most 48 DOM nodes; default remains 24.

Validation (local Chromium; no TV access):

- Full deterministic remote UX: 71/71 passed; then focused settings regressions passed after the final held-key guard, including Chinese/English/Spanish at 1.25 UI scale.
- Danmaku render suite: 10/10 passed under 6x CPU throttling. Covers 100,000-item indexed lookup, density ceilings, seek/replay, pause/resume, translation indexing, cleanup, fixed/reverse/color filters, area bounds, speed, malformed settings, animation-time lane spacing and live toggling.
- Actual player danmaku/subtitle font size integration: 4/4 passed.
- Live loading regression: 15/15 passed.
- Production build and ES2016 parsing; English/Spanish translation coverage and formatter checks passed.
- Large-text screenshots inspected; [Chinese panel](settings-zh.png).

Limits: browser CPU throttling is not old-TV compositor or hardware-decoder validation. No new physical TV test or long soak. The XML endpoint still defines the available source comments; this change does not fetch segmented/history archives or execute advanced/script comments. Current live relay carries plain text, so only scrolling/appearance controls apply to it. High density is opt-in and is an upper bound, not a guaranteed comment count.
