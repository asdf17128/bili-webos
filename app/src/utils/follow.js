// 关注列表缓存,用于卡片上的「已关注」标。
//
// 修过的 bug(owner 2026-08-31:"有些关注了的 up 主没有关注标,有的有有的没有"):
// 原来只拉 5 页 × 50 = 250 个就停,并注释说"web 接口上限 ~250"——**那句是错的**。
// 实测本人账号 pn=6/7/8 都正常返回(共 370 个关注),于是第 251 个之后的 UP
// 永远没有标。现在拉到拉完为止。
import { getNavInfo, getFollowings } from '../api/client';

const PS = 50;
const MAX_PAGES = 40;              // 兜底:2000 个关注,超出的极少数人接受不完整
const TTL = 30 * 60 * 1000;        // 内存 30 分钟
const DISK_TTL = 24 * 60 * 60 * 1000;
const LS_KEY = 'bili_followed';

let followedSet = null;
let loadedAt = 0;

// 冷启动时先用本地缓存把标显示出来,再在后台刷新 —— 否则每次开机都要等
// 8 次请求跑完,期间所有卡片都是"未关注"的样子。
function loadFromDisk() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!raw || !Array.isArray(raw.mids)) return null;
    if (Date.now() - (raw.ts || 0) > DISK_TTL) return null;
    return new Set(raw.mids);
  } catch (e) { return null; }
}

function saveToDisk(set) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), mids: Array.from(set) }));
  } catch (e) { /* 存不下就算了,不影响功能 */ }
}

export function getFollowedSet() {
  if (!followedSet) followedSet = loadFromDisk() || null;
  return followedSet || new Set();
}

export async function loadFollowedMids(force) {
  if (!force && followedSet && (Date.now() - loadedAt) < TTL) return followedSet;
  if (!followedSet) followedSet = loadFromDisk();     // 先给出旧数据,下面再刷新

  const set = new Set();
  try {
    const nav = await getNavInfo();
    const mid = nav?.data?.mid;
    if (!mid) return followedSet || set;
    for (let pn = 1; pn <= MAX_PAGES; pn++) {
      const res = await getFollowings(mid, pn, PS);
      const list = (res?.data?.list) || [];
      // mid 统一成数字:接口两边都给 number,但万一将来变字符串,
      // Set.has 会静默失配(这类 bug 最难查),这里定死类型。
      list.forEach(u => { const m = Number(u.mid); if (m) set.add(m); });
      if (list.length < PS) break;
    }
    if (set.size) {
      followedSet = set;
      loadedAt = Date.now();
      saveToDisk(set);
    }
  } catch (e) {
    console.warn('[follow] loadFollowedMids failed:', e?.message || e);
  }
  return followedSet || set;
}
