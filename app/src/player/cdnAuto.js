import { AUTO_MIRRORS, CDN_ROUTES, addMirrors, cdnHostOf, isBanned, isPcdnUrl, nativeCdnUrls, testBadCdnEnabled, TEST_BAD_HOST } from './cdn.js';
import { probeRange } from './cdnProbe.js';

export const HEALTH_KEY = 'bili_cdn_health_v1';
const GOOD_TTL = 4 * 60 * 60 * 1000, BAD_TTL = 15 * 60 * 1000;
const VERIFY_AFTER = 15 * 60 * 1000, BYTES = 256 * 1024;
const validHealthHost = host => /^(?:[a-z0-9-]+\.)+(?:bilivideo\.(?:com|cn)|akamaized\.net)$/.test(host);
let lastStatus = null;
export const getAutoCdnStatus = () => lastStatus;
if (typeof window !== 'undefined') window.__cdnAuto = getAutoCdnStatus;

// Persist only bounded host-level measurements, never media paths or signatures.
export function createCdnHealthStore(storage, now = Date.now) {
  let entries = {};
  try {
    const data = JSON.parse(storage?.getItem(HEALTH_KEY) || 'null');
    if (data?.version === 1) for (const host of Object.keys(data.entries || {}).slice(0, 32)) {
      const r = data.entries[host];
      if (validHealthHost(host) && typeof r.ok === 'boolean' && Number.isFinite(r.at) && r.at <= now() &&
          (!r.ok || (Number.isFinite(r.rateMbps) && r.rateMbps > 0))) {
        entries[host] = { ok: r.ok, at: r.at, rateMbps: r.ok ? r.rateMbps : 0 };
      }
    }
  } catch { /* private mode, invalid or old cache */ }
  const save = () => { try { storage?.setItem(HEALTH_KEY, JSON.stringify({ version: 1, entries })); } catch { /* quota */ } };
  return {
    get(host) {
      const r = entries[host];
      return r && now() >= r.at && now() - r.at < (r.ok ? GOOD_TTL : BAD_TTL) ? r : null;
    },
    put(host, r) {
      if (!validHealthHost(host)) return;
      entries[host] = { ok: !!r.ok, at: now(), rateMbps: r.ok ? r.rateMbps : 0 };
      const keys = Object.keys(entries).sort((a, b) => entries[b].at - entries[a].at);
      keys.slice(32).forEach(key => delete entries[key]); save();
    },
    clear() { entries = {}; save(); },
  };
}

let defaultStore;
function healthStore() {
  if (!defaultStore) {
    let disk;
    try { disk = window.localStorage; } catch { /* unavailable */ }
    defaultStore = createCdnHealthStore(disk);
  }
  return defaultStore;
}

export function rankCdnUrls(urls, health, preferred = '') {
  const good = urls.filter(u => !isBanned(cdnHostOf(u)) && health.get(cdnHostOf(u))?.ok);
  if (!good.length) return urls.slice(); // No evidence: retain the complete fallback list.
  let best = good[0];
  for (const u of good) {
    if (health.get(cdnHostOf(u)).rateMbps > health.get(cdnHostOf(best)).rateMbps) best = u;
  }
  const incumbent = good.find(u => cdnHostOf(u) === preferred) || good[0];
  if (health.get(cdnHostOf(incumbent)).rateMbps * 1.15 >= health.get(cdnHostOf(best)).rateMbps) best = incumbent;
  const rest = urls.filter(u => u !== best);
  // Retain native signed URLs; demote measured failures without deleting them.
  const failed = u => isBanned(cdnHostOf(u)) || health.get(cdnHostOf(u))?.ok === false;
  return [best, ...rest.filter(u => !failed(u)), ...rest.filter(failed)];
}

export function createAutoCdnRouter({ getRoute, canProbe, proxyBase, onUpdate = () => {},
  health = healthStore(), probe = probeRange, now = Date.now, intervalMs = 1000 }) {
  let candidates = [], preferred = '', generation = 0, running = false, disposed = false;
  const active = new Set();
  const automatic = () => !CDN_ROUTES[getRoute()]; // Includes legacy 'akam' -> auto.
  const publish = state => {
    lastStatus = { state, preferred, candidates: candidates.map(u => {
      const host = cdnHostOf(u), r = health.get(host);
      return { host, ok: r ? r.ok : null, rateMbps: r?.rateMbps || 0, ageMs: r ? now() - r.at : null };
    }) };
    onUpdate(lastStatus);
  };
  const cancel = () => { generation++; active.forEach(xhr => xhr.abort()); active.clear(); };
  const toProxy = u => {
    const x = new URL(u);
    return `${proxyBase()}/proxy/${x.host}${x.pathname}${x.search}`;
  };
  async function tick() {
    if (disposed || !candidates.length) return;
    if (!automatic() || !canProbe()) {
      if (running) cancel();
      publish(automatic() ? 'waiting' : 'manual'); return;
    }
    if (running) return;
    // At most one pair at a time. Every candidate gets a turn; no first-six bias.
    const target = candidates.find(u => !isBanned(cdnHostOf(u)) && !health.get(cdnHostOf(u))) ||
      candidates.find(u => cdnHostOf(u) === preferred && health.get(preferred)?.ok && now() - health.get(preferred).at >= VERIFY_AFTER);
    if (!target) { publish('ready'); return; }
    running = true;
    const id = generation, host = cdnHostOf(target);
    publish('testing');
    const valid = () => !disposed && id === generation && automatic() && canProbe();
    try {
      const first = await probe(toProxy(target), 0, BYTES - 1, { active, timeoutMs: 4000 });
      if (!valid()) return;
      if (first.timedOut || !first.bytes || !first.total) throw new Error('Incomplete CDN sample');
      const start = Math.max(0, Math.min(Math.floor(first.total / 2), first.total - BYTES));
      const second = await probe(toProxy(target), start, Math.min(start + BYTES, first.total) - 1, { active, timeoutMs: 4000 });
      if (!valid()) return;
      if (second.timedOut || !second.bytes || second.total !== first.total) throw new Error('Incomplete CDN sample');
      const rateMbps = Math.min(first.bytes / Math.max(1, first.ms), second.bytes / Math.max(1, second.ms)) * 0.008;
      health.put(host, { ok: true, rateMbps });
      preferred = cdnHostOf(rankCdnUrls(candidates, health, preferred)[0]);
    } catch (e) {
      if (valid()) health.put(host, { ok: false });
    } finally {
      running = false;
      if (!disposed && id === generation) publish('ready');
    }
  }
  const timer = intervalMs ? setInterval(tick, intervalMs) : null;
  const online = () => { cancel(); health.clear(); preferred = ''; publish('waiting'); };
  if (typeof window !== 'undefined') window.addEventListener('online', online);
  return {
    setSource(rep) {
      cancel(); preferred = '';
      candidates = rep ? addMirrors(nativeCdnUrls(rep).filter(u => !isPcdnUrl(u)), AUTO_MIRRORS) : [];
      // Uncacheable API-native hosts remain playback fallbacks, but must not
      // monopolize the probe queue by looking perpetually unmeasured.
      candidates = candidates.filter(u => validHealthHost(cdnHostOf(u)));
      // One signed URL per host for this exact representation, held in memory only.
      candidates = candidates.filter((u, i) => candidates.findIndex(v => cdnHostOf(v) === cdnHostOf(u)) === i).slice(0, 12);
      if (candidates.length) preferred = cdnHostOf(rankCdnUrls(candidates, health)[0]);
      publish(automatic() ? 'waiting' : 'manual');
    },
    order(urls) {
      if (!automatic()) return urls;
      // Only measured mirrors may be inserted ahead of the existing fallback list.
      const extra = AUTO_MIRRORS.filter(host => health.get(host)?.ok && !isBanned(host));
      const ranked = rankCdnUrls(addMirrors(urls, extra), health, preferred);
      if (ranked.length) preferred = cdnHostOf(ranked[0]);
      // Keep the explicit bad-node fixture effective for fallback regression tests.
      if (testBadCdnEnabled()) {
        const bad = ranked.find(u => cdnHostOf(u) === TEST_BAD_HOST && !isBanned(TEST_BAD_HOST));
        if (bad) return [bad, ...ranked.filter(u => u !== bad)];
      }
      return ranked;
    },
    failed(host) {
      if (isBanned(host)) { health.put(host, { ok: false }); publish('ready'); }
    },
    tick,
    dispose() {
      disposed = true; cancel(); clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', online);
      publish('stopped');
    },
  };
}
