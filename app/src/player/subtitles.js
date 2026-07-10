// Subtitle (CC) pure helpers — kept free of DOM/React so tools/test-subtitle.mjs
// can run them in plain Node (release-gate C-SUB-01).

// B站 AI-generated tracks (lan 'ai-zh', 'ai-en'…) run noticeably late relative
// to speech — the ASR stamps a line when it FINISHES hearing it. Showing those
// cues slightly early reads as "in sync" from the couch. Human tracks get 0.
export const AI_LEAD = 0.35; // seconds

export function isAiLan(lan) {
  return typeof lan === 'string' && lan.indexOf('ai-') === 0;
}

// player/v2 subtitle body → sorted cue list [{from, to, text}].
// Tolerates missing/garbage entries and unsorted input (the API contract is
// informal; ai_subtitle bodies have shipped with 0-length and overlapping cues).
export function parseSubtitleBody(json) {
  const body = json && Array.isArray(json.body) ? json.body : [];
  const cues = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (!c || typeof c.content !== 'string' || c.content === '') continue;
    const from = Number(c.from);
    const to = Number(c.to);
    if (!isFinite(from) || !isFinite(to) || to <= from) continue;
    cues.push({ from: from, to: to, text: c.content });
  }
  cues.sort((a, b) => a.from - b.from);
  return cues;
}

// Active cue index at time t (seconds), or -1. Binary search on `from`, then a
// short backward walk to cover overlapping cues — O(log n) per call, cheap
// enough to run every rAF tick on TV silicon.
export function pickCueIndex(cues, t) {
  if (!cues || cues.length === 0) return -1;
  let lo = 0, hi = cues.length - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].from <= t) { last = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  // Walk back a little: an overlapping earlier cue may still be live.
  for (let i = last; i >= 0 && i > last - 4; i--) {
    if (cues[i].from <= t && t < cues[i].to) return i;
  }
  return -1;
}
