// Persistent storage for auth tokens and settings
const PREFIX = 'bili_';

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
    } catch { /* ignore quota errors on TV */ }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
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

  getProxyUrl() {
    return this.get('proxyUrl') || 'http://192.168.50.242:9527';
  },

  setProxyUrl(url) {
    this.set('proxyUrl', url);
  },

  getSettings() {
    // Merge stored settings over the defaults so newly-added keys always have a
    // value even for users who saved settings before the key existed.
    const defaults = {
      // Default CHINESE (owner decision 2026-07-11): the audience is bilibili
      // users — a zh UI on an en-US system TV is less surprising than the
      // reverse. 'auto' (follow system) stays available in 设置 → 语言.
      language: 'zh',
      danmaku: true,
      quality: 80,
      gridCols: 3,
      // Danmaku font scale (#11: the danmaku text was a bit small on 42").
      danmakuScale: 1,
      // CC subtitles default off (B站 web default); the player button persists it.
      subtitle: false,
      subtitleScale: 1,
      // Video CDN route (#10): 'auto' keeps B站's own ordering (origin-first,
      // PCDN last); a named route forces that mirror host for stability.
      cdnRoute: 'auto',
    };
    return { ...defaults, ...(this.get('settings') || {}) };
  },

  setSettings(settings) {
    this.set('settings', settings);
  },

  // Local watch-progress map (bvid → [seconds, duration, ts]) so EVERY list's
  // cards can draw the resume bar — the server history API only annotates its
  // own rows. Written by the player, read per card render (parsed once, cached).
  _progressCache: null,
  getProgressMap() {
    if (!this._progressCache) this._progressCache = this.get('progress') || {};
    return this._progressCache;
  },
  getProgress(bvid) {
    if (!bvid) return null;
    const e = this.getProgressMap()[bvid];
    return e && e[1] > 0 ? { progress: e[0], duration: e[1] } : null;
  },
  setProgress(bvid, progress, duration) {
    if (!bvid || !(duration > 0) || !(progress >= 0)) return;
    const m = this.getProgressMap();
    m[bvid] = [Math.floor(progress), Math.floor(duration), Date.now()];
    const keys = Object.keys(m);
    if (keys.length > 300) {
      keys.sort((a, b) => (m[a][2] || 0) - (m[b][2] || 0));
      for (let i = 0; i < keys.length - 300; i++) delete m[keys[i]];
    }
    this.set('progress', m);
  },
  // Cards subscribe so their resume bars refresh the moment the player exits —
  // pages stay mounted and cards are memo()'d, so nothing else re-renders them.
  _progressSubs: new Set(),
  onProgressChange(fn) {
    this._progressSubs.add(fn);
    return () => this._progressSubs.delete(fn);
  },
  notifyProgressChange() {
    this._progressSubs.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
  },

  // Search history (most-recent-first, deduped). Remote-control typing is the
  // most painful TV interaction, so a one-tap "search it again" list matters.
  getSearchHistory() {
    return this.get('searchHistory') || [];
  },
  addSearchHistory(term) {
    var q = (term || '').trim();
    if (!q) return;
    var list = this.getSearchHistory().filter(function (x) { return x !== q; });
    list.unshift(q);
    if (list.length > 12) list = list.slice(0, 12);
    this.set('searchHistory', list);
  },
  removeSearchHistory(term) {
    this.set('searchHistory', this.getSearchHistory().filter(function (x) { return x !== term; }));
  },
  clearSearchHistory() {
    this.remove('searchHistory');
  },

  // Locally-tracked recently watched live rooms (B站's history API doesn't
  // record live viewing without its obfuscated heartbeat, so we keep our own).
  getRecentLive() {
    return this.get('recentLive') || [];
  },

  addRecentLive(room) {
    if (!room || !room.roomid) return;
    let list = this.getRecentLive().filter(r => r.roomid !== room.roomid);
    list.unshift({
      roomid: room.roomid,
      title: room.title || '',
      cover: room.cover || room.pic || '',
      uname: room.uname || (room.owner && room.owner.name) || '',
      ts: Math.floor(Date.now() / 1000), // for time-ordering against video history
    });
    if (list.length > 8) list = list.slice(0, 8);
    this.set('recentLive', list);
  }
};

// Test hook (like window.__openVideo): lets the CDP/Playwright harness drive
// the REAL storage paths (incl. in-memory caches + subscriptions) instead of
// poking localStorage underneath them.
if (typeof window !== 'undefined') window.__appStorage = storage;
