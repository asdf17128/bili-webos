// Bounded numeric-only diagnostic. rAF delay is scheduling latency, not a
// physical display measurement. No keys, video IDs, URLs or wall-clock times.
export function createControlTiming(now, frame) {
  let groups = {}, pending = false, generation = 0;
  return {
    reset() { groups = {}; pending = false; generation++; },
    record(result, age, paused) {
      const name = paused ? 'paused' : 'playing';
      const row = groups[name] || (groups[name] = { keys: 0, stale: 0, coalesced: 0, ageMax: 0, frameMax: 0, frames: 0 });
      if (row.keys >= 120) return;
      row.keys++;
      if (result === 'stale') row.stale++;
      if (result === 'repeat') row.coalesced++;
      if (Number.isFinite(age) && age >= 0 && age <= 60000) row.ageMax = Math.max(row.ageMax, Math.round(age));
      if (pending) return;
      pending = true;
      const start = now(), current = generation;
      frame(() => {
        if (current !== generation) return;
        pending = false; row.frames++;
        row.frameMax = Math.min(60000, Math.max(row.frameMax, Math.round(now() - start)));
      });
    },
    snapshot() { return Object.fromEntries(Object.entries(groups).map(([name,row]) => [name,{...row}])); },
  };
}
export const controlTiming = createControlTiming(() => performance.now(), callback => requestAnimationFrame(callback));
