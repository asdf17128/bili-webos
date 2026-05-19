// @ts-nocheck
const PREFIX = 'bili_';
const RESUME_PROGRESS_KEY = 'resume_progress';
const RESUME_END_THRESHOLD_SEC = 3;

function normalizeResumeEntry(entry) {
  if (!entry?.bvid) return null;

  const progress = Math.max(0, Number(entry.progress) || 0);
  const duration = Math.max(0, Number(entry.duration) || 0);
  const cid =
    entry.cid == null || entry.cid === ''
      ? null
      : Number(entry.cid) || entry.cid;

  return {
    bvid: entry.bvid,
    cid,
    progress,
    duration,
    updatedAt: Number(entry.updatedAt) || Date.now(),
  };
}

export const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* ignore quota errors on TV */
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore unavailable storage env */
    }
  },

  // Auth helpers
  getAuth() {
    return this.get('auth') || null;
  },

  setAuth(auth) {
    this.set('auth', auth);
  },

  clearAuth() {
    this.remove('auth');
  },

  getSettings() {
    return (
      this.get('settings') || {
        danmaku: true,
        quality: 80,
      }
    );
  },

  setSettings(settings) {
    this.set('settings', settings);
  },

  getResumeProgressMap() {
    return this.get(RESUME_PROGRESS_KEY) || {};
  },

  getResumeProgress(bvid, cid) {
    if (!bvid) return null;
    const entry = normalizeResumeEntry(this.getResumeProgressMap()?.[bvid]);
    if (!entry) return null;
    if (cid != null && entry.cid != null && String(entry.cid) !== String(cid)) {
      return null;
    }
    return entry;
  },

  setResumeProgress(entry) {
    const normalized = normalizeResumeEntry(entry);
    if (!normalized) return;
    const nextMap = {
      ...this.getResumeProgressMap(),
      [normalized.bvid]: normalized,
    };
    this.set(RESUME_PROGRESS_KEY, nextMap);
  },

  clearResumeProgress(bvid) {
    if (!bvid) return;
    const nextMap = { ...this.getResumeProgressMap() };
    delete nextMap[bvid];
    this.set(RESUME_PROGRESS_KEY, nextMap);
  },

  shouldClearResumeProgress(progress, duration) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    const safeProgress = Math.max(0, Number(progress) || 0);
    if (!safeDuration) return false;
    return safeDuration - safeProgress <= RESUME_END_THRESHOLD_SEC;
  },
};
