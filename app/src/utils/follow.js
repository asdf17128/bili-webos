// Cache of the logged-in user's followed UP mids, for the "已关注" card badge.
// Web relation API caps at ~250 followings, so this is best-effort.
import { getNavInfo, getFollowings } from '../api/client';

let followedSet = null;
let loadedAt = 0;
const TTL = 30 * 60 * 1000; // 30 min

export function getFollowedSet() {
  return followedSet || new Set();
}

export async function loadFollowedMids(force) {
  if (!force && followedSet && (Date.now() - loadedAt) < TTL) return followedSet;
  const set = new Set();
  try {
    const nav = await getNavInfo();
    const mid = nav?.data?.mid;
    if (!mid) return followedSet || set;
    for (let pn = 1; pn <= 5; pn++) {
      const res = await getFollowings(mid, pn, 50);
      const list = (res?.data?.list) || [];
      list.forEach(u => { if (u.mid) set.add(u.mid); });
      if (list.length < 50) break;
    }
    followedSet = set;
    loadedAt = Date.now();
  } catch (e) {
    console.warn('[follow] loadFollowedMids failed:', e?.message || e);
  }
  return followedSet || set;
}
