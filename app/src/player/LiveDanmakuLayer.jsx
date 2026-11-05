import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { appendDanmaku, normalizeDanmaku } from './danmakuSettings';

export default forwardRef(function LiveDanmakuLayer({ enabled, settings = {} }, ref) {
  const containerRef = useRef(null);
  const lanes = useRef([]);
  const signature = JSON.stringify(normalizeDanmaku(settings));
  const clear = () => { lanes.current = []; if (containerRef.current) containerRef.current.textContent = ''; };
  useEffect(clear, [enabled, signature]);
  useImperativeHandle(ref, () => ({
    push(text) {
      if (enabled && containerRef.current && text) appendDanmaku(containerRef.current, lanes.current,
        { mode: 1 }, text, Date.now() / 1000, settings);
    },
    clear,
  }), [enabled, signature]);
  if (!enabled) return null;
  return <div ref={containerRef} className="danmaku-container"
    onAnimationEnd={e => { if (e.target.parentNode === e.currentTarget) e.target.remove(); }} />;
});
