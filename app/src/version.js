// Single source of truth for the app version shown in Settings → 关于.
// Keep in sync with app/webos-meta/appinfo.json on each release.
export const APP_VERSION = '1.2.6';

// Compare two "x.y.z" strings. Returns >0 if a is newer than b.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
