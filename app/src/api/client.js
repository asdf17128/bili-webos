// Bilibili API client
// On webOS TV: uses Luna JS Service (no external proxy needed)
// Fallback: uses HTTP proxy on Mac
import { storage } from '../utils/storage';
import { getWbiKeys, signWbi } from './wbi';
import { logErr } from '../utils/errlog';

const API_HOST = 'api.bilibili.com';
const PASSPORT_HOST = 'passport.bilibili.com';
const SERVICE_URI = 'luna://com.biliwebos.app.service/';

// Detect if running on webOS with Luna service available
function hasLunaService() {
  return typeof window !== 'undefined' && typeof window.webOS !== 'undefined' && window.webOS.service;
}

// Luna service fetch (on TV)
function lunaFetch(url, options) {
  return new Promise(function(resolve, reject) {
    if (!hasLunaService()) {
      reject(new Error('Luna not available'));
      return;
    }

    var params = { url: url, method: options.method || 'GET' };
    if (options.body) params.body = options.body;
    if (options.contentType) params.contentType = options.contentType;
    if (options.range) params.range = options.range;

    window.webOS.service.request(SERVICE_URI, {
      method: 'fetch',
      parameters: params,
      onSuccess: function(res) {
        if (res.newCookies) {
          var auth = storage.getAuth() || {};
          storage.setAuth(Object.assign({}, auth, res.newCookies));
        }
        resolve(res);
      },
      onFailure: function(err) {
        logErr('luna', (err.errorText || err.error || 'Luna fetch failed').slice(0, 120));
        reject(new Error(err.errorText || err.error || 'Luna fetch failed'));
      }
    });
  });
}

// Proxy fetch (fallback for browser dev)
function proxyFetchRaw(url, options) {
  var base = storage.getProxyUrl();
  var parsed = new URL(url);
  var proxyUrl = base + '/proxy/' + parsed.host + parsed.pathname + parsed.search;

  return fetch(proxyUrl, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': options.contentType || 'application/json',
    },
    body: options.body,
  }).then(function(res) {
    var setCookie = res.headers.get('X-Set-Cookie');
    if (setCookie) {
      try {
        var newCookies = JSON.parse(setCookie);
        var auth = storage.getAuth() || {};
        storage.setAuth(Object.assign({}, auth, newCookies));
      } catch(e) {}
    }
    return res;
  });
}

// Smart fetch: try Luna first, fallback to proxy
async function smartFetch(host, path, options) {
  var url = 'https://' + host + path;
  var opts = options || {};

  if (hasLunaService()) {
    var res = await lunaFetch(url, opts);
    if (!res.returnValue) {
      logErr('svc', host + path.split('?')[0] + ' :: ' + res.error);
      throw new Error(res.error);
    }
    // Parse JSON body if applicable
    if (res.body) {
      try { return JSON.parse(res.body); } catch(e) { return res; }
    }
    return res;
  }

  // Fallback to proxy
  var proxyRes = await proxyFetchRaw(url, opts);
  var ct = proxyRes.headers.get('content-type') || '';
  if (ct.indexOf('json') >= 0 || ct.indexOf('text/plain') >= 0) {
    return proxyRes.json();
  }
  return proxyRes;
}

// API fetch
export async function apiFetch(path, params, options) {
  params = params || {};
  options = options || {};
  var host = options.host || API_HOST;
  var query = new URLSearchParams(params).toString();
  var fullPath = query ? path + '?' + query : path;
  return smartFetch(host, fullPath, options);
}

// API fetch with WBI signature. options.host targets a non-default host (the
// WBI signature is host-agnostic, so it works for api.live.bilibili.com too).
export async function wbiFetch(path, params, options) {
  var keys = await getWbiKeys(apiFetch);
  var signedQuery = signWbi(params || {}, keys.imgKey, keys.subKey);
  return smartFetch((options && options.host) || API_HOST, path + '?' + signedQuery);
}

// Raw fetch for special cases (returns Response or Luna result)
export async function rawFetch(url, options) {
  options = options || {};
  if (hasLunaService()) {
    return lunaFetch(url, options);
  }
  return proxyFetchRaw(url, options);
}

function lunaRequest(method, parameters, subscribe, handlers) {
  handlers = handlers || {};
  return new Promise(function(resolve, reject) {
    if (!hasLunaService()) {
      if (handlers.allowMissing) { resolve(null); return; }
      reject(new Error('Luna not available'));
      return;
    }

    window.webOS.service.request(SERVICE_URI, {
      method: method,
      subscribe: !!subscribe,
      parameters: parameters || {},
      onSuccess: function(res) {
        if (handlers.onSuccess) handlers.onSuccess(res);
        resolve(res);
      },
      onFailure: function(err) {
        if (handlers.onFailure) handlers.onFailure(err);
        reject(new Error(err.errorText || err.error || (method + ' failed')));
      },
    });
  });
}

export function castSubscribe(onEvent, onFailure) {
  if (!hasLunaService()) return function () {};

  let cancelled = false;
  window.webOS.service.request(SERVICE_URI, {
    method: 'castSubscribe',
    subscribe: true,
    parameters: { subscribe: true },
    onSuccess: function(res) {
      if (!cancelled && res?.event && onEvent) onEvent(res.event, res.status);
    },
    onFailure: function(err) {
      if (!cancelled && onFailure) onFailure(err);
    }
  });

  return function () { cancelled = true; };
}

export async function castAck(payload) {
  return lunaRequest('castAck', payload || {}, false, { allowMissing: true });
}

export async function castReportState(payload) {
  return lunaRequest('castReportState', payload || {}, false, { allowMissing: true });
}

export async function castReportProgress(payload) {
  return lunaRequest('castReportProgress', payload || {}, false, { allowMissing: true });
}

export async function castGetStatus() {
  return lunaRequest('castGetStatus', {}, false, { allowMissing: true });
}

// Persist extra cookies into the TV service (e.g. buvid3 for risk control).
function setServiceCookies(cookies) {
  return lunaRequest('setCookies', { cookies: cookies || {} }, false, { allowMissing: true });
}

// Ensure a buvid3/buvid4 fingerprint cookie exists — many endpoints (live
// getDanmuInfo, etc.) return -352 without it. Fetched once per session.
let buvidEnsured = false;
let _buvid3 = '';
export function getBuvid3() { return _buvid3; }
export async function ensureBuvid() {
  if (buvidEnsured) return;
  try {
    const r = await apiFetch('/x/frontend/finger/spi');
    const b3 = r?.data?.b_3;
    const b4 = r?.data?.b_4;
    if (b3) {
      _buvid3 = b3;
      await setServiceCookies({ buvid3: b3, buvid4: b4 || '' });
      buvidEnsured = true;
    }
  } catch (e) { /* best effort */ }
}

// Rename the cast receiver as shown in the phone's 投屏 list (applies live).
export async function castSetConfig(payload) {
  return lunaRequest('castSetConfig', payload || {}, false, { allowMissing: true });
}

// Service health snapshot for the 网络诊断 page. Falls back to 'ping' when the
// installed service predates getDiagnostics.
export async function getServiceDiagnostics() {
  try {
    return await lunaRequest('getDiagnostics', {}, false, {});
  } catch (e) {
    try {
      var p = await lunaRequest('ping', {}, false, {});
      return { returnValue: true, nodeVersion: p.nodeVersion, legacyPing: true, cookieKeys: p.cookieKeys };
    } catch (e2) {
      throw e; // report the original getDiagnostics error
    }
  }
}

// Subscribe to live danmaku relayed by the service. onDanmaku(text) per message.
// Returns an unsubscribe function. Pair with danmakuStop() to close the relay.
export function danmakuSubscribe(params, onDanmaku) {
  if (!hasLunaService()) return function () {};
  let cancelled = false;
  window.webOS.service.request(SERVICE_URI, {
    method: 'danmakuSubscribe',
    subscribe: true,
    parameters: params || {},
    onSuccess: function (res) { if (!cancelled && res && res.danmaku && onDanmaku) onDanmaku(res.danmaku); },
    onFailure: function () {},
  });
  return function () { cancelled = true; };
}

export async function danmakuStop() {
  return lunaRequest('danmakuStop', {}, false, { allowMissing: true });
}

// ============ Login ============

export async function qrCodeGenerate() {
  return smartFetch(PASSPORT_HOST, '/x/passport-login/web/qrcode/generate');
}

export async function qrCodePoll(qrcodeKey) {
  return smartFetch(PASSPORT_HOST, '/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(qrcodeKey));
}

// ============ User ============

export async function getNavInfo() {
  return apiFetch('/x/web-interface/nav');
}

// ============ Video ============

export async function getPopular(pn, ps) {
  return wbiFetch('/x/web-interface/popular', { pn: pn || 1, ps: ps || 20 });
}

export async function getRecommend(freshType, ps) {
  return wbiFetch('/x/web-interface/wbi/index/top/feed/rcmd', {
    fresh_idx: 1, fresh_idx_1h: 1, fresh_type: freshType || 4, ps: ps || 10,
  });
}

export async function getRanking(rid, type) {
  return wbiFetch('/x/web-interface/ranking/v2', { rid: rid || 0, type: type || 'all' });
}

export async function getVideoInfo(video) {
  if (typeof video === 'string') {
    return wbiFetch('/x/web-interface/view', { bvid: video });
  }
  video = video || {};
  if (video.bvid) return wbiFetch('/x/web-interface/view', { bvid: video.bvid });
  if (video.aid) return wbiFetch('/x/web-interface/view', { aid: video.aid });
  throw new Error('Missing video identifier');
}

// Player meta incl. resume position: last_play_cid (which part) + last_play_time
// (ms into it). Used to 续播 a multi-part video where the user left off.
// Seek-preview sprite sheets (YouTube-style scrub thumbnails). Returns
// data.image[] sprite jpgs (10x10 grid of 160x90 frames by default) plus
// per-frame timestamps in data.index[].
export async function getVideoshot(bvid, cid) {
  return apiFetch('/x/player/videoshot', { bvid, cid, index: 1 });
}

export async function getPlayerV2(aid, cid) {
  return wbiFetch('/x/player/wbi/v2', { aid, cid });
}

export async function getPlayUrl(videoOrBvid, cid, qn) {
  var payload = {
    cid: cid, qn: qn || 80, fnval: 4048, fnver: 0, fourk: 1, platform: 'pc',
  };
  if (typeof videoOrBvid === 'string') payload.bvid = videoOrBvid;
  else if (videoOrBvid?.bvid) payload.bvid = videoOrBvid.bvid;
  else if (videoOrBvid?.aid) payload.avid = videoOrBvid.aid;
  return wbiFetch('/x/player/playurl', payload);
}

// ============ Bangumi / 番剧 (PGC) ============
// PGC uses a different endpoint family than UGC videos, and wraps its payload
// in `result` (not `data`). An episode is identified by ep_id; cid pins the
// exact part. fnval=4048 requests DASH + HDR + 4K + Dolby + AV1.
export async function getBangumiPlayUrl(opts, qn) {
  var o = opts || {};
  var payload = { qn: qn || 80, fnval: 4048, fnver: 0, fourk: 1 };
  if (o.epid) payload.ep_id = o.epid;
  if (o.cid) payload.cid = o.cid;
  return wbiFetch('/pgc/player/web/playurl', payload);
}

// Season metadata (episode list with per-episode cid/cover/title). Accepts
// either an episode id or a season id.
export async function getBangumiInfo(opts) {
  var o = opts || {};
  var params = {};
  if (o.epid) params.ep_id = o.epid;
  else if (o.seasonId) params.season_id = o.seasonId;
  return wbiFetch('/pgc/view/web/season', params);
}

// Partition/region
export async function getRegionDynamic(rid, pn, ps) {
  // dynamic/region was sunset by B站 (-404 as of 2026-07); newlist returns the
  // same archives shape for the main region ids.
  return apiFetch('/x/web-interface/newlist', { rid: rid || 1, pn: pn || 1, ps: ps || 6, type: 0 });
}

// Follow feed — paginates by the `offset` cursor returned in data.offset,
// NOT by page number (page alone re-returns the first page).
export async function getFollowFeed(page, offset) {
  var url = '/x/polymer/web-dynamic/v1/feed/all?timezone_offset=-480&type=video&page=' + (page || 1);
  if (offset) url += '&offset=' + encodeURIComponent(offset);
  return smartFetch(API_HOST, url);
}

// Logged-in user's followings (Cookie auth). Used to badge "已关注" on cards.
export async function getFollowings(vmid, pn, ps) {
  return apiFetch('/x/relation/followings', { vmid: vmid, pn: pn || 1, ps: ps || 50, order: 'desc' });
}

// Latest released version from GitHub (direct fetch — github API sends CORS *,
// so it doesn't need the B站 proxy, and no B站 cookies leak to github).
export async function getLatestVersion() {
  const res = await fetch('https://api.github.com/repos/asdf17128/bili-webos/releases/latest', {
    headers: { 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.tag_name || '').replace(/^v/i, '');
}

// ============ Live ============

export async function getLiveList(page, pageSize) {
  // Try followed streamers first
  var followed = await smartFetch('api.live.bilibili.com',
    '/xlive/web-ucenter/v1/xfetter/GetWebList?page=' + (page || 1) + '&page_size=' + (pageSize || 12));
  var rooms = followed && followed.data && (followed.data.rooms || followed.data.list);
  if (rooms && rooms.length > 0) {
    return { data: { list: rooms } };
  }
  // Fallback to general recommendations
  var rec = await smartFetch('api.live.bilibili.com',
    '/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=' + (page || 1) + '&page_size=' + (pageSize || 12));
  var items = rec && rec.data && (rec.data.list || rec.data.recommend_room_list);
  return { data: { list: items || [] } };
}

// Resolve a (possibly short) room id to the real room_id.
export async function getRoomInit(roomId) {
  return apiFetch('/room/v1/Room/room_init', { id: roomId }, { host: 'api.live.bilibili.com' });
}

// Current room info in one shot: live_status (0 未开播 / 1 直播 / 2 轮播),
// title and a fresh cover — used to label/refresh "最近观看" live entries.
export async function getLiveRoomInfo(roomId) {
  return smartFetch('api.live.bilibili.com',
    '/xlive/web-room/v1/index/getInfoByRoom?room_id=' + roomId);
}

// Live danmaku server token + host list (for the WebSocket connection).
// Needs WBI signing (returns -352 otherwise).
export async function getDanmuInfo(realRoomId) {
  await ensureBuvid();
  return wbiFetch('/xlive/web-room/v1/index/getDanmuInfo', { id: realRoomId, type: 0, web_location: 444.8 }, { host: 'api.live.bilibili.com' });
}

export async function getLiveStreamUrl(roomId) {
  var res = await smartFetch('api.live.bilibili.com',
    '/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' + roomId + '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8');
  var streams = res && res.data && res.data.playurl_info && res.data.playurl_info.playurl && res.data.playurl_info.playurl.stream;
  if (!streams) return null;
  // Find HLS AVC stream
  for (var s = 0; s < streams.length; s++) {
    var formats = streams[s].format || [];
    for (var f = 0; f < formats.length; f++) {
      if (formats[f].format_name === 'fmp4' || formats[f].format_name === 'ts') {
        var codecs = formats[f].codec || [];
        for (var c = 0; c < codecs.length; c++) {
          if (codecs[c].codec_name === 'avc') {
            var info = (codecs[c].url_info || [{}])[0];
            return (info.host || '') + (codecs[c].base_url || '') + (info.extra || '');
          }
        }
      }
    }
  }
  return null;
}

// ============ Search ============

export async function searchVideo(keyword, page, pageSize) {
  return wbiFetch('/x/web-interface/search/type', {
    search_type: 'video', keyword: keyword, page: page || 1, page_size: pageSize || 20,
    order: '', duration: 0, tids: 0,
  });
}

// ============ History & Favorites ============

export async function getHistory(max, viewAt, ps) {
  return wbiFetch('/x/web-interface/history/cursor', { ps: ps || 20, type: '', max: max || 0, view_at: viewAt || 0 });
}

export async function getFavFolders(mid) {
  return wbiFetch('/x/v3/fav/folder/created/list-all', { up_mid: mid });
}

export async function getFavList(mediaId, pn, ps) {
  return wbiFetch('/x/v3/fav/resource/list', { media_id: mediaId, pn: pn || 1, ps: ps || 20, platform: 'web' });
}

// ============ Heartbeat ============

export async function reportHeartbeat(bvid, cid, playedTime, realTime) {
  var params = 'bvid=' + bvid + '&cid=' + cid +
    '&played_time=' + Math.floor(playedTime) +
    '&real_played_time=' + Math.floor(realTime) +
    '&type=3&dt=2&play_type=0&start_ts=' + Math.floor(Date.now() / 1000);

  try {
    await smartFetch(API_HOST, '/x/click-interface/web/heartbeat', {
      method: 'POST',
      body: params,
      contentType: 'application/x-www-form-urlencoded',
    });
  } catch(e) {}
}

// ============ Danmaku ============

export async function getDanmaku(cid) {
  var url = 'https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid;

  if (hasLunaService()) {
    var res = await lunaFetch(url, {});
    if (res.body) return parseDanmakuXml(res.body);
    return [];
  }

  // Proxy fallback
  var base = storage.getProxyUrl();
  var proxyRes = await fetch(base + '/proxy/api.bilibili.com/x/v1/dm/list.so?oid=' + cid);
  var text = await proxyRes.text();
  return parseDanmakuXml(text);
}

function parseDanmakuXml(xml) {
  var danmakus = [];
  var parser = new DOMParser();
  var doc = parser.parseFromString(xml, 'text/xml');
  var items = doc.querySelectorAll('d');
  items.forEach(function(d) {
    var attr = d.getAttribute('p');
    if (!attr) return;
    var parts = attr.split(',');
    danmakus.push({
      time: parseFloat(parts[0]),
      mode: parseInt(parts[1]),
      size: parseInt(parts[2]),
      color: '#' + parseInt(parts[3]).toString(16).padStart(6, '0'),
      timestamp: parseInt(parts[4]),
      text: d.textContent,
    });
  });
  danmakus.sort(function(a, b) { return a.time - b.time; });
  return danmakus;
}

// ============ Related ============

export async function getRelated(bvid) {
  return wbiFetch('/x/web-interface/archive/related', { bvid: bvid });
}

// ============ UP uploader ============

// This uploader's submitted videos, newest first (space arc search, WBI signed)
export async function getUpVideos(mid, pn, ps) {
  return wbiFetch('/x/space/wbi/arc/search', {
    mid: mid, pn: pn || 1, ps: ps || 30, order: 'pubdate', tid: 0, keyword: '',
    platform: 'web', web_location: 1550101,
  });
}
