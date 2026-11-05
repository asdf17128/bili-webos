// Shared by recorded video, live overlay and the settings preview.
export const DANMAKU_FIELDS = [
  ['danmakuScale', '弹幕字号', [0.8, 1, 1.3, 1.6], ['小', '标准', '大', '特大'], 1],
  ['danmakuOpacity', '弹幕不透明度', [0.25, 0.5, 0.75, 1], ['25%', '50%', '75%', '100%'], 1],
  ['danmakuWeight', '弹幕粗细', [400, 600, 700], ['常规', '中等', '加粗'], 600],
  ['danmakuOutline', '弹幕描边', [0, 1, 2], ['关', '标准', '加粗'], 1],
  ['danmakuArea', '弹幕显示区域', [0.25, 0.5, 0.75, 1], ['顶部四分之一', '顶部半屏', '顶部四分之三', '全屏'], 1],
  ['danmakuDensity', '弹幕密度', [12, 24, 48], ['稀疏', '标准', '密集'], 24],
  ['danmakuSpeed', '弹幕速度', [0.75, 1, 1.5], ['慢', '标准', '快'], 1],
  ['danmakuScroll', '滚动弹幕', [false, true], ['关', '开'], true],
  ['danmakuTop', '顶部固定弹幕', [false, true], ['关', '开'], true],
  ['danmakuBottom', '底部固定弹幕', [false, true], ['关', '开'], true],
  ['danmakuColor', '彩色弹幕', [false, true], ['关', '开'], true],
];
export function normalizeDanmaku(settings = {}) {
  const out = {};
  DANMAKU_FIELDS.forEach(([key, , values, , fallback]) => {
    out[key] = values.indexOf(settings[key]) >= 0 ? settings[key] : fallback;
  });
  return out;
}

let canvas;
const measurements = new Map();
export function danmakuLaneHeight(settings) {
  const s = normalizeDanmaku(settings);
  // Reserve the largest supported source glyph, line box and outline so a
  // later large comment cannot collide with a smaller one on the next lane.
  const minimum = Math.ceil(36 * s.danmakuScale * 1.25) + 2 * s.danmakuOutline + 8;
  return Math.ceil(minimum * (s.danmakuDensity === 12 ? 1.6 : s.danmakuDensity === 48 ? 1 : 1.25));
}
export function danmakuMeasureStats() { return { cached: measurements.size, limit: 512 }; }
function measure(text, font) {
  const key = font + ':' + text;
  if (measurements.has(key)) return measurements.get(key);
  canvas = canvas || document.createElement('canvas');
  const ctx = canvas.getContext('2d'); ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 12;
  if (measurements.size >= 512) measurements.delete(measurements.keys().next().value);
  measurements.set(key, width);
  return width;
}
export function appendDanmaku(container, lanes, dm, text, now, settings) {
  const s = normalizeDanmaku(settings);
  const mode = dm.mode === undefined ? 1 : dm.mode;
  const moving = mode === 1 || mode === 2 || mode === 3 || mode === 6;
  if (!(moving ? s.danmakuScroll : mode === 5 ? s.danmakuTop : mode === 4 ? s.danmakuBottom : false)) return false;
  const color = /^#[0-9a-f]{6}$/i.test(dm.color || '') ? dm.color : '#ffffff';
  if (!s.danmakuColor && color.toLowerCase() !== '#ffffff') return false;
  if (container.childElementCount >= s.danmakuDensity) return false;
  const height = danmakuLaneHeight(s);
  const count = Math.max(1, Math.floor((1020 * s.danmakuArea - 24) / height));
  // Clamp source sizes so huge/malformed comments cannot cover adjacent lanes.
  const size = Math.round(Math.max(16, Math.min(36, dm.size || 28)) * s.danmakuScale);
  const safeText = String(text).slice(0, 200);
  const width = measure(safeText, `${s.danmakuWeight} ${size}px sans-serif`);
  const velocity = 240 * s.danmakuSpeed;
  const duration = moving ? (1920 + width) / velocity : 4 / s.danmakuSpeed;
  const kind = moving ? (mode === 6 ? 'reverse' : 'scroll') : 'fixed';
  let track = -1;
  for (let n = 0; n < count; n++) {
    const i = mode === 4 ? count - n - 1 : n;
    const lane = lanes[i];
    if (!lane || lane.end <= now || (moving && lane.kind === kind && lane.free <= now)) { track = i; break; }
  }
  if (track < 0) return false;
  const prior = lanes[track];
  lanes[track] = {kind, free: now + (width + 64) / velocity, end: Math.max(prior?.end || 0, now + duration)};
  const el = document.createElement('div');
  el.className = 'danmaku-item' + (moving ? (mode === 6 ? ' danmaku-reverse' : '') : ' danmaku-fixed');
  el.textContent = safeText;
  el.style.top = `${track * height + 12}px`;
  el.style.color = color;
  el.style.fontSize = `${size}px`;
  el.style.lineHeight = '1.25';
  el.style.fontFamily = 'sans-serif';
  el.style.fontWeight = String(s.danmakuWeight);
  el.style.opacity = String(s.danmakuOpacity);
  el.style.textShadow = s.danmakuOutline === 0 ? 'none' : `${s.danmakuOutline}px ${s.danmakuOutline}px 1px #000, -${s.danmakuOutline}px -${s.danmakuOutline}px 1px #000, ${s.danmakuOutline}px -${s.danmakuOutline}px 1px #000, -${s.danmakuOutline}px ${s.danmakuOutline}px 1px #000`;
  el.style.animationDuration = duration + 's';
  if (!moving) { el.style.maxWidth = '1880px'; el.style.overflow = 'hidden'; el.style.textOverflow = 'ellipsis'; }
  container.appendChild(el);
  return true;
}
