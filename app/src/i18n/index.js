// Tiny i18n for a 10-foot app. Design (docs/DEVELOPMENT.md, #14):
// - Chinese source strings ARE the keys: t('弹幕'). zh needs no dictionary;
//   a missing translation falls back to the visible Chinese string (greppable,
//   and the coverage gate tools/test-i18n-coverage.mjs fails the build on it).
// - No library, no reactivity: switching language persists the setting and
//   reloads the app (standard TV settings UX). Zero re-render machinery.
// - ADDING A LANGUAGE = add src/i18n/<code>.js + one line in DICTS below.
//   Nothing else changes anywhere.
import { storage } from '../utils/storage.js';
import en from './en.js';
import es from './es.js';

const DICTS = {
  en: en,
  es: es,
  // ← future languages register here (one import + one line)
};

// Map browser/system locale to a dictionary code. Region variants collapse to
// their base language ('en-US' → 'en'); Chinese in any variant → source strings.
function detectLocale() {
  const pref = storage.getSettings().language || 'auto';
  if (pref !== 'auto') return pref;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'zh';
  const base = nav.toLowerCase().split('-')[0];
  return DICTS[base] ? base : 'zh';
}

// Resolved ONCE at module load — language changes go through setLanguage(),
// which reloads the app. Keeps t() a pure dictionary lookup (hot path: it runs
// in every render of every page).
let locale = detectLocale();
let dict = DICTS[locale] || null;

export function getLocale() { return locale; }

// Languages offered in 设置 → 语言. 'auto' resolves via system locale.
export function availableLanguages() {
  return ['auto', 'zh'].concat(Object.keys(DICTS));
}

export function setLanguage(lang) {
  storage.setSettings({ ...storage.getSettings(), language: lang });
  // Full reload: cheapest correct way to re-render every mounted page (pages
  // stay mounted behind the player by design, so in-place switching would
  // need app-wide reactivity we deliberately don't have).
  window.location.reload();
}

// t('弹幕') / t('已是最新 (v{v})', {v: '1.3.0'})
export function t(zh, vars) {
  let s = (dict && dict[zh]) || zh;
  if (vars) {
    for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  }
  return s;
}
