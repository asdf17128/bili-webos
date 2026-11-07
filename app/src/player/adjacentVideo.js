import { nextPlaylistItem } from '../utils/library.js';

const present = value => value !== undefined && value !== null && value !== '';
const same = (left, right) => present(left) && present(right) && String(left) === String(right);
const playable = item => !!(item && (item.bvid || item.aid || item.epid));

// Use the player's resolved CID: the original card can still carry the first
// P even though automatic resume selected a later part of the same BV.
function samePart(item, video, cid) {
  if (!item) return false;
  if (present(video.epid) && present(item.epid) && !same(video.epid, item.epid)) return false;
  if (present(video.bvid) && present(item.bvid) && !same(video.bvid, item.bvid)) return false;
  if (present(cid) && present(item.cid)) return same(cid, item.cid);
  return same(video.epid, item.epid) || same(video.bvid, item.bvid) || same(video.aid, item.aid);
}

function sameVideo(item, video, cid) {
  return same(item.bvid, video.bvid) || same(item.aid, video.aid)
    || same(item.epid, video.epid) || same(item.cid, cid);
}

function scan(list, index, step, predicate) {
  for (let i = index + step; i >= 0 && i < list.length; i += step) {
    if (predicate(list[i])) return i;
  }
  return -1;
}

function navigationContext({ video = {}, cid = video.cid, parts = [], related = [] } = {}) {
  if (Array.isArray(video.playlist)) {
    const list = video.playlist, index = video.playlistIndex;
    // An explicit list must not silently turn into unrelated recommendations
    // when its position is invalid or the last playable entry is reached.
    const valid = Number.isInteger(index) && index >= 0 && index < list.length;
    return { kind: 'playlist', video, list, index, valid };
  }
  const isBangumi = !!(video.isBangumi || video.epid || video.seasonId);
  const list = Array.isArray(parts) && parts.length ? parts : isBangumi && Array.isArray(related) ? related : null;
  if (list) return { kind: 'sequence', list, index: list.findIndex(item => samePart(item, video, cid)) };
  const next = (Array.isArray(related) ? related : []).find(item => playable(item) && !sameVideo(item, video, cid));
  return { kind: 'related', next: next || null };
}

// Rendering this is synchronous and never fetches pages. A known next page is
// an available action even when its first playable item has not loaded yet.
export function adjacentAvailability(context) {
  const nav = navigationContext(context);
  if (nav.kind === 'related') return { previous: false, next: !!nav.next };
  if ((nav.kind === 'playlist' && !nav.valid) || nav.index < 0) return { previous: false, next: false };
  const predicate = nav.kind === 'playlist' ? item => !!item?.bvid : playable;
  return {
    previous: scan(nav.list, nav.index, -1, predicate) >= 0,
    next: scan(nav.list, nav.index, 1, predicate) >= 0 || (nav.kind === 'playlist' && !!nav.video.playlistSource?.hasMore),
  };
}

// The caller owns cancellation, playback changes and error UI. Return a target
// with its list context intact; the caller applies playAdvance to start at zero.
export async function resolveAdjacentVideo(direction, context, fetchPage) {
  if (direction !== 'previous' && direction !== 'next') return null;
  const nav = navigationContext(context);
  if (nav.kind === 'related') return direction === 'next' && nav.next ? { ...nav.next } : null;
  if ((nav.kind === 'playlist' && !nav.valid) || nav.index < 0) return null;
  if (nav.kind === 'playlist') {
    if (direction === 'next') {
      // Keep unavailable slots (and therefore indices) while protecting the
      // shared paginator's BVID dedupe from null entries in older saved lists.
      const playlist = nav.list.some(item => !item) ? nav.list.map(item => item || {}) : nav.list;
      return nextPlaylistItem({ ...nav.video, playlist }, fetchPage);
    }
    const index = scan(nav.list, nav.index, -1, item => !!item?.bvid);
    return index < 0 ? null : { ...nav.list[index], playlist: nav.list, playlistIndex: index,
      playlistSource: nav.video.playlistSource, fromToView: nav.video.fromToView };
  }
  const index = scan(nav.list, nav.index, direction === 'previous' ? -1 : 1, playable);
  return index < 0 ? null : { ...nav.list[index] };
}
