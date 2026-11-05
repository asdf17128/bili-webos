import { useDanmakuMask } from './useDanmakuMask';
import React, { memo, useRef, useEffect } from 'react';

import { normalizeDanmaku, appendDanmaku } from './danmakuSettings';
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
export default memo(function DanmakuLayer({ danmakus, currentTime, enabled, paused = false, fontScale = 1, mtRef = null, settings = {}, preserveOnAppend = false, videoRef, maskSource, onMaskStatus }) {
  const containerRef = useRef(null);
  useDanmakuMask(containerRef, videoRef, maskSource, enabled && settings.danmakuMask === true, onMaskStatus);
  const renderedRef = useRef(new Set());
  const options = normalizeDanmaku({ ...settings, danmakuScale: fontScale });
  const signature = JSON.stringify(options);
  const trackRef = useRef([]);
  const lastTimeRef = useRef(null);
  const clockRef = useRef({ stamp: performance.now(), time: 0, paused });

  useEffect(() => {
    renderedRef.current.clear();
    trackRef.current = [];
    lastTimeRef.current = null;
    if (containerRef.current) containerRef.current.textContent = '';
  }, [signature, enabled]);
  useEffect(() => {
    if (preserveOnAppend) return;
    renderedRef.current.clear(); trackRef.current = []; lastTimeRef.current = null;
    if (containerRef.current) containerRef.current.textContent = '';
  }, [danmakus, preserveOnAppend]);

  useEffect(() => {
    const clock = clockRef.current, stamp = performance.now();
    if (!clock.paused) clock.time += (stamp - clock.stamp) / 1000;
    clock.stamp = stamp; clock.paused = paused;
    const container = containerRef.current;
    if (!enabled || !danmakus || !container) return;
    const now = currentTime, last = lastTimeRef.current;
    // Clear stale text for both forward and backward seeks, including replay.
    if (last !== null && (now < last - 1.5 || now > last + 2)) {
      renderedRef.current.clear();
      trackRef.current = [];
      container.textContent = '';
    }
    lastTimeRef.current = now;
    if (paused) return;
    const start = lowerBound(danmakus, now - 1);
    // Remember only the current window, not every comment in a multi-hour film.
    const keyOf = i => preserveOnAppend ? (danmakus[i].id || [danmakus[i].time, danmakus[i].mode, danmakus[i].text].join('|')) : i;
    const windowKeys = new Set();
    for (let i = start; i < Math.min(danmakus.length, start + MAX_WINDOW_ITEMS); i++) {
      if (danmakus[i].time > now + 0.3) break;
      windowKeys.add(keyOf(i));
    }
    renderedRef.current.forEach(key => { if (!windowKeys.has(key)) renderedRef.current.delete(key); });
    for (let i = start; i < Math.min(danmakus.length, start + MAX_WINDOW_ITEMS); i++) {
      const dm = danmakus[i];
      if (dm.time > now + 0.3) break;
      const key = keyOf(i);
      if (renderedRef.current.has(key)) continue;
      const text = mtRef ? mtRef.current?.get(i) : dm.text;
      if (!text) continue;
      // A full lane may become available on the next media tick. Retry only
      // within the one-second source window; no unbounded delayed queue.
      if (appendDanmaku(container, trackRef.current, dm, text, clock.time, options)) renderedRef.current.add(key);
    }
  }, [currentTime, danmakus, enabled, paused, fontScale, signature, mtRef, preserveOnAppend]);

  if (!enabled) return null;
  return <div ref={containerRef} className={'danmaku-container' + (paused ? ' danmaku-paused' : '')}
    onAnimationEnd={e => { if (e.target.parentNode === e.currentTarget) e.target.remove(); }} />;
});
