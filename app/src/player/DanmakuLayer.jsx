import React, { memo, useRef, useEffect } from 'react';

const MAX_VISIBLE = 24;
const MAX_WINDOW_ITEMS = 128;

// Lists arrive sorted by media time. Seeking into a long video must not scan
// all preceding comments twice a second on the TV's main thread.
function lowerBound(items, time) {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Keep original list indices for translation; pending translations may retry
// within the display window without ever flashing the original Chinese text.
export default memo(function DanmakuLayer({ danmakus, currentTime, enabled, paused = false, fontScale = 1, mtRef = null }) {
  const containerRef = useRef(null);
  const renderedRef = useRef(new Set());
  const trackHeight = Math.round(48 * fontScale);
  const trackCount = Math.max(6, Math.floor(1000 / trackHeight));
  const trackRef = useRef([]);
  const lastTimeRef = useRef(null);

  useEffect(() => {
    renderedRef.current.clear();
    trackRef.current = new Array(trackCount).fill(0);
    lastTimeRef.current = null;
    if (containerRef.current) containerRef.current.textContent = '';
  }, [danmakus, trackCount, enabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !danmakus || !container) return;
    const now = currentTime, last = lastTimeRef.current;
    // Clear stale text for both forward and backward seeks, including replay.
    if (last !== null && (now < last - 1.5 || now > last + 2)) {
      renderedRef.current.clear();
      trackRef.current.fill(0);
      container.textContent = '';
    }
    lastTimeRef.current = now;
    if (paused) return;
    const start = lowerBound(danmakus, now - 0.5);
    // Remember only the current window, not every comment in a multi-hour film.
    renderedRef.current.forEach(i => { if (i < start) renderedRef.current.delete(i); });
    const batch = document.createDocumentFragment();
    let visible = container.childElementCount;
    for (let i = start; i < Math.min(danmakus.length, start + MAX_WINDOW_ITEMS); i++) {
      const dm = danmakus[i];
      if (dm.time > now + 0.3) break;
      if (renderedRef.current.has(i)) continue;
      if (dm.mode !== 1 && dm.mode !== undefined) continue;
      const text = mtRef ? mtRef.current?.get(i) : dm.text;
      if (!text) continue;
      renderedRef.current.add(i);
      if (visible >= MAX_VISIBLE) continue;
      const track = trackRef.current.findIndex(free => free <= now);
      if (track < 0) continue;
      trackRef.current[track] = now + 3;
      const el = document.createElement('div');
      el.className = 'danmaku-item';
      el.textContent = text;
      el.style.top = `${track * trackHeight + 20}px`;
      el.style.color = dm.color || '#fff';
      el.style.fontSize = `${Math.round((dm.size || 28) * fontScale)}px`;
      el.style.animationDuration = '8s';
      batch.appendChild(el);
      visible++;
    }
    container.appendChild(batch);
  }, [currentTime, danmakus, enabled, paused, fontScale, trackHeight, mtRef]);

  if (!enabled) return null;
  return <div ref={containerRef} className={'danmaku-container' + (paused ? ' danmaku-paused' : '')}
    onAnimationEnd={e => { if (e.target.parentNode === e.currentTarget) e.target.remove(); }} />;
});
