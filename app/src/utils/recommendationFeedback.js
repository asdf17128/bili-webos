// Keep only the official web recommendation context. Never infer a target from
// a BV id or reuse the similarly named archive/thumbs-down interaction API.
function positiveId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// Official API reasons are independent of the menu option's display value.
export function isRecommendationFeedbackReason(reason) {
  return reason === 1 || reason === 4;
}

export function recommendationFeedbackContext(video) {
  if (!video || typeof video !== 'object' || video.goto !== 'av') return null;
  if (video.dislike_switch === 0 || video.dislike_switch_pc === 0) return null;
  // A present but invalid primary id must not silently select another target.
  const id = positiveId(video.id == null ? video.aid : video.id);
  const mid = positiveId(video.owner && video.owner.mid);
  const track = video.track_id;
  if (!id || !mid || typeof track !== 'string' || !track.length || track.length > 1024 ||
      track.trim() !== track || /[\u0000-\u001f\u007f]/.test(track)) return null;
  return { goto: 'av', id, mid, track_id: track };
}
