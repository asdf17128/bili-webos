import React, { useRef, useEffect, useCallback, useState } from 'react';

// Danmaku rendering layer over video
export default function DanmakuLayer({ danmakus, currentTime, enabled, fontScale = 1 }) {
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

  // Render danmakus that should appear at currentTime
  useEffect(() => {
    if (!enabled || !danmakus || !containerRef.current) return;

    const now = currentTime;
    const container = containerRef.current;

    // Find danmakus within a 0.5s window
    for (let i = 0; i < danmakus.length; i++) {
      const dm = danmakus[i];
      if (dm.time < now - 0.5) continue;
      if (dm.time > now + 0.3) break;
      if (renderedRef.current.has(i)) continue;

      // Only render scroll danmakus (mode 1) for simplicity
      if (dm.mode !== 1 && dm.mode !== undefined) continue;

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
      el.textContent = dm.text;
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
