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
      danmaku: true,
      quality: 80,
      gridCols: 3,
      // Pointer (Magic Remote) hover moving the focus caused the cursor drifting
      // over the sidebar/cards to switch pages and rapidly paginate (#11). Off by
      // default; D-pad and pointer *click* still select.
      pointerFocus: false,
    };
    return { ...defaults, ...(this.get('settings') || {}) };
  },

  setSettings(settings) {
    this.set('settings', settings);
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
    });
    if (list.length > 8) list = list.slice(0, 8);
    this.set('recentLive', list);
  }
};
