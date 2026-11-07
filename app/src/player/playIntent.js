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

// History stores whole seconds, while media duration may include a fraction.
// Only a completed position restarts; an unfinished short clip or its last
// few seconds must still resume. Use the selected part's duration, not the BV
// total or the duration of the initially requested part.
export function resumePosition(progress, duration) {
  const position = Number(progress), total = Number(duration);
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (Number.isFinite(total) && total > 0 && position >= (total >= 1 ? Math.floor(total) : total)) return 0;
  return position;
}

// Back-compat funnel guard: anything that reaches the player without an
// explicit intent (pages pass bare feed items; history rows pass progress).
export function normalizePlay(item) {
  if (!item) return item;
  // B站 history uses -1 for watched to the end. Keep this exact part/episode,
  // and do not turn the completed row into another server resume lookup.
  if (Number(item.progress) === -1) return playPart(item);
  if (item.resumeMode) return item;
  if (item.progress > 0) return playAt(item, item.progress);
  return playFresh(item);
}
