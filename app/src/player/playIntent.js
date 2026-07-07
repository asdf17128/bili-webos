// Single source of truth for HOW a playback starts (the 续播 policy).
// Every path that starts a video goes through one of these constructors, and
// PlayerPage consumes ONLY `resumeMode` — it never guesses from cid/progress.
// (The old heuristic "no cid on the item ⇒ ok to resume" silently disabled
// resume for every feed/favorites card, because those items carry a cid.)
//
// resumeMode:
//   'auto' — casual open (clicking a card anywhere): look up B站 last-play
//            (part + offset, /x/player/v2) and continue where the user left off
//   'at'   — explicit position (history row, cast): start at `progress` seconds
//   'none' — explicit part choice (选集) or auto-advance (连播): start at 0

export function playFresh(item) {
  return { ...item, resumeMode: 'auto' };
}

export function playAt(item, seconds) {
  return { ...item, resumeMode: 'at', progress: Math.max(0, seconds || 0) };
}

// 选集: the user picked THIS part — never jump to another part or offset.
export function playPart(item) {
  return { ...item, resumeMode: 'none', progress: 0 };
}

// 连播 auto-advance (favorites order-play, 分P/合集, error-skip): binge from 0.
export function playAdvance(item) {
  return { ...item, resumeMode: 'none', progress: 0 };
}

// Back-compat funnel guard: anything that reaches the player without an
// explicit intent (pages pass bare feed items; history rows pass progress).
export function normalizePlay(item) {
  if (!item || item.resumeMode) return item;
  if (item.progress > 0) return playAt(item, item.progress);
  return playFresh(item);
}
