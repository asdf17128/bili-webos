import { useEffect } from 'react';
import { getDanmakuMaskRange } from '../api/client';
import { maskUrl, maskHeader, maskIndex, decodeMaskSegment, maskFrame, currentMaskFrame, MASK_LIMITS } from './danmakuMask';
import { createDanmakuMaskVector } from './danmakuMaskVector';

// The native video plane is never read. Only the overlay gets an alpha mask.
export function useDanmakuMask(containerRef, videoRef, source, enabled, onStatus) {
  useEffect(() => {
    const element = containerRef.current, video = videoRef?.current;
    const url = maskUrl(source?.mask_url);
    const supports = typeof CSS !== 'undefined' && (CSS.supports('mask-image', 'linear-gradient(white, white)') || CSS.supports('-webkit-mask-image', 'linear-gradient(white, white)'));
    let disposed = false, busy = false, index = null, failed = false, lastKey = '', target = -1;
    const cache = new Map(), prepared = new Map();
    let desired = null, renderer = null;
    const clearPrepared = () => { prepared.forEach(bitmap => bitmap.dispose?.()); prepared.clear(); };
    const stats = { requests: 0, failures: 0, applied: 0, cached: 0, decodedFrames: 0, frameTime: null, timelineTime: null, sourceProtectedRatio: null, sourceHasHole: null, prepareMs: 0, selection: null, videoFrameCallbacks: 0, animationTicks: 0 };
    let videoFrameId = null, animationId = null, frameGeneration = 0, lastVideoFrameAt = -Infinity;
    const status = value => { if (!disposed) onStatus?.(value); };
    const clear = () => {
      if (renderer) renderer.clear();
      else if (element) { element.style.webkitMaskImage = 'none'; element.style.maskImage = 'none'; }
      lastKey = ''; stats.frameTime = null; stats.timelineTime = null; stats.sourceProtectedRatio = null; stats.sourceHasHole = null; stats.selection = null;
    };
    clear();
    if (!enabled) { status('off'); return; }
    if (!element || !video || !supports) { status('unsupported'); return; }
    if (!url) { status('unavailable'); return; }
    try { renderer = createDanmakuMaskVector(element); }
    catch (_) { status('unsupported'); return; }
    const diagnostics = () => ({ ...stats, cached: cache.size, prepared: prepared.size, preparing: false, renderer: 'vector', state: failed ? 'failed' : lastKey ? (stats.sourceHasHole === false ? 'unprotected' : 'active') : 'waiting' });
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
      } catch (_) { if (!disposed) { failed = true; stats.failures++; clear(); cache.clear(); clearPrepared(); status('failed'); } }
      finally { busy = false; }
    }
    function commit(target, bitmap) {
      if (disposed || failed || target !== desired || video.seeking || document.hidden || Math.abs(video.currentTime * 1000 - target.clockAtSelection) > 80) return;
      const { time, width, height, x, y, w, h } = target;
      let frame = target.frame;
      let selection = 'future';
      if (bitmap.sourceHasHole === false && frame.time > time && target.current && target.current.uri !== frame.uri) {
        const currentBitmap = prepare(target.current);
        // Unknown can be a small hole or an older engine without point tests.
        // currentMaskFrame already bounds this fallback to at most 80 ms.
        if (currentBitmap.sourceHasHole !== false) { frame = target.current; bitmap = currentBitmap; selection = 'current-transition'; }
      }
      const key = frame.uri + ':' + target.layoutKey;
      stats.frameTime = frame.time; stats.timelineTime = time; stats.sourceProtectedRatio = bitmap.sourceProtectedRatio; stats.sourceHasHole = bitmap.sourceHasHole; stats.selection = selection;
      if (key === lastKey) return;
      // Keep a single SVG mask reference. Geometry updates are synchronous;
      // no per-frame image encode/decode can leave the layer unmasked.
      renderer.apply(bitmap, { width, height, x, y, w, h });
      lastKey = key; stats.applied++; status(bitmap.sourceHasHole === false ? 'gap' : 'active');
    }
    function prepare(frame) {
      let bitmap = prepared.get(frame.uri);
      if (bitmap) { prepared.delete(frame.uri); prepared.set(frame.uri, bitmap); return bitmap; }
      const started = performance.now();
      bitmap = renderer.prepare(frame.uri);
      stats.prepareMs = Math.round(performance.now() - started);
      prepared.set(frame.uri, bitmap);
      while (prepared.size > 8) { const key = prepared.keys().next().value; prepared.get(key).dispose?.(); prepared.delete(key); }
      return bitmap;
    }
    function tick(time = video.currentTime * 1000) {
      if (disposed || failed) return;
      if (document.hidden || video.seeking) { desired = null; clear(); return; }
      let n = -1;
      if (index) for (let i = 0; i < index.length && index[i].time <= time; i++) n = i;
      const frames = (cache.get(n) || []).concat(cache.get(n + 1) || []), frame = maskFrame(frames, time, source?.fps);
      if (!frame || !video.videoWidth || !video.videoHeight) { desired = null; clear(); status(index && (n < 0 || cache.has(n)) ? 'gap' : 'loading'); return; }
      const vr = video.getBoundingClientRect(), er = element.getBoundingClientRect();
      const width = element.clientWidth, height = element.clientHeight, scale = width / er.width;
      const fitted = Math.min(vr.width / video.videoWidth, vr.height / video.videoHeight);
      const w = video.videoWidth * fitted * scale, h = video.videoHeight * fitted * scale;
      const x = (vr.left - er.left + (vr.width - w / scale) / 2) * scale;
      const y = (vr.top - er.top + (vr.height - h / scale) / 2) * scale;
      if (![width,height,x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) { desired = null; clear(); return; }
      const layoutKey = [width,height,x,y,w,h].join(',');
      desired = { frame, current: currentMaskFrame(frames, time), time, layoutKey, width, height, x, y, w, h, clockAtSelection: video.currentTime * 1000 };
      try { commit(desired, prepare(frame)); }
      catch (_) {
        failed = true; stats.failures++; desired = null; clear(); cache.clear(); clearPrepared(); status('failed');
      }
      // Keep the same age limit; a slow device must never freeze an old shape.
      if (stats.timelineTime !== null && Math.abs(time - stats.timelineTime) > 80) clear();
    }
    // Native webOS video may expose rVFC without delivering callbacks. Keep
    // an rAF watchdog even when the API exists; a 100 ms load poll is too
    // coarse to follow moving silhouettes. Healthy rVFC retains priority.
    const hasVideoFrames = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function';
    function scheduleVideoFrame() {
      if (disposed || failed || video.seeking) return;
      const generation = frameGeneration;
      videoFrameId = video.requestVideoFrameCallback((_, metadata) => {
        if (disposed || generation !== frameGeneration) return;
        videoFrameId = null;
        // A late callback must not rewind a silhouette already caught up by
        // the watchdog, or suppress that watchdog for another 80 ms.
        if (Number.isFinite(metadata.mediaTime) && video.currentTime * 1000 - metadata.mediaTime * 1000 <= 80) {
          stats.videoFrameCallbacks++; lastVideoFrameAt = performance.now(); tick(metadata.mediaTime * 1000);
        }
        scheduleVideoFrame();
      });
    }
    function animate() {
      if (disposed || failed) return;
      if (!video.paused && (!hasVideoFrames || performance.now() - lastVideoFrameAt > 80)) { stats.animationTicks++; tick(); }
      animationId = requestAnimationFrame(animate);
    }
    const seek = () => {
      desired = null; clear(); status('loading'); lastVideoFrameAt = -Infinity;
      frameGeneration++;
      if (hasVideoFrames) {
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
      if (document.hidden || video.paused) tick();
    };
    if (hasVideoFrames) scheduleVideoFrame();
    animationId = requestAnimationFrame(animate);
    const timer = setInterval(poll, 100); tick(); load();
    return () => {
      disposed = true; desired = null; frameGeneration++; clearInterval(timer);
      if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
      if (animationId !== null) cancelAnimationFrame(animationId);
      video.removeEventListener('seeking', seek); video.removeEventListener('seeked', seeked); clear(); cache.clear(); clearPrepared();
      renderer.dispose();
      if (window.__danmakuMaskStats === diagnostics) delete window.__danmakuMaskStats;
    };
  }, [containerRef, videoRef, source, enabled, onStatus]);
}
