export const DOLBY_QN = 126;
const TV_PROXY_BASE = 'http://127.0.0.1:7654';
const MAX_DOLBY_INIT_BYTES = 1024 * 1024;

function asArray(value) {
  if (Array.isArray(value)) return value.slice();
  return value ? [value] : [];
}

function representationUrl(rep) {
  return rep && (rep.baseUrl || rep.base_url);
}

function rangeValue(rep, key) {
  const segmentBase = (rep && (rep.SegmentBase || rep.segment_base)) || {};
  return segmentBase[key]
    || segmentBase[key === 'Initialization' ? 'initialization' : 'index_range']
    || '';
}

function pickHighestBandwidth(representations) {
  if (!representations.length) return null;
  return representations.reduce((best, rep) => (
    (Number(rep.bandwidth) || 0) > (Number(best.bandwidth) || 0) ? rep : best
  ));
}

export function mediaTypeFor(rep) {
  if (!rep || !rep.codecs) return '';
  const mimeType = rep.mimeType || rep.mime_type || 'audio/mp4';
  return `${mimeType}; codecs="${rep.codecs}"`;
}

function canPlay(rep, isTypeSupported) {
  if (!representationUrl(rep)) return false;
  const mediaType = mediaTypeFor(rep);
  if (!mediaType || typeof isTypeSupported !== 'function') return true;
  try {
    return !!isTypeSupported(mediaType);
  } catch {
    return false;
  }
}

// Select one exact video quality. Manual quality changes use strict selection
// so the UI can never say "4K" while a lower representation is playing.
// Automatic startup fallback may opt into the next available lower qn.
export function selectVideoRepresentation(dash, requestedQn, options = {}) {
  const videos = asArray(dash && dash.video).filter(representationUrl);
  if (!videos.length) return { representation: null, actualQn: null, exact: false };

  const requested = Number(requestedQn);
  let pool = Number.isFinite(requested)
    ? videos.filter(rep => Number(rep.id) === requested)
    : [];
  let exact = pool.length > 0;

  if (!pool.length && options.allowFallback) {
    const ids = Array.from(new Set(videos.map(rep => Number(rep.id)).filter(Number.isFinite)))
      .sort((a, b) => b - a);
    const fallbackQn = Number.isFinite(requested)
      ? (ids.find(id => id <= requested) ?? ids[0])
      : ids[0];
    pool = videos.filter(rep => Number(rep.id) === fallbackQn);
    exact = false;
  }

  const representation = pickHighestBandwidth(pool);
  return {
    representation,
    actualQn: representation ? Number(representation.id) : null,
    exact,
  };
}

// Audio is independent from video quality: switching Dolby Vision to SDR 4K
// must not silently throw away an available Atmos or Hi-Res track.
export function listPreferredAudio(dash, isTypeSupported, options = {}) {
  const dolby = asArray(dash && dash.dolby && dash.dolby.audio)
    .filter(rep => /^(ec-3|eac3)$/i.test(rep && rep.codecs || ''))
    .sort((a, b) => (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0));
  const flac = asArray(dash && dash.flac && dash.flac.audio)
    .filter(rep => /^flac$/i.test(rep && rep.codecs || ''))
    .sort((a, b) => (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0));
  const standard = asArray(dash && dash.audio)
    .sort((a, b) => (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0));

  const excluded = new Set(asArray(options.excludeKinds));
  const groups = [
    { kind: 'dolby', label: 'Dolby E-AC-3', representations: dolby },
    { kind: 'hires', label: 'Hi-Res FLAC', representations: flac },
    { kind: 'standard', label: 'AAC', representations: standard },
  ].filter(group => !excluded.has(group.kind));

  const candidates = [];
  for (const group of groups) {
    const representation = group.representations.find(rep => canPlay(rep, isTypeSupported));
    if (representation) {
      candidates.push({
        representation,
        kind: group.kind,
        codec: representation.codecs || '',
        label: group.label,
      });
    }
  }
  return candidates;
}

export function selectPreferredAudio(dash, isTypeSupported, options = {}) {
  const candidates = listPreferredAudio(dash, isTypeSupported, options);
  return candidates[0] || { representation: null, kind: 'none', codec: '', label: '' };
}

export function hasAudioRepresentations(dash) {
  const sources = []
    .concat(asArray(dash && dash.dolby && dash.dolby.audio))
    .concat(asArray(dash && dash.flac && dash.flac.audio))
    .concat(asArray(dash && dash.audio));
  return sources.some(representationUrl);
}

// One failed load cannot reliably tell whether the video or audio decoder was
// responsible. Try each genuinely supported premium audio kind in order, then
// AAC. For Dolby Vision, repeat that sequence once with the original hvc1/hev1
// signaling so the same qn126 base layer remains available as a last resort.
export function createPlaybackAttemptPlan(audioCandidates, dolbyCodec, options = {}) {
  const audio = asArray(audioCandidates);
  if (!audio.length && options.allowVideoOnly) {
    audio.push({ representation: null, kind: 'none', codec: '', label: '' });
  }
  const signaling = dolbyCodec ? [dolbyCodec, null] : [null];
  const attempts = [];
  for (const codec of signaling) {
    for (const candidate of audio) {
      attempts.push({
        audioRepresentation: candidate.representation,
        audioKind: candidate.kind,
        audioCodec: candidate.codec,
        audioLabel: candidate.label,
        dolbyCodec: codec,
      });
    }
  }
  return attempts;
}

export function proxyMediaUrl(url, proxyBase = TV_PROXY_BASE) {
  const absolute = String(url || '').startsWith('//') ? `https:${url}` : String(url || '');
  const parsed = new URL(absolute);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported media URL protocol');
  }
  return `${proxyBase}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
}

function findAscii(bytes, text, start = 0, end = bytes.length) {
  outer: for (let i = Math.max(0, start); i <= Math.min(bytes.length, end) - text.length; i++) {
    for (let j = 0; j < text.length; j++) {
      if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

function nearestSampleEntry(bytes, configOffset) {
  const entries = ['dvh1', 'dvhe', 'hvc1', 'hev1'];
  let best = { value: null, offset: -1 };
  entries.forEach((entry) => {
    let from = Math.max(0, configOffset - 1024);
    let hit = findAscii(bytes, entry, from, configOffset);
    while (hit >= 0 && hit < configOffset) {
      if (hit > best.offset) best = { value: entry, offset: hit };
      from = hit + 4;
      hit = findAscii(bytes, entry, from, configOffset);
    }
  });
  return best;
}

function readUint32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function findDolbyConfigBox(bytes) {
  const candidates = [];
  for (const type of ['dvcC', 'dvvC', 'dvwC']) {
    let from = 0;
    let hit = findAscii(bytes, type, from);
    while (hit >= 0) {
      candidates.push({ type, typeOffset: hit });
      from = hit + type.length;
      hit = findAscii(bytes, type, from);
    }
  }
  candidates.sort((a, b) => a.typeOffset - b.typeOffset);

  for (const candidate of candidates) {
    const boxStart = candidate.typeOffset - 4;
    const boxSize = readUint32(bytes, boxStart);
    // Dolby configuration boxes use an ordinary 32-bit size. Reject ASCII
    // lookalikes, extended-size boxes and truncated records rather than
    // deriving a codec from unrelated payload bytes.
    if (boxSize == null || boxSize === 0 || boxSize === 1 || boxSize < 13) continue;
    const boxEnd = boxStart + boxSize;
    if (boxEnd > bytes.length || candidate.typeOffset + 9 > boxEnd) continue;
    return { ...candidate, boxStart, boxEnd };
  }
  return null;
}

export function parseDolbyConfig(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const boxInfo = findDolbyConfigBox(bytes);
  if (!boxInfo) return null;
  const box = boxInfo.type;
  const boxOffset = boxInfo.typeOffset;

  const record = boxOffset + 4;
  const profileLevelA = bytes[record + 2];
  const flags = bytes[record + 3];
  const sample = nearestSampleEntry(bytes, boxOffset);
  const profile = profileLevelA >> 1;
  const level = ((profileLevelA & 1) << 5) | (flags >> 3);
  const prefix = sample.value === 'hev1' || sample.value === 'dvhe' || box === 'dvcC'
    ? 'dvhe'
    : 'dvh1';

  return {
    box,
    boxOffset,
    sampleEntry: sample.value,
    sampleEntryOffset: sample.offset,
    versionMajor: bytes[record],
    versionMinor: bytes[record + 1],
    profile,
    level,
    rpuPresent: !!((flags >> 2) & 1),
    enhancementLayerPresent: !!((flags >> 1) & 1),
    baseLayerPresent: !!(flags & 1),
    compatibilityId: (bytes[record + 4] >> 4) & 0x0f,
    codec: `${prefix}.${String(profile).padStart(2, '0')}.${String(level).padStart(2, '0')}`,
  };
}

export async function inspectDolbyRepresentation(rep, proxyBase = TV_PROXY_BASE) {
  const url = representationUrl(rep);
  const initialization = rangeValue(rep, 'Initialization');
  if (!url || !initialization) return null;
  const rangeMatch = /^(\d+)-(\d+)$/.exec(String(initialization));
  if (!rangeMatch) throw new Error('Invalid Dolby init range');
  const rangeStart = Number(rangeMatch[1]);
  const rangeEnd = Number(rangeMatch[2]);
  const expectedBytes = rangeEnd - rangeStart + 1;
  if (!Number.isSafeInteger(rangeStart)
      || !Number.isSafeInteger(rangeEnd)
      || rangeStart < 0
      || rangeEnd < rangeStart
      || expectedBytes > MAX_DOLBY_INIT_BYTES) {
    throw new Error('Unsafe Dolby init range');
  }
  const response = await fetch(proxyMediaUrl(url, proxyBase), {
    headers: { Range: `bytes=${initialization}` },
  });
  // Never read a 200 response: a CDN that ignored Range may be returning the
  // complete media object, which can be hundreds of megabytes on a TV.
  if (response.status !== 206) {
    throw new Error(`Dolby init probe requires HTTP 206 (got ${response.status})`);
  }
  const contentLength = Number(response.headers && response.headers.get('content-length'));
  if (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes) {
    throw new Error('Dolby init probe length mismatch');
  }
  const data = await response.arrayBuffer();
  if (data.byteLength !== expectedBytes) {
    throw new Error('Dolby init probe body length mismatch');
  }
  const info = parseDolbyConfig(data);
  if (!info) return null;
  return {
    ...info,
    apiCodec: rep.codecs || '',
    width: rep.width || 0,
    height: rep.height || 0,
    frameRate: rep.frameRate || rep.frame_rate || '',
  };
}
