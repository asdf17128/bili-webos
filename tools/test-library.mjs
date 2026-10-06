import assert from 'node:assert/strict';
import { mapLibraryPage, libraryKey, nextPlaylistItem } from '../app/src/utils/library.js';

const folder = { id: 12, type: 11, mid: 1, owner: 'creator' };
const season = { ...folder, type: 21 };
assert.notEqual(libraryKey(folder), libraryKey(season));
const fav = mapLibraryPage({ medias: [{ bvid: 'BV1', type: 2, title: 'video', cover: 'a', upper: { name: 'UP' } }, { type: 12, title: 'audio' }], has_more: false }, folder, 1, 36);
assert.equal(fav.items.length, 1); assert.equal(fav.items[0].owner.name, 'UP');
assert.equal(fav.hasMore, false);
const collection = mapLibraryPage({ archives: [{ bvid: 'BV2', title: 'episode', pic: 'b' }], page: { total: 37 } }, season, 1, 36);
assert.equal(collection.items[0].owner.name, 'creator'); assert.equal(collection.hasMore, true);
assert.equal(mapLibraryPage({ archives: [], page: { total: 37 } }, season, 2, 36).hasMore, false);

const video = { playlist: [{ bvid: 'BV1' }], playlistIndex: 0, playlistSource: { ...season, nextPage: 2, hasMore: true } };
const next = await nextPlaylistItem(video, async (source, pn) => {
  assert.equal(source.type, 21); assert.equal(pn, 2);
  return { items: [{ bvid: 'BV1' }, { bvid: 'BV2' }, { bvid: 'BV2' }], hasMore: false };
});
assert.equal(next.bvid, 'BV2'); assert.equal(next.playlistIndex, 1);
assert.equal(next.playlist.length, 2); assert.equal(next.playlistSource.nextPage, 3);
assert.equal(await nextPlaylistItem(next, () => assert.fail('end must not refetch')), null);
await assert.rejects(nextPlaylistItem(video, async () => { throw new Error('network'); }), /network/);
assert.equal(await nextPlaylistItem(video, async () => ({ items: [{ bvid: 'BV1' }], hasMore: true })), null);
console.log('PASS favorites/collections mapping, pagination, cross-page playback, duplicates, network failure and end of list');
