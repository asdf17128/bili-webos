// Coalesce integer-second cast updates. A slow Luna service must not accumulate
// concurrent requests; after it replies only the newest position is relevant.
export function createProgressReporter(send) {
  let busy = false, disposed = false, latest = null, delivered = null;
  const equal = (a, b) => a && b && a.duration === b.duration && a.position === b.position;
  function flush() {
    if (disposed || busy || !latest || equal(latest, delivered)) return;
    const payload = latest;
    busy = true;
    Promise.resolve().then(() => { if (!disposed) return send(payload); }).then(() => { delivered = payload; }, () => {}).then(() => {
      busy = false;
      // A failed unchanged position retries on the next sample, never in a loop.
      if (!equal(latest, payload)) flush();
    });
  }
  return {
    update(duration, position) {
      if (disposed) return;
      latest = { duration: Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0,
        position: Number.isFinite(position) ? Math.max(0, Math.floor(position)) : 0 };
      flush();
    },
    dispose() { disposed = true; latest = null; },
  };
}
