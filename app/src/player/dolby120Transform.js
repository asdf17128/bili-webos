import { reduceDolby120To60Fragment } from './dolbyFrameReducer.js';
import {
  TARGET_DOLBY_120_SOURCE,
  TARGET_DOLBY_120_SIDX_HEX,
  patchTargetDolby120InitSegment,
  validateTargetDolby120IndexSegment,
} from './dolbyTimingPatch.js';

export var TARGET_DOLBY_120_TIMESCALE = 16000;
export var TARGET_DOLBY_120_LENGTH_SIZE = 4;

var TARGET_INIT_RANGE = '0-1037';
var TARGET_INDEX_RANGE = '1038-1497';

function hexBytes(value) {
  var output = new Uint8Array(value.length / 2);
  for (var index = 0; index < output.length; index += 1) {
    output[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function readU32(bytes, offset) {
  return bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

function buildTargetSegmentEntries() {
  var bytes = hexBytes(TARGET_DOLBY_120_SIDX_HEX);
  var indexStart = Number(TARGET_INDEX_RANGE.split('-')[0]);
  var count = bytes[38] * 0x100 + bytes[39];
  var entries = [];
  var offset = 40;
  var nextByte = indexStart + bytes.length;
  var nextTime = 0;
  for (var index = 0; index < count; index += 1) {
    var sizeWord = readU32(bytes, offset);
    var duration = readU32(bytes, offset + 4);
    var sapWord = readU32(bytes, offset + 8);
    var size = sizeWord & 0x7fffffff;
    if ((sizeWord & 0x80000000) !== 0
        || (sapWord >>> 28) !== 9
        || size <= 0 || duration <= 0) {
      throw new Error('Invalid built-in Dolby segment index');
    }
    var finalEntry = index === count - 1;
    entries.push(Object.freeze({
      index: index,
      startByte: nextByte,
      endByte: nextByte + size - 1,
      inputBytes: size,
      durationTicks: duration,
      startTicks: nextTime,
      startTime: nextTime / TARGET_DOLBY_120_TIMESCALE,
      endTime: (nextTime + duration) / TARGET_DOLBY_120_TIMESCALE,
      inputSamples: finalEntry ? 598 : 600,
      outputSamples: finalEntry ? 299 : 300,
      droppedFinalTrailRIndex: finalEntry ? 597 : 598,
      trailingAUsAfterDroppedFinalTrailR: finalEntry ? 0 : 1,
    }));
    nextByte += size;
    nextTime += duration;
    offset += 12;
  }
  if (offset !== bytes.length || entries.length !== 35) {
    throw new Error('Invalid built-in Dolby segment count');
  }
  return Object.freeze(entries);
}

export var TARGET_DOLBY_120_SEGMENTS = buildTargetSegmentEntries();

function asArray(value) {
  return Array.isArray(value) ? value : (value ? [value] : []);
}

function segmentRange(rep, key) {
  var base = (rep && (rep.SegmentBase || rep.segment_base)) || {};
  return String(base[key]
    || base[key === 'Initialization' ? 'initialization' : 'index_range']
    || '');
}

function representationUrls(rep) {
  var urls = [];
  var primary = rep && (rep.baseUrl || rep.base_url);
  if (primary) urls.push(primary);
  urls = urls.concat(asArray(rep && (rep.backupUrl || rep.backup_url)));
  return urls.filter(Boolean);
}

function urlPathname(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return '';
  }
}

function frameRateNumber(value) {
  if (typeof value === 'string' && value.indexOf('/') > 0) {
    var parts = value.split('/');
    var numerator = Number(parts[0]);
    var denominator = Number(parts[1]);
    return denominator ? numerator / denominator : NaN;
  }
  return Number(value);
}

// Return an ephemeral, non-secret runtime descriptor only for the one source
// whose complete hvcC, sidx, 35 GOPs, RPS chains and Dolby RPUs were audited.
// Signed query strings are deliberately not retained.
export function isTargetDolby120Identity(video, cid, representation) {
  var target = TARGET_DOLBY_120_SOURCE;
  return !!(video && representation
    && (String(video.bvid || '') === target.bvid
      || String(video.aid || '') === target.aid)
    && String(cid || '') === target.cid
    && Number(representation.id) === target.quality);
}

export function createTargetDolby120Session(video, cid, representation) {
  var target = TARGET_DOLBY_120_SOURCE;
  if (!isTargetDolby120Identity(video, cid, representation)
      || String(representation.codecs || '') !== target.codec
      || Number(representation.width) !== target.width
      || Number(representation.height) !== target.height
      || frameRateNumber(representation.frameRate || representation.frame_rate) !== target.frameRate
      || segmentRange(representation, 'Initialization') !== TARGET_INIT_RANGE
      || segmentRange(representation, 'indexRange') !== TARGET_INDEX_RANGE) {
    return null;
  }

  var pathnames = representationUrls(representation)
    .map(urlPathname)
    .filter(Boolean)
    .filter(function unique(value, index, values) {
      return values.indexOf(value) === index;
    });
  if (!pathnames.length) return null;

  return {
    bvid: target.bvid,
    cid: target.cid,
    quality: target.quality,
    pathnames: pathnames,
    initRange: TARGET_INIT_RANGE,
    indexRange: TARGET_INDEX_RANGE,
    timescale: TARGET_DOLBY_120_TIMESCALE,
    lengthSize: TARGET_DOLBY_120_LENGTH_SIZE,
    segmentEntries: TARGET_DOLBY_120_SEGMENTS,
  };
}

export function targetDolbyRequestPathMatches(session, uri) {
  if (!session || !uri) return false;
  var pathname = urlPathname(uri);
  return !!pathname && session.pathnames.indexOf(pathname) >= 0;
}

export function matchTargetDolbyMediaRequest(session, rangeHeader, segment) {
  if (!session || session.segmentEntries !== TARGET_DOLBY_120_SEGMENTS || !segment) {
    return null;
  }
  var startByte = Number(segment.startByte);
  var endByte = Number(segment.endByte);
  var entry = TARGET_DOLBY_120_SEGMENTS.find(function findRange(candidate) {
    return candidate.startByte === startByte && candidate.endByte === endByte;
  });
  if (!entry || String(rangeHeader || '').toLowerCase()
      !== 'bytes=' + entry.startByte + '-' + entry.endByte) {
    return null;
  }
  if (Number.isFinite(segment.startTime)
      && Math.abs(segment.startTime - entry.startTime) > 0.000001) {
    return null;
  }
  // SegmentIndex.fit() overwrites the final reference's endTime with the MPD
  // Period duration.  The immutable byte range, startTime, response size and
  // decoded duration still bind that final response to the audited SIDX entry.
  return entry;
}

export function transformTargetDolbyIndex(input) {
  return validateTargetDolby120IndexSegment(input);
}

export function transformTargetDolbyInit(input) {
  return patchTargetDolby120InitSegment(input);
}

export function transformTargetDolbyMedia(input, session, indexValidated, segmentEntry) {
  if (!session || indexValidated !== true) {
    return {
      status: 'unsupported',
      supported: false,
      changed: false,
      reason: 'target-segment-index-was-not-validated',
      data: input,
    };
  }
  if (session.segmentEntries !== TARGET_DOLBY_120_SEGMENTS
      || TARGET_DOLBY_120_SEGMENTS.indexOf(segmentEntry) < 0
      || !input || input.byteLength !== segmentEntry.inputBytes) {
    return {
      status: 'unsupported',
      supported: false,
      changed: false,
      reason: 'media-response-does-not-match-audited-segment-entry',
      data: input,
    };
  }
  var result = reduceDolby120To60Fragment(input, {
    timescale: session.timescale,
    lengthSize: session.lengthSize,
    closedSegmentBoundaryProven: true,
  });
  if (!result.supported) return result;
  if (result.inputSampleCount !== segmentEntry.inputSamples
      || result.outputSampleCount !== segmentEntry.outputSamples
      || result.trackId !== 1
      || result.baseDecodeTime !== segmentEntry.startTicks
      || result.duration !== segmentEntry.durationTicks
      || result.droppedFinalTrailRIndex !== segmentEntry.droppedFinalTrailRIndex
      || result.trailingAUsAfterDroppedFinalTrailR
        !== segmentEntry.trailingAUsAfterDroppedFinalTrailR
      || result.data.length >= segmentEntry.inputBytes) {
    return {
      status: 'unsupported',
      supported: false,
      changed: false,
      reason: 'reduced-segment-does-not-match-audited-postconditions',
      data: input,
    };
  }
  return result;
}

export function createDolbyTransformFailure(reason, epoch) {
  var safeReason = String(reason || 'unknown-transform-failure').slice(0, 160);
  var error = new Error('Dolby 60fps transform failed: ' + safeReason);
  error.name = 'DolbyTransformError';
  error.dolbyTransformFailure = true;
  error.dolbyTransformReason = safeReason;
  error.dolbyTransformEpoch = Number(epoch) || 0;
  return error;
}

// Shaka wraps a response-filter exception in Error 1007 data[0].  Keep this
// small and cycle-safe so load-time and mid-stream failures share one policy.
export function findDolbyTransformFailure(value) {
  var queue = [value];
  var seen = [];
  for (var depth = 0; queue.length && depth < 16; depth += 1) {
    var item = queue.shift();
    if (!item || (typeof item !== 'object' && typeof item !== 'function')) continue;
    if (seen.indexOf(item) >= 0) continue;
    seen.push(item);
    if (item.dolbyTransformFailure === true) return item;
    if (Array.isArray(item.data)) queue = queue.concat(item.data);
    if (item.cause) queue.push(item.cause);
  }
  return null;
}
