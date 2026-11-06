// 弹幕屏占比 (issue #66): the share of the screen height danmaku may use,
// counted from the top. 1 keeps the historical layout exactly.
export const DANMAKU_AREAS = [1, 0.75, 0.5, 0.25];

export function normalizeDanmakuArea(value) {
  const n = Number(value);
  return DANMAKU_AREAS.includes(n) ? n : 1;
}

// trackHeight is already scaled by the danmaku font size. The full layout keeps
// at least 6 tracks; a restricted area keeps at least 2 so something still shows.
export function danmakuTrackCount(trackHeight, area = 1) {
  const full = Math.max(6, Math.floor(1000 / trackHeight));
  return Math.max(2, Math.round(full * normalizeDanmakuArea(area)));
}

// 弹幕透明度 (issue #66): 1 = opaque (the historical look).
export const DANMAKU_OPACITIES = [1, 0.8, 0.6, 0.4];

export function normalizeDanmakuOpacity(value) {
  const n = Number(value);
  return DANMAKU_OPACITIES.includes(n) ? n : 1;
}
