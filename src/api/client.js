// Bilibili API client
// On webOS TV: uses Luna JS Service (no external proxy needed)
// In browser dev: uses the Vite /proxy fallback
import { storage } from '../utils/storage';
import { buildProxyUrl } from '../utils/proxy';
import { getWbiKeys, signWbi } from './wbi';
import { selectLiveStreamSource, selectLiveStreamUrl } from './liveStreamSelector';

const API_HOST = 'api.bilibili.com';
const PASSPORT_HOST = 'passport.bilibili.com';
const SERVICE_URI = 'luna://com.biliwebos.app.service/';

// Detect if running on webOS with Luna service available
function hasPalmServiceBridge() {
  if (typeof window === 'undefined') return false;
  if (typeof window.PalmServiceBridge !== 'undefined') return true;
  return !!(window.PalmSystem && typeof window.PalmSystem.serviceBridge === 'function');
}

function hasLunaService() {
  return typeof window !== 'undefined' && typeof window.webOS !== 'undefined' && window.webOS.service && hasPalmServiceBridge();
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
        reject(new Error(err.errorText || err.error || 'Luna fetch failed'));
      }
    });
  });
}

// Proxy fetch (fallback for browser dev)
function proxyFetchRaw(url, options) {
  var proxyUrl = buildProxyUrl(url);

  var headers = Object.assign({}, options.headers || {});
  if (options.contentType) {
    headers['Content-Type'] = options.contentType;
  } else if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(proxyUrl, {
    method: options.method || 'GET',
    headers: headers,
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
    try {
      var res = await lunaFetch(url, opts);
      if (!res.returnValue) throw new Error(res.error);
      // Parse JSON body if applicable
      if (res.body) {
        try { return JSON.parse(res.body); } catch(e) { return res; }
      }
      return res;
    } catch (err) {
      // Browser dev may expose webOS.service but lack PalmServiceBridge; fallback to proxy.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[api] Luna fetch failed, fallback to proxy:', err && err.message ? err.message : err);
      }
    }
  }

  // Fallback to proxy
  var proxyRes = await proxyFetchRaw(url, opts);
  var ct = proxyRes.headers.get('content-type') || '';
  if (ct.indexOf('json') >= 0) {
    return proxyRes.json();
  }
  if (ct.indexOf('text/plain') >= 0) {
    try {
      return await proxyRes.json();
    } catch (e) {
      return proxyRes.text();
    }
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

// API fetch with WBI signature
export async function wbiFetch(path, params) {
  var keys = await getWbiKeys(apiFetch);
  var signedQuery = signWbi(params || {}, keys.imgKey, keys.subKey);
  return smartFetch(API_HOST, path + '?' + signedQuery);
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

export async function getPlayUrl(videoOrBvid, cid, qn) {
  var payload = {
    cid: cid, qn: qn || 80, fnval: 4048, fnver: 0, fourk: 1, platform: 'pc',
  };
  if (typeof videoOrBvid === 'string') payload.bvid = videoOrBvid;
  else if (videoOrBvid?.bvid) payload.bvid = videoOrBvid.bvid;
  else if (videoOrBvid?.aid) payload.avid = videoOrBvid.aid;
  return wbiFetch('/x/player/playurl', payload);
}

// Partition/region
export async function getRegionDynamic(rid, pn, ps) {
  return wbiFetch('/x/web-interface/dynamic/region', { rid: rid || 0, pn: pn || 1, ps: ps || 6 });
}

// Follow feed
export async function getFollowFeed(page, ps) {
  return smartFetch(API_HOST, '/x/polymer/web-dynamic/v1/feed/all?timezone_offset=-480&type=video&page=' + (page || 1));
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

export async function getLiveStreamUrl(roomId) {
  var res = await smartFetch('api.live.bilibili.com',
    '/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' + roomId + '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8');
  var streams = res && res.data && res.data.playurl_info && res.data.playurl_info.playurl && res.data.playurl_info.playurl.stream;
  return selectLiveStreamUrl(streams);
}

export async function getLiveStreamSource(roomId) {
  var res = await smartFetch('api.live.bilibili.com',
    '/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' + roomId + '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8');
  var streams = res && res.data && res.data.playurl_info && res.data.playurl_info.playurl && res.data.playurl_info.playurl.stream;
  return selectLiveStreamSource(streams);
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
  var proxyRes = await fetch(buildProxyUrl('https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid));
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
