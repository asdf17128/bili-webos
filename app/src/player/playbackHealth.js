// Playback can run out of data with readyState=1. That is precisely when the
// old watchdog reset its clock (#35). Never seek forward to hide a stall.
export function createStallMonitor() {
  let lastTime = null, stalledAt = null, retriedAt = null;
  return (video, loading, now = Date.now()) => {
    const inactive = !video || loading || video.paused || video.ended || video.seeking;
    const moved = video && (lastTime == null || Math.abs(video.currentTime - lastTime) >= 0.05);
    lastTime = video ? video.currentTime : null;
    if (inactive || moved) {
      stalledAt = null; retriedAt = null;
      return { buffering: false, retry: false, failed: false };
    }
    if (stalledAt == null) stalledAt = now;
    const elapsed = now - stalledAt;
    const retry = elapsed >= 3000 && (retriedAt == null || now - retriedAt >= 8000);
    if (retry) retriedAt = now;
    return { buffering: elapsed >= 1500, retry: retry && elapsed < 30000, failed: elapsed >= 30000 };
  };
}

// In-memory, URL/token-free evidence for the next diagnostic report.
let lastPlayback = null;
export function startPlaybackReport(route) {
  lastPlayback = { route: route || 'auto', host: '', stalls: 0, retries: 0, buffer: 0, at: Date.now() };
}
export function updatePlaybackReport(values) {
  if (lastPlayback) Object.assign(lastPlayback, values, { at: Date.now() });
}
export function countPlaybackEvent(key) {
  if (lastPlayback && (key === 'stalls' || key === 'retries')) lastPlayback[key]++;
}
export function getPlaybackReport() { return lastPlayback ? { ...lastPlayback } : null; }
export function bufferedAhead(video) {
  try {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) > video.currentTime) {
        return video.buffered.end(i) - video.currentTime;
      }
    }
  } catch { /* unloaded element */ }
  return 0;
}
