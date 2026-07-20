// Byte-exact HEVC timing signalling patch for one immutable Bilibili
// representation only.  This does not remove pictures or rewrite fMP4 sample
// timestamps; applying it on its own would create contradictory timing.  It is
// intended to be the signalling half of the separately validated 120 -> 60
// compressed-domain frame reducer.

export var TARGET_DOLBY_120_SOURCE = Object.freeze({
  bvid: 'BV1dCNC6hEzE',
  aid: '116910368953933',
  cid: '39933052694',
  quality: 126,
  codec: 'hvc1.2.4.L156.90',
  width: 3840,
  height: 2160,
  frameRate: 120,
});

var MAX_INIT_BYTES = 1024 * 1024;
var MAX_ACCESS_UNIT_BYTES = 4 * 1024 * 1024;

var ORIGINAL_VPS_HEX =
  '40010c01ffff02200000030090000003000003009c99c090';
var ORIGINAL_SPS_120_HEX =
  '42010102200000030090000003000003009ca001e02002207c4b6599d29084646fd43016a122412080000003008000003c04';
var PATCHED_SPS_60_HEX =
  '42010102200000030090000003000003009ca001e02002207c4b6599d29084646fd43016a122412080000003008000001e04';
var ORIGINAL_PPS_HEX = '4401c0a53c0cc9';
var ORIGINAL_AUD_HEX = '460110';

// The complete 119-byte HEVCDecoderConfigurationRecord.  Fingerprinting the
// whole record prevents this source-specific patch from silently widening to
// another encode which merely happens to contain a similar VUI suffix.
var ORIGINAL_HVCC_RECORD_HEX =
  '0102200000009000000000009cf000fcfdfafa00000f03'
  + 'a000010018' + ORIGINAL_VPS_HEX
  + 'a100010032' + ORIGINAL_SPS_120_HEX
  + 'a200010007' + ORIGINAL_PPS_HEX;
var PATCHED_HVCC_RECORD_HEX =
  '0102200000009000000000009cf000fcfdfafa00000f03'
  + 'a000010018' + ORIGINAL_VPS_HEX
  + 'a100010032' + PATCHED_SPS_60_HEX
  + 'a200010007' + ORIGINAL_PPS_HEX;

function hexBytes(value) {
  var output = new Uint8Array(value.length / 2);
  for (var i = 0; i < output.length; i += 1) {
    output[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}

var ORIGINAL_VPS = hexBytes(ORIGINAL_VPS_HEX);
var ORIGINAL_SPS_120 = hexBytes(ORIGINAL_SPS_120_HEX);
var PATCHED_SPS_60 = hexBytes(PATCHED_SPS_60_HEX);
var ORIGINAL_PPS = hexBytes(ORIGINAL_PPS_HEX);
var ORIGINAL_AUD = hexBytes(ORIGINAL_AUD_HEX);
var ORIGINAL_HVCC_RECORD = hexBytes(ORIGINAL_HVCC_RECORD_HEX);
var PATCHED_HVCC_RECORD = hexBytes(PATCHED_HVCC_RECORD_HEX);
var ORIGINAL_HVCC_BOX = hexBytes('0000007f68766343' + ORIGINAL_HVCC_RECORD_HEX);
var PATCHED_HVCC_BOX = hexBytes('0000007f68766343' + PATCHED_HVCC_RECORD_HEX);

// Exact SegmentBase index for the immutable target representation.  Besides
// binding the runtime transform to the audited object, this proves all 35
// media ranges have starts_with_SAP=1 / SAP_type=1.  That closed-boundary
// proof is required before the reducer may discard the final, otherwise
// reference-capable picture in a fragment.
export var TARGET_DOLBY_120_SIDX_HEX =
  '000001cc73696478010000000000000100003e800000000000000000000000000000000000000023'
  + '0077102b000138809000000000d4d986000138809000000000e31d0c000138809000000000eccfce'
  + '000138809000000000fe4a0200013880900000000100c8bd000138809000000000fbab4000013880'
  + '9000000000d75262000138809000000000fd53b3000138809000000000bc4a560001388090000000'
  + '00de378f00013880900000000104abde0001388090000000010bccf9000138809000000000f5b31f'
  + '000138809000000000d2cace000138809000000000c33fdc000138809000000001184cdf00013880'
  + '9000000000d03ce5000138809000000000b6c603000138809000000000a365e90001388090000000'
  + '00cd99dd000138809000000000e89bee000138809000000000c57462000138809000000000b9d492'
  + '00013880900000000099a711000138809000000000c51025000138809000000000e9cb3500013880'
  + '90000000010b122d000138809000000000f44496000138809000000000c5fe790001388090000000'
  + '00c54a9f000138809000000000d63b54000138809000000000eb77e5000138809000000000cb98f0'
  + '000138809000000000d314b80001377590000000';
var TARGET_DOLBY_120_SIDX = hexBytes(TARGET_DOLBY_120_SIDX_HEX);

function asBytes(input) {
  if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) {
    return input;
  }
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return null;
}

function unsupported(data, reason) {
  return {
    status: 'unsupported',
    supported: false,
    changed: false,
    reason: reason,
    data: data,
  };
}

function alreadyPatched(data, scope) {
  return {
    status: 'already-60',
    supported: true,
    changed: false,
    reason: 'target-sps-vui-is-already-60',
    scope: scope,
    data: data,
  };
}

function patched(data, scope) {
  return {
    status: 'patched',
    supported: true,
    changed: true,
    reason: 'target-sps-vui-120-to-60',
    scope: scope,
    data: data,
  };
}

function validated(data, scope) {
  return {
    status: 'validated',
    supported: true,
    changed: false,
    reason: 'target-segment-index-and-sap-boundaries-match',
    scope: scope,
    data: data,
  };
}

function equalAt(haystack, offset, needle) {
  if (offset < 0 || offset + needle.length > haystack.length) return false;
  for (var i = 0; i < needle.length; i += 1) {
    if (haystack[offset + i] !== needle[i]) return false;
  }
  return true;
}

function equalBytes(left, right) {
  return left.length === right.length && equalAt(left, 0, right);
}

function findExact(bytes, needle) {
  var offsets = [];
  var limit = bytes.length - needle.length;
  for (var offset = 0; offset <= limit; offset += 1) {
    if (equalAt(bytes, offset, needle)) offsets.push(offset);
  }
  return offsets;
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

function nalType(bytes, offset) {
  return (bytes[offset] >> 1) & 0x3f;
}

function isLayerZeroTidZero(bytes, offset) {
  var layerId = ((bytes[offset] & 0x01) << 5) | (bytes[offset + 1] >> 3);
  return layerId === 0 && (bytes[offset + 1] & 0x07) === 1;
}

// Patch one complete, header-inclusive SPS NAL.  Exactly one payload byte is
// changed: NAL byte 48, 0x3c -> 0x1e.  In RBSP terms this changes
// vui_time_scale 120 -> 60 while leaving vui_num_units_in_tick=1.
export function patchTargetDolby120SpsNal(input) {
  var bytes = asBytes(input);
  if (!bytes) return unsupported(input, 'input-is-not-bytes');
  if (equalBytes(bytes, PATCHED_SPS_60)) return alreadyPatched(bytes, 'sps');
  if (!equalBytes(bytes, ORIGINAL_SPS_120)) {
    return unsupported(bytes, 'target-sps-fingerprint-mismatch');
  }
  var output = bytes.slice();
  output[48] = 0x1e;
  if (!equalBytes(output, PATCHED_SPS_60)) {
    return unsupported(bytes, 'target-sps-patch-postcondition-failed');
  }
  return patched(output, 'sps');
}

// Patch the payload of the target hvcC box.  The VPS is deliberately left
// untouched: this source sets vps_timing_info_present_flag=0, while its SPS VUI
// is the authoritative timing source.  avgFrameRate is zero and also remains
// untouched.
export function patchTargetDolby120HvccRecord(input) {
  var bytes = asBytes(input);
  if (!bytes) return unsupported(input, 'input-is-not-bytes');
  if (equalBytes(bytes, PATCHED_HVCC_RECORD)) {
    return alreadyPatched(bytes, 'hvcc-record');
  }
  if (!equalBytes(bytes, ORIGINAL_HVCC_RECORD)) {
    return unsupported(bytes, 'target-hvcc-fingerprint-mismatch');
  }
  var output = bytes.slice();
  var spsOffsets = findExact(output, ORIGINAL_SPS_120);
  if (spsOffsets.length !== 1) {
    return unsupported(bytes, 'target-hvcc-sps-count-mismatch');
  }
  output.set(PATCHED_SPS_60, spsOffsets[0]);
  if (!equalBytes(output, PATCHED_HVCC_RECORD)) {
    return unsupported(bytes, 'target-hvcc-patch-postcondition-failed');
  }
  return patched(output, 'hvcc-record');
}

// Locate the one complete target hvcC box in a bounded initialization segment.
// This scans for the entire byte-exact box, not for an SPS-looking byte pattern
// in arbitrary MP4 payload.
export function patchTargetDolby120InitSegment(input) {
  var bytes = asBytes(input);
  if (!bytes) return unsupported(input, 'input-is-not-bytes');
  if (bytes.length > MAX_INIT_BYTES) {
    return unsupported(bytes, 'target-init-is-unreasonably-large');
  }
  var originalOffsets = findExact(bytes, ORIGINAL_HVCC_BOX);
  var patchedOffsets = findExact(bytes, PATCHED_HVCC_BOX);
  if (originalOffsets.length === 0 && patchedOffsets.length === 1) {
    return alreadyPatched(bytes, 'init-segment');
  }
  if (originalOffsets.length !== 1 || patchedOffsets.length !== 0) {
    return unsupported(bytes, 'target-init-hvcc-count-mismatch');
  }
  var output = bytes.slice();
  output.set(PATCHED_HVCC_BOX, originalOffsets[0]);
  if (!equalAt(output, originalOffsets[0], PATCHED_HVCC_BOX)) {
    return unsupported(bytes, 'target-init-patch-postcondition-failed');
  }
  return patched(output, 'init-segment');
}

// Validate the complete SegmentBase sidx before any media bytes are reduced.
// A semantic "all SAP" check is intentionally insufficient here: the exact
// reference sizes/durations also bind subsequent Range responses to the
// complete source object audited offline.
export function validateTargetDolby120IndexSegment(input) {
  var bytes = asBytes(input);
  if (!bytes) return unsupported(input, 'input-is-not-bytes');
  if (!equalBytes(bytes, TARGET_DOLBY_120_SIDX)) {
    return unsupported(bytes, 'target-segment-index-fingerprint-mismatch');
  }
  return validated(bytes, 'segment-index');
}

// Patch the one SPS carried in the first length-prefixed access unit of each
// target media segment.  The full source was verified to have this exact
// [AUD,VPS,SPS,PPS,IDR_W_RADL,RPU] layout in all 35 segment-leading AUs.
export function patchTargetDolby120LeadingAccessUnit(input, options) {
  var bytes = asBytes(input);
  if (!bytes) return unsupported(input, 'input-is-not-bytes');
  options = options || {};
  if (options.lengthSize !== 4) {
    return unsupported(bytes, 'unsupported-hevc-length-size');
  }
  if (bytes.length > MAX_ACCESS_UNIT_BYTES) {
    return unsupported(bytes, 'target-access-unit-is-unreasonably-large');
  }

  var units = [];
  var offset = 0;
  while (offset < bytes.length) {
    var size = readU32(bytes, offset);
    if (size === null || size < 3 || offset + 4 + size > bytes.length) {
      return unsupported(bytes, 'invalid-length-prefixed-nal');
    }
    var start = offset + 4;
    if ((bytes[start] & 0x80) !== 0 || !isLayerZeroTidZero(bytes, start)) {
      return unsupported(bytes, 'unsupported-hevc-layer');
    }
    units.push({ start: start, size: size, type: nalType(bytes, start) });
    if (units.length > 6) {
      return unsupported(bytes, 'target-leading-access-unit-layout-mismatch');
    }
    offset = start + size;
  }
  if (offset !== bytes.length || units.length !== 6) {
    return unsupported(bytes, 'target-leading-access-unit-layout-mismatch');
  }

  var expectedTypes = [35, 32, 33, 34, 19, 62];
  for (var i = 0; i < units.length; i += 1) {
    if (units[i].type !== expectedTypes[i]) {
      return unsupported(bytes, 'target-leading-access-unit-layout-mismatch');
    }
  }
  if (!equalBytes(bytes.subarray(units[0].start, units[0].start + units[0].size), ORIGINAL_AUD)
      || !equalBytes(bytes.subarray(units[1].start, units[1].start + units[1].size), ORIGINAL_VPS)
      || !equalBytes(bytes.subarray(units[3].start, units[3].start + units[3].size), ORIGINAL_PPS)) {
    return unsupported(bytes, 'target-parameter-set-fingerprint-mismatch');
  }
  if ((bytes[units[4].start + 2] & 0x80) === 0) {
    return unsupported(bytes, 'target-idr-is-not-a-complete-picture');
  }
  if (units[5].size < 9 || units[5].size > 4096) {
    return unsupported(bytes, 'target-rpu-size-mismatch');
  }

  var sps = bytes.subarray(units[2].start, units[2].start + units[2].size);
  var spsResult = patchTargetDolby120SpsNal(sps);
  if (!spsResult.supported) return unsupported(bytes, spsResult.reason);
  if (!spsResult.changed) return alreadyPatched(bytes, 'leading-access-unit');

  var output = bytes.slice();
  output.set(spsResult.data, units[2].start);
  if (!equalAt(output, units[2].start, PATCHED_SPS_60)) {
    return unsupported(bytes, 'target-access-unit-patch-postcondition-failed');
  }
  return patched(output, 'leading-access-unit');
}
