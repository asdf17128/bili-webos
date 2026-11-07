import assert from 'node:assert/strict';
import { adjacentAvailability, resolveAdjacentVideo } from '../app/src/player/adjacentVideo.js';

const A = { bvid: 'BVA', cid: 11 }, B = { bvid: 'BVB', cid: 22 }, C = { bvid: 'BVC', cid: 33 };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
const resolve = (direction, video, extra = {}, fetchPage) => resolveAdjacentVideo(direction, { video, ...extra }, fetchPage);

await test('playlist boundaries do not wrap', async () => {
  const first = { ...A, playlist: [A, B, C], playlistIndex: 0 };
  const last = { ...C, playlist: [A, B, C], playlistIndex: 2 };
  assert.deepEqual(adjacentAvailability({ video: first }), { previous: false, next: true });
  assert.deepEqual(adjacentAvailability({ video: last }), { previous: true, next: false });
  assert.equal(await resolve('previous', first), null); assert.equal(await resolve('next', last), null);
});

await test('previous skips unavailable entries and keeps playlist context', async () => {
  const playlist = [A, null, {}, C], source = { id: 8, nextPage: 2, hasMore: true };
  const item = await resolve('previous', { ...C, playlist, playlistIndex: 3, playlistSource: source, fromToView: true });
  assert.equal(item.bvid, A.bvid); assert.equal(item.playlistIndex, 0);
  assert.equal(item.playlist, playlist); assert.equal(item.playlistSource, source); assert.equal(item.fromToView, true);
});

await test('loaded next does not fetch and skips unavailable slots', async () => {
  let requests = 0;
  const item = await resolve('next', { ...A, playlist: [A, {}, B], playlistIndex: 0 }, {}, async () => { requests++; });
  assert.equal(item.bvid, B.bvid); assert.equal(item.playlistIndex, 2); assert.equal(requests, 0);
});

await test('playlist wins over parts and recommendations', async () => {
  const video = { ...B, playlist: [A, B, C], playlistIndex: 1 };
  const extra = { parts: [B, { bvid: 'wrong-part', cid: 44 }], related: [{ bvid: 'wrong-related' }] };
  assert.equal((await resolve('previous', video, extra)).bvid, A.bvid);
  assert.equal((await resolve('next', video, extra)).bvid, C.bvid);
});

await test('invalid explicit playlist position cannot fall back to another queue', async () => {
  for (const playlistIndex of [-1, 1.5, 3, undefined, '0']) {
    const video = { ...A, playlist: [A], playlistIndex };
    const extra = { parts: [A, B], related: [C] };
    assert.deepEqual(adjacentAvailability({ video, ...extra }), { previous: false, next: false });
    assert.equal(await resolve('next', video, extra), null);
  }
});

await test('known next page is available without fetching during render', async () => {
  const video = { ...A, playlist: [A], playlistIndex: 0, playlistSource: { nextPage: 2, hasMore: true } };
  assert.deepEqual(adjacentAvailability({ video }), { previous: false, next: true });
});

await test('paged next reuses dedupe and retains watch-later context', async () => {
  const source = { id: 8, type: 11, nextPage: 2, hasMore: true };
  const original = { ...A, playlist: [A, null], playlistIndex: 0, playlistSource: source, fromToView: true };
  const snapshot = JSON.stringify(original); const requests = [];
  const item = await resolve('next', original, {}, async (received, page, size) => {
    requests.push([received.id, page, size]); return { items: [A, B, B], hasMore: true };
  });
  assert.deepEqual(requests, [[8, 2, 36]]); assert.equal(item.bvid, B.bvid);
  assert.equal(item.playlistIndex, 2); assert.equal(item.playlist.length, 3);
  assert.equal(item.playlistSource.nextPage, 3); assert.equal(item.fromToView, true);
  assert.equal(JSON.stringify(original), snapshot, 'input list and source are immutable');
});

await test('empty next page stops instead of replaying or falling back', async () => {
  const video = { ...A, playlist: [A], playlistIndex: 0, playlistSource: { nextPage: 2, hasMore: true } };
  let requests = 0;
  assert.equal(await resolve('next', video, { related: [B] }, async () => { requests++; return { items: [A], hasMore: true }; }), null);
  assert.equal(requests, 1);
});

await test('pagination failure reaches caller error handling', async () => {
  const error = new Error('synthetic page failure');
  const video = { ...A, playlist: [A], playlistIndex: 0, playlistSource: { nextPage: 2, hasMore: true } };
  await assert.rejects(resolve('next', video, {}, async () => { throw error; }), candidate => candidate === error);
});

await test('multi-P uses resolved CID rather than original card CID', async () => {
  const parts = [1, 2, 3].map(cid => ({ bvid: 'BVParts', cid }));
  const video = { bvid: 'BVParts', cid: 1 };
  const context = { video, cid: '2', parts };
  assert.deepEqual(adjacentAvailability(context), { previous: true, next: true });
  assert.equal((await resolveAdjacentVideo('previous', context)).cid, 1);
  assert.equal((await resolveAdjacentVideo('next', context)).cid, 3);
});

await test('UGC collection matches video identity as well as CID', async () => {
  const parts = [{ bvid: 'wrong', cid: 22 }, A, B, C];
  assert.equal((await resolve('previous', B, { cid: 22, parts })).bvid, A.bvid);
  assert.equal((await resolve('next', B, { cid: 22, parts })).bvid, C.bvid);
});

await test('ordered parts do not leak into recommendations at either end', async () => {
  assert.equal(await resolve('previous', A, { parts: [A, B], related: [C] }), null);
  assert.equal(await resolve('next', B, { parts: [A, B], related: [C] }), null);
  assert.deepEqual(adjacentAvailability({ video: A, parts: [A], related: [C] }), { previous: false, next: false });
});

await test('unresolved sequence identity disables both directions', async () => {
  const context = { video: A, cid: 999, parts: [A, B], related: [C] };
  assert.deepEqual(adjacentAvailability(context), { previous: false, next: false });
  assert.equal(await resolveAdjacentVideo('next', context), null);
});

await test('Bangumi related list is ordered episode navigation', async () => {
  const episodes = [1, 2, 3].map(epid => ({ isBangumi: true, epid, cid: epid * 100 }));
  const video = { isBangumi: true, epid: '2', cid: 200 };
  assert.equal((await resolve('previous', video, { related: episodes })).epid, 1);
  assert.equal((await resolve('next', video, { related: episodes })).epid, 3);
  assert.equal(await resolve('next', episodes[2], { related: episodes }), null);
});

await test('season-only Bangumi entry locates episode by resolved CID', async () => {
  const episodes = [{ epid: 1, cid: 100 }, { epid: 2, cid: 200 }];
  const context = { video: { isBangumi: true, seasonId: 1 }, cid: 200, related: episodes };
  assert.deepEqual(adjacentAvailability(context), { previous: true, next: false });
  assert.equal((await resolveAdjacentVideo('previous', context)).epid, 1);
});

await test('single video next filters the same BV even when a different CID is present', async () => {
  const related = [null, {}, { bvid: A.bvid, cid: 999 }, B, C];
  assert.deepEqual(adjacentAvailability({ video: A, related }), { previous: false, next: true });
  assert.equal((await resolve('next', A, { related })).bvid, B.bvid);
  assert.equal(await resolve('previous', A, { related }), null);
});

await test('aid-only current video is not replayed by related fallback', async () => {
  const video = { aid: 42, cid: 420 };
  assert.equal((await resolve('next', video, { related: [{ aid: 42, bvid: 'same' }, C] })).bvid, C.bvid);
});

await test('missing or self-only recommendations disable next', async () => {
  for (const related of [undefined, [], [A], [null, {}]]) {
    assert.deepEqual(adjacentAvailability({ video: A, related }), { previous: false, next: false });
    assert.equal(await resolve('next', A, { related }), null);
  }
});

await test('returned target is a copy and caller owns fresh playback intent', async () => {
  const target = Object.freeze({ ...B, progress: 77, resumeMode: 'at' });
  const result = await resolve('next', A, { related: Object.freeze([target]) });
  assert.notEqual(result, target); assert.equal(result.progress, 77);
  result.progress = 0; assert.equal(target.progress, 77);
});

await test('unknown direction and empty context are inert', async () => {
  assert.deepEqual(adjacentAvailability(), { previous: false, next: false });
  assert.equal(await resolveAdjacentVideo('next'), null);
  assert.equal(await resolve('invalid', A, { related: [B] }), null);
});

console.log(`${passed}/${passed} passed`);
