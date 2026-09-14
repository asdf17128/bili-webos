// 视频 CDN 的选路与自愈 (#29)。
//
// B站 playurl 给的主/备 URL 都是 upos 镜像(*.bilivideo.com / akamaized.net),
// 校验的是 query 里的 upsig,**不含 host**——同一条签名 URL 换到任何一个
// bilivideo.com 镜像都能拉(2026-09-14 从洛杉矶和国内直连都验过,连 Akamai
// 签的 URL 换到 cosov/estgoss 也是 206)。唯独换**到** Akamai 不行:它要自己
// 的 hdnts token,只有 playurl 原生给的 akam URL 才带 → 任何改写都是 403,
// 所以 Akamai 只能"B站 给了就用",不能强制。
//
// 三层:
//   1. buildBaseUrls 末尾无条件追加 FALLBACK_MIRRORS 的改写副本 —— 主 CDN 好的
//      时候一个字节不多拉,挂了 Shaka 沿 BaseURL 列表往下滑。
//   2. 同一 host 短时间内连续失败 → 拉黑 5 分钟,请求过滤器直接跳过它,不用
//      等 Shaka 一轮轮重试;黑名单跨视频,同一会话后面的视频直接绕开。
//   3. (v2.2 再做)缓冲充足时后台测速自选最快镜像。

// 海外实测:cosov(腾讯云海外)4.8–8.8 MB/s 最稳;estgoss 是大陆里海外可达且
// 最快的(1.1–1.4 MB/s),也是国内 playurl 的常客。两个够了,列表越长
// Shaka 失败转移一轮越久。
export const FALLBACK_MIRRORS = [
  'upos-sz-mirrorcosov.bilivideo.com',
  'upos-sz-estgoss.bilivideo.com',
];

// 设置 → CDN 线路 可强制的镜像(#10)。没有 akam:见文件头,强制它必 403。
export const CDN_ROUTES = {
  ali: 'upos-sz-mirrorali.bilivideo.com',
  cos: 'upos-sz-mirrorcos.bilivideo.com',
  ks3: 'upos-sz-mirrorks3.bilivideo.com',
  cosov: 'upos-sz-mirrorcosov.bilivideo.com',
  aliov: 'upos-sz-mirroraliov.bilivideo.com',
};

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
