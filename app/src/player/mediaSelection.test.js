import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlaybackAttemptPlan,
  dolbySignalingFrameRateAllowed,
  inspectDolbyRepresentation,
  listPreferredAudio,
  mediaTypeFor,
  parseDolbyConfig,
  proxyMediaUrl,
  selectPreferredAudio,
  selectVideoRepresentation,
} from './mediaSelection.js';

test('Dolby signaling preserves the base layer for high or unknown frame rates', () => {
  for (const frameRate of [24, 30, 60, '60000/1001', '59.94']) {
    assert.equal(dolbySignalingFrameRateAllowed({ frameRate }), true, String(frameRate));
  }
  for (const frameRate of [120, '120000/1001', 60.01, '', 'unknown', '60fps', '60/0', 0, -1]) {
    assert.equal(dolbySignalingFrameRateAllowed({ frameRate }), false, String(frameRate));
  }
  assert.equal(dolbySignalingFrameRateAllowed({ frame_rate: '30000/1001' }), true);
  assert.equal(dolbySignalingFrameRateAllowed(null), false);
});

function specimen() {
  const prefix = Buffer.from('0000000068766331000000006876634300000000', 'hex');
  const config = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('dvvC'),
    Buffer.from('0100104d4000000000000000000000000000000000000000', 'hex'),
  ]);
  return new Uint8Array(Buffer.concat([prefix, config]));
}

const rep = (id, codecs, bandwidth) => ({
  id,
  codecs,
  bandwidth,
  mimeType: 'audio/mp4',
  baseUrl: `https://example.test/${id}.m4s`,
});

test('parses Bilibili Profile 8 Level 9 dvvC signaling', () => {
  const info = parseDolbyConfig(specimen());
  assert.equal(info.box, 'dvvC');
  assert.equal(info.sampleEntry, 'hvc1');
  assert.equal(info.profile, 8);
  assert.equal(info.level, 9);
  assert.equal(info.compatibilityId, 4);
  assert.equal(info.rpuPresent, true);
  assert.equal(info.enhancementLayerPresent, false);
  assert.equal(info.baseLayerPresent, true);
  assert.equal(info.codec, 'dvh1.08.09');
});

test('rejects truncated and non-box Dolby markers', () => {
  assert.equal(parseDolbyConfig(Buffer.from('payload-dvvC-not-an-mp4-box')), null);

  const truncated = specimen();
  truncated[20] = 0;
  truncated[21] = 0;
  truncated[22] = 1;
  truncated[23] = 0;
  assert.equal(parseDolbyConfig(truncated), null);
});

test('proxy media URLs preserve ranges and reject non-network protocols', () => {
  assert.equal(
    proxyMediaUrl('//cdn.example.test/path/video.m4s?token=x', 'http://127.0.0.1:7654'),
    'http://127.0.0.1:7654/proxy/cdn.example.test/path/video.m4s?token=x',
  );
  assert.throws(() => proxyMediaUrl('data:video/mp4;base64,AA=='), /Unsupported media URL protocol/);
});

test('Dolby init probing is bounded and requires a complete body', async () => {
  const init = specimen();
  const video = { id: 126, codecs: 'hvc1.2.4.L156.90', baseUrl: 'https://example.test/video.m4s', SegmentBase: { Initialization: `0-${init.length - 1}` } };
  let called = false;
  const readRange = async (url, start, end, opts) => {
    called = true;
    assert.equal(start, 0); assert.equal(end, init.length - 1);
    assert.equal(opts.timeoutMs, 3000);
    return { data: init.buffer };
  };
  await assert.rejects(inspectDolbyRepresentation({ ...video, SegmentBase: { Initialization: '0-1048576' } }, undefined, { readRange }), /Unsafe/);
  assert.equal(called, false);
  assert.equal((await inspectDolbyRepresentation(video, undefined, { readRange })).codec, 'dvh1.08.09');
  await assert.rejects(inspectDolbyRepresentation(video, undefined, { readRange: async () => ({ data: new ArrayBuffer(1) }) }), /length mismatch/);
  await assert.rejects(inspectDolbyRepresentation(video, undefined, { readRange: async () => ({ data: init.buffer, timedOut: true }) }), /length mismatch/);
});

test('strict video selection never disguises a lower quality as 4K', () => {
  const dash = { video: [
    { id: '120', bandwidth: 3, baseUrl: 'https://example.test/slow.m4s' },
    { id: 120, bandwidth: 9, baseUrl: 'https://example.test/best.m4s' },
    { id: 80, bandwidth: 12, baseUrl: 'https://example.test/1080.m4s' },
  ] };
  const exact = selectVideoRepresentation(dash, 120);
  assert.equal(exact.representation.bandwidth, 9);
  assert.equal(exact.actualQn, 120);
  assert.equal(exact.exact, true);

  const missing = selectVideoRepresentation(dash, 126);
  assert.equal(missing.representation, null);
  assert.equal(missing.actualQn, null);
});

test('automatic video fallback reports the quality it actually selected', () => {
  const dash = { video: [
    { id: 80, bandwidth: 4, baseUrl: 'https://example.test/1080.m4s' },
    { id: 64, bandwidth: 2, baseUrl: 'https://example.test/720.m4s' },
  ] };
  const selected = selectVideoRepresentation(dash, 120, { allowFallback: true });
  assert.equal(selected.actualQn, 80);
  assert.equal(selected.exact, false);
});

test('true Dolby audio wins over Hi-Res and AAC', () => {
  const dash = {
    dolby: { type: 2, audio: [rep(30250, 'ec-3', 769172)] },
    flac: { display: true, audio: rep(30251, 'fLaC', 1516956) },
    audio: [rep(30280, 'mp4a.40.2', 207608)],
  };
  const selected = selectPreferredAudio(dash, () => true);
  assert.equal(selected.kind, 'dolby');
  assert.equal(selected.representation.id, 30250);
  assert.equal(selected.label, 'Dolby E-AC-3');
});

test('Hi-Res-only video selects FLAC and never pretends AAC is EC-3', () => {
  const dash = {
    dolby: { type: 0, audio: [] },
    flac: { display: true, audio: rep(30251, 'fLaC', 1516956) },
    audio: [rep(30280, 'mp4a.40.2', 207608)],
  };
  const selected = selectPreferredAudio(dash, () => true);
  assert.equal(selected.kind, 'hires');
  assert.equal(selected.representation.id, 30251);
  assert.equal(mediaTypeFor(selected.representation), 'audio/mp4; codecs="fLaC"');
});

test('unsupported premium codecs fall back to the highest AAC representation', () => {
  const dash = {
    dolby: { type: 2, audio: [rep(30250, 'ec-3', 769172)] },
    flac: { display: true, audio: rep(30251, 'fLaC', 1516956) },
    audio: [rep(30216, 'mp4a.40.2', 65673), rep(30280, 'mp4a.40.2', 207608)],
  };
  const selected = selectPreferredAudio(dash, type => type.includes('mp4a.40.2'));
  assert.equal(selected.kind, 'standard');
  assert.equal(selected.representation.id, 30280);
  assert.equal(selected.label, 'AAC');
});

test('unsupported EC-3 falls through to supported Hi-Res FLAC', () => {
  const dash = {
    dolby: { type: 2, audio: [rep(30250, 'ec-3', 769172)] },
    flac: { display: true, audio: rep(30251, 'fLaC', 1516956) },
    audio: [rep(30280, 'mp4a.40.2', 207608)],
  };
  const selected = selectPreferredAudio(dash, type => type.includes('fLaC'));
  assert.equal(selected.kind, 'hires');
  assert.equal(selected.representation.id, 30251);
});

test('runtime audio fallbacks remain Dolby to Hi-Res to AAC without duplicates', () => {
  const dash = {
    dolby: { type: 2, audio: [rep(30250, 'ec-3', 769172)] },
    flac: { display: true, audio: rep(30251, 'fLaC', 1516956) },
    audio: [rep(30280, 'mp4a.40.2', 207608)],
  };
  const candidates = listPreferredAudio(dash, () => true);
  assert.deepEqual(candidates.map(candidate => candidate.kind), ['dolby', 'hires', 'standard']);
  assert.deepEqual(candidates.map(candidate => candidate.representation.id), [30250, 30251, 30280]);
});

test('Dolby signaling failure retries the same audio ladder on the base layer', () => {
  const audio = [
    { kind: 'dolby', codec: 'ec-3', label: 'Dolby E-AC-3', representation: rep(30250, 'ec-3', 1) },
    { kind: 'hires', codec: 'fLaC', label: 'Hi-Res FLAC', representation: rep(30251, 'fLaC', 1) },
    { kind: 'standard', codec: 'mp4a.40.2', label: 'AAC', representation: rep(30280, 'mp4a.40.2', 1) },
  ];
  const attempts = createPlaybackAttemptPlan(audio, 'dvh1.08.09');
  assert.deepEqual(attempts.map(item => [item.dolbyCodec, item.audioKind]), [
    ['dvh1.08.09', 'dolby'],
    ['dvh1.08.09', 'hires'],
    ['dvh1.08.09', 'standard'],
    [null, 'dolby'],
    [null, 'hires'],
    [null, 'standard'],
  ]);
});

test('AAC-only playback is attempted once', () => {
  const audio = [{
    kind: 'standard', codec: 'mp4a.40.2', label: 'AAC',
    representation: rep(30280, 'mp4a.40.2', 1),
  }];
  const attempts = createPlaybackAttemptPlan(audio, null);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].audioKind, 'standard');
});
