import React, { useRef, useEffect, useCallback, useState } from 'react';

// Danmaku rendering layer over video.
// mtRef (optional): a ref holding a dmTranslate translator — when present,
// items render TRANSLATED text and untranslated items are skipped (they retry
// while still inside their display window; no Chinese flash on non-zh UIs).
export default function DanmakuLayer({ danmakus, currentTime, enabled, fontScale = 1, mtRef = null }) {
  const containerRef = useRef(null);
  const renderedRef = useRef(new Set()); // Track which danmakus have been shown
  // Track pitch scales with the font. Fill (nearly) the full 1080p height —
  // 20px top margin, ~60px bottom kept clear for the progress bar — instead of a
  // fixed 15 tracks, which only covered the top ~3/4 and cut danmaku off in the
  // bottom quarter (#11).
  const TRACK_H = Math.round(48 * fontScale);
  const TRACK_COUNT = Math.max(6, Math.floor((1080 - 20 - 60) / TRACK_H));
  const trackRef = useRef(new Array(TRACK_COUNT).fill(0)); // value = time when track frees

  // Reset when danmaku list changes
  useEffect(() => {
    renderedRef.current = new Set();
    trackRef.current = new Array(TRACK_COUNT).fill(0);
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
  }, [danmakus, TRACK_COUNT]);

  // Detect a backward seek: "already shown" marks would otherwise suppress that
  // stretch forever, so rewinding left the screen permanently empty (#11).
  // Reset the shown-set and tracks so the rewound stretch replays.
  const lastTimeRef = useRef(0);

  // Render danmakus that should appear at currentTime
  useEffect(() => {
    if (!enabled || !danmakus || !containerRef.current) return;

    const now = currentTime;
    const container = containerRef.current;

    if (now < lastTimeRef.current - 1.5) {
      renderedRef.current = new Set();
      trackRef.current = new Array(TRACK_COUNT).fill(0);
      container.innerHTML = '';
    }
    lastTimeRef.current = now;

    // Find danmakus within a 0.5s window
    for (let i = 0; i < danmakus.length; i++) {
      const dm = danmakus[i];
      if (dm.time < now - 0.5) continue;
      if (dm.time > now + 0.3) break;
      if (renderedRef.current.has(i)) continue;

      // Only render scroll danmakus (mode 1) for simplicity
      if (dm.mode !== 1 && dm.mode !== undefined) continue;

      // MT mode: only translated text goes on screen.
      let text = dm.text;
      if (mtRef) {
        const tr = mtRef.current ? mtRef.current.get(i) : null;
        if (!tr) continue; // not translated yet — retry within the window
        text = tr;
      }

      renderedRef.current.add(i);

      // Find a free track
      let track = -1;
      for (let t = 0; t < trackRef.current.length; t++) {
        if (trackRef.current[t] <= now) {
          track = t;
          trackRef.current[t] = now + 3; // Occupy track for 3 seconds
          break;
        }
      }
      if (track === -1) continue; // All tracks busy

      const el = document.createElement('div');
      el.className = 'danmaku-item';
      el.textContent = text;
      // Scale the track pitch with the font so larger danmaku don't overlap.
      el.style.top = `${track * TRACK_H + 20}px`;
      el.style.color = dm.color || '#fff';
      el.style.fontSize = `${Math.round((dm.size || 28) * fontScale)}px`;
      el.style.animationDuration = '8s';

      container.appendChild(el);

      // Remove after animation
      el.addEventListener('animationend', () => {
        el.remove();
      });
    }
  }, [currentTime, danmakus, enabled]);

  if (!enabled) return null;

  return <div ref={containerRef} className="danmaku-container" />;
}
