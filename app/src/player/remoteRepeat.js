// Bound held-key work without delaying deliberate taps or replaying a backlog.
export function createRemoteRepeat(interval = 120, maxAge = 250) {
  let held = null, acceptedAt = -Infinity;
  return {
    inspect(event, now, wallNow) {
      const repeat = event.repeat || held === event.key;
      if (event.repeat && held !== event.key) return 'stale';
      const stamp = Number(event.timeStamp);
      const age = stamp > 1e12 ? wallNow - stamp : now - stamp;
      if (repeat && stamp > 0 && age > maxAge) return 'stale';
      const changed = held !== event.key;
      held = event.key;
      if (!changed && now - acceptedAt < interval) return 'repeat';
      acceptedAt = now;
      return 'accept';
    },
    release(key) { if (!key || held === key) held = null; },
    isHeld() { return held !== null; },
  };
}
