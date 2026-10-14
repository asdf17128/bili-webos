// Legacy settings always saved the default 1080p, so an unmarked 80 cannot
// distinguish a user choice from the old default. Explicit new choices win.
const VALID = [6, 16, 32, 64, 74, 80, 100, 112, 116, 120, 125, 126, 127];
export function qualityPreference(settings = {}) {
  const qn = Number(settings.quality);
  if (settings.quality === 'auto' || settings.qualityMode === 'auto') return 'auto';
  if (!VALID.includes(qn)) return 'auto';
  if (qn === 80 && settings.qualityMode !== 'manual') return 'auto';
  return qn;
}
export function requestedQuality(preference) {
  return preference === 'auto' ? 127 : Number(preference);
}
