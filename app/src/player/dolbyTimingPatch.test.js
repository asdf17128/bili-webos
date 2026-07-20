import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_DOLBY_120_SIDX_HEX,
  patchTargetDolby120SpsNal,
  patchTargetDolby120HvccRecord,
  patchTargetDolby120InitSegment,
  patchTargetDolby120LeadingAccessUnit,
  validateTargetDolby120IndexSegment,
} from './dolbyTimingPatch.js';

const VPS_HEX = '40010c01ffff02200000030090000003000003009c99c090';
const SPS_120_HEX =
  '42010102200000030090000003000003009ca001e02002207c4b6599d29084646fd43016a122412080000003008000003c04';
const SPS_60_HEX =
  '42010102200000030090000003000003009ca001e02002207c4b6599d29084646fd43016a122412080000003008000001e04';
const PPS_HEX = '4401c0a53c0cc9';
const HVCC_120_HEX =
  '0102200000009000000000009cf000fcfdfafa00000f03'
  + 'a000010018' + VPS_HEX
  + 'a100010032' + SPS_120_HEX
  + 'a200010007' + PPS_HEX;
const HVCC_60_HEX = HVCC_120_HEX.replace(SPS_120_HEX, SPS_60_HEX);
const HVCC_BOX_120_HEX = '0000007f68766343' + HVCC_120_HEX;
const HVCC_BOX_60_HEX = '0000007f68766343' + HVCC_60_HEX;

function fromHex(value) {
  return new Uint8Array(Buffer.from(value, 'hex'));
}

function toHex(value) {
  return Buffer.from(value).toString('hex');
}

function u32(value) {
  return new Uint8Array([
    Math.floor(value / 0x1000000) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x100) & 0xff,
    value & 0xff,
  ]);
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function lengthPrefixed(hex) {
  const nal = fromHex(hex);
  return concat([u32(nal.length), nal]);
}

function makeLeadingAccessUnit(spsHex = SPS_120_HEX) {
  return concat([
    lengthPrefixed('460110'),
    lengthPrefixed(VPS_HEX),
    lengthPrefixed(spsHex),
    lengthPrefixed(PPS_HEX),
    lengthPrefixed('260180'),
    lengthPrefixed('7c0119080980000000'),
  ]);
}

test('patches only the target SPS VUI time_scale byte', () => {
  const input = fromHex(SPS_120_HEX);
  const before = input.slice();
  const result = patchTargetDolby120SpsNal(input);

  assert.equal(result.status, 'patched');
  assert.equal(toHex(result.data), SPS_60_HEX);
  assert.deepEqual(input, before, 'input is not mutated');
  const changed = [];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== result.data[index]) changed.push(index);
  }
  assert.deepEqual(changed, [48]);
  assert.equal(input[48], 0x3c);
  assert.equal(result.data[48], 0x1e);
});

test('patches the exact hvcC record without growing VPS or the record', () => {
  const input = fromHex(HVCC_120_HEX);
  const result = patchTargetDolby120HvccRecord(input);

  assert.equal(result.status, 'patched');
  assert.equal(result.data.length, input.length);
  assert.equal(toHex(result.data), HVCC_60_HEX);
  assert.ok(toHex(result.data).includes(VPS_HEX));
});

test('patches exactly one complete hvcC box in a bounded init segment', () => {
  const prefix = fromHex('000000106674797069736f6d00000000');
  const suffix = fromHex('0000000c6476764301020304');
  const input = concat([prefix, fromHex(HVCC_BOX_120_HEX), suffix]);
  const result = patchTargetDolby120InitSegment(input);

  assert.equal(result.status, 'patched');
  assert.equal(result.data.length, input.length);
  assert.ok(toHex(result.data).includes(HVCC_BOX_60_HEX));
  assert.equal(toHex(result.data).includes(HVCC_BOX_120_HEX), false);
});

test('validates the exact 35-fragment index and rejects neighboring bytes', () => {
  const input = fromHex(TARGET_DOLBY_120_SIDX_HEX);
  const result = validateTargetDolby120IndexSegment(input);
  assert.equal(result.status, 'validated');
  assert.equal(result.supported, true);
  assert.strictEqual(result.data, input);

  const changed = input.slice();
  changed[changed.length - 1] ^= 1;
  const rejected = validateTargetDolby120IndexSegment(changed);
  assert.equal(rejected.status, 'unsupported');
  assert.equal(rejected.reason, 'target-segment-index-fingerprint-mismatch');
  assert.strictEqual(rejected.data, changed);
});

test('patches the target SPS in the segment-leading access unit', () => {
  const input = makeLeadingAccessUnit();
  const result = patchTargetDolby120LeadingAccessUnit(input, { lengthSize: 4 });

  assert.equal(result.status, 'patched');
  assert.equal(result.data.length, input.length);
  assert.ok(toHex(result.data).includes(SPS_60_HEX));
  assert.equal(toHex(result.data).includes(SPS_120_HEX), false);
});

test('is idempotent for the already-patched target structures', () => {
  assert.equal(patchTargetDolby120SpsNal(fromHex(SPS_60_HEX)).status, 'already-60');
  assert.equal(
    patchTargetDolby120HvccRecord(fromHex(HVCC_60_HEX)).status,
    'already-60',
  );
  assert.equal(
    patchTargetDolby120LeadingAccessUnit(
      makeLeadingAccessUnit(SPS_60_HEX),
      { lengthSize: 4 },
    ).status,
    'already-60',
  );
});

test('fails closed for neighboring but non-target encodes and layouts', () => {
  const wrongSps = fromHex(SPS_120_HEX);
  wrongSps[20] ^= 1;
  assert.equal(
    patchTargetDolby120SpsNal(wrongSps).reason,
    'target-sps-fingerprint-mismatch',
  );

  const duplicateBox = concat([
    fromHex(HVCC_BOX_120_HEX),
    fromHex(HVCC_BOX_120_HEX),
  ]);
  assert.equal(
    patchTargetDolby120InitSegment(duplicateBox).reason,
    'target-init-hvcc-count-mismatch',
  );

  const wrongLayout = makeLeadingAccessUnit();
  // First NAL is AUD (type 35); change it to prefix SEI (type 39).
  wrongLayout[4] = 39 << 1;
  assert.equal(
    patchTargetDolby120LeadingAccessUnit(wrongLayout, { lengthSize: 4 }).reason,
    'target-leading-access-unit-layout-mismatch',
  );
});
