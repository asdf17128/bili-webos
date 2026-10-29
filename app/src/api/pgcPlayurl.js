// PGC v2 nests the media ladder in video_info. Keep the top-level API code
// and envelope fields so a missing ladder never hides a refusal/challenge.
export function normalizePgcPlayurl(response) {
  if (!response || typeof response !== 'object') return response;
  const key = response.result ? 'result' : 'data';
  const envelope = response[key];
  if (!envelope?.video_info || typeof envelope.video_info !== 'object' || Array.isArray(envelope.video_info)) return response;
  return { ...response, [key]: { ...envelope, ...envelope.video_info } };
}
