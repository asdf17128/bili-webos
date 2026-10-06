// 视频 CDN 的选路与自愈 (#29)。
//
// Keep API-native URLs intact. Ordinary UPOS paths can be tried on the fixed
// mirror allowlist; availability is measured, never inferred from the hostname.
// Akamai needs its API-native signed URL and is never synthesized or used as a
// template for another host. Live streams do not use this DASH routing policy.
//
// 三层:
//   1. 普通 UPOS 路径末尾追加 FALLBACK_MIRRORS 的候选副本 —— 主 CDN 好的
//      时候一个字节不多拉,挂了 Shaka 沿 BaseURL 列表往下滑。
//   2. 同一 host 短时间内连续失败 → 拉黑 5 分钟,请求过滤器直接跳过它,不用
//      等 Shaka 一轮轮重试;黑名单跨视频,同一会话后面的视频直接绕开。
//   3. cdnAuto.js 在缓冲充足/暂停时测真实 Range，缓存健康状态并重排后续分片。

// Small fallback set. hwo1 was checked with a real 206 and matching bytes on
// 2026-10-06; no fixed mirror is assumed fastest across regions or over time.
export const FALLBACK_MIRRORS = [
  'upos-sz-mirrorcosov.bilivideo.com',
  'upos-sz-estgoss.bilivideo.com',
  'upos-sz-mirrorhwo1.bilivideo.com',
];

// 设置 → CDN 线路 可强制的镜像(#10)。没有 akam:见文件头,强制它必 403。
export const CDN_ROUTES = {
  ali: 'upos-sz-mirrorali.bilivideo.com',
  cos: 'upos-sz-mirrorcos.bilivideo.com',
  ks3: 'upos-sz-mirrorks3.bilivideo.com',
  cosov: 'upos-sz-mirrorcosov.bilivideo.com',
  aliov: 'upos-sz-mirroraliov.bilivideo.com',
  hwo1: 'upos-sz-mirrorhwo1.bilivideo.com',
};

export const AUTO_MIRRORS = [...FALLBACK_MIRRORS, CDN_ROUTES.aliov, CDN_ROUTES.ali, CDN_ROUTES.cos];
export const isPcdnUrl = u => /mcdn\.|szbdyd|\bxy[\dx]+xy\b|:\d{4,5}\//i.test(u);

export function canMirror(u) {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && x.hostname.endsWith('.bilivideo.com') &&
      /^\/upgcxcode\//.test(x.pathname) && !isPcdnUrl(u);
  } catch { return false; }
}

export function nativeCdnUrls(rep) {
  const urls = [rep.baseUrl || rep.base_url, ...(rep.backupUrl || rep.backup_url || [])].filter(Boolean);
  return Array.from(new Set(urls)).sort((a, b) => Number(isPcdnUrl(a)) - Number(isPcdnUrl(b)));
}

export function addMirrors(urls, hosts) {
  const result = urls.slice(), template = urls.find(canMirror);
  if (template) for (const host of hosts) {
    if (!result.some(u => cdnHostOf(u) === host)) result.push(withHost(template, host));
  }
  return result.filter(Boolean);
}

export function playbackCdnUrls(rep, route) {
  let urls = nativeCdnUrls(rep);
  const template = urls.find(canMirror), forced = CDN_ROUTES[route];
  if (template && forced) {
    const url = withHost(template, forced);
    urls = [url, ...urls.filter(u => u !== url)];
  }
  urls = addMirrors(urls, FALLBACK_MIRRORS);
  if (testBadCdnEnabled() && template) urls.unshift(withHost(template, TEST_BAD_HOST));
  return demoteBanned(urls);
}

export function isUposUrl(u) {
  return /upos-|\.bilivideo\.(com|cn)|akamaized\.net/i.test(u || '');
}

export function withHost(u, host) {
  try {
    const x = new URL(u);
    x.host = host;
    return x.toString();
  } catch { return null; }
}

// 从任意 URL 里取视频 CDN 的 host。走本地代理的 URL 形如
// http://127.0.0.1:7654/proxy/{host}/{path},要剥掉代理层看真实 host。
export function cdnHostOf(u) {
  try {
    const x = new URL(u);
    const m = x.pathname.match(/^\/proxy\/([^/]+)/);
    return (m ? m[1] : x.host).toLowerCase();
  } catch { return ''; }
}

// ── 黑名单 ──
const FAILS_TO_BAN = 2;      // 60 秒内两次失败就拉黑(一次可能是抖动)
const FAIL_WINDOW_MS = 60000;
const BAN_MS = 5 * 60000;

const fails = new Map();     // host → [ts, ts, …]
const banned = new Map();    // host → until(ts)

export function markFail(host, now) {
  if (!host) return false;
  const t = now || Date.now();
  const list = (fails.get(host) || []).filter(ts => t - ts < FAIL_WINDOW_MS);
  list.push(t);
  fails.set(host, list);
  if (list.length >= FAILS_TO_BAN) {
    banned.set(host, t + BAN_MS);
    fails.delete(host);
    return true;
  }
  return false;
}

export function isBanned(host, now) {
  const until = banned.get(host);
  if (!until) return false;
  if ((now || Date.now()) >= until) { banned.delete(host); return false; }
  return true;
}

export function bannedHosts(now) {
  const t = now || Date.now();
  return Array.from(banned.keys()).filter(h => isBanned(h, t));
}

export function resetCdnState() { fails.clear(); banned.clear(); }
if (typeof window !== 'undefined') window.__cdnBanned = bannedHosts; // test hook

// 把拉黑的 host 挪到末尾(不删:全黑了还得有得试)。
export function demoteBanned(urls) {
  const good = [], bad = [];
  for (const u of urls) (isBanned(cdnHostOf(u)) ? bad : good).push(u);
  return good.concat(bad);
}

// Shaka NetworkingEngine 的 'retry' 事件:一次请求失败、即将换下一个 URI 重试。
// e.error.data[0] 是刚失败的 URI。
export function onShakaRetry(e) {
  try {
    const err = e && (e.error || (e.detail && e.detail.error));
    const uri = err && err.data && err.data[0];
    const host = cdnHostOf(uri);
    if (!host || !isUposUrl('https://' + host + '/')) return;
    if (markFail(host)) {
      try { console.warn('[cdn] banned ' + host + ' for 5min'); } catch {}
    }
  } catch { /* 诊断路径,不能影响播放 */ }
}

// 测试钩子:localStorage bili_test_badcdn=1 → 在最前面塞一个必挂的 host,
// 断言"主 CDN 挂了照样播 + 它被拉黑"。域名走 bilivideo.com 是为了过服务端
// 的 host 白名单,子域不存在 → DNS 失败 → 代理很快回 502。
export const TEST_BAD_HOST = 'upos-sz-mirrorbad.bilivideo.com';
export function testBadCdnEnabled() {
  try { return typeof localStorage !== 'undefined' && !!localStorage.getItem('bili_test_badcdn'); } catch { return false; }
}
