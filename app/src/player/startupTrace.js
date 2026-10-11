// Bounded, in-memory startup evidence. URLs/errors are reduced to safe fields
// immediately; never retain signed paths, titles, headers or error text.
// Stages can overlap; their durations must not be added to infer total startup.
const STAGES = ['engine', 'attach', 'view', 'resume', 'url', 'probe', 'load'];
const POINTS = ['request', 'response', 'video', 'audio', 'metadata', 'data', 'playing', 'vappend', 'aappend'];
const clock = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

function endpoint(uri) {
  try {
    const u = new URL(uri), scheme = u.protocol.slice(0, -1);
    if (scheme === 'blob') return { scheme, host: '' };
    const host = (u.pathname.match(/^\/proxy\/([^/]+)/) || [])[1] || u.hostname;
    return { scheme: /^https?$/.test(scheme) ? scheme : 'other',
      host: /^[a-z0-9.-]{1,100}$/i.test(host) ? host.toLowerCase() : 'other' };
  } catch { return { scheme: 'other', host: '' }; }
}
function mediaState(media) {
  if (!media) return null;
  let ahead = 0;
  try {
    for (let i = 0; i < media.buffered.length; i++) {
      if (media.buffered.start(i) <= media.currentTime + 0.05 && media.buffered.end(i) >= media.currentTime) {
        ahead = Math.max(0, media.buffered.end(i) - media.currentTime); break;
      }
    }
  } catch { /* detached media */ }
  return { ready: media.readyState, bufferMs: Math.round(ahead * 1000) };
}

export function createStartupTrace(publish, { now = clock, start = now() } = {}) {
  let dead = false;
  const trace = { state: 'loading', stages: {}, points: {}, requests: 0, responses: 0, retries: 0, maxRequestMs: null, hosts: {}, media: {}, retryKinds: [], retryOverflow: 0 };
  const elapsed = () => Math.max(0, Math.round(now() - start));
  const snapshot = () => ({ ...trace,
    stages: Object.keys(trace.stages).reduce((out, key) => { out[key] = { ...trace.stages[key] }; return out; }, {}),
    points: { ...trace.points }, hosts: { ...trace.hosts },
    media: Object.keys(trace.media).reduce((out, key) => { out[key] = { ...trace.media[key] }; return out; }, {}),
    retryKinds: trace.retryKinds.map(row => ({ ...row })),
  });
  const emit = () => { if (!dead) publish(snapshot()); };
  const point = (key, media) => {
    if (dead || !POINTS.includes(key) || trace.points[key] != null || !['loading', 'ready'].includes(trace.state)) return;
    trace.points[key] = elapsed();
    const state = mediaState(media);
    if (state) trace.media[key] = state;
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
      const s = trace.stages[key] || (trace.stages[key] = { ms: 0, count: 0, errors: 0, pending: 0, start: began, end: null });
      s.count++; s.pending++; emit();
      try {
        const value = await fn();
        if (value && typeof value.code === 'number' && value.code !== 0 && !dead) s.errors++;
        return value;
      } catch (error) {
        if (!dead) s.errors++;
        throw error;
      } finally {
        if (!dead) { s.end = elapsed(); s.ms += s.end - began; s.pending--; emit(); }
      }
    },
    point,
    request(request) { if (!dead && trace.state === 'loading') {
      trace.requests++;
      if (trace.points.request == null) trace.hosts.request = endpoint(request?.uris?.[0]).host;
      point('request'); emit();
    } },
    response(response, context) {
      if (dead || trace.state !== 'loading') return;
      trace.responses++;
      const ms = response?.timeMs;
      if (typeof ms === 'number' && isFinite(ms) && ms >= 0) trace.maxRequestMs = Math.max(trace.maxRequestMs, Math.round(ms));
      const host = endpoint(response?.uri || response?.originalUri).host;
      if (trace.points.response == null) trace.hosts.response = host;
      point('response');
      const kind = context?.stream?.type;
      if (kind === 'video' || kind === 'audio') {
        if (trace.points[kind] == null) trace.hosts[kind] = host;
        point(kind);
      }
      emit();
    },
    append(kind, media) { if (kind === 'video' || kind === 'audio') point(kind === 'video' ? 'vappend' : 'aappend', media); },
    retry(error) {
      if (dead || trace.state !== 'loading') return;
      trace.retries++;
      // Shaka 4.x error data layouts differ by code; unknown layouts stay unknown.
      const code = Number.isInteger(error?.code) ? error.code : 0, data = error?.data || [];
      const type = code === 1001 ? data[4] : code === 1002 ? data[2] : code === 1003 ? data[1] : null;
      const kind = type === 0 ? 'manifest' : type === 1 ? 'media' : 'other';
      const source = endpoint(data[0]);
      const row = trace.retryKinds.find(r => r.code === code && r.kind === kind && r.scheme === source.scheme && r.host === source.host);
      if (row) row.count++;
      else if (trace.retryKinds.length < 4) trace.retryKinds.push({ code, kind, ...source, count: 1 });
      else trace.retryOverflow++;
      emit();
    },
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
    'media: req=' + trace.requests + ' res=' + trace.responses + ' slowest=' + ms(trace.responses ? trace.maxRequestMs : null),
    'dispatch: ' + STAGES.filter(k => trace.stages[k]).map(k => k + '=' + ms(trace.stages[k].start)).join(' '),
    'first-host: ' + Object.keys(trace.hosts || {}).map(k => k + '=' + (trace.hosts[k] || '?')).join(' '),
    'buffer: ' + Object.keys(trace.media || {}).map(k => k + '=' + trace.media[k].bufferMs + 'ms/r' + trace.media[k].ready).join(' '),
    'net-retry=' + trace.retries + ((trace.retryKinds || []).length ? ': ' + trace.retryKinds.map(r => r.kind + '/' + r.scheme + '/' + r.code + (r.host ? '/' + r.host : '') + 'x' + r.count).join(' ') : '') + (trace.retryOverflow ? ' other=' + trace.retryOverflow : ''),
  ];
}
