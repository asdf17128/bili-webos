// Bounded numeric-only diagnostics. Timer/rAF delays are scheduling proxies,
// never physical display latency. No keys, video IDs, URLs or wall-clock times.
export function createControlTiming(now, frame, timer = callback => setTimeout(callback, 0)) {
  let groups = {}, pending = false, generation = 0;
  return {
    reset() { groups = {}; pending = false; generation++; },
    record(result, age, paused) {
      const name = paused ? 'paused' : 'playing';
      const row = groups[name] || (groups[name] = { keys: 0, stale: 0, coalesced: 0, ageMax: 0, frameMax: 0, frames: 0, timerMax: 0, timers: 0, handlerMax: 0 });
      if (row.keys >= 120) return;
      row.keys++;
      if (result === 'stale') row.stale++;
      if (result === 'repeat') row.coalesced++;
      if (Number.isFinite(age) && age >= 0 && age <= 60000) row.ageMax = Math.max(row.ageMax, Math.round(age));
      if (pending) return;
      pending = true;
      const start = now(), current = generation;
      let completed = 0;
      const finish = type => {
        if (current !== generation) return;
        row[type === 'frame' ? 'frames' : 'timers']++;
        row[type + 'Max'] = Math.min(60000, Math.max(row[type + 'Max'], Math.round(now() - start)));
        if (++completed === 2) pending = false;
      };
      frame(() => finish('frame'));
      timer(() => finish('timer'));
    },
    handled(ms, paused) {
      const row = groups[paused ? 'paused' : 'playing'];
      if (row && row.keys < 120 && Number.isFinite(ms)) row.handlerMax = Math.min(60000, Math.max(row.handlerMax, Math.round(ms)));
    },
    snapshot() { return Object.fromEntries(Object.entries(groups).map(([name,row]) => [name,{...row}])); },
  };
}
export const controlTiming = createControlTiming(() => performance.now(), callback => requestAnimationFrame(callback));
