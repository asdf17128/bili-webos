import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDolbyTransformFailure,
  createTargetDolby120Session,
  findDolbyTransformFailure,
  isTargetDolby120Identity,
  matchTargetDolbyMediaRequest,
  TARGET_DOLBY_120_SEGMENTS,
  targetDolbyRequestPathMatches,
  transformTargetDolbyMedia,
} from './dolby120Transform.js';

function targetRepresentation(overrides = {}) {
  return {
    id: 126,
    codecs: 'hvc1.2.4.L156.90',
    width: 3840,
    height: 2160,
    frameRate: '120.000',
    baseUrl: 'https://example.invalid/video/target-30126.m4s?signed=secret',
    backupUrl: ['https://backup.invalid/video/target-30126.m4s?other=secret'],
    SegmentBase: { Initialization: '0-1037', indexRange: '1038-1497' },
    ...overrides,
  };
}

test('binds the transform only to the audited video, cid and representation', () => {
  const session = createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzE' },
    '39933052694',
    targetRepresentation(),
  );
  assert.ok(session);
  assert.deepEqual(session.pathnames, ['/video/target-30126.m4s']);
  assert.equal(Object.values(session).join(' ').includes('signed=secret'), false);
  assert.equal(
    targetDolbyRequestPathMatches(
      session,
      'https://another.invalid/video/target-30126.m4s?fresh=token',
    ),
    true,
  );

  assert.equal(createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzF' }, '39933052694', targetRepresentation(),
  ), null);
  assert.equal(createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzE' }, '39933052695', targetRepresentation(),
  ), null);
  assert.equal(createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzE' }, '39933052694', targetRepresentation({ frameRate: 60 }),
  ), null);
  assert.equal(createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzE' }, '39933052694', targetRepresentation({
      SegmentBase: { Initialization: '0-1037', indexRange: '1038-1498' },
    }),
  ), null);
  assert.equal(isTargetDolby120Identity(
    { bvid: 'BV1dCNC6hEzE' },
    '39933052694',
    targetRepresentation({ codecs: 'neighboring-codec' }),
  ), true, 'identity remains recognized so a fingerprint mismatch can fail to HLG');
  assert.equal(isTargetDolby120Identity(
    { aid: '116910368953933' },
    '39933052694',
    targetRepresentation({ frameRate: undefined }),
  ), true, 'aid-only and missing metadata still identify the unsafe source');
  assert.equal(createTargetDolby120Session(
    { aid: '116910368953933' },
    '39933052694',
    targetRepresentation({ frameRate: undefined }),
  ), null, 'missing transform fingerprints force HLG instead of raw DV');
  assert.ok(createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzE' },
    '39933052694',
    targetRepresentation({ frameRate: '120/1' }),
  ), 'an equivalent rational frame-rate spelling is accepted');
});

test('media transform fails closed until the exact source index is validated', () => {
  const input = new Uint8Array([1, 2, 3]);
  const result = transformTargetDolbyMedia(input, { timescale: 16000, lengthSize: 4 }, false);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'target-segment-index-was-not-validated');
  assert.strictEqual(result.data, input);
});

test('binds all media responses to the exact audited SIDX entries', () => {
  assert.equal(TARGET_DOLBY_120_SEGMENTS.length, 35);
  assert.equal(TARGET_DOLBY_120_SEGMENTS[0].startByte, 1498);
  assert.equal(TARGET_DOLBY_120_SEGMENTS[0].startTicks, 0);
  assert.equal(TARGET_DOLBY_120_SEGMENTS.at(-1).startTicks, 2720000);
  assert.equal(TARGET_DOLBY_120_SEGMENTS.at(-1).endByte, 500019347);
  assert.equal(
    TARGET_DOLBY_120_SEGMENTS.reduce((sum, entry) => sum + entry.durationTicks, 0),
    2799733,
  );
  for (let index = 1; index < TARGET_DOLBY_120_SEGMENTS.length; index += 1) {
    assert.equal(
      TARGET_DOLBY_120_SEGMENTS[index].startByte,
      TARGET_DOLBY_120_SEGMENTS[index - 1].endByte + 1,
    );
  }

  const session = createTargetDolby120Session(
    { bvid: 'BV1dCNC6hEzE' },
    '39933052694',
    targetRepresentation(),
  );
  const entry = TARGET_DOLBY_120_SEGMENTS[0];
  const segment = {
    startByte: entry.startByte,
    endByte: entry.endByte,
    startTime: entry.startTime,
    endTime: entry.endTime,
  };
  assert.strictEqual(
    matchTargetDolbyMediaRequest(
      session,
      `bytes=${entry.startByte}-${entry.endByte}`,
      segment,
    ),
    entry,
  );
  assert.equal(matchTargetDolbyMediaRequest(
    session,
    `bytes=${entry.startByte}-${entry.endByte - 1}`,
    segment,
  ), null);
  assert.equal(matchTargetDolbyMediaRequest(session, 'bytes=1-2', {
    ...segment,
    startTime: entry.startTime + 1,
  }), null);

  const finalEntry = TARGET_DOLBY_120_SEGMENTS.at(-1);
  assert.strictEqual(matchTargetDolbyMediaRequest(
    session,
    `bytes=${finalEntry.startByte}-${finalEntry.endByte}`,
    {
      startByte: finalEntry.startByte,
      endByte: finalEntry.endByte,
      startTime: finalEntry.startTime,
      endTime: 175,
    },
  ), finalEntry, 'Shaka fits the final endTime to the integer MPD duration');

  const wrongResponse = new Uint8Array(entry.inputBytes - 1);
  const result = transformTargetDolbyMedia(wrongResponse, session, true, entry);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'media-response-does-not-match-audited-segment-entry');
});

test('finds a controlled transform error through Shaka-style wrapping', () => {
  const cause = createDolbyTransformFailure('bad-fragment', 7);
  const wrapped = { code: 1007, data: [cause] };
  assert.strictEqual(findDolbyTransformFailure(wrapped), cause);
  assert.equal(cause.dolbyTransformEpoch, 7);
  assert.equal(findDolbyTransformFailure({ code: 1001, data: [] }), null);

  cause.cause = wrapped;
  assert.strictEqual(findDolbyTransformFailure(wrapped), cause, 'cycles are bounded');
});
