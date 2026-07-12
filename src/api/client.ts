// Bilibili API client
// On webOS TV: uses Luna JS Service (no external proxy needed)
// In browser dev: uses the Vite /proxy fallback
import { storage } from '../utils/storage';
import { buildProxyUrl } from '../utils/proxy';
import { getWbiKeys, signWbi } from './wbi';
import {
  selectLiveStreamSource,
  selectLiveStreamUrl,
} from './liveStreamSelector';

const API_HOST = 'api.bilibili.com';
const PASSPORT_HOST = 'passport.bilibili.com';
const SERVICE_URI = 'luna://com.biliwebos.app.service/';
const CAST_SUBSCRIBE_RETRY_MS = 1000;

type FetchOptions = {
  method?: string;
  body?: BodyInit | null;
  contentType?: string;
  range?: string;
  headers?: Record<string, string>;
  host?: string;
};

type LunaFetchResponse = {
  returnValue?: boolean;
  error?: string;
  errorText?: string;
  body?: string;
  newCookies?: Record<string, string>;
  [key: string]: any;
};

type LunaRequestHandlers = {
  allowMissing?: boolean;
  onSuccess?: (response: any) => void;
  onFailure?: (error: any) => void;
};

// Detect if running on webOS with Luna service available
function hasPalmServiceBridge() {
  if (typeof window === 'undefined') return false;
  if (typeof window.PalmServiceBridge !== 'undefined') return true;
  return !!(
    window.PalmSystem && typeof window.PalmSystem.serviceBridge === 'function'
  );
}

function isLocalDevRuntime() {
  if (typeof window === 'undefined') return false;
  const hostname = window.location?.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function hasLunaService() {
  return (
    typeof window !== 'undefined' &&
    typeof window.webOS !== 'undefined' &&
    typeof window.webOS.service?.request === 'function' &&
    (hasPalmServiceBridge() || !isLocalDevRuntime())
  );
}

// Luna service fetch (on TV)
function lunaFetch(url: string, options: FetchOptions = {}) {
  return new Promise<LunaFetchResponse>(function (resolve, reject) {
    if (!hasLunaService()) {
      reject(new Error('Luna not available'));
      return;
    }

    var params: Record<string, any> = {
      url: url,
      method: options.method || 'GET',
    };
    if (options.body) params.body = options.body;
    if (options.contentType) params.contentType = options.contentType;
    if (options.range) params.range = options.range;

    window.webOS.service.request(SERVICE_URI, {
      method: 'fetch',
      parameters: params,
      onSuccess: function (res) {
        if (res.newCookies) {
          var auth = storage.getAuth() || {};
          storage.setAuth(Object.assign({}, auth, res.newCookies));
        }
        resolve(res);
      },
      onFailure: function (err) {
        reject(new Error(err.errorText || err.error || 'Luna fetch failed'));
      },
    });
  });
}

// Proxy fetch (fallback for browser dev)
function proxyFetchRaw(url: string, options: FetchOptions = {}) {
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
  }).then(function (res) {
    var setCookie = res.headers.get('X-Set-Cookie');
    if (setCookie) {
      try {
        var newCookies = JSON.parse(setCookie);
        var auth = storage.getAuth() || {};
        storage.setAuth(Object.assign({}, auth, newCookies));
      } catch (e) {}
    }
    return res;
  });
}

// Smart fetch: try Luna first, fallback to proxy
async function smartFetch(
  host: string,
  path: string,
  options: FetchOptions = {},
) {
  var url = 'https://' + host + path;
  var opts = options || {};

  if (hasLunaService()) {
    try {
      var res: LunaFetchResponse = await lunaFetch(url, opts);
      if (!res.returnValue) throw new Error(res.error);
      // Parse JSON body if applicable
      if (res.body) {
        try {
          return JSON.parse(res.body);
        } catch (e) {
          return res;
        }
      }
      return res;
    } catch (err) {
      // Browser dev may expose webOS.service but lack PalmServiceBridge; fallback to proxy.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[api] Luna fetch failed, fallback to proxy:',
          err && err.message ? err.message : err,
        );
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
export async function apiFetch(
  path: string,
  params?: Record<string, any>,
  options?: FetchOptions,
) {
  params = params || {};
  options = options || {};
  var host = options.host || API_HOST;
  var query = new URLSearchParams(params).toString();
  var fullPath = query ? path + '?' + query : path;
  return smartFetch(host, fullPath, options);
}

// API fetch with WBI signature
export async function wbiFetch(
  path: string,
  params?: Record<string, any>,
  options?: { host?: string },
) {
  var keys = await getWbiKeys(apiFetch);
  var signedQuery = signWbi(params || {}, keys.imgKey, keys.subKey);
  return smartFetch(options?.host || API_HOST, path + '?' + signedQuery);
}

// Raw fetch for special cases (returns Response or Luna result)
export async function rawFetch(url: string, options: FetchOptions = {}) {
  options = options || {};
  if (hasLunaService()) {
    return lunaFetch(url, options);
  }
  return proxyFetchRaw(url, options);
}

function lunaRequest(
  method: string,
  parameters?: Record<string, unknown>,
  subscribe = false,
  handlers: LunaRequestHandlers = {},
) {
  return new Promise(function (resolve, reject) {
    if (!hasLunaService()) {
      if (handlers.allowMissing) {
        resolve(null);
        return;
      }
      reject(new Error('Luna not available'));
      return;
    }

    window.webOS.service.request(SERVICE_URI, {
      method: method,
      subscribe: !!subscribe,
      parameters: parameters || {},
      onSuccess: function (res) {
        if (handlers.onSuccess) handlers.onSuccess(res);
        resolve(res);
      },
      onFailure: function (err) {
        if (handlers.onFailure) handlers.onFailure(err);
        reject(new Error(err.errorText || err.error || method + ' failed'));
      },
    });
  });
}

export function castSubscribe(
  onEvent?: (event: any, status: any) => void,
  onFailure?: (error: any) => void,
) {
  if (!hasLunaService()) return function () {};

  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let requestHandle: { cancel?: () => void } | void;

  function cancelRequest() {
    if (requestHandle && typeof requestHandle.cancel === 'function') {
      requestHandle.cancel();
    }
  }

  function subscribe() {
    if (cancelled || !hasLunaService()) return;

    requestHandle = window.webOS.service.request(SERVICE_URI, {
      method: 'castSubscribe',
      subscribe: true,
      parameters: { subscribe: true },
      onSuccess: function (res) {
        if (!cancelled && res?.event && onEvent) onEvent(res.event, res.status);
      },
      onFailure: function (err) {
        if (cancelled) return;
        if (onFailure) onFailure(err);
        cancelRequest();
        retryTimer = setTimeout(subscribe, CAST_SUBSCRIBE_RETRY_MS);
      },
    });
  }

  subscribe();

  return function () {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    cancelRequest();
  };
}

export async function castAck(payload?: Record<string, unknown>) {
  return lunaRequest('castAck', payload || {}, false, { allowMissing: true });
}

export async function castReportState(payload?: Record<string, unknown>) {
  return lunaRequest('castReportState', payload || {}, false, {
    allowMissing: true,
  });
}

export async function castReportProgress(payload?: Record<string, unknown>) {
  return lunaRequest('castReportProgress', payload || {}, false, {
    allowMissing: true,
  });
}

export async function castGetStatus() {
  return lunaRequest('castGetStatus', {}, false, { allowMissing: true });
}

// ============ Login ============

export async function qrCodeGenerate() {
  return smartFetch(PASSPORT_HOST, '/x/passport-login/web/qrcode/generate');
}

export async function qrCodePoll(qrcodeKey) {
  return smartFetch(
    PASSPORT_HOST,
    '/x/passport-login/web/qrcode/poll?qrcode_key=' +
      encodeURIComponent(qrcodeKey),
  );
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
    fresh_idx: 1,
    fresh_idx_1h: 1,
    fresh_type: freshType || 4,
    ps: ps || 10,
  });
}

export async function getRanking(rid, type) {
  return wbiFetch('/x/web-interface/ranking/v2', {
    rid: rid || 0,
    type: type || 'all',
  });
}

export async function getVideoInfo(video) {
  if (typeof video === 'string') {
    return wbiFetch('/x/web-interface/view', { bvid: video });
  }
  video = video || {};
  if (video.bvid)
    return wbiFetch('/x/web-interface/view', { bvid: video.bvid });
  if (video.aid) return wbiFetch('/x/web-interface/view', { aid: video.aid });
  throw new Error('Missing video identifier');
}

export async function getPlayUrl(videoOrBvid, cid, qn) {
  var payload: Record<string, any> = {
    cid: cid,
    qn: qn || 80,
    fnval: 4048,
    fnver: 0,
    fourk: 1,
    platform: 'pc',
  };
  if (typeof videoOrBvid === 'string') payload.bvid = videoOrBvid;
  else if (videoOrBvid?.bvid) payload.bvid = videoOrBvid.bvid;
  else if (videoOrBvid?.aid) payload.avid = videoOrBvid.aid;
  return wbiFetch('/x/player/playurl', payload);
}

export async function getPlayerSubtitles(videoOrBvid, cid) {
  var payload: Record<string, any> = { cid: cid };
  if (typeof videoOrBvid === 'string') payload.bvid = videoOrBvid;
  else if (videoOrBvid?.bvid) payload.bvid = videoOrBvid.bvid;
  else if (videoOrBvid?.aid) payload.aid = videoOrBvid.aid;
  var res = await wbiFetch('/x/player/wbi/v2', payload);
  return res?.data?.subtitle?.subtitles || [];
}

export async function getSubtitleCues(subtitleUrl) {
  if (!subtitleUrl) return [];
  var normalizedUrl = subtitleUrl.startsWith('//')
    ? 'https:' + subtitleUrl
    : subtitleUrl;
  var parsedUrl = new URL(normalizedUrl);
  var res = await smartFetch(
    parsedUrl.host,
    parsedUrl.pathname + parsedUrl.search,
  );
  return Array.isArray(res?.body) ? res.body : [];
}

// Partition/region
export async function getRegionDynamic(rid, pn, ps) {
  return wbiFetch('/x/web-interface/dynamic/region', {
    rid: rid || 0,
    pn: pn || 1,
    ps: ps || 6,
  });
}

// Follow feed
export async function getFollowFeed(page, ps) {
  return smartFetch(
    API_HOST,
    '/x/polymer/web-dynamic/v1/feed/all?timezone_offset=-480&type=video&page=' +
      (page || 1),
  );
}

// ============ Live ============

export async function getLiveList(
  page?: number,
  pageSize?: number,
): Promise<any> {
  // Try followed streamers first
  var followed: any = await smartFetch(
    'api.live.bilibili.com',
    '/xlive/web-ucenter/v1/xfetter/GetWebList?page=' +
      (page || 1) +
      '&page_size=' +
      (pageSize || 12),
  );
  var rooms =
    followed && followed.data && (followed.data.rooms || followed.data.list);
  if (rooms && rooms.length > 0) {
    return { data: { list: rooms } };
  }
  // Fallback to general recommendations
  var rec: any = await smartFetch(
    'api.live.bilibili.com',
    '/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=' +
      (page || 1) +
      '&page_size=' +
      (pageSize || 12),
  );
  var items =
    rec && rec.data && (rec.data.list || rec.data.recommend_room_list);
  return { data: { list: items || [] } };
}

export async function getLiveStreamUrl(roomId) {
  var res = await smartFetch(
    'api.live.bilibili.com',
    '/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' +
      roomId +
      '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8',
  );
  var streams =
    res &&
    res.data &&
    res.data.playurl_info &&
    res.data.playurl_info.playurl &&
    res.data.playurl_info.playurl.stream;
  return selectLiveStreamUrl(streams);
}

export async function getLiveStreamSource(roomId) {
  var res = await smartFetch(
    'api.live.bilibili.com',
    '/xlive/web-room/v2/index/getRoomPlayInfo?room_id=' +
      roomId +
      '&protocol=0,1&format=0,1,2&codec=0,1,2&platform=web&ptype=8',
  );
  var streams =
    res &&
    res.data &&
    res.data.playurl_info &&
    res.data.playurl_info.playurl &&
    res.data.playurl_info.playurl.stream;
  return selectLiveStreamSource(streams);
}

export async function getLiveDanmakuInfo(roomId) {
  return wbiFetch(
    '/xlive/web-room/v1/index/getDanmuInfo',
    { id: roomId, type: 0 },
    { host: 'api.live.bilibili.com' },
  );
}

// ============ Search ============

export async function searchVideo(
  keyword: string,
  page?: number,
  pageSize?: number,
) {
  return wbiFetch('/x/web-interface/search/type', {
    search_type: 'video',
    keyword: keyword,
    page: page || 1,
    page_size: pageSize || 20,
    order: '',
    duration: 0,
    tids: 0,
  });
}

// ============ History & Favorites ============

export async function getHistory(max, viewAt, ps) {
  return wbiFetch('/x/web-interface/history/cursor', {
    ps: ps || 20,
    type: '',
    max: max || 0,
    view_at: viewAt || 0,
  });
}

export async function getFavFolders(mid) {
  return wbiFetch('/x/v3/fav/folder/created/list-all', { up_mid: mid });
}

export async function getFavList(mediaId, pn, ps) {
  return wbiFetch('/x/v3/fav/resource/list', {
    media_id: mediaId,
    pn: pn || 1,
    ps: ps || 20,
    platform: 'web',
  });
}

function normalizeSubscriptionRow(item) {
  const meta = item || {};
  const mediaId = Number(
    meta.id || meta.media_id || meta.mediaId || meta.fid || 0,
  );
  const ownerMid = Number(meta.upper?.mid || meta.mid || meta.owner_mid || 0);
  const rawTitle = meta.title || meta.name || '';
  const cover = meta.cover || '';
  const total = Number(
    meta.media_count || meta.count || meta.cnt_info?.media_count || 0,
  );
  const isInvalid = !mediaId || !rawTitle || !cover;

  return {
    id: `collected-folder-${mediaId || 'invalid'}`,
    mediaId,
    seasonId: mediaId,
    ownerMid,
    title: rawTitle || '未命名订阅',
    cover,
    total,
    isInvalid,
  };
}

function normalizeSubscriptionVideo(archive) {
  const bvid = archive?.bvid || '';
  const rawTitle = archive?.title || archive?.arc?.title || '';
  const pic = archive?.pic || archive?.cover || '';
  const duration = Number(archive?.duration || archive?.arc?.duration || 0);
  const pubdate = Number(archive?.pubdate || archive?.ptime || 0);
  const ownerName =
    archive?.owner?.name ||
    archive?.upper?.name ||
    archive?.author ||
    archive?.author_name ||
    '';
  const viewCount =
    archive?.stat?.view ||
    archive?.stat?.play ||
    archive?.cnt_info?.play ||
    archive?.play ||
    0;
  const isInvalid = !bvid || !rawTitle;

  return {
    aid: archive?.aid || archive?.id || 0,
    bvid,
    cid: archive?.cid || 0,
    title: isInvalid ? '视频已失效' : rawTitle,
    pic,
    duration,
    pubdate,
    owner: { name: ownerName || '未知UP主' },
    stat: { view: Number(viewCount || 0) },
    isInvalid,
  };
}

export async function getMySubscriptions(userMid, pn, ps) {
  const res = await apiFetch('/x/v3/fav/folder/collected/list', {
    up_mid: userMid,
    pn: pn || 1,
    ps: ps || 50,
    platform: 'web',
    web_location: '333.1387',
  });
  const data = res?.data || {};
  const items = data?.list || data?.items || [];

  return {
    items: items.map(normalizeSubscriptionRow),
    page: {
      pageNum: Number(data?.pn || pn || 1),
      pageSize: Number(data?.ps || ps || 50),
      total: Number(data?.count || data?.total || items.length || 0),
    },
  };
}

export async function getSubscriptionVideos(params) {
  const res = await apiFetch('/x/space/fav/season/list', {
    season_id: params.seasonId || params.mediaId,
    pn: params.pageNum || 1,
    ps: params.pageSize || 40,
    web_location: '333.1387',
  });

  return {
    meta: res?.data?.info || res?.data?.meta || {},
    items: (res?.data?.medias || res?.data?.archives || []).map(
      normalizeSubscriptionVideo,
    ),
    page: {
      pageNum: Number(res?.data?.pn || params.pageNum || 1),
      pageSize: Number(res?.data?.ps || params.pageSize || 40),
      total: Number(
        res?.data?.info?.media_count ||
          res?.data?.count ||
          res?.data?.total ||
          0,
      ),
    },
  };
}

// ============ Heartbeat ============

export async function reportHeartbeat(bvid, cid, playedTime, realTime) {
  var params =
    'bvid=' +
    bvid +
    '&cid=' +
    cid +
    '&played_time=' +
    Math.floor(playedTime) +
    '&real_played_time=' +
    Math.floor(realTime) +
    '&type=3&dt=2&play_type=0&start_ts=' +
    Math.floor(Date.now() / 1000);

  try {
    await smartFetch(API_HOST, '/x/click-interface/web/heartbeat', {
      method: 'POST',
      body: params,
      contentType: 'application/x-www-form-urlencoded',
    });
  } catch (e) {}
}

// ============ Danmaku ============

export async function getDanmaku(cid) {
  var url = 'https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid;

  if (hasLunaService()) {
    var res: LunaFetchResponse = await lunaFetch(url, {});
    if (res.body) return parseDanmakuXml(res.body);
    return [];
  }

  // Proxy fallback
  var proxyRes = await fetch(
    buildProxyUrl('https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid),
  );
  var text = await proxyRes.text();
  return parseDanmakuXml(text);
}

function parseDanmakuXml(xml) {
  var danmakus = [];
  var parser = new DOMParser();
  var doc = parser.parseFromString(xml, 'text/xml');
  var items = doc.querySelectorAll('d');
  items.forEach(function (d) {
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
  danmakus.sort(function (a, b) {
    return a.time - b.time;
  });
  return danmakus;
}

// ============ Related ============

export async function getRelated(bvid) {
  return wbiFetch('/x/web-interface/archive/related', { bvid: bvid });
}

// ============ Storyboard ============

export type StoryboardTile = {
  imageUrls: string[];
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  interval: number;
  frameTimes?: number[];
};

type VideoShotData = {
  pvdata?: string;
  img_x_len: number;
  img_y_len: number;
  img_x_size: number;
  img_y_size: number;
  image: string[];
};

function parsePvdata(buf: ArrayBuffer): number[] {
  const view = new DataView(buf);
  const frames: number[] = [];
  for (let i = 0; i + 1 < buf.byteLength; i += 2) {
    frames.push(view.getUint16(i, false));
  }
  return frames;
}

async function fetchPvdata(pvdataUrl: string): Promise<number[] | null> {
  try {
    const url = buildProxyUrl(
      pvdataUrl.startsWith('//') ? 'https:' + pvdataUrl : pvdataUrl,
    );
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return parsePvdata(buf);
  } catch {
    return null;
  }
}

function normalizeShotData(shot: VideoShotData): {
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  imageUrls: string[];
  frameTimes: number[] | null;
} | null {
  const isPosInt = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0;
  if (
    !Array.isArray(shot.image) ||
    shot.image.length === 0 ||
    !shot.image.every((u: any) => typeof u === 'string' && u.length > 0) ||
    !isPosInt(shot.img_x_len) ||
    !isPosInt(shot.img_y_len) ||
    !isPosInt(shot.img_x_size) ||
    !isPosInt(shot.img_y_size)
  ) {
    return null;
  }
  return {
    tileW: shot.img_x_size,
    tileH: shot.img_y_size,
    cols: shot.img_x_len,
    rows: shot.img_y_len,
    imageUrls: shot.image.map((url: string) =>
      url.startsWith('//') ? buildProxyUrl('https:' + url) : buildProxyUrl(url),
    ),
    frameTimes: null,
  };
}

export async function getStoryboard(
  bvid: string,
  cid: number | string,
): Promise<StoryboardTile | null> {
  const res = await wbiFetch('/x/player/videoshot', { bvid, cid });
  if (res?.code !== 0) return null;
  const data = res?.data;
  if (!data) return null;

  const shots = data.video_shots as Record<string, VideoShotData> | undefined;
  const shot: VideoShotData | undefined =
    shots && Object.keys(shots).length > 0 ? shots[String(cid)] : data;
  if (!shot) return null;

  const normalized = normalizeShotData(shot);
  if (!normalized) return null;

  let frameTimes: number[] | null = null;
  if (shot.pvdata) {
    frameTimes = await fetchPvdata(shot.pvdata);
  }
  normalized.frameTimes = frameTimes;

  const framesAvailable =
    normalized.cols * normalized.rows * normalized.imageUrls.length;
  const interval =
    frameTimes && frameTimes.length > 1
      ? (frameTimes[frameTimes.length - 1] - frameTimes[0]) /
        Math.max(frameTimes.length - 1, 1)
      : 5;

  return {
    imageUrls: normalized.imageUrls,
    cols: normalized.cols,
    rows: normalized.rows,
    tileW: normalized.tileW,
    tileH: normalized.tileH,
    interval: interval || 5,
    frameTimes: frameTimes ?? undefined,
  };
}
