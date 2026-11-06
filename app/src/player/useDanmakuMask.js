import { useEffect } from 'react';
import { getDanmakuMaskRange } from '../api/client';
import { maskUrl, maskHeader, maskIndex, decodeMaskSegment, maskFrame, currentMaskFrame, MASK_LIMITS } from './danmakuMask';
import { prepareDanmakuMaskImage } from './danmakuMaskImage';

// The native video plane is never read. Only the overlay gets an alpha mask.
export function useDanmakuMask(containerRef, videoRef, source, enabled, onStatus) {
  useEffect(() => {
    const element = containerRef.current, video = videoRef?.current;
    const url = maskUrl(source?.mask_url);
    const supports = typeof CSS !== 'undefined' && (CSS.supports('mask-image', 'linear-gradient(white, white)') || CSS.supports('-webkit-mask-image', 'linear-gradient(white, white)'));
    let disposed = false, busy = false, index = null, failed = false, lastKey = '', target = -1;
    const cache = new Map(), prepared = new Map();
    let desired = null, preparing = false, cancelPreparation = null;
    const clearPrepared = () => { prepared.forEach(bitmap => bitmap.dispose?.()); prepared.clear(); };
    const stats = { requests: 0, failures: 0, applied: 0, cached: 0, decodedFrames: 0, frameTime: null, timelineTime: null, sourceProtectedRatio: null, prepareMs: 0, selection: null };
    let videoFrameId = null, animationId = null, frameGeneration = 0, lastVideoFrameAt = -Infinity;
    const status = value => { if (!disposed) onStatus?.(value); };
    const clear = () => {
      if (element) { element.style.webkitMaskImage = 'none'; element.style.maskImage = 'none'; }
      lastKey = ''; stats.frameTime = null; stats.timelineTime = null; stats.sourceProtectedRatio = null; stats.selection = null;
    };
    clear();
    if (!enabled) { status('off'); return; }
    if (!element || !video || !supports) { status('unsupported'); return; }
    if (!url) { status('unavailable'); return; }
    const diagnostics = () => ({ ...stats, cached: cache.size, prepared: prepared.size, preparing, state: failed ? 'failed' : lastKey ? (stats.sourceProtectedRatio === 0 ? 'unprotected' : 'active') : 'waiting' });
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
      } catch (_) { if (!disposed) { failed = true; stats.failures++; clear(); cache.clear(); clearPrepared(); cancelPreparation?.(); status('failed'); } }
      finally { busy = false; }
    }
    function commit(target, bitmap) {
      if (disposed || failed || target !== desired || video.seeking || document.hidden || Math.abs(video.currentTime * 1000 - target.clockAtSelection) > 80) return;
      const { time, width, height, x, y, w, h } = target;
      let frame = target.frame;
      let selection = 'future';
      if (bitmap.sourceProtectedRatio === 0 && frame.time > time && target.current && target.current.uri !== frame.uri) {
        const currentBitmap = prepared.get(target.current.uri);
        if (!currentBitmap) return;
        if (currentBitmap.sourceProtectedRatio > 0) { frame = target.current; bitmap = currentBitmap; selection = 'current-transition'; }
      }
      const key = frame.uri + ':' + target.layoutKey;
      stats.frameTime = frame.time; stats.timelineTime = time; stats.sourceProtectedRatio = bitmap.sourceProtectedRatio; stats.selection = selection;
      if (key === lastKey) return;
      // Use the already decoded small PNG directly. Wrapping it in a fresh
      // SVG image caused another asynchronous decode and blank mask frames.
      const clamp = (value, end) => Math.max(0, Math.min(end, value));
      const top = clamp(y, height), bottom = clamp(y + h, height), left = clamp(x, width), right = clamp(x + w, width);
      const layers = [`url("${bitmap.uri}")`], sizes = [`${w}px ${h}px`], positions = [`${x}px ${y}px`];
      if (top > 0 || bottom < height) {
        layers.push(`linear-gradient(to bottom, white 0px, white ${top}px, transparent ${top}px, transparent ${bottom}px, white ${bottom}px)`);
        sizes.push('100% 100%'); positions.push('0px 0px');
      }
      if (left > 0 || right < width) {
        layers.push(`linear-gradient(to right, white 0px, white ${left}px, transparent ${left}px, transparent ${right}px, white ${right}px)`);
        sizes.push('100% 100%'); positions.push('0px 0px');
      }
      element.style.webkitMaskImage = layers.join(','); element.style.maskImage = layers.join(',');
      element.style.webkitMaskSize = sizes.join(','); element.style.maskSize = sizes.join(',');
      element.style.webkitMaskPosition = positions.join(','); element.style.maskPosition = positions.join(',');
      element.style.webkitMaskRepeat = 'no-repeat'; element.style.maskRepeat = 'no-repeat';
      element.style.webkitMaskComposite = 'source-over'; element.style.maskComposite = 'add';
      lastKey = key; stats.applied++; status(bitmap.sourceProtectedRatio === 0 ? 'gap' : 'active');
    }
    function prepareNext() {
      if (disposed || failed || preparing || !desired || document.hidden || video.seeking) return;
      const work = [desired.frame, desired.current, ...desired.next].find(frame => frame && !prepared.has(frame.uri));
      if (!work) return;
      preparing = true;
      const generation = frameGeneration, started = performance.now();
      // A tiny cancellation signal also works on webOS engines without native
      // AbortController. Only the mask decoder subscribes to this signal.
      let abortListener = null;
      const signal = { aborted: false, addEventListener: (_, listener) => { abortListener = listener; }, removeEventListener: (_, listener) => { if (abortListener === listener) abortListener = null; } };
      const cancel = () => { if (!signal.aborted) { signal.aborted = true; abortListener?.(); } };
      cancelPreparation = cancel;
      prepareDanmakuMaskImage(work.uri, { signal }).then(bitmap => {
        if (disposed || failed || generation !== frameGeneration) { bitmap.dispose?.(); return; }
        stats.prepareMs = Math.round(performance.now() - started);
        prepared.set(work.uri, bitmap);
        while (prepared.size > 8) { const key = prepared.keys().next().value; prepared.get(key).dispose?.(); prepared.delete(key); }
        if (desired && (desired.frame.uri === work.uri || desired.current?.uri === work.uri)) { const ready = prepared.get(desired.frame.uri); if (ready) commit(desired, ready); }
      }).catch(() => {
        if (!disposed && !failed && generation === frameGeneration) { failed = true; stats.failures++; clear(); cache.clear(); clearPrepared(); cancelPreparation?.(); status('failed'); }
      }).finally(() => { if (cancelPreparation === cancel) cancelPreparation = null; preparing = false; if (!disposed) prepareNext(); });
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
      // A small look-ahead prepares masks before presentation. Never decode the
      // video; at most one source-size mask bitmap is being prepared at once.
      const next = [], candidates = frames.slice(frames.indexOf(frame) + 1);
      for (const candidate of candidates) {
        if (candidate.uri !== frame.uri && !next.some(f => f.uri === candidate.uri)) next.push(candidate);
        if (next.length === 2) break;
      }
      desired = { frame, current: currentMaskFrame(frames, time), time, layoutKey, width, height, x, y, w, h, next, clockAtSelection: video.currentTime * 1000 };
      const bitmap = prepared.get(frame.uri);
      if (bitmap) { prepared.delete(frame.uri); prepared.set(frame.uri, bitmap); commit(desired, bitmap); }
      // Do not let slow preparation leave a frozen silhouette over a cut.
      if (stats.timelineTime !== null && Math.abs(time - stats.timelineTime) > 80) clear();
      prepareNext();
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
      desired = null; clear(); status('loading'); lastVideoFrameAt = -Infinity;
      frameGeneration++; cancelPreparation?.();
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
      if (document.hidden || video.paused || (hasVideoFrames && performance.now() - lastVideoFrameAt > 150)) tick();
    };
    if (hasVideoFrames) scheduleVideoFrame();
    else animationId = requestAnimationFrame(animate);
    const timer = setInterval(poll, 100); tick(); load();
    return () => {
      disposed = true; desired = null; frameGeneration++; cancelPreparation?.(); clearInterval(timer);
      if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
      if (animationId !== null) cancelAnimationFrame(animationId);
      video.removeEventListener('seeking', seek); video.removeEventListener('seeked', seeked); clear(); cache.clear(); clearPrepared();
      if (window.__danmakuMaskStats === diagnostics) delete window.__danmakuMaskStats;
    };
  }, [containerRef, videoRef, source, enabled, onStatus]);
}
