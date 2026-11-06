import { useEffect } from 'react';
import { getDanmakuMaskRange } from '../api/client';
import { maskUrl, maskHeader, maskIndex, decodeMaskSegment, safeMaskImage, maskFrame, MASK_LIMITS } from './danmakuMask';

// The native video plane is never read. Only the overlay gets an alpha mask.
export function useDanmakuMask(containerRef, videoRef, source, enabled, onStatus) {
  useEffect(() => {
    const element = containerRef.current, video = videoRef?.current;
    const url = maskUrl(source?.mask_url);
    const supports = typeof CSS !== 'undefined' && (CSS.supports('mask-image', 'linear-gradient(white, white)') || CSS.supports('-webkit-mask-image', 'linear-gradient(white, white)'));
    let disposed = false, busy = false, index = null, failed = false, lastKey = '', target = -1;
    const cache = new Map();
    const stats = { requests: 0, failures: 0, applied: 0, cached: 0, decodedFrames: 0, frameTime: null, timelineTime: null };
    let videoFrameId = null, animationId = null, frameGeneration = 0, lastVideoFrameAt = -Infinity;
    const status = value => { if (!disposed) onStatus?.(value); };
    const clear = () => {
      if (element) { element.style.webkitMaskImage = 'none'; element.style.maskImage = 'none'; }
      lastKey = ''; stats.frameTime = null; stats.timelineTime = null;
    };
    clear();
    if (!enabled) { status('off'); return; }
    if (!element || !video || !supports) { status('unsupported'); return; }
    if (!url) { status('unavailable'); return; }
    const diagnostics = () => ({ ...stats, cached: cache.size, state: failed ? 'failed' : lastKey ? 'active' : 'waiting' });
    window.__danmakuMaskStats = diagnostics;
    const fetchRange = async (start, end) => { stats.requests++; return getDanmakuMaskRange(url, start, end); };
    async function load() {
      if (busy || disposed || failed || document.hidden) return;
      busy = true;
      try {
        if (!index) {
          status('loading');
          const header = await fetchRange(0, 15); if (disposed) return;
          const size = maskHeader(header);
          index = maskIndex(await fetchRange(0, size - 1)); if (disposed) return;
        }
        const time = video.currentTime * 1000;
        target = -1; for (let n = 0; n < index.length && index[n].time <= time; n++) target = n;
        if (target < 0) return;
        cache.forEach((_, n) => { if (n < target || n > target + 1) cache.delete(n); });
        const n = [target, target + 1].find(n => n < index.length && !cache.has(n));
        if (n === undefined) return;
        const start = index[n].offset, end = index[n + 1]?.offset || start + MASK_LIMITS.compressed;
        if (end - start > MASK_LIMITS.compressed) throw Error('Mask segment limit');
        const bytes = await fetchRange(start, end - 1); if (disposed) return;
        const frames = decodeMaskSegment(bytes, index[n].time, index[n + 1]?.time || Infinity);
        // A seek may have happened while fetching. The next tick selects its
        // own target; do not install this response as the current silhouette.
        const current = video.currentTime * 1000;
        if (current >= index[n].time && current < (index[n + 1]?.time || Infinity) || n === target + 1) {
          cache.set(n, frames); stats.decodedFrames += frames.length;
        }
      } catch (_) { if (!disposed) { failed = true; stats.failures++; clear(); cache.clear(); status('failed'); } }
      finally { busy = false; }
    }
    function tick(time = video.currentTime * 1000) {
      if (disposed || failed) return;
      if (document.hidden || video.seeking) { clear(); return; }
      let n = -1;
      if (index) for (let i = 0; i < index.length && index[i].time <= time; i++) n = i;
      const frame = maskFrame(cache.get(n) || [], time);
      if (!frame || !video.videoWidth || !video.videoHeight) { clear(); status(index && (n < 0 || cache.has(n)) ? 'gap' : 'loading'); }
      else {
        const vr = video.getBoundingClientRect(), er = element.getBoundingClientRect();
        const width = element.clientWidth, height = element.clientHeight, scale = width / er.width;
        const fitted = Math.min(vr.width / video.videoWidth, vr.height / video.videoHeight);
        const w = video.videoWidth * fitted * scale, h = video.videoHeight * fitted * scale;
        const x = (vr.left - er.left + (vr.width - w / scale) / 2) * scale;
        const y = (vr.top - er.top + (vr.height - h / scale) / 2) * scale;
        const key = frame.uri + ':' + [width,height,x,y,w,h].join(',');
        stats.frameTime = frame.time; stats.timelineTime = time;
        if (key !== lastKey) {
          try {
            if (![width,height,x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) throw Error('Mask layout');
            const safe = safeMaskImage(frame.uri);
            const svg = new DOMParser().parseFromString(atob(safe.split(',')[1]), 'image/svg+xml').documentElement;
            svg.setAttribute('x', x); svg.setAttribute('y', y); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('preserveAspectRatio','none');
            // Keep letterbox regions unaffected; only the fitted video gets
            // silhouette holes. The outer SVG clips at the overlay boundary.
            const rect = (a,b,c,d) => c > 0 && d > 0 ? `<rect x="${a}" y="${b}" width="${c}" height="${d}" fill="white"/>` : '';
            const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rect(0,0,width,y)}${rect(0,y+h,width,height-y-h)}${rect(0,y,x,h)}${rect(x+w,y,width-x-w,h)}${new XMLSerializer().serializeToString(svg)}</svg>`;
            const image = 'url("data:image/svg+xml;base64,' + btoa(wrapper) + '")';
            element.style.webkitMaskImage = image; element.style.maskImage = image;
            element.style.webkitMaskSize = '100% 100%'; element.style.maskSize = '100% 100%';
            element.style.webkitMaskRepeat = 'no-repeat'; element.style.maskRepeat = 'no-repeat';
            lastKey = key; stats.applied++; status('active');
          } catch (_) { failed = true; stats.failures++; clear(); cache.clear(); status('failed'); }
        }
      }
    }
    // Follow the frame being presented, not a coarse wall-clock poll. Older
    // webOS engines use rAF; the poll still loads data and handles paused or
    // native video pipelines which expose rVFC but do not deliver callbacks.
    const hasVideoFrames = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function';
    function scheduleVideoFrame() {
      if (disposed || failed || video.seeking) return;
      const generation = frameGeneration;
      videoFrameId = video.requestVideoFrameCallback((_, metadata) => {
        if (disposed || generation !== frameGeneration) return;
        videoFrameId = null;
        if (Number.isFinite(metadata.mediaTime)) { lastVideoFrameAt = performance.now(); tick(metadata.mediaTime * 1000); }
        scheduleVideoFrame();
      });
    }
    function animate() {
      if (disposed || failed) return;
      if (!video.paused) tick();
      animationId = requestAnimationFrame(animate);
    }
    const seek = () => {
      clear(); status('loading'); lastVideoFrameAt = -Infinity;
      if (hasVideoFrames) {
        frameGeneration++;
        if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
        videoFrameId = null;
      }
    };
    const seeked = () => {
      if (hasVideoFrames) {
        frameGeneration++;
        if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
        videoFrameId = null; scheduleVideoFrame();
      }
      tick();
    };
    video.addEventListener('seeked', seeked);
    video.addEventListener('seeking', seek);
    const poll = () => {
      load();
      if (document.hidden || video.paused || (hasVideoFrames && performance.now() - lastVideoFrameAt > 150)) tick();
    };
    if (hasVideoFrames) scheduleVideoFrame();
    else animationId = requestAnimationFrame(animate);
    const timer = setInterval(poll, 100); tick(); load();
    return () => {
      disposed = true; frameGeneration++; clearInterval(timer);
      if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
      if (animationId !== null) cancelAnimationFrame(animationId);
      video.removeEventListener('seeking', seek); video.removeEventListener('seeked', seeked); clear(); cache.clear();
      if (window.__danmakuMaskStats === diagnostics) delete window.__danmakuMaskStats;
    };
  }, [containerRef, videoRef, source, enabled, onStatus]);
}
