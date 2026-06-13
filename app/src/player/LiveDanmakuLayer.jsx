import React, { useRef, useImperativeHandle, forwardRef } from 'react';

// Live danmaku overlay. Each incoming message is appended to the DOM directly
// (no React re-render) and CSS-scrolls right→left, reusing the .danmaku-item
// animation. Track allocation avoids overlap; capped for TV performance.
const TRACKS = 12;
const DURATION = 9; // seconds

export default forwardRef(function LiveDanmakuLayer({ enabled }, ref) {
  const containerRef = useRef(null);
  const trackFree = useRef(new Array(TRACKS).fill(0)); // ms timestamp each track frees

  useImperativeHandle(ref, () => ({
    push(text) {
      const container = containerRef.current;
      if (!enabled || !container || !text) return;
      // Hard ceiling on concurrent animated nodes — too many overwhelm the TV's
      // compositor and the scroll stutters.
      if (container.childElementCount >= 20) return;
      const now = Date.now();
      let track = -1;
      for (let t = 0; t < TRACKS; t++) {
        if (trackFree.current[t] <= now) { track = t; trackFree.current[t] = now + 2200; break; }
      }
      // No free lane (busy room): drop this one instead of overlapping — keeps
      // concurrent danmaku ≲ track count so the animation stays smooth.
      if (track === -1) return;
      const el = document.createElement('div');
      el.className = 'danmaku-item';
      el.textContent = text;
      el.style.top = `${track * 44 + 16}px`;
      el.style.color = '#fff';
      el.style.fontSize = '28px';
      el.style.animationDuration = DURATION + 's';
      container.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    },
    clear() { if (containerRef.current) containerRef.current.innerHTML = ''; },
  }), [enabled]);

  if (!enabled) return null;
  return <div ref={containerRef} className="danmaku-container" />;
});
