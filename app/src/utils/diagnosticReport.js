// This is the ONLY export boundary. Never serialize raw API/service/errors,
// URLs, cookies, UA strings or arbitrary keys, even in a local preview.
export const DIAGNOSTIC_STAGES = ['svc', 'api', 'rcmd', 'view', 'playurl', 'playurl_legacy', 'cdn', 'cdnspeed', 'imgproxy'];
const STARTUP_STAGES = ['engine', 'attach', 'view', 'resume', 'url', 'probe', 'load'];
const STATUSES = ['ok', 'fail', 'skip', 'warn', 'run'];
const REASONS = ['api_error', 'invalid_response', 'verification_required', 'no_stream', 'no_cid', 'timeout', 'network', 'http', 'unknown', 'unavailable'];
const ERROR_CODES = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ABORT_ERR'];
const ROUTES = ['auto', 'ali', 'cos', 'ks3', 'cosov', 'aliov', 'hwo1'];
const allowed = (value, list, fallback) => list.includes(value) ? value : fallback;
const number = (value, min = 0, max = 3600000) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null;
const code = value => ERROR_CODES.includes(value) ? value : Number.isInteger(value) ? number(value, -100000, 100000) : null;
const version = value => typeof value === 'string' && /^v?\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(value) ? value.replace(/^v/, '') : '?';
// BUILD_VERSION is a compile-time constant; retain bounded test labels so a
// local candidate can still be distinguished from the released package.
const buildVersion = value => typeof value === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,5} [a-z][a-z0-9-]{0,23}\.\d{1,4}$/.test(value) ? value : version(value);


// Original playback failure survives later diagnostic probes. Only fixed
// categories and numeric measurements cross the export boundary; no video IDs.
export function diagnosticContextLines(svc, now = Date.now()) {
  if (!svc || typeof svc !== 'object') return [];
  const n = (v, min = 0, max = 3600000) => number(v, min, max) ?? '?';
  const lines = [];
  if (typeof svc.loggedIn === 'boolean') lines.push('session: login=' + (svc.loggedIn ? 'Y' : 'N'));
  if (svc.identity) lines.push('identity: pending=' + (svc.identity.pending === true) + ' cooldown=' + n(svc.identity.cooldownSec, 0, 86400) + 's');
  if (Array.isArray(svc.cookieKeys)) lines.push('identity-fields: ' + ['buvid3', 'buvid4', 'b_nut', '_uuid', 'buvid_fp'].map(key => key + '=' + (svc.cookieKeys.includes(key) ? 'Y' : 'N')).join(' '));
  if(svc.activation) lines.push('activation: state=' + allowed(svc.activation.state,['idle','pending','accepted','failed','timeout','persistence','session_changed'],'unknown') + ' cooldown=' + n(svc.activation.cooldownSec,0,300) + 's');
  const recovery = svc.playback?.lastRecovery;
  if (recovery && typeof recovery === 'object') {
    lines.push('previous-recovery: age=' + n((now - recovery.at) / 1000, 0, 31536000) +
      's state=' + allowed(recovery.recovery, ['pending', 'retried', 'timeout', 'persistence', 'session_changed', 'invalid_response', 'identity_unchanged', 'reset', 'dns', 'transport'], 'unknown') +
      ' final=' + allowed(recovery.outcome, ['ok', 'failed'], 'unknown'));
    (Array.isArray(recovery.attempts) ? recovery.attempts.slice(0, 2) : []).forEach((a, i) => {
      if (a && typeof a === 'object') lines.push('previous-attempt' + (i + 1) + ': http=' + n(a.http, 100, 599) +
        ' code=' + n(a.code, -100000, 100000) + ' stream=' + (a.stream === true));
    });
  }
  const f = svc.playback?.lastFailure;
  if (!f || typeof f !== 'object') return lines;
  lines.push('failure: ' + allowed(f.kind, ['ugc', 'wbi', 'pgc', 'pgc_v2'], 'unknown') + ' age=' + n((now - f.at) / 1000, 0, 31536000) + 's qn=' + n(f.qn, 0, 999) + ' fnval=' + n(f.fnval, 0, 65535));
  (Array.isArray(f.attempts) ? f.attempts.slice(0, 2) : []).forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    let row = 'attempt' + (i + 1) + ': http=' + n(a.http, 100, 599) + ' code=' + n(a.code, -100000, 100000) + ' voucher=' + (a.voucher === true) + ' stream=' + (a.stream === true) + ' ms=' + n(a.ms);
    if (a.error) row += ' error=' + allowed(a.error, ['timeout', 'cooldown', 'persistence', 'session_changed', 'invalid_response', 'identity_unchanged', 'reset', 'dns', 'transport', 'non_json'], 'unknown');
    lines.push(row);
  });
  lines.push('recovery=' + allowed(f.recovery, ['none', 'pending', 'retried', 'timeout', 'cooldown', 'persistence', 'session_changed', 'invalid_response', 'identity_unchanged', 'reset', 'dns', 'transport'], 'unknown') + ' final=' + allowed(f.outcome, ['ok', 'failed'], 'unknown'));
  return lines;
}

// Keep only the presence of a usable stream / verification challenge, never
// the challenge value, stream URL or other fields of data/result (PGC).
export function describePlayResponse(response) {
  const data = response?.data || response?.result;
  const videos = data?.dash?.video;
  const durl = data?.durl;
  const hasUrl = value => typeof value === 'string' && /^https?:\/\//.test(value);
  const hasStream = !!((Array.isArray(videos) && videos.some(v => hasUrl(v?.baseUrl) || hasUrl(v?.base_url))) ||
    (Array.isArray(durl) && durl.some(v => hasUrl(v?.url))));
  const voucher = !!data?.v_voucher;
  const rawCode = Number.isInteger(response?.code) ? number(response.code, -100000, 100000) : null;
  const reason = rawCode === null ? 'invalid_response' : rawCode !== 0 ? 'api_error' : !hasStream ? (voucher ? 'verification_required' : 'no_stream') : null;
  return { status: reason ? 'fail' : 'ok', code: rawCode, hasStream, voucher, reason };
}

export function diagnosticError(error) {
  const rawCode = code(error?.code);
  // Text is inspected for a category only, never copied into the report.
  const message = typeof error?.message === 'string' ? error.message.slice(0, 2048) : '';
  const http = /\bHTTP ([45]\d\d)\b/.exec(message);
  const reason = /timeout|timed out/i.test(message) || rawCode === 'ETIMEDOUT' ? 'timeout' :
    http ? 'http' : ERROR_CODES.includes(rawCode) || /fetch|network|socket|aborted/i.test(message) ? 'network' : 'unknown';
  return { reason, code: rawCode === null && http ? Number(http[1]) : rawCode };
}

function fields(row) {
  const out = {};
  const c = code(row?.code);
  if (c !== null) out.code = c;
  if (typeof row?.hasStream === 'boolean') out.hasStream = row.hasStream;
  if (typeof row?.voucher === 'boolean') out.voucher = row.voucher;
  if (REASONS.includes(row?.reason)) out.reason = row.reason;
  for (const key of ['ms', 'retries', 'attempts', 'errors']) {
    const value = number(row?.[key], 0, key === 'ms' ? 3600000 : 9999);
    if (value !== null) out[key] = value;
  }
  if (['wbi', 'legacy'].includes(row?.endpoint)) out.endpoint = row.endpoint;
  if (['reference', 'recommendation'].includes(row?.source)) out.source = row.source;
  return out;
}

export function diagnosticDetail(row) {
  const safe = fields(row);
  return Object.keys(safe).map(key => key + '=' + (typeof safe[key] === 'boolean' ? (safe[key] ? 'yes' : 'no') : safe[key])).join(' ');
}

export function buildDiagnosticReport({ version: appVersion, chromeMajor, nodeVersion, platform, route, checks, startup, qualitySwitch, errors, service } = {}) {
  const report = {
    schema: 1, version: buildVersion(appVersion),
    context: diagnosticContextLines(service),
    environment: { chromeMajor: number(chromeMajor, 1, 999), node: version(nodeVersion), platform: allowed(platform, ['tv', 'browser'], 'unknown') },
    route: allowed(route, ROUTES, 'auto'),
    checks: DIAGNOSTIC_STAGES.map(stage => {
      const row = Array.isArray(checks) && checks.find(r => r?.stage === stage);
      return row ? { stage, status: allowed(row.status, STATUSES, 'fail'), ...fields(row) } : null;
    }).filter(Boolean),
  };
  if (qualitySwitch && typeof qualitySwitch === 'object') {
    report.qualitySwitch = {
      state: allowed(qualitySwitch.state, ['loading', 'ready', 'failed'], 'unknown'),
      kind: allowed(qualitySwitch.kind, ['wbi', 'pgc'], 'unknown'),
      stage: allowed(qualitySwitch.stage, ['url', 'selection', 'probe', 'load'], 'unknown'),
      ...fields(qualitySwitch),
    };
    for (const key of ['requested', 'selected', 'served', 'fps', 'profile', 'mediaCode', 'category']) {
      const value = number(qualitySwitch[key], 0, key === 'mediaCode' ? 100000 : 999);
      if (value !== null) report.qualitySwitch[key] = value;
    }
  }
  if (startup) {
    report.startup = { state: allowed(startup.state, ['loading', 'ready', 'failed', 'cancelled'], 'unknown'),
      ...fields({ ms: startup.elapsedMs, retries: startup.retries }),
      stages: STARTUP_STAGES.filter(stage => startup.stages?.[stage]).map(stage => {
        const s = startup.stages[stage];
        return { stage, ...fields({ ...s, attempts: s.count }) };
      }) };
  }
  // Existing local ring buffers may contain free-form errors. Reduce to
  // categories/codes, discard tags, timestamps, bodies and all other fields.
  report.errors = (Array.isArray(errors) ? errors.slice(-8) : []).map(e => diagnosticError({ code: e?.code, message: e?.d }))
    .filter((e, i, all) => all.findIndex(x => x.reason === e.reason && x.code === e.code) === i).slice(-4);
  return report;
}

export function diagnosticReportText(input) {
  // Construct fresh allowlisted fields, never trust caller-formatted lines.
  // The returned ASCII text is shared verbatim by preview and export.
  const r = buildDiagnosticReport(input);
  const lines = ['diag=1 app=' + r.version,
    'env chromeMajor=' + (r.environment.chromeMajor ?? '?') + ' node=' + r.environment.node + ' platform=' + r.environment.platform,
    'route=' + r.route];
  if (r.qualitySwitch) lines.push('quality-switch: ' + Object.entries(r.qualitySwitch).map(([k, v]) => k + '=' + v).join(' '));
  lines.push(...r.context);
  for (const row of r.checks) lines.push('[' + row.status + '] ' + row.stage + ' ' + diagnosticDetail(row));
  if (r.startup) {
    lines.push('startup ' + r.startup.state + ' ' + diagnosticDetail(r.startup));
    for (const row of r.startup.stages) lines.push('stage ' + row.stage + ' ' + diagnosticDetail(row));
  }
  for (const e of r.errors) lines.push('error ' + diagnosticDetail(e));
  const bounded = [];
  for (const line of lines) {
    if (bounded.join('\n').length + line.length + 14 > 1800) { bounded.push('truncated=1'); break; }
    bounded.push(line);
  }
  return bounded.join('\n');
}

export function diagnosticIssueUrl(input) {
  const body = diagnosticReportText(input);
  return 'https://github.com/asdf17128/bili-webos/issues/new?title=' + encodeURIComponent('[diag] v' + buildVersion(input?.version)) +
    '&body=' + encodeURIComponent(body).replace(/%20/g, '+');
}
