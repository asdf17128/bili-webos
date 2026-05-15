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
    try {
      localStorage.removeItem(PREFIX + key);
    } catch { /* ignore unavailable storage env */ }
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
    return this.get('settings') || {
      danmaku: true,
      quality: 80,
    };
  },

  setSettings(settings) {
    this.set('settings', settings);
  }
};
