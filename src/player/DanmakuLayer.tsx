// @ts-nocheck
import React, { useRef, useEffect } from 'react';

// Danmaku rendering layer over video
export default function DanmakuLayer({ danmakus, currentTime, enabled }) {
  const containerRef = useRef(null);
  const renderedRef = useRef(new Set()); // Track which danmakus have been shown
  const trackRef = useRef(new Array(15).fill(0)); // 15 tracks, value = time when track becomes free

  // Reset when danmaku list changes
  useEffect(() => {
    renderedRef.current = new Set();
    trackRef.current = new Array(15).fill(0);
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
  }, [danmakus]);

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
      el.style.top = `${track * 48 + 20}px`;
      el.style.color = dm.color || '#fff';
      el.style.fontSize = `${dm.size || 28}px`;
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
