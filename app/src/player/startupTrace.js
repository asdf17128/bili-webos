// Bounded, in-memory startup evidence. Never accept URLs, titles or error text.
// Stages can overlap; their durations must not be added to infer total startup.
const STAGES = ['engine', 'attach', 'view', 'resume', 'url', 'probe', 'load'];
const POINTS = ['request', 'response', 'video', 'audio', 'metadata', 'data', 'playing'];
const clock = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export function createStartupTrace(publish, { now = clock, start = now() } = {}) {
  let dead = false;
  const trace = { state: 'loading', stages: {}, points: {}, requests: 0, responses: 0, retries: 0, maxRequestMs: null };
  const elapsed = () => Math.max(0, Math.round(now() - start));
  const snapshot = () => ({ ...trace,
    stages: Object.keys(trace.stages).reduce((out, key) => { out[key] = { ...trace.stages[key] }; return out; }, {}),
    points: { ...trace.points },
  });
  const emit = () => { if (!dead) publish(snapshot()); };
  const point = key => {
    if (dead || !POINTS.includes(key) || trace.points[key] != null || !['loading', 'ready'].includes(trace.state)) return;
    trace.points[key] = elapsed();
    if (key === 'data') { trace.state = 'ready'; trace.elapsedMs = trace.points.data; }
    emit();
  };
  const finish = state => {
    if (dead || trace.state !== 'loading') return;
    trace.state = state; trace.elapsedMs = elapsed(); emit();
  };
  emit();
  return {
    // Measure the promise at dispatch, not when a concurrent task awaits it.
    async measure(key, fn) {
      if (dead || trace.state !== 'loading' || !STAGES.includes(key)) return fn();
      const began = elapsed();
      const s = trace.stages[key] || (trace.stages[key] = { ms: 0, count: 0, errors: 0, pending: 0 });
      s.count++; s.pending++; emit();
      try {
        const value = await fn();
        if (value && typeof value.code === 'number' && value.code !== 0 && !dead) s.errors++;
        return value;
      } catch (error) {
        if (!dead) s.errors++;
        throw error;
      } finally {
        if (!dead) { s.ms += elapsed() - began; s.pending--; emit(); }
      }
    },
    point,
    request() { if (!dead && trace.state === 'loading') { trace.requests++; point('request'); emit(); } },
    response(response, context) {
      if (dead || trace.state !== 'loading') return;
      trace.responses++;
      const ms = response?.timeMs;
      if (typeof ms === 'number' && isFinite(ms) && ms >= 0) trace.maxRequestMs = Math.max(trace.maxRequestMs, Math.round(ms));
      point('response');
      if (context?.stream?.type === 'video' || context?.stream?.type === 'audio') point(context.stream.type);
      emit();
    },
    retry() { if (!dead && trace.state === 'loading') { trace.retries++; emit(); } },
    fail() { finish('failed'); },
    dispose() { finish('cancelled'); dead = true; },
  };
}

// Compact ASCII lines for a TV-scannable QR. A missing observation is "?",
// not a zero duration; xN identifies repeated attempts, + identifies pending.
export function startupReportLines(trace) {
  if (!trace) return [];
  const ms = n => n == null ? '?' : n + 'ms';
  return [
    'startup ' + trace.state + ' elapsed=' + ms(trace.elapsedMs) + ': ' + STAGES.filter(k => trace.stages[k]).map(k => {
      const s = trace.stages[k];
      return k + '=' + ms(s.ms) + (s.count > 1 ? 'x' + s.count : '') + (s.pending ? '+' : '') + (s.errors ? '!' + s.errors : '');
    }).join(' '),
    'since-open: ' + POINTS.filter(k => trace.points[k] != null).map(k => k + '=' + ms(trace.points[k])).join(' '),
    'media: req=' + trace.requests + ' res=' + trace.responses + ' retry=' + trace.retries + ' slowest=' + ms(trace.responses ? trace.maxRequestMs : null),
  ];
}
