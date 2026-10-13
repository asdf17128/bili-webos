// Shaka lifecycle integration for PR #17's source-bound transform. No media
// URL or bytes enter diagnostics; stale or unproven responses fail closed.
import { createDolbyTransformFailure, findDolbyTransformFailure, matchTargetDolbyMediaRequest,
  targetDolbyRequestPathMatches, transformTargetDolbyIndex, transformTargetDolbyInit,
  transformTargetDolbyMedia } from './dolby120Transform.js';

export function createDolbyRuntime() {
  let epoch = 0, state = { phase: 'off' };
  const contexts = new WeakMap();
  const fail = reason => { throw createDolbyTransformFailure(reason, epoch); };
  const unproxy = uri => {
    try { const u = new URL(uri); return u.pathname.startsWith('/proxy/') ? 'https://' + u.pathname.slice(7) + u.search : uri; }
    catch { return uri; }
  };
  const fallback = reason => {
    if (state.phase !== 'playing' || !state.fallback) return false;
    const active = state;
    state.phase = 'fallback-queued'; state.reason = reason;
    Promise.resolve().then(() => { if (state === active) return active.fallback(); }).catch(() => {});
    return true;
  };
  return {
    begin(session) { epoch++; state = { phase: session ? 'loading' : 'off', session, indexValidated: false, fragments: 0 }; return epoch; },
    ready(id, onFallback) {
      if (id !== epoch) fail('stale-transform-load');
      if (!state.session) return;
      if (!state.indexValidated) fail('load-completed-without-validated-index');
      state.phase = 'playing'; state.fallback = onFallback;
    },
    request(type, request, context) {
      if (!state.session || type !== 1 || !context) return;
      const uri = unproxy(request.uris?.[0] || '');
      if (!targetDolbyRequestPathMatches(state.session, uri)) return;
      const headers = request.headers || {};
      const range = String(headers[Object.keys(headers).find(k => k.toLowerCase() === 'range')] || '').toLowerCase();
      let kind, segmentEntry;
      if (!context.stream && range === 'bytes=' + state.session.indexRange) kind = 'index';
      else if (context.stream?.type === 'video' && Number(context.stream.originalId) === state.session.quality) {
        // Shaka AdvancedRequestType: INIT_SEGMENT=0, MEDIA_SEGMENT=1.
        if (context.type === 0 && range === 'bytes=' + state.session.initRange) kind = 'init';
        else if (context.type === 1) {
          segmentEntry = matchTargetDolbyMediaRequest(state.session, range, context.segment);
          if (segmentEntry) kind = 'media';
        }
      }
      if (kind) contexts.set(context, { epoch, kind, segmentEntry });
    },
    response(type, response, context) {
      const marker = context && contexts.get(context);
      if (!marker) {
        if (state.session && type === 1 && context?.stream?.type === 'video'
            && Number(context.stream.originalId) === state.session.quality) fail('unbound-target-video-response');
        return;
      }
      if (marker.epoch !== epoch || !state.session) throw createDolbyTransformFailure('stale-transform-response', marker.epoch);
      if (marker.kind === 'index') {
        const result = transformTargetDolbyIndex(response.data);
        if (!result.supported) fail(result.reason);
        state.indexValidated = true;
        return;
      }
      if (!state.indexValidated) fail('target-segment-index-was-not-validated');
      const result = marker.kind === 'init' ? transformTargetDolbyInit(response.data)
        : transformTargetDolbyMedia(response.data, state.session, true, marker.segmentEntry);
      if (!result.supported || (marker.kind === 'media' && result.status !== 'reduced')) fail(result.reason);
      const bytes = result.data;
      response.data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      if (marker.kind === 'media') state.fragments++;
    },
    handleError(error) {
      const transformError = findDolbyTransformFailure(error);
      if (transformError) {
        if (transformError.dolbyTransformEpoch === epoch) fallback(transformError.dolbyTransformReason);
        return true; // load-time rejection is handled by loadDash, never retry raw bytes.
      }
      return error?.category === 3 && fallback('transformed-media-error-' + error.code);
    },
    stalled() { return fallback('transformed-playback-stalled'); },
    snapshot() { return { epoch, phase: state.phase, indexValidated: !!state.indexValidated, fragments: state.fragments || 0, reason: state.reason }; },
  };
}
