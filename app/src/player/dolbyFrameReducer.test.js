import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { reduceDolby120To60Fragment } from './dolbyFrameReducer.js';
import { validateTargetDolby120IndexSegment } from './dolbyTimingPatch.js';

const TIMESCALE = 90000;
const SAMPLE_DURATION = 750;
const BASE_DTS = 12345;
const VPS_HEX = '40010c01ffff02200000030090000003000003009c99c090';
const SPS_120_HEX =
  '42010102200000030090000003000003009ca001e02002207c4b6599d29084646fd43016a122412080000003008000003c04';
const SPS_60_HEX =
  '42010102200000030090000003000003009ca001e02002207c4b6599d29084646fd43016a122412080000003008000001e04';
const PPS_HEX = '4401c0a53c0cc9';

function fromHex(value) {
  return new Uint8Array(Buffer.from(value, 'hex'));
}

function u32(value) {
  const output = new Uint8Array(4);
  output[0] = Math.floor(value / 0x1000000) & 0xff;
  output[1] = Math.floor(value / 0x10000) & 0xff;
  output[2] = Math.floor(value / 0x100) & 0xff;
  output[3] = value & 0xff;
  return output;
}

function i32(value) {
  return u32(value < 0 ? value + 0x100000000 : value);
}

function readU32(bytes, offset) {
  return bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

function readI32(bytes, offset) {
  const value = readU32(bytes, offset);
  return value >= 0x80000000 ? value - 0x100000000 : value;
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function ascii(value) {
  return new Uint8Array(Array.from(value, char => char.charCodeAt(0)));
}

function box(type, ...payload) {
  const body = concat(payload);
  return concat([u32(body.length + 8), ascii(type), body]);
}

function fullBox(type, version, flags, ...payload) {
  return box(type, new Uint8Array([
    version,
    (flags >> 16) & 0xff,
    (flags >> 8) & 0xff,
    flags & 0xff,
  ]), ...payload);
}

function crc32Mpeg2(bytes, start = 0, end = bytes.length) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (crc ^ (bytes[index] << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80000000)
        ? (((crc << 1) ^ 0x04c11db7) >>> 0)
        : ((crc << 1) >>> 0);
    }
  }
  return crc >>> 0;
}

class BitWriter {
  constructor() {
    this.bits = [];
  }

  write(value, count) {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      this.bits.push(Math.floor(value / (2 ** bit)) & 1);
    }
  }

  ue(value) {
    const code = value + 1;
    const length = Math.floor(Math.log2(code)) + 1;
    this.write(0, length - 1);
    this.write(code, length);
  }

  se(value) {
    this.ue(value <= 0 ? -value * 2 : value * 2 - 1);
  }

  bytes() {
    while (this.bits.length % 8) this.bits.push(0);
    const output = new Uint8Array(this.bits.length / 8);
    for (let index = 0; index < this.bits.length; index += 1) {
      output[index >> 3] |= this.bits[index] << (7 - (index & 7));
    }
    return output;
  }
}

function addEmulationPrevention(bytes) {
  const output = [];
  let zeroes = 0;
  for (const value of bytes) {
    if (zeroes >= 2 && value <= 3) {
      output.push(3);
      zeroes = 0;
    }
    output.push(value);
    zeroes = value === 0 ? zeroes + 1 : 0;
  }
  return new Uint8Array(output);
}

function independentDolbyRpuPayload() {
  const writer = new BitWriter();
  writer.write(25, 8);
  writer.write(2, 6);
  writer.write(18, 11);
  writer.write(1, 4);
  writer.write(0, 4);
  writer.write(1, 1); // vdr_seq_info_present_flag
  writer.write(0, 1);
  writer.write(0, 2);
  writer.ue(23);
  writer.write(1, 2);
  writer.write(0, 1);
  writer.ue(2);
  writer.ue(2);
  writer.ue(4);
  writer.write(0, 1);
  writer.write(0, 3);
  writer.write(0, 1);
  writer.write(1, 1); // disable_residual_flag
  writer.write(1, 1); // DM metadata present
  writer.write(0, 1); // never use a previous mapping
  writer.ue(0); // vdr_rpu_id
  writer.ue(0);
  writer.ue(0);
  for (let component = 0; component < 3; component += 1) {
    writer.ue(0);
    writer.write(0, 10);
    writer.write(1023, 10);
  }
  writer.ue(0);
  writer.ue(0);
  for (let component = 0; component < 3; component += 1) {
    writer.ue(0); // polynomial mapping
    writer.ue(0); // order minus one
    writer.write(0, 1); // no linear interpolation
    for (let coefficient = 0; coefficient < 2; coefficient += 1) {
      writer.se(0);
      writer.write(0, 23);
    }
  }
  writer.ue(0); // affected DM metadata id
  writer.ue(0); // current DM metadata id
  writer.ue(1); // every RPU refreshes its own scene state
  for (let field = 0; field < 9; field += 1) writer.write(0, 16);
  for (let field = 0; field < 3; field += 1) writer.write(0, 32);
  for (let field = 0; field < 9; field += 1) writer.write(0, 16);
  writer.write(65535, 16); // signal_eotf when all EOTF params are zero
  writer.write(0, 16);
  writer.write(0, 16);
  writer.write(0, 32);
  writer.write(12, 5);
  writer.write(0, 2);
  writer.write(0, 2);
  writer.write(1, 2);
  writer.write(0, 12);
  writer.write(3079, 12);
  writer.write(42, 10);
  const body = writer.bytes();
  const crc = crc32Mpeg2(body, 1);
  return addEmulationPrevention(concat([body, u32(crc), new Uint8Array([0x80])]));
}

const VALID_RPU = independentDolbyRpuPayload();

function nal(type, payload) {
  const body = concat([
    new Uint8Array([(type << 1) & 0x7e, 1]),
    payload,
  ]);
  return concat([u32(body.length), body]);
}

function accessUnit(type, marker, includeRpu = true) {
  const vcl = nal(type, new Uint8Array([0x80, marker & 0x7f]));
  const parts = type === 19 ? [
    nal(35, new Uint8Array([0x10])),
    concat([u32(fromHex(VPS_HEX).length), fromHex(VPS_HEX)]),
    concat([u32(fromHex(SPS_120_HEX).length), fromHex(SPS_120_HEX)]),
    concat([u32(fromHex(PPS_HEX).length), fromHex(PPS_HEX)]),
    vcl,
  ] : [nal(35, new Uint8Array([0x10])), vcl];
  if (includeRpu) parts.push(nal(62, VALID_RPU));
  return concat(parts);
}

function sampleFlags(index, type, unsafeDropIndex) {
  if (index === 0) return 0x02400000; // sync: depends_on=2, is_depended_on=1
  if (index === unsafeDropIndex) return 0x01410000;
  if (type === 1) return 0x01410000; // reference, non-sync
  return 0x01810000; // non-reference: is_depended_on=2, non-sync
}

function makeFragment(options = {}) {
  const count = options.count || 600;
  const samples = [];
  const entries = [];
  const cto = [];
  for (let index = 0; index < count; index += 1) {
    const type = index === 0
      ? 19
      : (index % 4 === 1 || index % 4 === 2 ? 1 : 0);
    const sample = accessUnit(type, index, index !== options.missingRpuIndex);
    const offset = 0;
    samples.push(sample);
    cto.push(offset);
    entries.push(concat([
      u32(index === options.badDurationIndex ? SAMPLE_DURATION + 1 : SAMPLE_DURATION),
      u32(sample.length),
      u32(sampleFlags(index, type, options.unsafeDropIndex)),
      i32(offset),
    ]));
  }

  const tfhd = fullBox('tfhd', 0, 0x020000, u32(1));
  const tfdt = fullBox('tfdt', 0, 0, u32(BASE_DTS));
  const mfhd = fullBox('mfhd', 0, 0, u32(7));
  const makeMoof = (dataOffset) => {
    const trun = fullBox(
      'trun', 1, 0x000f01,
      u32(count), i32(dataOffset), ...entries,
    );
    return box('moof', mfhd, box('traf', tfhd, tfdt, trun));
  };
  const sizingMoof = makeMoof(0);
  const moof = makeMoof(sizingMoof.length + 8);
  const styp = box('styp', new Uint8Array([1, 2, 3, 4]));
  const mdat = box('mdat', ...samples);
  return {
    data: concat([styp, moof, mdat]),
    originalSamples: samples,
    originalCompositionOffsets: cto,
    prefixLength: styp.length,
  };
}

function typeAt(bytes, offset) {
  return String.fromCharCode(
    bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]
  );
}

function boxes(bytes, start = 0, end = bytes.length) {
  const found = [];
  let offset = start;
  while (offset < end) {
    const size = readU32(bytes, offset);
    found.push({ type: typeAt(bytes, offset), start: offset, end: offset + size, size });
    offset += size;
  }
  assert.equal(offset, end);
  return found;
}

function parseReduced(bytes) {
  const top = boxes(bytes);
  const moof = top.find(item => item.type === 'moof');
  const mdat = top.find(item => item.type === 'mdat');
  const free = top.find(item => item.type === 'free');
  const moofChildren = boxes(bytes, moof.start + 8, moof.end);
  const traf = moofChildren.find(item => item.type === 'traf');
  const trafChildren = boxes(bytes, traf.start + 8, traf.end);
  const tfdt = trafChildren.find(item => item.type === 'tfdt');
  const trun = trafChildren.find(item => item.type === 'trun');
  const version = bytes[trun.start + 8];
  const flags = bytes[trun.start + 9] * 0x10000
    + bytes[trun.start + 10] * 0x100
    + bytes[trun.start + 11];
  const count = readU32(bytes, trun.start + 12);
  const dataOffset = readI32(bytes, trun.start + 16);
  let entryOffset = trun.start + 20;
  let sampleOffset = mdat.start + 8;
  const tfdtVersion = bytes[tfdt.start + 8];
  if (tfdtVersion === 1) assert.equal(readU32(bytes, tfdt.start + 12), 0);
  let dts = readU32(bytes, tfdt.start + (tfdtVersion === 1 ? 16 : 12));
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const duration = readU32(bytes, entryOffset);
    const size = readU32(bytes, entryOffset + 4);
    const sampleFlagsValue = readU32(bytes, entryOffset + 8);
    const compositionOffset = version === 0
      ? readU32(bytes, entryOffset + 12)
      : readI32(bytes, entryOffset + 12);
    samples.push({
      dts,
      pts: dts + compositionOffset,
      duration,
      size,
      flags: sampleFlagsValue,
      bytes: bytes.slice(sampleOffset, sampleOffset + size),
    });
    dts += duration;
    sampleOffset += size;
    entryOffset += 16;
  }
  return { top, moof, mdat, free, trun, flags, dataOffset, samples };
}

function nalTypes(sample) {
  const types = [];
  let offset = 0;
  while (offset < sample.length) {
    const length = readU32(sample, offset);
    offset += 4;
    types.push((sample[offset] >> 1) & 0x3f);
    offset += length;
  }
  return types;
}

test('reduces a strict five-second Dolby 120 fps fragment to an exact 60fps grid', () => {
  const source = makeFragment();
  const result = reduceDolby120To60Fragment(source.data, {
    timescale: TIMESCALE,
    lengthSize: 4,
    closedSegmentBoundaryProven: true,
  });

  assert.equal(result.status, 'reduced');
  assert.equal(result.supported, true);
  assert.equal(result.inputSampleCount, 600);
  assert.equal(result.outputSampleCount, 300);
  assert.equal(result.duration, TIMESCALE * 5);
  assert.equal(result.droppedFinalTrailRIndex, 598);
  assert.equal(result.trailingAUsAfterDroppedFinalTrailR, 1);
  assert.ok(result.data.length < source.data.length);

  const reduced = parseReduced(result.data);
  assert.deepEqual(reduced.top.map(item => item.type), ['styp', 'moof', 'mdat']);
  assert.equal(reduced.free, undefined);
  assert.equal(reduced.dataOffset, reduced.moof.size + 8);
  assert.equal(reduced.flags, 0x000f01);
  assert.equal(reduced.samples.length, 300);
  assert.equal(
    reduced.samples.reduce((sum, sample) => sum + sample.duration, 0),
    TIMESCALE * 5,
  );

  const expectedIndices = source.originalSamples
    .map((sample, index) => ({ index, types: nalTypes(sample) }))
    .filter(item => item.types.includes(19) || item.types.includes(1))
    .map(item => item.index);
  expectedIndices.pop(); // final decode-order TRAIL_R is the proven-safe extra
  assert.equal(expectedIndices.length, 300);

  for (let index = 0; index < reduced.samples.length; index += 1) {
    const output = reduced.samples[index];
    assert.equal(output.duration, TIMESCALE / 60);
    assert.equal(output.dts, BASE_DTS + index * TIMESCALE / 60);
    assert.equal(output.pts, BASE_DTS + index * TIMESCALE / 60);
    if (index === 0) {
      const hex = Buffer.from(output.bytes).toString('hex');
      assert.ok(hex.includes(SPS_60_HEX));
      assert.equal(hex.includes(SPS_120_HEX), false);
    } else {
      assert.deepEqual(output.bytes, source.originalSamples[expectedIndices[index]]);
    }
    assert.ok(nalTypes(output.bytes).includes(62), 'Dolby RPU remains in the AU');
  }
});

test('reduces the shorter final 598-sample fragment to 299 pictures', () => {
  const source = makeFragment({ count: 598 });
  const result = reduceDolby120To60Fragment(source.data, {
    timescale: TIMESCALE,
    lengthSize: 4,
    closedSegmentBoundaryProven: true,
  });
  assert.equal(result.status, 'reduced');
  assert.equal(result.inputSampleCount, 598);
  assert.equal(result.outputSampleCount, 299);
  assert.equal(result.droppedFinalTrailRIndex, 597);
  assert.equal(result.trailingAUsAfterDroppedFinalTrailR, 0);
  const reduced = parseReduced(result.data);
  assert.equal(reduced.samples.length, 299);
  assert.equal(
    reduced.samples.reduce((sum, sample) => sum + sample.duration, 0),
    Math.round(598 * TIMESCALE / 120),
  );
});

test('fails closed when a discarded picture can be depended on', () => {
  const source = makeFragment({ unsafeDropIndex: 103 });
  const result = reduceDolby120To60Fragment(source.data, {
    timescale: TIMESCALE,
    lengthSize: 4,
    closedSegmentBoundaryProven: true,
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'non-reference-sample-has-unsafe-dependency');
  assert.strictEqual(result.data, source.data);
});

test('fails closed for unsupported sample and HEVC formats', async (t) => {
  await t.test('lengthSize other than four', () => {
    const source = makeFragment();
    const result = reduceDolby120To60Fragment(source.data, {
      timescale: TIMESCALE,
      lengthSize: 2,
      closedSegmentBoundaryProven: true,
    });
    assert.equal(result.reason, 'unsupported-hevc-length-size');
    assert.strictEqual(result.data, source.data);
  });

  await t.test('fragment without 600 samples', () => {
    const source = makeFragment({ count: 596 });
    const result = reduceDolby120To60Fragment(source.data, {
      timescale: TIMESCALE,
      lengthSize: 4,
      closedSegmentBoundaryProven: true,
    });
    assert.equal(result.reason, 'expected-600-or-final-598-samples');
    assert.strictEqual(result.data, source.data);
  });

  await t.test('access unit without a Dolby RPU', () => {
    const source = makeFragment({ missingRpuIndex: 222 });
    const result = reduceDolby120To60Fragment(source.data, {
      timescale: TIMESCALE,
      lengthSize: 4,
      closedSegmentBoundaryProven: true,
    });
    assert.equal(result.reason, 'access-unit-without-dolby-rpu');
    assert.strictEqual(result.data, source.data);
  });

  await t.test('one sample with a non-120fps duration', () => {
    const source = makeFragment({ badDurationIndex: 444 });
    const result = reduceDolby120To60Fragment(source.data, {
      timescale: TIMESCALE,
      lengthSize: 4,
      closedSegmentBoundaryProven: true,
    });
    assert.equal(result.reason, 'sample-cadence-is-not-120fps');
    assert.strictEqual(result.data, source.data);
  });

  await t.test('closed segment boundary was not proven by the index validator', () => {
    const source = makeFragment();
    const result = reduceDolby120To60Fragment(source.data, {
      timescale: TIMESCALE,
      lengthSize: 4,
    });
    assert.equal(result.reason, 'closed-segment-boundary-is-not-proven');
    assert.strictEqual(result.data, source.data);
  });

  await t.test('a media response containing sidx cannot be shortened safely', () => {
    const source = makeFragment();
    const withSidx = source.data.slice();
    withSidx.set(ascii('sidx'), 4);
    const result = reduceDolby120To60Fragment(withSidx, {
      timescale: TIMESCALE,
      lengthSize: 4,
      closedSegmentBoundaryProven: true,
    });
    assert.equal(result.reason, 'media-fragment-must-not-contain-sidx');
    assert.strictEqual(result.data, withSidx);
  });
});

// The full media object is intentionally not committed. Maintainers can point
// this optional regression at a locally captured copy of the audited stream.
const capturedFullStream = process.env.BILI_DOLBY_120_CORPUS || '';
test('all 35 captured fragments satisfy the closed-GOP reduction proof', {
  skip: !capturedFullStream || !existsSync(capturedFullStream),
}, () => {
  const fd = openSync(capturedFullStream, 'r');
  try {
    const fileSize = fstatSync(fd).size;
    const header = Buffer.alloc(8);
    const top = [];
    let fileOffset = 0;
    while (fileOffset < fileSize) {
      assert.equal(readSync(fd, header, 0, 8, fileOffset), 8);
      const size = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      assert.ok(size >= 8 && fileOffset + size <= fileSize);
      top.push({ start: fileOffset, size, type });
      fileOffset += size;
    }
    assert.equal(fileOffset, fileSize);

    const indexBox = top.find(item => item.type === 'sidx');
    const indexBytes = Buffer.alloc(indexBox.size);
    assert.equal(readSync(fd, indexBytes, 0, indexBytes.length, indexBox.start), indexBytes.length);
    assert.equal(validateTargetDolby120IndexSegment(indexBytes).status, 'validated');

    const fragments = [];
    for (let index = 0; index < top.length; index += 1) {
      if (top[index].type === 'moof') {
        assert.equal(top[index + 1].type, 'mdat');
        fragments.push({ moof: top[index], mdat: top[index + 1] });
      }
    }
    assert.equal(fragments.length, 35);

    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index];
      const inputLength = fragment.moof.size + fragment.mdat.size;
      const input = Buffer.alloc(inputLength);
      assert.equal(readSync(fd, input, 0, input.length, fragment.moof.start), input.length);
      const result = reduceDolby120To60Fragment(input, {
        timescale: 16000,
        lengthSize: 4,
        closedSegmentBoundaryProven: true,
      });
      const finalFragment = index === fragments.length - 1;
      assert.equal(result.status, 'reduced', `fragment ${index}: ${result.reason}`);
      assert.equal(result.inputSampleCount, finalFragment ? 598 : 600);
      assert.equal(result.outputSampleCount, finalFragment ? 299 : 300);
      assert.equal(result.droppedFinalTrailRIndex, finalFragment ? 597 : 598);
      assert.equal(result.trailingAUsAfterDroppedFinalTrailR, finalFragment ? 0 : 1);
      assert.equal(result.leadingTimingPatchStatus, 'patched');
      assert.ok(result.data.length < input.length);

      const reduced = parseReduced(result.data);
      assert.deepEqual(reduced.top.map(item => item.type), ['moof', 'mdat']);
      assert.equal(reduced.samples.length, finalFragment ? 299 : 300);
      assert.equal(
        reduced.samples.reduce((sum, sample) => sum + sample.duration, 0),
        finalFragment ? 79733 : 80000,
      );
      const expectedStepLow = Math.floor(16000 / 60);
      const expectedStepHigh = Math.ceil(16000 / 60);
      for (const sample of reduced.samples) {
        assert.ok(sample.duration === expectedStepLow || sample.duration === expectedStepHigh);
        const types = nalTypes(sample.bytes);
        assert.equal(types.includes(0), false);
        assert.ok(types.includes(62));
      }
      assert.ok(nalTypes(reduced.samples[0].bytes).includes(19));
      const leadingHex = Buffer.from(reduced.samples[0].bytes).toString('hex');
      assert.ok(leadingHex.includes(SPS_60_HEX));
      assert.equal(leadingHex.includes(SPS_120_HEX), false);

      const presentation = reduced.samples.map(sample => sample.pts).sort((a, b) => a - b);
      for (let rank = 1; rank < presentation.length; rank += 1) {
        const delta = presentation[rank] - presentation[rank - 1];
        assert.ok(delta === expectedStepLow || delta === expectedStepHigh);
        const error = (presentation[rank] - presentation[0]) * 60 - rank * 16000;
        assert.ok(Math.abs(error) <= 30);
      }
    }
  } finally {
    closeSync(fd);
  }
});
