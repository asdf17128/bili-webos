// Export only compact evidence; signed URLs and authentication are never useful
// in a public issue. Apply redaction before truncation (including error logs).
export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
    .replace(/(?:SESSDATA|bili_jct|DedeUserID|buvid\w*|v_voucher|access_token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '[private]')
    .replace(/[^\x20-\x7e]/g, '').trim();
}

export function diagnosticContextLines(svc, now = Date.now()) {
  if (!svc) return [];
  const lines = ['session: login=' + (svc.loggedIn ? 'Y' : 'N')];
  const n = v => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : '?';
  const token = v => /^[a-z_]{1,24}$/.test(v || '') ? v : '?';
  if (svc.identity) lines.push('identity: pending=' + !!svc.identity.pending + ' cooldown=' + n(svc.identity.cooldownSec) + 's');
  const f = svc.playback?.lastFailure;
  if (!f) return lines;
  let source = 'failure: ' + token(f.kind) + ' age=' + n(Math.max(0, (now - f.at) / 1000)) + 's';
  if (/^BV[a-zA-Z0-9]{10}$/.test(f.bvid || '')) source += ' bvid=' + f.bvid;
  for (const k of ['cid', 'ep_id', 'qn', 'fnval']) if (f[k] != null) source += ' ' + k + '=' + n(f[k]);
  lines.push(source);
  (f.attempts || []).slice(0, 2).forEach((a, i) => lines.push('attempt' + (i + 1) + ': http=' + n(a.http) + ' code=' + n(a.code) + ' voucher=' + !!a.voucher + ' stream=' + !!a.stream + ' ms=' + n(a.ms) + (a.error ? ' error=' + token(a.error) : '')));
  lines.push('recovery=' + token(f.recovery) + ' final=' + token(f.outcome));
  return lines;
}
