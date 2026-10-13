// Compressed-domain (no decode/re-encode) 120 fps -> 60 fps reducer for one
// byte-fingerprinted Dolby Vision representation.  It intentionally removes
// pictures, then rewrites fMP4 timing; unsupported input is returned
// byte-for-byte unchanged.

import { patchTargetDolby120LeadingAccessUnit } from './dolbyTimingPatch.js';

var MAX_SAFE_INTEGER = 9007199254740991;
var UINT32 = 4294967296;
var MAX_FRAGMENT_BYTES = 64 * 1024 * 1024;
var MAX_RPU_BYTES = 4096;

var TFHD_BASE_DATA_OFFSET = 0x000001;
var TFHD_SAMPLE_DESCRIPTION_INDEX = 0x000002;
var TFHD_DEFAULT_SAMPLE_DURATION = 0x000008;
var TFHD_DEFAULT_SAMPLE_SIZE = 0x000010;
var TFHD_DEFAULT_SAMPLE_FLAGS = 0x000020;
var TFHD_DURATION_IS_EMPTY = 0x010000;
var TFHD_DEFAULT_BASE_IS_MOOF = 0x020000;

var TRUN_DATA_OFFSET = 0x000001;
var TRUN_FIRST_SAMPLE_FLAGS = 0x000004;
var TRUN_SAMPLE_DURATION = 0x000100;
var TRUN_SAMPLE_SIZE = 0x000200;
var TRUN_SAMPLE_FLAGS = 0x000400;
var TRUN_SAMPLE_COMPOSITION_OFFSET = 0x000800;

// This reducer intentionally recognizes only the exact temporal shape seen in
// the target representation.  Other HEVC VCL types (including reserved *_R
// values) are not inferred to be safe.
var TRAIL_N = 0;
var TRAIL_R = 1;
var IDR_W_RADL = 19;
var IDR_N_LP = 20;
var CRA_NUT = 21;

function unsupported(bytes, reason) {
  return {
    status: 'unsupported',
    supported: false,
    changed: false,
    reason: reason,
    data: bytes,
  };
}

function reject(reason) {
  var error = new Error(reason);
  error.frameReducerReason = reason;
  throw error;
}

function asBytes(input) {
  if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) {
    return input;
  }
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return null;
}

function safeInteger(value) {
  return typeof value === 'number'
    && isFinite(value)
    && Math.floor(value) === value
    && Math.abs(value) <= MAX_SAFE_INTEGER;
}

function need(bytes, offset, length, reason) {
  if (!safeInteger(offset) || !safeInteger(length)
      || offset < 0 || length < 0 || offset + length > bytes.length) {
    reject(reason || 'truncated-data');
  }
}

function readU32(bytes, offset) {
  need(bytes, offset, 4, 'truncated-u32');
  return bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

function readI32(bytes, offset) {
  var value = readU32(bytes, offset);
  return value >= 0x80000000 ? value - UINT32 : value;
}

function readU64(bytes, offset) {
  var high = readU32(bytes, offset);
  var low = readU32(bytes, offset + 4);
  var value = high * UINT32 + low;
  if (!safeInteger(value) || value < 0) reject('unsafe-64-bit-value');
  return value;
}

function writeU32(bytes, offset, value) {
  if (!safeInteger(value) || value < 0 || value >= UINT32) {
    reject('u32-overflow');
  }
  bytes[offset] = Math.floor(value / 0x1000000) & 0xff;
  bytes[offset + 1] = Math.floor(value / 0x10000) & 0xff;
  bytes[offset + 2] = Math.floor(value / 0x100) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeI32(bytes, offset, value) {
  if (!safeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    reject('i32-overflow');
  }
  writeU32(bytes, offset, value < 0 ? value + UINT32 : value);
}

function writeFlags(bytes, offset, version, flags) {
  bytes[offset] = version & 0xff;
  bytes[offset + 1] = (flags >> 16) & 0xff;
  bytes[offset + 2] = (flags >> 8) & 0xff;
  bytes[offset + 3] = flags & 0xff;
}

function readFlags(bytes, offset) {
  need(bytes, offset, 4, 'truncated-full-box');
  return {
    version: bytes[offset],
    flags: bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3],
  };
}

function boxType(bytes, offset) {
  need(bytes, offset, 4, 'truncated-box-type');
  return String.fromCharCode(
    bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]
  );
}

function writeType(bytes, offset, type) {
  bytes[offset] = type.charCodeAt(0);
  bytes[offset + 1] = type.charCodeAt(1);
  bytes[offset + 2] = type.charCodeAt(2);
  bytes[offset + 3] = type.charCodeAt(3);
}

function parseBoxes(bytes, start, end, scope) {
  var boxes = [];
  var offset = start;
  while (offset < end) {
    need(bytes, offset, 8, 'truncated-' + scope + '-box');
    var size = readU32(bytes, offset);
    if (size === 0 || size === 1) reject('unsupported-' + scope + '-box-size');
    if (size < 8 || offset + size > end) reject('invalid-' + scope + '-box-size');
    boxes.push({
      type: boxType(bytes, offset + 4),
      start: offset,
      end: offset + size,
      size: size,
      payloadStart: offset + 8,
    });
    offset += size;
  }
  if (offset !== end) reject('misaligned-' + scope + '-boxes');
  return boxes;
}

function onlyBox(boxes, type, required) {
  var found = [];
  for (var i = 0; i < boxes.length; i += 1) {
    if (boxes[i].type === type) found.push(boxes[i]);
  }
  if (found.length > 1 || (required && found.length !== 1)) {
    reject('expected-one-' + type);
  }
  return found.length ? found[0] : null;
}

function parseTfhd(bytes, box) {
  var full = readFlags(bytes, box.payloadStart);
  if (full.version !== 0) reject('unsupported-tfhd-version');
  var known = TFHD_BASE_DATA_OFFSET
    | TFHD_SAMPLE_DESCRIPTION_INDEX
    | TFHD_DEFAULT_SAMPLE_DURATION
    | TFHD_DEFAULT_SAMPLE_SIZE
    | TFHD_DEFAULT_SAMPLE_FLAGS
    | TFHD_DURATION_IS_EMPTY
    | TFHD_DEFAULT_BASE_IS_MOOF;
  if ((full.flags & (0xffffff ^ known)) !== 0) reject('unsupported-tfhd-flags');
  if ((full.flags & TFHD_BASE_DATA_OFFSET) !== 0) reject('tfhd-base-data-offset');
  if ((full.flags & TFHD_DURATION_IS_EMPTY) !== 0) reject('empty-track-fragment');
  if ((full.flags & TFHD_DEFAULT_BASE_IS_MOOF) === 0) reject('tfhd-base-is-not-moof');

  var offset = box.payloadStart + 4;
  need(bytes, offset, 4, 'truncated-tfhd-track-id');
  var trackId = readU32(bytes, offset);
  offset += 4;
  if (trackId === 0) reject('invalid-track-id');

  if ((full.flags & TFHD_SAMPLE_DESCRIPTION_INDEX) !== 0) offset += 4;
  var defaultDuration = null;
  var defaultSize = null;
  var defaultFlags = null;
  if ((full.flags & TFHD_DEFAULT_SAMPLE_DURATION) !== 0) {
    defaultDuration = readU32(bytes, offset);
    offset += 4;
  }
  if ((full.flags & TFHD_DEFAULT_SAMPLE_SIZE) !== 0) {
    defaultSize = readU32(bytes, offset);
    offset += 4;
  }
  if ((full.flags & TFHD_DEFAULT_SAMPLE_FLAGS) !== 0) {
    defaultFlags = readU32(bytes, offset);
    offset += 4;
  }
  if (offset !== box.end) reject('invalid-tfhd-length');
  return {
    trackId: trackId,
    defaultDuration: defaultDuration,
    defaultSize: defaultSize,
    defaultFlags: defaultFlags,
  };
}

function parseTfdt(bytes, box) {
  var full = readFlags(bytes, box.payloadStart);
  if (full.flags !== 0 || (full.version !== 0 && full.version !== 1)) {
    reject('unsupported-tfdt-format');
  }
  var offset = box.payloadStart + 4;
  var baseDecodeTime;
  if (full.version === 0) {
    baseDecodeTime = readU32(bytes, offset);
    offset += 4;
  } else {
    baseDecodeTime = readU64(bytes, offset);
    offset += 8;
  }
  if (offset !== box.end) reject('invalid-tfdt-length');
  return { baseDecodeTime: baseDecodeTime };
}

function parseTrun(bytes, box, tfhd) {
  var full = readFlags(bytes, box.payloadStart);
  var known = TRUN_DATA_OFFSET
    | TRUN_FIRST_SAMPLE_FLAGS
    | TRUN_SAMPLE_DURATION
    | TRUN_SAMPLE_SIZE
    | TRUN_SAMPLE_FLAGS
    | TRUN_SAMPLE_COMPOSITION_OFFSET;
  if (full.version !== 0 && full.version !== 1) reject('unsupported-trun-version');
  if ((full.flags & (0xffffff ^ known)) !== 0) reject('unsupported-trun-flags');
  if ((full.flags & TRUN_DATA_OFFSET) === 0) reject('trun-without-data-offset');
  if ((full.flags & TRUN_FIRST_SAMPLE_FLAGS) !== 0
      && (full.flags & TRUN_SAMPLE_FLAGS) !== 0) {
    reject('conflicting-trun-sample-flags');
  }

  var offset = box.payloadStart + 4;
  var sampleCount = readU32(bytes, offset);
  offset += 4;
  // Reject before iterating or allocating from an attacker-controlled count.
  // The final subsegment is two source pictures shorter than the regular
  // five-second subsegments.  No other count is accepted.
  if (sampleCount !== 600 && sampleCount !== 598) {
    reject('expected-600-or-final-598-samples');
  }
  var dataOffset = readI32(bytes, offset);
  offset += 4;
  var firstSampleFlags = null;
  if ((full.flags & TRUN_FIRST_SAMPLE_FLAGS) !== 0) {
    firstSampleFlags = readU32(bytes, offset);
    offset += 4;
  }

  var samples = [];
  for (var i = 0; i < sampleCount; i += 1) {
    var duration = tfhd.defaultDuration;
    var size = tfhd.defaultSize;
    var sampleFlags = i === 0 && firstSampleFlags !== null
      ? firstSampleFlags
      : tfhd.defaultFlags;
    var compositionOffset = 0;

    if ((full.flags & TRUN_SAMPLE_DURATION) !== 0) {
      duration = readU32(bytes, offset);
      offset += 4;
    }
    if ((full.flags & TRUN_SAMPLE_SIZE) !== 0) {
      size = readU32(bytes, offset);
      offset += 4;
    }
    if ((full.flags & TRUN_SAMPLE_FLAGS) !== 0) {
      sampleFlags = readU32(bytes, offset);
      offset += 4;
    }
    if ((full.flags & TRUN_SAMPLE_COMPOSITION_OFFSET) !== 0) {
      compositionOffset = full.version === 0
        ? readU32(bytes, offset)
        : readI32(bytes, offset);
      offset += 4;
    }
    if (!safeInteger(duration) || duration <= 0) reject('missing-sample-duration');
    if (!safeInteger(size) || size <= 0) reject('missing-sample-size');
    if (!safeInteger(sampleFlags) || sampleFlags < 0) reject('missing-sample-flags');
    samples.push({
      duration: duration,
      size: size,
      flags: sampleFlags,
      compositionOffset: compositionOffset,
    });
  }
  if (offset !== box.end) reject('invalid-trun-length');
  return {
    version: full.version,
    flags: full.flags,
    dataOffset: dataOffset,
    samples: samples,
  };
}

function sampleDependency(flags) {
  return {
    dependsOn: Math.floor(flags / 0x1000000) & 0x03,
    isDependedOn: Math.floor(flags / 0x400000) & 0x03,
    nonSync: (Math.floor(flags / 0x10000) & 0x01) !== 0,
  };
}

function BitReader(bytes) {
  this.bytes = bytes;
  this.position = 0;
}

BitReader.prototype.read = function read(count) {
  if (!safeInteger(count) || count < 0 || count > 32
      || this.position + count > this.bytes.length * 8) {
    reject('truncated-bitstream');
  }
  var value = 0;
  for (var i = 0; i < count; i += 1) {
    value = value * 2
      + ((this.bytes[this.position >> 3] >> (7 - (this.position & 7))) & 1);
    this.position += 1;
  }
  return value;
};

BitReader.prototype.readUe = function readUe() {
  var zeroes = 0;
  while (this.read(1) === 0) {
    zeroes += 1;
    if (zeroes > 31) reject('exp-golomb-overflow');
  }
  return Math.pow(2, zeroes) - 1 + (zeroes ? this.read(zeroes) : 0);
};

BitReader.prototype.readSe = function readSe() {
  var code = this.readUe();
  return code & 1 ? (code + 1) / 2 : -(code / 2);
};

function removeEmulationPrevention(bytes, start, end) {
  var output = new Uint8Array(end - start);
  var length = 0;
  for (var i = start; i < end; i += 1) {
    if (i >= start + 2 && bytes[i] === 0x03
        && bytes[i - 1] === 0 && bytes[i - 2] === 0) {
      continue;
    }
    output[length] = bytes[i];
    length += 1;
  }
  return output.subarray(0, length);
}

function crc32Mpeg2(bytes, start, end) {
  var crc = 0xffffffff;
  for (var i = start; i < end; i += 1) {
    crc = (crc ^ (bytes[i] << 24)) >>> 0;
    for (var bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80000000)
        ? (((crc << 1) ^ 0x04c11db7) >>> 0)
        : ((crc << 1) >>> 0);
    }
  }
  return crc >>> 0;
}

function skipDolbyMapping(reader, header) {
  var vdrRpuId = reader.readUe();
  var mappingColorSpace = reader.readUe();
  var mappingChromaFormat = reader.readUe();
  if (vdrRpuId !== 0 || mappingColorSpace !== 0 || mappingChromaFormat !== 0) {
    reject('unsupported-rpu-mapping-state');
  }

  var pivotsMinusTwo = [];
  for (var component = 0; component < 3; component += 1) {
    var count = reader.readUe();
    if (count > 7) reject('unsupported-rpu-pivot-count');
    pivotsMinusTwo.push(count);
    for (var pivot = 0; pivot < count + 2; pivot += 1) {
      reader.read(header.blBitDepth);
    }
  }

  // Profile 8 must not carry NLQ/residual mapping.  Reaching this branch would
  // require substantially more state than this browser-side prototype parses.
  if ((header.format & 0x700) === 0 && !header.disableResidual) {
    reject('unsupported-rpu-residual-mapping');
  }
  if (reader.readUe() !== 0 || reader.readUe() !== 0) {
    reject('unsupported-rpu-partitioning');
  }

  for (component = 0; component < 3; component += 1) {
    for (var piece = 0; piece < pivotsMinusTwo[component] + 1; piece += 1) {
      var method = reader.readUe();
      if (method === 0) {
        var polynomialOrderMinusOne = reader.readUe();
        if (polynomialOrderMinusOne > 1) reject('unsupported-rpu-polynomial-order');
        var linearInterpolation = polynomialOrderMinusOne === 0
          ? reader.read(1)
          : 0;
        if (linearInterpolation) reject('unsupported-rpu-linear-interpolation');
        for (var coefficient = 0;
          coefficient < polynomialOrderMinusOne + 2;
          coefficient += 1) {
          if (header.coefficientType === 0) reader.readSe();
          reader.read(header.coefficientDenominatorBits);
        }
      } else if (method === 1) {
        var mmrOrderMinusOne = reader.read(2);
        if (mmrOrderMinusOne > 2) reject('unsupported-rpu-mmr-order');
        if (header.coefficientType === 0) reader.readSe();
        reader.read(header.coefficientDenominatorBits);
        for (coefficient = 0; coefficient < (mmrOrderMinusOne + 1) * 7;
          coefficient += 1) {
          if (header.coefficientType === 0) reader.readSe();
          reader.read(header.coefficientDenominatorBits);
        }
      } else {
        reject('unsupported-rpu-mapping-method');
      }
    }
  }
}

function parseIndependentDolbyRpu(bytes, start, size) {
  if (size < 9 || size > MAX_RPU_BYTES) reject('unsupported-dolby-rpu-size');
  var rbsp = removeEmulationPrevention(bytes, start + 2, start + size);
  var end = rbsp.length;
  while (end > 0 && rbsp[end - 1] === 0) end -= 1;
  if (end < 7 || rbsp[end - 1] !== 0x80) reject('invalid-dolby-rpu-ending');
  var crcOffset = end - 5;
  var receivedCrc = readU32(rbsp, crcOffset);
  if (crc32Mpeg2(rbsp, 1, crcOffset) !== receivedCrc) {
    reject('invalid-dolby-rpu-crc');
  }

  var reader = new BitReader(rbsp.subarray(0, crcOffset));
  if (reader.read(8) !== 25 || reader.read(6) !== 2) {
    reject('unsupported-dolby-rpu-prefix');
  }
  var format = reader.read(11);
  var profile = reader.read(4);
  var level = reader.read(4);
  var sequenceInfo = reader.read(1);
  if (format !== 18 || profile !== 1 || level !== 0 || !sequenceInfo) {
    reject('unsupported-dolby-rpu-profile');
  }

  reader.read(1); // chroma_resampling_explicit_filter_flag
  var coefficientType = reader.read(2);
  var coefficientDenominator = coefficientType === 0 ? reader.readUe() : 32;
  reader.read(2); // vdr_rpu_normalized_idc
  reader.read(1); // bl_video_full_range_flag
  var blBitDepthMinusEight = reader.readUe();
  var elBitDepthAndExtension = reader.readUe();
  var vdrBitDepthMinusEight = reader.readUe();
  reader.read(1); // spatial_resampling_filter_flag
  var reserved = reader.read(3);
  var elSpatialResampling = reader.read(1);
  var disableResidual = reader.read(1);
  if (coefficientType !== 0 || coefficientDenominator !== 23
      || blBitDepthMinusEight !== 2
      || (elBitDepthAndExtension & 0xff) !== 2
      || vdrBitDepthMinusEight > 6
      || reserved !== 0 || elSpatialResampling !== 0 || !disableResidual) {
    reject('unsupported-dolby-rpu-sequence');
  }

  var dmMetadataPresent = reader.read(1);
  var usePreviousMapping = reader.read(1);
  if (usePreviousMapping) reject('dolby-rpu-uses-previous-mapping');
  if (!dmMetadataPresent) reject('dolby-rpu-without-dm-metadata');
  var header = {
    format: format,
    coefficientType: coefficientType,
    coefficientDenominatorBits: coefficientDenominator,
    blBitDepth: blBitDepthMinusEight + 8,
    disableResidual: !!disableResidual,
  };
  skipDolbyMapping(reader, header);

  var affectedDmMetadataId = reader.readUe();
  var currentDmMetadataId = reader.readUe();
  var sceneRefresh = reader.readUe();
  if (affectedDmMetadataId > 15
      || affectedDmMetadataId !== currentDmMetadataId
      || sceneRefresh !== 1) {
    reject('dolby-rpu-dm-state-is-not-self-contained');
  }

  // Parse the fixed, uncompressed DM payload as well.  Extension metadata is
  // deliberately left opaque, but the RPU-wide CRC above still authenticates
  // every one of its bytes.
  var field;
  for (field = 0; field < 9; field += 1) reader.read(16); // YCC -> RGB
  for (field = 0; field < 3; field += 1) reader.read(32); // YCC offsets
  for (field = 0; field < 9; field += 1) reader.read(16); // RGB -> LMS
  var signalEotf = reader.read(16);
  var signalEotfParam0 = reader.read(16);
  var signalEotfParam1 = reader.read(16);
  var signalEotfParam2 = reader.read(32);
  var signalBitDepth = reader.read(5);
  reader.read(2); // signal_color_space
  reader.read(2); // signal_chroma_format
  reader.read(2); // signal_full_range_flag
  reader.read(12); // source_min_pq
  reader.read(12); // source_max_pq
  reader.read(10); // source_diagonal
  if (signalBitDepth < 8 || signalBitDepth > 16
      || (signalEotfParam0 === 0 && signalEotfParam1 === 0
        && signalEotfParam2 === 0 && signalEotf !== 65535)) {
    reject('invalid-dolby-rpu-dm-payload');
  }
  return true;
}

function parseSingleTemporalLayer(bytes, start, size, type) {
  var rbsp = removeEmulationPrevention(bytes, start + 2, start + size);
  var reader = new BitReader(rbsp);
  if (type === 32) {
    reader.read(4); // vps_video_parameter_set_id
    reader.read(1); // vps_base_layer_internal_flag
    reader.read(1); // vps_base_layer_available_flag
    reader.read(6); // vps_max_layers_minus1
    if (reader.read(3) !== 0) reject('vps-has-higher-temporal-layers');
  } else {
    reader.read(4); // sps_video_parameter_set_id
    if (reader.read(3) !== 0) reject('sps-has-higher-temporal-layers');
    if (reader.read(1) !== 1) reject('sps-temporal-id-is-not-nested');
  }
}

function classifyAccessUnit(bytes, start, size, sampleIndex) {
  var offset = start;
  var end = start + size;
  var nalUnits = [];
  need(bytes, start, size, 'sample-outside-mdat');

  while (offset < end) {
    need(bytes, offset, 4, 'truncated-nal-length');
    var nalSize = readU32(bytes, offset);
    offset += 4;
    if (nalSize < 3 || offset + nalSize > end) reject('invalid-nal-length');
    if ((bytes[offset] & 0x80) !== 0) reject('hevc-forbidden-zero-bit');
    var nalType = (bytes[offset] >> 1) & 0x3f;
    var layerId = ((bytes[offset] & 0x01) << 5) | (bytes[offset + 1] >> 3);
    var temporalIdPlusOne = bytes[offset + 1] & 0x07;
    // TID0 is essential: an HEVC *_N picture can otherwise still be used by a
    // higher temporal sub-layer.  VPS/SPS below additionally prohibit such a
    // layer from existing in this sequence.
    if (layerId !== 0 || temporalIdPlusOne !== 1) reject('unsupported-hevc-layer');
    nalUnits.push({ type: nalType, start: offset, size: nalSize });
    if (nalUnits.length > 8) reject('too-many-nals-in-access-unit');
    offset += nalSize;
  }
  if (offset !== end) reject('misaligned-access-unit');

  var rpuUnits = 0;
  for (var unitIndex = 0; unitIndex < nalUnits.length; unitIndex += 1) {
    if (nalUnits[unitIndex].type === 62) rpuUnits += 1;
  }
  if (rpuUnits === 0) reject('access-unit-without-dolby-rpu');
  if (rpuUnits !== 1) reject('access-unit-with-multiple-dolby-rpus');

  var vcl;
  var rpu;
  if (sampleIndex === 0) {
    if (nalUnits.length !== 6
        || nalUnits[0].type !== 35
        || nalUnits[1].type !== 32
        || nalUnits[2].type !== 33
        || nalUnits[3].type !== 34
        || (nalUnits[4].type !== IDR_W_RADL
          && nalUnits[4].type !== IDR_N_LP
          && nalUnits[4].type !== CRA_NUT)
        || nalUnits[5].type !== 62) {
      reject('unsupported-leading-access-unit-layout');
    }
    parseSingleTemporalLayer(bytes, nalUnits[1].start, nalUnits[1].size, 32);
    parseSingleTemporalLayer(bytes, nalUnits[2].start, nalUnits[2].size, 33);
    vcl = nalUnits[4];
    rpu = nalUnits[5];
  } else {
    if (nalUnits.length !== 3 || nalUnits[0].type !== 35
        || (nalUnits[1].type !== TRAIL_N && nalUnits[1].type !== TRAIL_R)
        || nalUnits[2].type !== 62) {
      reject('unsupported-trailing-access-unit-layout');
    }
    vcl = nalUnits[1];
    rpu = nalUnits[2];
  }

  // This fingerprint contains exactly one VCL NAL per sample.  Requiring its
  // first-slice flag proves that the sample is one complete picture rather
  // than a continuation or two pictures accidentally packed together.
  if ((bytes[vcl.start + 2] & 0x80) === 0) reject('vcl-is-not-a-complete-picture');
  parseIndependentDolbyRpu(bytes, rpu.start, rpu.size);
  return {
    disposition: vcl.type === TRAIL_N ? 'drop' : 'keep',
    vclType: vcl.type,
    rpuCount: 1,
  };
}

function sortedByPresentationTime(records) {
  var sorted = records.slice();
  sorted.sort(function sortPresentation(a, b) {
    return a.pts - b.pts || a.dts - b.dts;
  });
  return sorted;
}

function requirePresentationCadence(records, timescale, rate, reason) {
  var sorted = sortedByPresentationTime(records);
  var floorStep = Math.floor(timescale / rate);
  var ceilStep = Math.ceil(timescale / rate);
  for (var i = 1; i < sorted.length; i += 1) {
    var delta = sorted[i].pts - sorted[i - 1].pts;
    if (delta <= 0 || (delta !== floorStep && delta !== ceilStep)) reject(reason);
    // Integer timescales distribute rounding across frames.  Requiring every
    // cumulative timestamp to be within half a tick of the ideal cadence is
    // stricter than accepting arbitrary mixtures of floor/ceil durations.
    var scaledError = (sorted[i].pts - sorted[0].pts) * rate - i * timescale;
    if (Math.abs(scaledError) * 2 > rate) reject(reason);
  }
  return sorted;
}

function concatBytes(parts) {
  var length = 0;
  var i;
  for (i = 0; i < parts.length; i += 1) length += parts[i].length;
  if (!safeInteger(length)) reject('output-too-large');
  var output = new Uint8Array(length);
  var offset = 0;
  for (i = 0; i < parts.length; i += 1) {
    output.set(parts[i], offset);
    offset += parts[i].length;
  }
  return output;
}

function buildTrun(samples, version, includeCompositionOffsets, dataOffset) {
  var flags = TRUN_DATA_OFFSET
    | TRUN_SAMPLE_DURATION
    | TRUN_SAMPLE_SIZE
    | TRUN_SAMPLE_FLAGS;
  if (includeCompositionOffsets) flags |= TRUN_SAMPLE_COMPOSITION_OFFSET;
  var fieldsPerSample = includeCompositionOffsets ? 4 : 3;
  var size = 20 + samples.length * fieldsPerSample * 4;
  if (size >= UINT32) reject('trun-too-large');
  var output = new Uint8Array(size);
  writeU32(output, 0, size);
  writeType(output, 4, 'trun');
  writeFlags(output, 8, version, flags);
  writeU32(output, 12, samples.length);
  writeI32(output, 16, dataOffset);
  var offset = 20;
  for (var i = 0; i < samples.length; i += 1) {
    var sample = samples[i];
    writeU32(output, offset, sample.duration);
    writeU32(output, offset + 4, sample.size);
    writeU32(output, offset + 8, sample.flags);
    offset += 12;
    if (includeCompositionOffsets) {
      if (version === 0) writeU32(output, offset, sample.compositionOffset);
      else writeI32(output, offset, sample.compositionOffset);
      offset += 4;
    }
  }
  return output;
}

function replaceNestedBox(bytes, outerBox, innerBox, replacement) {
  var newSize = outerBox.size - innerBox.size + replacement.length;
  if (newSize < 8 || newSize >= UINT32) reject('rebuilt-box-size');
  var result = concatBytes([
    bytes.subarray(outerBox.start, innerBox.start),
    replacement,
    bytes.subarray(innerBox.end, outerBox.end),
  ]);
  writeU32(result, 0, newSize);
  return result;
}

function checkTopLevelLayout(bytes) {
  var boxes = parseBoxes(bytes, 0, bytes.length, 'top-level');
  var moof = onlyBox(boxes, 'moof', true);
  var mdat = onlyBox(boxes, 'mdat', true);
  var moofIndex = boxes.indexOf(moof);
  var mdatIndex = boxes.indexOf(mdat);
  if (mdatIndex !== moofIndex + 1 || mdat.end !== bytes.length) {
    reject('moof-mdat-must-be-final-and-adjacent');
  }
  for (var i = 0; i < moofIndex; i += 1) {
    var type = boxes[i].type;
    if (type === 'sidx') reject('media-fragment-must-not-contain-sidx');
    if (type !== 'styp' && type !== 'emsg' && type !== 'free') {
      reject('unsupported-prefix-box-' + type);
    }
  }
  return { moof: moof, mdat: mdat };
}

// The caller must supply the representation timescale and the HEVC length
// field size read from hvcC.  `closedSegmentBoundaryProven` may be true only
// after validateTargetDolby120IndexSegment() validates the exact target SIDX.
// Only lengthSize=4 is supported.
export function reduceDolby120To60Fragment(input, options) {
  var bytes = asBytes(input);
  if (!bytes) return unsupported(input, 'input-is-not-bytes');
  if (bytes.length > MAX_FRAGMENT_BYTES) return unsupported(bytes, 'fragment-too-large');
  options = options || {};
  if (options.lengthSize !== 4) return unsupported(bytes, 'unsupported-hevc-length-size');
  var timescale = Number(options.timescale);
  if (!safeInteger(timescale) || timescale < 120 || timescale > 0x7fffffff) {
    return unsupported(bytes, 'invalid-timescale');
  }

  try {
    var layout = checkTopLevelLayout(bytes);
    var moofChildren = parseBoxes(bytes, layout.moof.payloadStart, layout.moof.end, 'moof');
    var traf = onlyBox(moofChildren, 'traf', true);
    onlyBox(moofChildren, 'mfhd', false);
    for (var m = 0; m < moofChildren.length; m += 1) {
      if (moofChildren[m].type !== 'mfhd' && moofChildren[m].type !== 'traf') {
        reject('unsupported-moof-child-' + moofChildren[m].type);
      }
    }

    var trafChildren = parseBoxes(bytes, traf.payloadStart, traf.end, 'traf');
    var tfhdBox = onlyBox(trafChildren, 'tfhd', true);
    var tfdtBox = onlyBox(trafChildren, 'tfdt', true);
    var trunBox = onlyBox(trafChildren, 'trun', true);
    if (trafChildren.length !== 3) reject('unsupported-traf-auxiliary-box');
    var tfhd = parseTfhd(bytes, tfhdBox);
    var tfdt = parseTfdt(bytes, tfdtBox);
    var trun = parseTrun(bytes, trunBox, tfhd);
    var samples = trun.samples;

    if (trun.dataOffset !== layout.moof.size + 8) reject('unexpected-trun-data-offset');
    if (options.closedSegmentBoundaryProven !== true) {
      reject('closed-segment-boundary-is-not-proven');
    }

    var payloadStart = layout.mdat.payloadStart;
    var payloadSize = layout.mdat.size - 8;
    var sampleOffset = payloadStart;
    var decodeTime = tfdt.baseDecodeTime;
    var totalDuration = 0;
    var records = [];
    for (var i = 0; i < samples.length; i += 1) {
      var sample = samples[i];
      var accessUnit = classifyAccessUnit(bytes, sampleOffset, sample.size, i);
      var dependency = sampleDependency(sample.flags);
      if (accessUnit.disposition === 'drop') {
        // A value of zero is unspecified in this source.  It is accepted only
        // because TRAIL_N+TID0 and the single-layer VPS/SPS independently prove
        // that this picture cannot feed a retained picture.
        if (dependency.isDependedOn === 1 || !dependency.nonSync) {
          reject('non-reference-sample-has-unsafe-dependency');
        }
      } else if (i === 0) {
        if (dependency.dependsOn !== 2 || dependency.nonSync) {
          reject('invalid-leading-random-access-flags');
        }
      }
      var presentationTime = decodeTime + sample.compositionOffset;
      if (!safeInteger(presentationTime)) reject('sample-timeline-overflow');
      records.push({
        index: i,
        start: sampleOffset,
        size: sample.size,
        duration: sample.duration,
        flags: sample.flags,
        compositionOffset: sample.compositionOffset,
        dts: decodeTime,
        pts: presentationTime,
        disposition: accessUnit.disposition,
        vclType: accessUnit.vclType,
        rpuCount: accessUnit.rpuCount,
      });
      sampleOffset += sample.size;
      decodeTime += sample.duration;
      totalDuration += sample.duration;
      var minimum120FpsDuration = Math.floor(timescale / 120);
      var maximum120FpsDuration = Math.ceil(timescale / 120);
      if (sample.duration !== minimum120FpsDuration
          && sample.duration !== maximum120FpsDuration) {
        reject('sample-cadence-is-not-120fps');
      }
      if (!safeInteger(decodeTime) || !safeInteger(totalDuration)) {
        reject('sample-timeline-overflow');
      }
    }
    if (sampleOffset !== payloadStart + payloadSize) reject('sample-sizes-do-not-fill-mdat');
    var expectedSourceDuration = Math.round(samples.length * timescale / 120);
    if (totalDuration !== expectedSourceDuration) reject('unexpected-fragment-duration');
    requirePresentationCadence(records, timescale, 120, 'presentation-is-not-120fps');

    // Delete every non-reference TRAIL_N plus exactly the final TRAIL_R in
    // decode order.  No earlier-decoded retained picture can depend on a later
    // decoded picture.  Every later AU is verified below to be TRAIL_N and is
    // also removed.  The caller must separately validate the target SIDX/SAP
    // contract, proving every following segment starts with an IDR that closes
    // the DPB (and proving the last referenced subsegment is the stream end).
    var lastTrailRIndex = -1;
    for (i = 0; i < records.length; i += 1) {
      if (records[i].vclType === TRAIL_R) lastTrailRIndex = i;
    }
    if (lastTrailRIndex < 1) reject('missing-final-trail-r-candidate');
    for (i = lastTrailRIndex + 1; i < records.length; i += 1) {
      if (records[i].vclType !== TRAIL_N) {
        reject('retained-au-exists-after-final-trail-r');
      }
    }

    var kept = [];
    var payloadParts = [];
    for (i = 0; i < records.length; i += 1) {
      if (records[i].disposition === 'keep' && i !== lastTrailRIndex) {
        kept.push(records[i]);
        payloadParts.push(bytes.subarray(records[i].start, records[i].start + records[i].size));
      }
    }
    var expectedOutputSamples = samples.length / 2;
    if (kept.length !== expectedOutputSamples) {
      reject('safe-output-picture-count-mismatch');
    }

    var patchedLeadingAu = patchTargetDolby120LeadingAccessUnit(
      payloadParts[0],
      { lengthSize: 4 }
    );
    if (!patchedLeadingAu.supported
        || (patchedLeadingAu.status !== 'patched'
          && patchedLeadingAu.status !== 'already-60')) {
      reject('leading-sps-timing-patch-' + patchedLeadingAu.reason);
    }
    if (patchedLeadingAu.data.length !== kept[0].size) {
      reject('leading-sps-timing-patch-changed-size');
    }
    payloadParts[0] = patchedLeadingAu.data;

    // The decode and display orders are different for this B-frame stream.
    // Assign a new exact 60fps grid independently in each order, preserving
    // the original presentation start and the fragment's total duration.
    var displayOrder = sortedByPresentationTime(kept);
    var presentationStart = displayOrder[0].pts;
    for (i = 0; i < displayOrder.length; i += 1) {
      displayOrder[i].newPts = presentationStart + Math.round(i * timescale / 60);
      if (!safeInteger(displayOrder[i].newPts)) reject('sample-timeline-overflow');
    }

    var rebuiltSamples = [];
    for (i = 0; i < kept.length; i += 1) {
      var newDts = tfdt.baseDecodeTime + Math.round(i * timescale / 60);
      var nextDts = i + 1 < kept.length
        ? tfdt.baseDecodeTime + Math.round((i + 1) * timescale / 60)
        : tfdt.baseDecodeTime + totalDuration;
      var newDuration = nextDts - newDts;
      var newCompositionOffset = kept[i].newPts - newDts;
      if (!safeInteger(newDts) || newDuration <= 0 || newDuration >= UINT32
          || !safeInteger(newCompositionOffset)
          || newCompositionOffset < -0x80000000
          || newCompositionOffset > 0x7fffffff) {
        reject('invalid-retained-decode-timeline');
      }
      rebuiltSamples.push({
        duration: newDuration,
        size: kept[i].size,
        flags: kept[i].flags,
        compositionOffset: newCompositionOffset,
      });
    }
    var rebuiltDuration = 0;
    for (i = 0; i < rebuiltSamples.length; i += 1) {
      rebuiltDuration += rebuiltSamples[i].duration;
    }
    if (rebuiltDuration !== totalDuration) reject('output-duration-changed');

    var includeCompositionOffsets = true;
    var rebuiltTrunVersion = rebuiltSamples.some(function hasNegativeCto(item) {
      return item.compositionOffset < 0;
    }) ? 1 : 0;
    var rebuiltTrun = buildTrun(
      rebuiltSamples,
      rebuiltTrunVersion,
      includeCompositionOffsets,
      0
    );
    var rebuiltTrafRelative = {
      start: traf.start - layout.moof.start,
      end: traf.end - layout.moof.start,
      size: traf.size,
    };
    var trunRelative = {
      start: trunBox.start - layout.moof.start,
      end: trunBox.end - layout.moof.start,
      size: trunBox.size,
    };
    var originalMoof = bytes.subarray(layout.moof.start, layout.moof.end);
    var rebuiltTraf = replaceNestedBox(
      originalMoof,
      rebuiltTrafRelative,
      trunRelative,
      rebuiltTrun
    );
    var rebuiltMoof = concatBytes([
      originalMoof.subarray(0, rebuiltTrafRelative.start),
      rebuiltTraf,
      originalMoof.subarray(rebuiltTrafRelative.end),
    ]);
    writeU32(rebuiltMoof, 0, rebuiltMoof.length);

    // data_offset is 16 bytes into the canonical trun.  Locate it inside the
    // rebuilt moof through the unchanged prefix and rebuilt traf prefix.
    var rebuiltTrunOffset = rebuiltTrafRelative.start
      + (trunRelative.start - rebuiltTrafRelative.start)
      + 16;
    writeI32(rebuiltMoof, rebuiltTrunOffset, rebuiltMoof.length + 8);

    var prefix = bytes.subarray(0, layout.moof.start);
    var rebuiltPayloadLength = 0;
    for (i = 0; i < payloadParts.length; i += 1) {
      rebuiltPayloadLength += payloadParts[i].length;
    }
    var rebuiltMdatSize = rebuiltPayloadLength + 8;
    if (rebuiltMdatSize >= UINT32) reject('mdat-too-large');
    var outputLength = prefix.length + rebuiltMoof.length + rebuiltMdatSize;
    if (outputLength >= bytes.length) reject('reduced-fragment-did-not-shrink');

    // Each DASH range response is filtered independently, so later upstream
    // SIDX offsets do not move.  Return the shorter response directly rather
    // than retaining deleted bytes in a giant free box.
    var output = new Uint8Array(outputLength);
    var outputOffset = 0;
    output.set(prefix, outputOffset);
    outputOffset += prefix.length;
    output.set(rebuiltMoof, outputOffset);
    outputOffset += rebuiltMoof.length;
    writeU32(output, outputOffset, rebuiltMdatSize);
    writeType(output, outputOffset + 4, 'mdat');
    outputOffset += 8;
    for (i = 0; i < payloadParts.length; i += 1) {
      output.set(payloadParts[i], outputOffset);
      outputOffset += payloadParts[i].length;
    }
    if (outputOffset !== output.length) reject('output-length-changed');

    return {
      status: 'reduced',
      supported: true,
      changed: true,
      reason: 'compressed-domain-120-to-60',
      data: output,
      trackId: tfhd.trackId,
      timescale: timescale,
      baseDecodeTime: tfdt.baseDecodeTime,
      duration: totalDuration,
      inputSampleCount: records.length,
      outputSampleCount: rebuiltSamples.length,
      removedSampleCount: records.length - rebuiltSamples.length,
      droppedFinalTrailRIndex: lastTrailRIndex,
      trailingAUsAfterDroppedFinalTrailR: records.length - lastTrailRIndex - 1,
      leadingTimingPatchStatus: patchedLeadingAu.status,
    };
  } catch (error) {
    return unsupported(bytes, error && error.frameReducerReason
      ? error.frameReducerReason
      : 'malformed-fragment');
  }
}
