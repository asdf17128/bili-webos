export function libraryKey(folder) { return `${Number(folder.type) === 21 ? 'season' : 'folder'}:${folder.id}`; }
export function librarySource(folder) {
  return { id: folder.id, type: Number(folder.type) || 11, mid: folder.upper?.mid || folder.mid, owner: folder.upper?.name || '' };
}
export function mapLibraryPage(data, folder, pn, ps) {
  const season = Number(folder.type) === 21;
  const raw = (season ? data?.archives : data?.medias) || [];
  const items = raw.filter(m => m.bvid && (!m.type || Number(m.type) === 2)).map(m => ({
    bvid: m.bvid, aid: m.aid || m.id, cid: m.cid || m.ugc?.first_cid,
    title: m.title, pic: m.pic || m.cover, duration: m.duration,
    owner: m.owner || { name: m.upper?.name || folder.owner || folder.upper?.name || '', mid: m.upper?.mid || folder.mid },
    stat: m.stat || { view: m.cnt_info?.play }, pubdate: m.pubdate || m.pubtime,
  }));
  const total = season ? data?.page?.total : data?.info?.media_count;
  const hasMore = season ? pn * ps < Number(total || 0)
    : (data?.has_more != null ? !!Number(data.has_more) : (total != null ? pn * ps < total : raw.length >= ps));
  return { items, hasMore: raw.length > 0 && hasMore };
}

// Carry page state into the player; loading a new page must not restart the
// folder or play the same BVID twice. Network errors propagate to the UI.
export async function nextPlaylistItem(video, fetchPage) {
  let list = video.playlist || [], source = video.playlistSource;
  const index = video.playlistIndex;
  if (!Array.isArray(list) || typeof index !== 'number') return null;
  let next = index + 1;
  while (true) {
    while (next < list.length) {
      if (list[next]?.bvid) return { ...list[next], playlist: list, playlistIndex: next, playlistSource: source, fromToView: video.fromToView };
      next++;
    }
    if (!source?.hasMore) return null;
    const page = await fetchPage(source, source.nextPage, 36);
    const seen = new Set(list.map(v => v.bvid));
    const items = page.items.filter(v => v.bvid && !seen.has(v.bvid) && seen.add(v.bvid));
    source = { ...source, nextPage: source.nextPage + 1, hasMore: page.hasMore && items.length > 0 };
    list = list.concat(items);
  }
}
