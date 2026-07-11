import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayUrl, getDanmaku, getVideoInfo, getPlayerV2, reportHeartbeat, getRelated, getUpVideos, getBangumiPlayUrl, getBangumiInfo, castReportProgress, castReportState, getVideoshot, getSubtitleBody, gtxTranslate } from '../api/client';
import { playPart, playAdvance } from './playIntent';

import { formatDuration, formatTime, QUALITY_MAP, cleanTitle } from '../utils/format';
import { storage } from '../utils/storage';
import { setCustomKeyHandler } from '../hooks/useFocus';
import DanmakuLayer from './DanmakuLayer';
import SubtitleLayer from './SubtitleLayer';
import { parseSubtitleBody, pickCueIndex, isAiLan, subtitleLanName, mtLanName, findZhTrack, AI_LEAD } from './subtitles';
import { translateCues } from './subTranslate';
import { createDmTranslator } from './dmTranslate';
import { titleMT, useTitlesMT } from '../utils/titlemt';
import { t, getLocale } from '../i18n';

// Proxy + resize card thumbnails (same as VideoCard): the proxy adds the
// Referer B站 image CDN needs, and @672w webp keeps the TV's image decoder from
// choking on full-size covers (which is why direct-loaded thumbs failed).
// Sprite sheets must NOT get the @672w_420h_1c resize: the CDN would scale
// the whole 4800x2700 sheet to a CROPPED 672x420 — mushy and misaligned cells.
function proxyImgRaw(url) {
  if (!url) return '';
  const u = url.startsWith('//') ? 'https:' + url : url;
  const base = (typeof window !== 'undefined' && window.webOS) ? 'http://127.0.0.1:7654' : storage.getProxyUrl();
  try {
    const parsed = new URL(u);
    return `${base}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return u;
  }
}

function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) u += '@672w_420h_1c.webp';
  const base = (typeof window !== 'undefined' && window.webOS) ? 'http://127.0.0.1:7654' : storage.getProxyUrl();
  try {
    const parsed = new URL(u);
    return `${base}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return u;
  }
}

export default function PlayerPage({ video, onBack, onPlayNext }) {
  useTitlesMT(); // re-render when list-title translations land (no-op on zh)
  const videoRef = useRef(null);
  const shakaRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [qualities, setQualities] = useState([]);
  const [currentQuality, setCurrentQuality] = useState(80);
  const [showQuality, setShowQuality] = useState(false);
  const [showRelated, setShowRelated] = useState(false);
  const [danmakus, setDanmakus] = useState([]);
  // Respect the user's persisted danmaku toggle (设置 → 弹幕) instead of always
  // starting on (thanks @ponymuch, PR #2).
  const [danmakuEnabled, setDanmakuEnabled] = useState(() => storage.getSettings().danmaku !== false);
  // Danmaku/subtitle font scales (设置 → 弹幕字号/字幕字号). Read once per mount.
  const [danmakuScale] = useState(() => storage.getSettings().danmakuScale || 1);
  const [subtitleScale] = useState(() => storage.getSettings().subtitleScale || 1);
  // CC subtitles (player/v2 → data.subtitle.subtitles). subLan null = off.
  // settings.subtitle persists only the on/off preference; the concrete track
  // is re-picked per part (track lists differ video to video).
  const [subTracks, setSubTracks] = useState([]);
  const [subLan, setSubLan] = useState(null);
  const [subCues, setSubCues] = useState(null);
  const subReqRef = useRef(0); // drop stale subtitle-body fetches on switch
  const [videoTitle, setVideoTitle] = useState(video?.title || '');
  // Owner + publish time under the title — the entry item often lacks them
  // (deep link, related card), so the view fetch backfills.
  const [metaOwner, setMetaOwner] = useState(video?.owner?.name || '');
  const [metaPubdate, setMetaPubdate] = useState(video?.pubdate || 0);
  // 创作声明 (argue_info): B站's own disclaimer line — AI 生成内容 / 剧情演绎 /
  // 个人观点 etc. Shown in the controls bar like the official clients do.
  const [argueMsg, setArgueMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [ended, setEnded] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState([]);
  // Multi-part (分P) videos: the parts replace 相关推荐 with a 选集 list, and
  // playing one auto-advances to the next part on end (#11).
  const [isMultiP, setIsMultiP] = useState(false);
  const [partsLabel, setPartsLabel] = useState(t('选集'));
  const [partsList, setPartsList] = useState([]); // 选集/合集 items (separate from 相关推荐)
  const partsRef = useRef([]);
  // YouTube-style deferred seek (scrub): arrows move a GHOST playhead with a
  // time bubble + videoshot thumbnail; the video only jumps on OK or ~1s after
  // the last press. Repeated presses accelerate 10s → 30s → 60s.
  const [scrubTarget, setScrubTarget] = useState(null); // seconds | null
  const scrubTargetRef = useRef(null);
  const scrubStreakRef = useRef({ n: 0, last: 0 });
  const scrubTimerRef = useRef(null);
  const [videoshot, setVideoshot] = useState(null); // {images,xLen,yLen,w,h,index}
  // YouTube-style chapters (B站 view_points): [{from,to,content}] — segment
  // ticks on the progress bar + chapter title in the scrub bubble/time row.
  const [chapters, setChapters] = useState([]);
  // YouTube-TV-style end screen: dimmed video + centered "接下来播放" card with
  // an 8s autoplay countdown. OK plays it now; any other key cancels. The
  // embedded controls+panel stay fully reachable (v1.2.2 behavior preserved).
  const [endNextIn, setEndNextIn] = useState(null); // seconds | null
  const relatedRef = useRef([]);
  // Bottom panel: 'related' (相关推荐) | 'up' (UP主投稿)
  const [panelTab, setPanelTab] = useState('related');
  const [upVideos, setUpVideos] = useState([]);
  const [upName, setUpName] = useState('');
  // Focus: 'none' | 'controls' | 'quality' | 'tabs' | 'related' (=grid)
  const [focusArea, setFocusArea] = useState('none');
  const [focusIdx, setFocusIdx] = useState(0);
  const controlsTimer = useRef(null);
  const timeUpdateRef = useRef(null);
  const cidRef = useRef(null);
  const videoAidRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const upMidRef = useRef(null);
  const upLoadingRef = useRef(false);
  const upPnRef = useRef(1);
  const upSeenRef = useRef(new Set());

  const pendingSeekRef = useRef(null);

  // Video title and chapter names go through the shared titleMT system at
  // RENDER time (pending → blank, landed → translated, zh UI → passthrough)
  // — no Chinese flash before the swap (owner report).

  // Danmaku MT (non-zh UI + danmaku on): rolling-window translator — the 40s
  // ahead of the playhead is pre-translated every 8s (and on seeks), so items
  // are ready by the time they'd scroll on. See dmTranslate.js.
  const dmMtRef = useRef(null);
  const dmMtActive = getLocale() !== 'zh';
  useEffect(() => {
    if (!dmMtActive || !danmakuEnabled || !danmakus || danmakus.length === 0) {
      dmMtRef.current = null;
      return undefined;
    }
    const tr = createDmTranslator(danmakus, getLocale(), gtxTranslate);
    dmMtRef.current = tr;
    const doTick = () => {
      const v = videoRef.current;
      if (v) tr.tick(v.currentTime).catch(() => {});
    };
    doTick();
    const iv = setInterval(doTick, 8000);
    const v = videoRef.current;
    if (v) v.addEventListener('seeked', doTick);
    return () => {
      tr.stop();
      clearInterval(iv);
      if (v) v.removeEventListener('seeked', doTick);
      dmMtRef.current = null;
    };
  }, [danmakus, danmakuEnabled, dmMtActive]);

  const queueOrApplySeek = useCallback((seekSec) => {
    const target = Math.max(0, Number(seekSec) || 0);
    if (!videoRef.current) return;
    const canSeekNow = Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0;
    if (canSeekNow) {
      const max = Math.max(0, (videoRef.current.duration || 0) - 0.2);
      videoRef.current.currentTime = Math.min(target, max || target);
      pendingSeekRef.current = null;
      return;
    }
    pendingSeekRef.current = target;
  }, []);

  const flushPendingSeek = useCallback(() => {
    if (pendingSeekRef.current == null || !videoRef.current) return;
    if (!(Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0)) return;
    const max = Math.max(0, (videoRef.current.duration || 0) - 0.2);
    videoRef.current.currentTime = Math.min(pendingSeekRef.current, max || pendingSeekRef.current);
    pendingSeekRef.current = null;
  }, []);

  // The CC button only exists when this part actually has subtitle tracks.
  const CONTROLS = subTracks.length > 0
    ? ['play', 'danmaku', 'subtitle', 'quality']
    : ['play', 'danmaku', 'quality'];

  // Machine translation is offered as a VIRTUAL track ('x-mt') feeding on the
  // zh source track, only when the UI locale itself isn't Chinese — an English
  // UI user gets 关 → 中文轨 → English (translated) → 关.
  // Subtitle bodies are memoized per URL so opening the CC panel can PREFETCH
  // the track before the user even confirms (cleared per part in loadVideo).
  const subBodyCacheRef = useRef(new Map());
  const fetchSubBody = useCallback((url) => {
    const m = subBodyCacheRef.current;
    if (!m.has(url)) {
      m.set(url, getSubtitleBody(url).catch(e => { m.delete(url); throw e; }));
    }
    return m.get(url);
  }, []);

  const selectSubtitle = useCallback((track) => {
    const req = ++subReqRef.current;
    if (!track) { setSubLan(null); setSubCues(null); return; }
    setSubLan(track.lan);
    setSubCues(null);
    fetchSubBody(track.subtitle_url)
      .then(body => {
        if (subReqRef.current !== req) return;
        const cues = parseSubtitleBody(body);
        // MT track: show NOTHING until translated batches land (a Chinese
        // flash before the swap reads as a bug on non-zh UIs — owner report).
        // Plain tracks show immediately.
        if (track.lan !== 'x-mt') setSubCues(cues);
        if (track.lan === 'x-mt' && cues.length > 0) {
          // Start translating at the playhead so the stretch being WATCHED
          // turns translated after ~one round-trip, not after the whole track.
          const t = videoRef.current ? videoRef.current.currentTime : 0;
          let startIndex = pickCueIndex(cues, t);
          if (startIndex < 0) { startIndex = cues.findIndex(c => c.to > t); if (startIndex < 0) startIndex = 0; }
          translateCues(cues, track.mt, gtxTranslate, `bili_subtr:${cidRef.current || ''}:${track.mt}`, window.localStorage, {
            startIndex,
            onPartial: pc => { if (subReqRef.current === req) setSubCues(pc); },
          })
            .then(tc => { if (subReqRef.current === req) setSubCues(tc); })
            .catch(e => {
              console.warn('[subtitle] MT failed, falling back to source:', e?.message || e);
              // Revert to the source cues + label — the button must not claim
              // a translation that isn't (fully) showing.
              if (subReqRef.current === req) { setSubLan(track.srcLan); setSubCues(cues); }
            });
        }
      })
      .catch(() => { if (subReqRef.current === req) setSubCues(null); });
  }, [fetchSubBody]);

  const makeMtTrack = useCallback((tracks, loc) => {
    const zh = findZhTrack(tracks);
    if (!zh || loc === 'zh') return null;
    return { lan: 'x-mt', subtitle_url: zh.subtitle_url, mt: loc, srcLan: zh.lan };
  }, []);

  // CC selection panel (same interaction as the quality panel): 关 / each real
  // track / the machine-translated virtual track. Selection persists on/off so
  // the next video auto-enables.
  const [showSubPanel, setShowSubPanel] = useState(false);
  const subOptions = React.useMemo(() => {
    if (subTracks.length === 0) return [];
    const opts = [{ key: 'off', label: t('关') }]
      .concat(subTracks.map(s => ({ key: s.lan, label: t(subtitleLanName(s.lan, s.lan_doc)) })));
    if (makeMtTrack(subTracks, getLocale())) opts.push({ key: 'x-mt', label: t(mtLanName(getLocale())) });
    return opts;
  }, [subTracks, makeMtTrack]);

  const applySubOption = useCallback((opt) => {
    if (!opt) return;
    if (opt.key === 'off') selectSubtitle(null);
    else if (opt.key === 'x-mt') selectSubtitle(makeMtTrack(subTracks, getLocale()));
    else selectSubtitle(subTracks.find(s => s.lan === opt.key) || null);
    storage.setSettings({ ...storage.getSettings(), subtitle: opt.key !== 'off' });
  }, [subTracks, selectSubtitle, makeMtTrack]);

  // Initialize Shaka Player
  useEffect(() => {
    let mounted = true;
    async function init() {
      const shaka = await import('shaka-player');
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        // Older webOS engines may lack MSE/EME — surface it instead of a
        // silent black screen / endless spinner.
        setLoading(false);
        setErrorMsg(t('当前设备不支持视频播放(浏览器内核过旧)'));
        setLoadError(true);
        return;
      }
      const player = new shaka.Player();
      await player.attach(videoRef.current);
      shakaRef.current = player;

      // Resilience: more retries + longer timeouts so a flaky segment fetch is
      // retried instead of fataling the whole playback (TV CDN is unreliable).
      player.configure({
        // ABR off: the app has an explicit quality selector, so don't let
        // Shaka silently downgrade bitrate mid-playback on bandwidth wobble.
        abr: { enabled: false },
        // No exponential backoff: keep retries for reliability but a flat,
        // short delay so a transient failure doesn't add seconds of dead wait
        // (an aggressive backoff here added ~7.5s to every load).
        manifest: { retryParameters: { maxAttempts: 4, baseDelay: 150, backoffFactor: 1, timeout: 15000 } },
        streaming: {
          retryParameters: { maxAttempts: 6, baseDelay: 200, backoffFactor: 1, fuzzFactor: 0.5, timeout: 20000 },
          bufferingGoal: 30,
          rebufferingGoal: 2,
        },
      });

      // On a network/media error, resume streaming instead of dying silently.
      // category 1 = NETWORK, 3 = MEDIA — usually recoverable mid-playback.
      player.addEventListener('error', (e) => {
        const err = e.detail;
        console.error('Shaka error code:', err?.code, 'category:', err?.category, err);
        if (err && (err.category === 1 || err.category === 3)) {
          try { player.retryStreaming(); } catch {}
        }
      });

      // Rewrite all media/segment URLs through the local proxy (TV) or Mac
      // proxy. Registered once here — not per load — so retries don't stack
      // duplicate filters.
      player.getNetworkingEngine().registerRequestFilter((type, request) => {
        if (request.uris[0] && request.uris[0].startsWith('http')) {
          const originalUrl = new URL(request.uris[0]);
          const proxyBase = (typeof window !== 'undefined' && window.webOS)
            ? 'http://127.0.0.1:7654'
            : storage.getProxyUrl();
          request.uris[0] = `${proxyBase}/proxy/${originalUrl.host}${originalUrl.pathname}${originalUrl.search}`;
        }
      });

      if (mounted) loadVideo(player);
    }
    init();
    return () => { mounted = false; shakaRef.current?.destroy(); };
  }, []);

  const loadVideo = useCallback(async (player) => {
    const isBangumi = !!(video?.isBangumi || video?.epid || video?.seasonId);
    if (!video?.bvid && !video?.aid && !isBangumi) return;
    setLoading(true);
    setLoadError(false);
    castReportState({ playState: 'loading' }).catch(() => {});
    try {
      let cid = video.cid;
      let resumeProgress = video.progress || 0; // seconds; may be set from 续播
      let epid = video.epid;
      let seasonId = video.seasonId;
      let ownerMid = video.owner?.mid || null;
      let ownerName = video.owner?.name || '';

      if (isBangumi) {
        // Bangumi (PGC): resolve the episode's cid (and a concrete epid) from
        // the season listing when the history/feed item didn't carry them.
        if (!cid || !epid) {
          try {
            const info = await getBangumiInfo({ epid, seasonId });
            const result = info?.result || info?.data || {};
            const eps = result.episodes || [];
            let ep = epid ? eps.find(e => String(e.id) === String(epid)) : null;
            if (!ep) ep = eps[0];
            if (ep) { epid = ep.id || epid; cid = cid || ep.cid; }
            if (!video.title && result.season_title) setVideoTitle(result.season_title);
            seasonId = seasonId || result.season_id;
          } catch (e) { console.warn('[bangumi] season info failed:', e?.message || e); }
        }
        if (!epid && !cid) throw new Error('No bangumi epid/cid');
      }
      // UGC: always fetch the view so we have the 分P page list + aid (needed
      // for 选集 and 续播), the title and the owner.
      let ugcPages = [];
      let ugcSeason = null;
      if (!isBangumi) {
        const info = await getVideoInfo(video);
        const d = info?.data || {};
        ugcPages = d.pages || [];
        ugcSeason = d.ugc_season || null; // UGC 合集 (multi-video series)
        videoAidRef.current = d.aid || null;
        if (d.title) setVideoTitle(d.title);
        if (d.owner) {
          ownerMid = ownerMid || d.owner.mid;
          ownerName = ownerName || d.owner.name;
          if (d.owner.name) setMetaOwner(d.owner.name);
        }
        if (d.pubdate) setMetaPubdate(d.pubdate);
        setArgueMsg((d.argue_info && d.argue_info.argue_msg) || '');
        // Cast can hand us an aid-only video (no bvid). Backfill bvid from the
        // view response so heartbeat/related (which key on bvid) keep working.
        if (!video.bvid && d.bvid) video.bvid = d.bvid;
        if (!cid) cid = d.cid;
        // 续播: casual opens (resumeMode 'auto', see playIntent.js) resume at the
        // part and offset where the user last left off (player v2 last_play_*).
        // 'at' (history/cast) already carries progress; 'none' (选集/连播) starts at 0.
        if (video.resumeMode === 'auto' && d.aid && cid) {
          try {
            const pv = await getPlayerV2(d.aid, cid);
            const lc = pv?.data?.last_play_cid;
            const lt = pv?.data?.last_play_time; // ms
            if (lc && ugcPages.some(p => p.cid === lc)) {
              cid = lc;
              if (lt > 0) resumeProgress = lt / 1000;
            }
          } catch {}
        }
      }
      if (!isBangumi && !cid) throw new Error('No cid for video');
      cidRef.current = cid;
      // Chapters (view_points) for the FINAL cid — best effort. (The resume
      // lookup above may fetch player/v2 for the pre-jump cid, whose chapter
      // list would be the wrong part's.)
      setChapters([]);
      setSubTracks([]);
      selectSubtitle(null); // also bumps subReqRef → orphans in-flight bodies
      subBodyCacheRef.current = new Map(); // bodies are per-cid
      if (!isBangumi && videoAidRef.current) {
        getPlayerV2(videoAidRef.current, cid).then(pv => {
          const vp = pv?.data?.view_points;
          if (Array.isArray(vp)) {
            const ch = vp
              .filter(p => p && p.content && p.to > p.from)
              .map(p => ({ from: p.from, to: p.to, content: String(p.content).slice(0, 40) }))
              .sort((a, b) => a.from - b.from);
            if (ch.length > 0) setChapters(ch); // names translate via titleMT at render
          }
          // CC tracks ride the same response (human tracks first, then ai-zh).
          const st = pv?.data?.subtitle?.subtitles;
          if (Array.isArray(st)) {
            const tracks = st.filter(s => s && s.lan && s.subtitle_url);
            if (tracks.length > 0) {
              setSubTracks(tracks);
              // Re-enable automatically if the user had CC on last time —
              // non-zh UI prefers the translated virtual track.
              if (storage.getSettings().subtitle) {
                selectSubtitle(makeMtTrack(tracks, getLocale()) || tracks[0]);
              }
            }
          }
        }).catch(() => {});
      }
      // Seek-preview sprites (YouTube-style scrub thumbnails) — best effort.
      setVideoshot(null);
      if (!isBangumi && (video.bvid || video.aid)) {
        getVideoshot(video.bvid, cid).then(r => {
          const d2 = r?.data;
          if (d2 && Array.isArray(d2.image) && d2.image.length > 0) {
            setVideoshot({
              images: d2.image.map(u => (u.startsWith('//') ? 'https:' + u : u)),
              xLen: d2.img_x_len || 10, yLen: d2.img_y_len || 10,
              w: d2.img_x_size || 160, h: d2.img_y_size || 90,
              index: Array.isArray(d2.index) ? d2.index : null,
            });
          }
        }).catch(() => {});
      }
      // Reset the "UP主投稿" tab (regular videos only).
      upMidRef.current = isBangumi ? null : ownerMid;
      upPnRef.current = 1;
      upSeenRef.current = new Set();
      setUpVideos([]);
      setUpName(isBangumi ? '' : (ownerName || ''));
      setPanelTab('related');

      const settings = storage.getSettings();
      let loaded = false;
      let lastErr = null;
      // Quality-fallback ladder: try the best first, then drop to safer
      // qualities so a TV that can't decode the top rep (e.g. an older panel
      // facing 4K/HDR HEVC) still plays at 1080p/360p instead of black-
      // screening. `null` = the default pick (bangumi → top/HDR rep, UGC →
      // highest bitrate). Inner loop re-fetches playurl for fresh CDN nodes.
      // Step DOWN one quality tier at a time on decode failure. The old UGC
      // ladder [null,16] jumped an undecodable 8K/4K rep straight to 360p
      // (#11: an 8K video played at 360p). Prefer Dolby Vision (126) / HDR (125)
      // 4K over SDR 4K (120) on the way down, per the reporter's request, before
      // bottoming out at 1080p (80) / 360p (16).
      const qualityLadder = isBangumi ? [null, 80, 16] : [null, 126, 125, 120, 80, 16];
      for (let rung = 0; rung < qualityLadder.length && !loaded; rung++) {
        const fallbackQn = qualityLadder[rung];
        for (let attempt = 0; attempt < 2 && !loaded; attempt++) {
          try {
            let dash, meta, wantQn;
            if (isBangumi) {
              // Request the full ladder so HDR/4K reps are present; pick the
              // top rep by default, or the forced fallback quality.
              const res = await getBangumiPlayUrl({ epid, cid }, 127);
              meta = res?.result || res?.data;
              dash = meta?.dash;
              if (!dash) throw new Error('No DASH stream (bangumi — region/VIP locked?)');
              wantQn = fallbackQn != null ? fallbackQn
                : (Math.max.apply(null, (dash.video || []).map(v => v.id || 0)) || undefined);
            } else {
              // Pass the whole `video` so a cast-initiated, aid-only payload
              // still resolves via getPlayUrl's object overload.
              const res = await getPlayUrl(video, cid, fallbackQn || settings.quality || 80);
              meta = res?.data;
              dash = meta?.dash;
              if (!dash) throw new Error('No DASH stream in playurl (DRM/bangumi?)');
              // Default to the quality id B站 actually served (meta.quality), NOT
              // the highest bitrate. HDR=125 / Dolby Vision=126 reps are usually
              // lower bitrate than an SDR 4K rep, so picking by bitrate selected
              // SDR and left HDR unlit until the user manually switched (#11).
              wantQn = fallbackQn != null ? fallbackQn : (meta?.quality || undefined);
            }

            setQualities((meta?.accept_quality || []).map(q => ({ qn: q, label: QUALITY_MAP[q] || `${q}` })));
            setCurrentQuality(wantQn || meta?.quality || 80);

            const mpd = buildMPD(dash, wantQn);
            const blob = new Blob([mpd], { type: 'application/dash+xml' });
            const mpdUrl = URL.createObjectURL(blob);
            // Resume directly at the saved position via load()'s startTime — don't
            // load at 0 then seek, which buffers the intro and immediately throws
            // it away (the main cause of the long resume-load wait).
            const resumeAt = (resumeProgress > 0 && resumeProgress < (dash.duration || 9999) - 10)
              ? resumeProgress : 0;
            try {
              await player.load(mpdUrl, resumeAt || undefined);
            } finally {
              URL.revokeObjectURL(mpdUrl);
            }
            if (rung > 0) console.warn('[loadVideo] fell back to qn=' + fallbackQn + ' (top rep failed to load/decode)');
            loaded = true;
          } catch (e) {
            lastErr = e;
            console.warn('[loadVideo] rung ' + rung + ' attempt ' + (attempt + 1) + ' failed:', e?.message || e);
            const isLast = rung === qualityLadder.length - 1 && attempt === 1;
            if (!isLast) await new Promise(r => setTimeout(r, 600));
          }
        }
      }
      if (!loaded) throw lastErr || new Error('Playback load failed');

      // load(mpdUrl, resumeAt) already started playback at the saved offset.
      // For a cast-initiated resume, also queue the seek through
      // queueOrApplySeek so it still lands if duration isn't ready yet.
      if (resumeProgress > 0) {
        queueOrApplySeek(resumeProgress);
      }

      selectBestVariant(player);
      videoRef.current.play();
      setPlaying(true);
      setLoading(false);
      castReportState({ playState: 'playing' }).catch(() => {});

      videoRef.current.addEventListener('ended', () => {
        castReportState({ playState: 'end' }).catch(() => {});
        // Multi-part (分P) auto-advance: play the next part of THIS video before
        // anything else, so a 66-讲 series plays straight through (#11).
        // Order-play (收藏夹顺序播放, #11): a favorites playlist takes PRIORITY
        // over 分P/合集 auto-advance — when the user is playing their favorites
        // folder in order and one item happens to be a single part of a multi-P
        // video, finishing it should move to the next FAVORITE, not binge the
        // other 65 parts (per @ZMonsterror's request).
        const pl = video?.playlist;
        const idx = video?.playlistIndex;
        if (pl && Array.isArray(pl) && typeof idx === 'number' && idx + 1 < pl.length && onPlayNext) {
          const next = pl[idx + 1];
          onPlayNext(playAdvance({ ...next, playlist: pl, playlistIndex: idx + 1 }));
          return;
        }
        // Multi-part (分P/合集) auto-advance: play the next part of THIS video
        // (only when not inside a favorites playlist).
        const parts = partsRef.current;
        if (parts.length > 1 && onPlayNext) {
          const pi = parts.findIndex(p => p.cid === cidRef.current);
          if (pi >= 0 && pi + 1 < parts.length) {
            onPlayNext(playAdvance({ ...parts[pi + 1] }));
            return;
          }
        }
        // Land back on the NORMAL player page (controls pinned + panel open)
        // instead of a modal end screen — the old overlay trapped the D-pad in
        // its grid, so 重播/选集/画质 were unreachable after playback finished.
        setEnded(true);
        setShowControls(true);
        setShowRelated(true);
        setPanelTab('related');
        setFocusArea('related');
        setFocusIdx(0);
        if (relatedRef.current.length > 0) setEndNextIn(10); // YouTube-style autoplay next
      });

      try { setDanmakus(await getDanmaku(cid)); } catch {}
      if (isBangumi) {
        // "相关推荐" → the season's episode list; each plays via the PGC path.
        try {
          const info = await getBangumiInfo({ epid, seasonId });
          const result = info?.result || info?.data || {};
          const eps = (result.episodes || []).map(e => ({
            isBangumi: true, epid: e.id, cid: e.cid,
            title: e.long_title ? t('第{n}话', { n: e.title }) + ' ' + e.long_title : (e.share_copy || t('第{n}话', { n: e.title })),
            pic: e.cover, owner: { name: result.season_title || '' },
          }));
          setRelatedVideos(eps.slice(0, 60));
        } catch {}
      } else {
        // UGC. Build the 选集 (分P or 合集) if present, kept SEPARATE from 相关推荐
        // so both get their own tab (#11).
        let parts = [];
        if (ugcPages.length > 1) {
          // 分P: same bvid/aid, different cid per part.
          parts = ugcPages.map(p => ({
            bvid: video.bvid, aid: videoAidRef.current, cid: p.cid, page: p.page,
            title: `P${p.page} ${p.part || ''}`.trim(), duration: p.duration,
            pic: video.pic, owner: { name: ownerName || '' },
          }));
          setPartsLabel(t('选集 · {n}P', { n: parts.length }));
        } else if (ugcSeason && (ugcSeason.sections || []).some(s => (s.episodes || []).length > 1)) {
          // 合集: separate videos (own bvid) grouped into a series.
          (ugcSeason.sections || []).forEach(sec => (sec.episodes || []).forEach(e => parts.push({
            bvid: e.bvid, aid: e.aid, cid: e.cid,
            title: e.title, duration: e.arc?.duration, pic: e.arc?.pic || e.cover,
            owner: { name: ownerName || '' },
          })));
          setPartsLabel(t('合集 · {n}', { n: parts.length }));
        }
        partsRef.current = parts;
        setPartsList(parts);
        setIsMultiP(parts.length > 0);
        if (parts.length > 0) setPanelTab('parts');
        // Always fetch 相关推荐 too (its own tab).
        try {
          const rel = await getRelated(video.bvid);
          setRelatedVideos((rel?.data || []).slice(0, 12));
        } catch {}
      }
    } catch (err) {
      console.error('Load video error:', err?.message || err);
      // Order-play: a 失效 (taken-down) video in a favorites folder throws here —
      // don't dead-end on the error screen, just skip to the next item (#11).
      const pl = video?.playlist;
      const idx = video?.playlistIndex;
      if (pl && Array.isArray(pl) && typeof idx === 'number' && idx + 1 < pl.length && onPlayNext) {
        onPlayNext(playAdvance({ ...pl[idx + 1], playlist: pl, playlistIndex: idx + 1 }));
        return;
      }
      setLoading(false);
      setLoadError(true);
      castReportState({ playState: 'error', error: err?.message || 'load-failed' }).catch(() => {});
    }
  }, [video, queueOrApplySeek, selectSubtitle, makeMtTrack]);

  function buildMPD(dash, wantQn) {
    const duration = dash.duration || 0;
    const minBuffer = dash.minBufferTime || 1.5;
    // ABR is off and manual quality re-fetches playurl, so the MPD only needs
    // the single highest-bitrate video + audio. Emitting every quality/codec
    // (B站 returns AVC+HEVC+AV1 × resolutions) makes Shaka's parse/codec-probe
    // on the TV's weak CPU take several seconds before the first byte loads.
    const pickBest = (arr) => (arr && arr.length)
      ? [arr.reduce((a, b) => ((b.bandwidth || 0) > (a.bandwidth || 0) ? b : a))] : [];
    // When a specific quality is wanted (manual pick, or bangumi defaulting to
    // its top rep), select by B站's quality id — HDR=125 / Dolby Vision=126 are
    // keyed by id, and the HDR rep is usually NOT the highest bitrate (an SDR
    // AVC rep often is), so picking by bitrate alone never lights up HDR.
    const pickRep = (arr) => {
      if (!arr || !arr.length) return [];
      if (!wantQn) return pickBest(arr);
      let pool = arr.filter(v => v.id === wantQn);
      if (!pool.length) {
        const ids = Array.from(new Set(arr.map(v => v.id))).sort((a, b) => b - a);
        const t = ids.find(id => id <= wantQn);
        pool = arr.filter(v => v.id === (t != null ? t : ids[0]));
      }
      return [pool.reduce((a, b) => ((b.bandwidth || 0) > (a.bandwidth || 0) ? b : a))];
    };
    const videoList = pickRep(dash.video);
    const audioList = pickBest(dash.audio);
    let videoAdaptations = '';
    if (videoList.length > 0) {
      const reps = videoList.map(v => {
        return `<Representation id="${v.id}" bandwidth="${v.bandwidth || 1000000}" codecs="${v.codecs || 'avc1.640032'}" mimeType="${v.mimeType || 'video/mp4'}" width="${v.width || 1920}" height="${v.height || 1080}" frameRate="${v.frameRate || v.frame_rate || '30'}">
          ${buildBaseUrls(v)}
          <SegmentBase indexRange="${v.SegmentBase?.indexRange || v.segment_base?.index_range || '0-0'}">
            <Initialization range="${v.SegmentBase?.Initialization || v.segment_base?.initialization || '0-0'}" />
          </SegmentBase>
        </Representation>`;
      }).join('\n');
      videoAdaptations = `<AdaptationSet contentType="video" mimeType="video/mp4" segmentAlignment="true">${reps}</AdaptationSet>`;
    }
    let audioAdaptations = '';
    if (audioList.length > 0) {
      const reps = audioList.map(a => {
        return `<Representation id="${a.id}" bandwidth="${a.bandwidth || 128000}" codecs="${a.codecs || 'mp4a.40.2'}" mimeType="${a.mimeType || 'audio/mp4'}">
          ${buildBaseUrls(a)}
          <SegmentBase indexRange="${a.SegmentBase?.indexRange || a.segment_base?.index_range || '0-0'}">
            <Initialization range="${a.SegmentBase?.Initialization || a.segment_base?.initialization || '0-0'}" />
          </SegmentBase>
        </Representation>`;
      }).join('\n');
      audioAdaptations = `<AdaptationSet contentType="audio" mimeType="audio/mp4" segmentAlignment="true">${reps}</AdaptationSet>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
  type="static" mediaPresentationDuration="PT${duration}S" minBufferTime="PT${minBuffer}S">
  <Period>${videoAdaptations}${audioAdaptations}</Period>
</MPD>`;
  }

  function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Emit primary + backup CDN URLs as multiple <BaseURL> elements so Shaka can
  // fail over when a node returns bad/short data (the cause of the "Payload
  // length does not match range requested bytes" + Shaka 1001 load failures).
  //
  // B站's primary baseUrl is usually a flaky PCDN/P2P node (mcdn.bilivideo.cn
  // on a non-standard port), while a stable origin CDN (upos / *.bilivideo.com
  // on :443) sits in backupUrl. Order origin FIRST so Shaka prefers it and only
  // falls back to PCDN if the origin is unreachable.
  // Forceable CDN mirror hosts (#10, requested by randef1ned): all are B站's own
  // upos mirrors; swapping the host among them is a stability lever when the
  // auto-assigned node is slow. The signed query params stay valid across them.
  const CDN_ROUTES = {
    ali: 'upos-sz-mirrorali.bilivideo.com',
    cos: 'upos-sz-mirrorcos.bilivideo.com',
    ks3: 'upos-sz-mirrorks3.bilivideo.com',
    // Overseas Akamai mirror — the mainland CDNs are often unreachable/slow
    // outside China; this is the route for overseas users (#10, randef1ned).
    akam: 'upos-hz-mirrorakam.akamaized.net',
  };

  function buildBaseUrls(rep) {
    let urls = [];
    const primary = rep.baseUrl || rep.base_url;
    if (primary) urls.push(primary);
    const backups = rep.backupUrl || rep.backup_url || [];
    for (let i = 0; i < backups.length; i++) {
      if (backups[i]) urls.push(backups[i]);
    }
    const seen = {};
    urls = urls.filter(u => (seen[u] ? false : (seen[u] = true)));
    const isPcdn = (u) => /mcdn\.|szbdyd|\bxy[\dx]+xy\b|:\d{4,5}\//i.test(u);
    urls.sort((a, b) => (isPcdn(a) ? 1 : 0) - (isPcdn(b) ? 1 : 0));
    // 设置 → CDN线路: put ONE URL rewritten to the chosen mirror host in front
    // (after the pcdn sort — Chromium 68's sort isn't stable), keeping all the
    // originals behind it as Shaka failover targets.
    const routeHost = CDN_ROUTES[storage.getSettings().cdnRoute];
    if (routeHost) {
      for (let i = 0; i < urls.length; i++) {
        if (/upos-|\.bilivideo\.(com|cn)/i.test(urls[i])) {
          try {
            const u = new URL(urls[i]);
            u.host = routeHost;
            if (urls.indexOf(u.toString()) === -1) urls.unshift(u.toString());
            break;
          } catch { /* keep originals */ }
        }
      }
    }
    return urls
      .map(u => `<BaseURL>${escapeXml(u)}</BaseURL>`)
      .join('\n          ') || '<BaseURL></BaseURL>';
  }

  // With ABR disabled, explicitly pin to the highest-bandwidth variant so the
  // stream stays at the requested quality (B站 only returns variants <= the
  // requested qn, so "highest" == the chosen quality ceiling).
  function selectBestVariant(player) {
    try {
      const variants = player.getVariantTracks();
      if (!variants || !variants.length) return;
      const best = variants.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
      const active = variants.find(v => v.active);
      // load() already picks the first (highest) variant with ABR off — only
      // switch if it isn't already best, and DON'T clear the buffer (avoids a
      // wasteful full re-download that made loading slow).
      if (active && active.id === best.id) return;
      player.selectVariantTrack(best, /* clearBuffer */ false);
    } catch (e) { /* ignore */ }
  }

  // Time update
  useEffect(() => {
    timeUpdateRef.current = setInterval(() => {
      if (videoRef.current) {
        const nextCurrentTime = videoRef.current.currentTime;
        const nextDuration = videoRef.current.duration || 0;
        setCurrentTime(nextCurrentTime);
        setDuration(nextDuration);
        castReportProgress({
          duration: Math.floor(nextDuration),
          position: Math.floor(nextCurrentTime),
        }).catch(() => {});
      }
    }, 500);
    return () => clearInterval(timeUpdateRef.current);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const handlePlay = () => {
      setPlaying(true);
      setEnded(false); // replay (play() on an ended video restarts at 0)
      setEndNextIn(null);
      castReportState({ playState: 'playing' }).catch(() => {});
    };
    const handleLoadedMetadata = () => flushPendingSeek();
    const handleCanPlay = () => flushPendingSeek();

    const handlePause = () => {
      if (!ended) castReportState({ playState: 'paused' }).catch(() => {});
      setPlaying(false);
    };

    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);
    el.addEventListener('loadedmetadata', handleLoadedMetadata);
    el.addEventListener('canplay', handleCanPlay);
    return () => {
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
      el.removeEventListener('canplay', handleCanPlay);
    };
  }, [ended, flushPendingSeek]);

  useEffect(() => {
    return () => {
      castReportState({ playState: 'stop' }).catch(() => {});
      // Report the FINAL position on exit — the 15s interval alone leaves the
      // resume point up to 15s stale, which reads as "没续播上".
      const v = videoRef.current;
      if (v && video?.bvid && cidRef.current && v.currentTime > 0) {
        reportHeartbeat(video.bvid, cidRef.current, v.currentTime, (Date.now() - startTimeRef.current) / 1000);
        // Local progress map: every list's cards draw the resume bar from this.
        storage.setProgress(video.bvid, v.currentTime, v.duration || 0);
      }
      // Wake the (mounted, memo'd) list cards so their bars show this session.
      storage.notifyProgressChange();
    };
  }, []);

  useEffect(() => { relatedRef.current = relatedVideos; }, [relatedVideos]);

  // End-screen autoplay countdown.
  useEffect(() => {
    if (endNextIn == null) return;
    if (endNextIn <= 0) {
      const rv = relatedRef.current[0];
      setEndNextIn(null);
      if (rv && onPlayNext) onPlayNext(rv);
      return;
    }
    const t = setTimeout(() => setEndNextIn(v => (v == null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [endNextIn, onPlayNext]);

  // Heartbeat
  useEffect(() => {
    const hb = setInterval(() => {
      if (videoRef.current && video?.bvid && cidRef.current && !videoRef.current.paused) {
        reportHeartbeat(video.bvid, cidRef.current, videoRef.current.currentTime, (Date.now() - startTimeRef.current) / 1000);
        storage.setProgress(video.bvid, videoRef.current.currentTime, videoRef.current.duration || 0);
      }
    }, 15000);
    return () => clearInterval(hb);
  }, [video?.bvid]);

  // Stall watchdog: if playback freezes mid-video (segment error, network
  // hiccup) and Shaka doesn't recover on its own, retry streaming; if it's
  // still stuck, nudge currentTime to force a re-buffer.
  // Fixes "plays halfway, freezes, and never resumes".
  useEffect(() => {
    let lastTime = -1;
    let stalledSec = 0;
    const iv = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended || v.seeking || v.readyState < 2) {
        stalledSec = 0;
        lastTime = v ? v.currentTime : -1;
        return;
      }
      if (Math.abs(v.currentTime - lastTime) < 0.05) {
        stalledSec += 1;
        if (stalledSec === 3) {
          console.warn('[watchdog] playback stalled 3s, retrying streaming');
          try { shakaRef.current?.retryStreaming(); } catch {}
        } else if (stalledSec >= 8) {
          console.warn('[watchdog] still stalled, nudging currentTime');
          try { v.currentTime = v.currentTime + 0.5; v.play(); } catch {}
          stalledSec = 0;
        }
      } else {
        stalledSec = 0;
      }
      lastTime = v.currentTime;
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // When focus returns to the tab row, scroll it back into view — the grid may
  // have scrolled the panel down, leaving the tabs (and focus) off-screen.
  useEffect(() => {
    if (focusArea === 'tabs') {
      const el = document.querySelector('.panel-tab-row');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusArea]);

  // ===== Scrub (deferred seek) =====
  const clearScrub = useCallback(() => {
    if (scrubTimerRef.current) { clearTimeout(scrubTimerRef.current); scrubTimerRef.current = null; }
    scrubTargetRef.current = null;
    setScrubTarget(null);
  }, []);

  const commitScrubRef = useRef(null);
  const commitScrub = useCallback(() => {
    const t = scrubTargetRef.current;
    clearScrub();
    const v = videoRef.current;
    if (t != null && v && !isNaN(v.duration)) {
      v.currentTime = Math.min(t, Math.max(0, v.duration - 1));
      if (v.paused) { v.play(); setPlaying(true); }
    }
    setFocusArea('none');
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      setShowControls(false); setShowRelated(false); setShowQuality(false);
    }, 1200);
  }, [clearScrub]);
  commitScrubRef.current = commitScrub;

  const scrubBy = useCallback((dir) => {
    const v = videoRef.current;
    if (!v || !v.duration || isNaN(v.duration)) return;
    const now = Date.now();
    const st = scrubStreakRef.current;
    st.n = (now - st.last < 800) ? st.n + 1 : 1;
    st.last = now;
    const step = st.n < 4 ? 10 : st.n < 10 ? 30 : 60; // accelerate like YouTube
    const base = scrubTargetRef.current != null ? scrubTargetRef.current : v.currentTime;
    const target = Math.max(0, Math.min(v.duration - 1, base + dir * step));
    scrubTargetRef.current = target;
    setScrubTarget(target);
    setShowControls(true);
    setFocusArea('scrub');
    if (controlsTimer.current) clearTimeout(controlsTimer.current); // don't auto-hide mid-scrub
    if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
    scrubTimerRef.current = setTimeout(() => commitScrubRef.current && commitScrubRef.current(), 1000);
  }, []);

  // Auto-hide controls
  const hideControlsLater = useCallback(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!ended) {
        setShowControls(false);
        setShowRelated(false);
        setShowQuality(false);
        setShowSubPanel(false); // never strand a selection panel without its bar
        setFocusArea('none');
      }
    }, 5000);
  }, [ended]);

  const openControls = useCallback(() => {
    setShowControls(true);
    setFocusArea('controls');
    setFocusIdx(0);
    hideControlsLater();
  }, [hideControlsLater]);

  // One entry for a control-bar action — shared by D-pad OK and pointer click
  // (the Magic Remote pointer must drive every button the D-pad can).
  const pressControl = useCallback((btn) => {
    if (btn === 'play') {
      if (videoRef.current.paused) {
        videoRef.current.play(); setPlaying(true);
        castReportState({ playState: 'playing' }).catch(() => {});
      } else {
        videoRef.current.pause(); setPlaying(false);
        castReportState({ playState: 'paused' }).catch(() => {});
      }
    } else if (btn === 'danmaku') {
      setDanmakuEnabled(prev => {
        const next = !prev;
        // Persist — the live player and 设置 already do; the VOD button not
        // doing so made the player and 设置 disagree (owner report).
        storage.setSettings({ ...storage.getSettings(), danmaku: next });
        return next;
      });
    } else if (btn === 'subtitle') {
      setShowSubPanel(true);
      setFocusArea('subpanel');
      const cur = subOptions.findIndex(o => o.key === (subLan || 'off'));
      setFocusIdx(cur < 0 ? 0 : cur);
      // A selection panel means the user is mid-decision: suspend auto-hide
      // until they pick or back out (restarted on close).
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      // Prefetch the likeliest track's body while they decide.
      if (subTracks[0]) fetchSubBody(subTracks[0].subtitle_url).catch(() => {});
      return;
    } else if (btn === 'quality') {
      setShowQuality(true);
      setFocusArea('quality');
      setFocusIdx(0);
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      return;
    }
    hideControlsLater();
  }, [subOptions, subLan, subTracks, fetchSubBody, hideControlsLater]);

  // Load more related videos
  const loadingRelatedRef = useRef(false);
  const relatedSeenRef = useRef(new Set());
  const loadMoreRelated = useCallback(async () => {
    if (loadingRelatedRef.current || relatedVideos.length === 0) return;
    loadingRelatedRef.current = true;
    try {
      // Use last video's bvid to get its related
      const lastBvid = relatedVideos[relatedVideos.length - 1]?.bvid;
      if (lastBvid) {
        const rel = await getRelated(lastBvid);
        const newItems = (rel?.data || []).filter(v => {
          if (relatedSeenRef.current.has(v.bvid)) return false;
          relatedSeenRef.current.add(v.bvid);
          return true;
        }).slice(0, 8);
        if (newItems.length > 0) {
          setRelatedVideos(prev => [...prev, ...newItems]);
        }
      }
    } catch {}
    loadingRelatedRef.current = false;
  }, [relatedVideos]);

  // Init seen set when related first loads
  useEffect(() => {
    relatedSeenRef.current = new Set(relatedVideos.map(v => v.bvid).filter(Boolean));
  }, [relatedVideos.length === 0]);

  // Load this uploader's videos (newest first) for the "UP主投稿" tab.
  // reset=true starts fresh; otherwise appends the next page.
  const loadUpVideos = useCallback(async (reset) => {
    if (upLoadingRef.current) return;
    let mid = upMidRef.current;
    // The list item may not have carried owner.mid — resolve it lazily.
    if (!mid && video?.bvid) {
      try {
        const info = await getVideoInfo(video.bvid);
        mid = info?.data?.owner?.mid || null;
        upMidRef.current = mid;
        if (info?.data?.owner?.name) setUpName(info.data.owner.name);
      } catch {}
    }
    if (!mid) return;
    upLoadingRef.current = true;
    try {
      if (reset) { upPnRef.current = 1; upSeenRef.current = new Set(); }
      const res = await getUpVideos(mid, upPnRef.current, 30);
      const vlist = (res?.data?.list?.vlist) || [];
      const mapped = vlist.filter(v => v.bvid && !upSeenRef.current.has(v.bvid)).map(v => {
        upSeenRef.current.add(v.bvid);
        return {
          bvid: v.bvid,
          title: v.title,
          pic: v.pic,
          owner: { name: v.author, mid: v.mid },
          pubdate: v.created,
        };
      });
      setUpVideos(prev => reset ? mapped : [...prev, ...mapped]);
      upPnRef.current += 1;
    } catch (e) {
      console.warn('[loadUpVideos] failed:', e?.message || e);
    }
    upLoadingRef.current = false;
  }, [video]);

  // Change quality
  const changeQuality = useCallback(async (qn) => {
    const isBangumi = !!(video?.isBangumi || video?.epid || video?.seasonId);
    if ((!video?.bvid && !video?.aid && !isBangumi) || !shakaRef.current) return;
    setCurrentQuality(qn);
    storage.setSettings({ ...storage.getSettings(), quality: qn });
    try {
      let cid = video.cid || cidRef.current;
      let dash;
      if (isBangumi) {
        const res = await getBangumiPlayUrl({ epid: video.epid, cid }, qn);
        dash = (res?.result || res?.data)?.dash;
      } else {
        const res = await getPlayUrl(video, cid, qn);
        dash = res?.data?.dash;
      }
      if (dash) {
        const pos = videoRef.current.currentTime;
        // Honor the picked quality id (this is how HDR=125 / Dolby=126 get
        // selected — they aren't the highest-bitrate rep).
        const mpd = buildMPD(dash, qn);
        const blob = new Blob([mpd], { type: 'application/dash+xml' });
        const mpdUrl = URL.createObjectURL(blob);
        await shakaRef.current.load(mpdUrl);
        URL.revokeObjectURL(mpdUrl);
        selectBestVariant(shakaRef.current);
        videoRef.current.currentTime = pos;
        videoRef.current.play();
        setCurrentQuality(qn);
      }
    } catch (e) {
      console.error('Quality change error:', e);
    }
  }, [video]);

  useEffect(() => {
    storage.setSettings({ ...storage.getSettings(), danmaku: danmakuEnabled });
  }, [danmakuEnabled]);

  useEffect(() => {
    const handleCastCommand = (event) => {
      const command = event.detail;
      if (!command || !videoRef.current) return;

      if (command.type === 'pause') {
        videoRef.current.pause();
        setPlaying(false);
        castReportState({ playState: 'paused' }).catch(() => {});
        return;
      }
      if (command.type === 'resume') {
        videoRef.current.play();
        setPlaying(true);
        castReportState({ playState: 'playing' }).catch(() => {});
        return;
      }
      if (command.type === 'seek') {
        queueOrApplySeek(command.positionSec);
        castReportProgress({
          duration: Math.floor(videoRef.current.duration || 0),
          position: Math.floor(videoRef.current.currentTime || 0),
        }).catch(() => {});
        return;
      }
      if (command.type === 'switchDanmaku') {
        setDanmakuEnabled(!!command.open);
        return;
      }
      if (command.type === 'stop') {
        videoRef.current.pause();
        onBack?.();
      }
    };

    window.addEventListener('bili-cast-command', handleCastCommand);
    return () => window.removeEventListener('bili-cast-command', handleCastCommand);
  }, [onBack, queueOrApplySeek]);

  // ========== Keyboard handler ==========
  useEffect(() => {
    const handler = (e) => {
      // End-screen countdown: OK plays the up-next video immediately; any
      // other key cancels autoplay and continues as normal navigation.
      if (ended && endNextIn != null) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const rv = relatedRef.current[0];
          setEndNextIn(null);
          if (rv && onPlayNext) onPlayNext(rv);
          return true;
        }
        setEndNextIn(null); // cancel, then fall through
      }
      if (e.keyCode === 461 || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        if (scrubTargetRef.current != null) {
          // Scrubbing: back cancels the pending seek, keep watching
          clearScrub();
          setShowControls(false);
          setFocusArea('none');
        } else if (ended) {
          // End screen: back exits player
          onBack();
        } else if (showControls || showQuality || showRelated || showSubPanel) {
          // Controls/quality/subtitle/related visible: close them
          setShowControls(false);
          setShowQuality(false);
          setShowSubPanel(false);
          setShowRelated(false);
          setFocusArea('none');
          if (controlsTimer.current) clearTimeout(controlsTimer.current);
        } else {
          // Nothing visible: exit player
          onBack();
        }
        return true;
      }

      // === No controls visible (focusArea === 'none') ===
      if (focusArea === 'none') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          scrubBy(-1);
          return true;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          scrubBy(1);
          return true;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          openControls();
          return true;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          // Toggle play/pause
          if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true); }
          else { videoRef.current.pause(); setPlaying(false); }
          return true;
        }
        return false;
      }

      // === Scrubbing (deferred seek with ghost playhead) ===
      if (focusArea === 'scrub') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); scrubBy(-1); return true; }
        if (e.key === 'ArrowRight') { e.preventDefault(); scrubBy(1); return true; }
        if (e.key === 'Enter') { e.preventDefault(); commitScrub(); return true; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // Leave scrub without seeking and hand over to the normal controls
          e.preventDefault();
          clearScrub();
          openControls();
          return true;
        }
        return true;
      }

      // === Controls visible ===
      if (focusArea === 'controls') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setFocusIdx(prev => Math.max(0, prev - 1));
          hideControlsLater();
          return true;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setFocusIdx(prev => Math.min(CONTROLS.length - 1, prev + 1));
          hideControlsLater();
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (partsList.length > 0 || relatedVideos.length > 0 || upMidRef.current) {
            setShowRelated(true);
            setFocusArea('tabs');
            if (controlsTimer.current) clearTimeout(controlsTimer.current);
          }
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          // Close controls
          setShowControls(false);
          setShowRelated(false);
          setShowQuality(false);
          setFocusArea('none');
          if (controlsTimer.current) clearTimeout(controlsTimer.current);
          return true;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          pressControl(CONTROLS[focusIdx]);
          return true;
        }
        return false;
      }

      // === Subtitle panel (same pattern as quality) ===
      if (focusArea === 'subpanel') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusIdx(prev => Math.max(0, prev - 1));
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusIdx(prev => Math.min(subOptions.length - 1, prev + 1));
          return true;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          applySubOption(subOptions[focusIdx]);
          setShowSubPanel(false);
          setFocusArea('controls');
          setFocusIdx(CONTROLS.indexOf('subtitle'));
          hideControlsLater(); // decision made — resume the auto-hide clock
          return true;
        }
        return false;
      }

      // === Quality panel ===
      if (focusArea === 'quality') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusIdx(prev => Math.max(0, prev - 1));
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusIdx(prev => Math.min(qualities.length - 1, prev + 1));
          return true;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = qualities[focusIdx];
          if (q) { changeQuality(q.qn); setShowQuality(false); setFocusArea('controls'); setFocusIdx(CONTROLS.indexOf('quality')); hideControlsLater(); }
          return true;
        }
        return false;
      }

      // Scroll the focused related card into view
      function scrollRelatedIntoView(idx) {
        setTimeout(() => {
          const cards = document.querySelectorAll('.related-card');
          if (cards[idx]) {
            cards[idx].scrollIntoView({ block: 'nearest' });
          }
        }, 30);
      }

      // === Tab row (相关推荐 / UP主投稿) ===
      if (focusArea === 'tabs') {
        e.preventDefault();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const keys = isMultiP ? ['parts', 'related', 'up'] : ['related', 'up'];
          let i = keys.indexOf(panelTab); if (i < 0) i = 0;
          i = e.key === 'ArrowRight' ? (i + 1) % keys.length : (i - 1 + keys.length) % keys.length;
          const next = keys[i];
          setPanelTab(next);
          setFocusIdx(0);
          if (next === 'up' && upVideos.length === 0) loadUpVideos(true);
        } else if (e.key === 'ArrowUp') {
          setFocusArea('controls');
          setFocusIdx(0);
        } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
          setFocusArea('related'); // enter the grid (shows the active tab's list)
          setFocusIdx(0);
        }
        return true;
      }

      // === Video grid for the active tab (4-column) ===
      if (focusArea === 'related') {
        const RCOLS = 4;
        const gridList = panelTab === 'parts' ? partsList : panelTab === 'up' ? upVideos : relatedVideos;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (focusIdx % RCOLS > 0) {
            setFocusIdx(prev => prev - 1);
            scrollRelatedIntoView(focusIdx - 1);
          }
          return true;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (focusIdx % RCOLS < RCOLS - 1 && focusIdx < gridList.length - 1) {
            setFocusIdx(prev => prev + 1);
            scrollRelatedIntoView(focusIdx + 1);
          }
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (focusIdx >= RCOLS) {
            const newIdx = focusIdx - RCOLS;
            setFocusIdx(newIdx);
            scrollRelatedIntoView(newIdx);
          } else {
            setFocusArea('tabs'); // top row → back up to the tab bar
          }
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = focusIdx + RCOLS;
          if (nextIdx < gridList.length) {
            setFocusIdx(nextIdx);
            scrollRelatedIntoView(nextIdx);
          } else {
            if (panelTab === 'up') loadUpVideos(false);
            else loadMoreRelated();
          }
          return true;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const rv = gridList[focusIdx];
          if (rv && onPlayNext) onPlayNext(panelTab === 'parts' ? playPart(rv) : rv);
          return true;
        }
        return false;
      }

      return false;
    };

    setCustomKeyHandler(handler);
    return () => setCustomKeyHandler(null);
  }, [focusArea, focusIdx, qualities, showControls, showQuality, showRelated, showSubPanel, ended, endNextIn, relatedVideos, partsList, isMultiP, panelTab, upVideos, loadUpVideos, onBack, onPlayNext, openControls, hideControlsLater, changeQuality, scrubBy, commitScrub, clearScrub, subTracks, subLan, subOptions, applySubOption, fetchSubBody, pressControl]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Magic Remote: waving the pointer must summon the controls bar (the D-pad
  // path was the only way in). Throttled; ignored while a panel/end screen has
  // its own interaction going.
  const lastMoveRef = useRef(0);
  const handlePointerMove = useCallback(() => {
    const now = Date.now();
    if (now - lastMoveRef.current < 400) return;
    lastMoveRef.current = now;
    if (ended) return;
    if (!showControls) { setShowControls(true); setFocusArea('controls'); setFocusIdx(0); }
    if (!showSubPanel && !showQuality) hideControlsLater();
  }, [ended, showControls, showSubPanel, showQuality, hideControlsLater]);

  return (
    <div className="player-page" onMouseMove={handlePointerMove}>
      <video ref={videoRef} className="player-video" />

      <DanmakuLayer danmakus={danmakus} currentTime={currentTime} enabled={danmakuEnabled} fontScale={danmakuScale}
        mtRef={dmMtActive ? dmMtRef : null} />

      <SubtitleLayer videoRef={videoRef} cues={subCues} enabled={subLan != null}
        lead={(isAiLan(subLan) || subLan === 'x-mt') ? AI_LEAD : 0}
        lift={showControls ? (showRelated ? 2 : 1) : 0} fontScale={subtitleScale} />

      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', zIndex: 50 }}>
          <div className="loading"><div className="loading-spinner" />{t('加载中...')}</div>
        </div>
      )}

      {loadError && !loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, background: 'rgba(0,0,0,0.85)', zIndex: 50 }}>
          <div style={{ fontSize: 26, color: '#fff' }}>{errorMsg || t('视频加载失败')}</div>
          <div style={{ fontSize: 18, color: '#aaa' }}>
            {errorMsg ? t('请按返回键退出') : t('该视频源节点异常,请按返回键重试或换一个视频')}
          </div>
        </div>
      )}


      {/* Scrub bubble (thumb + chapter + time) — rendered at the ROOT on purpose:
          .player-controls is overflow-y:auto, which clipped the bubble (#11). */}
      {scrubTarget != null && duration > 0 && (() => {
        const pct = Math.min(100, Math.max(0, (scrubTarget / duration) * 100));
        const bubblePct = Math.min(88, Math.max(12, pct));
        const delta = Math.round(scrubTarget - currentTime);
        let thumb = null;
        if (videoshot) {
          const per = videoshot.xLen * videoshot.yLen;
          const total = videoshot.images.length * per;
          let f;
          if (videoshot.index && videoshot.index.length > 1) {
            f = 0;
            while (f < videoshot.index.length - 1 && videoshot.index[f + 1] <= scrubTarget) f++;
          } else {
            f = Math.floor((scrubTarget / duration) * total);
          }
          f = Math.max(0, Math.min(total - 1, f));
          const sheet = Math.floor(f / per), local = f % per;
          const col = local % videoshot.xLen, row = Math.floor(local / videoshot.xLen);
          // Frame size varies per video (160/480 wide). Cap upscaling at 1.5x —
          // a 160px frame stretched to 320px is visibly mushy (#11); large
          // 480px frames still downscale to a sharp 320px.
          const SC = Math.min(320 / videoshot.w, 1.5);
          thumb = {
            url: proxyImgRaw(videoshot.images[sheet]),
            w: Math.round(videoshot.w * SC), h: Math.round(videoshot.h * SC),
            size: `${Math.round(videoshot.xLen * videoshot.w * SC)}px ${Math.round(videoshot.yLen * videoshot.h * SC)}px`,
            pos: `-${Math.round(col * videoshot.w * SC)}px -${Math.round(row * videoshot.h * SC)}px`,
          };
        }
        const ch = chapters.find(c => scrubTarget >= c.from && scrubTarget < c.to);
        return (
          <div style={{
            position: 'absolute',
            left: `calc(60px + ${bubblePct} * (100% - 120px) / 100)`,
            bottom: 104, transform: 'translateX(-50%)',
            textAlign: 'center', pointerEvents: 'none', zIndex: 80,
          }}>
            {thumb && (
              <div style={{
                width: thumb.w, height: thumb.h,
                backgroundImage: `url(${thumb.url})`,
                backgroundSize: thumb.size, backgroundPosition: thumb.pos,
                borderRadius: 8, border: '3px solid rgba(255,255,255,0.9)',
                margin: '0 auto 8px', boxShadow: '0 4px 18px rgba(0,0,0,0.6)',
              }} />
            )}
            {ch && (
              <div style={{
                fontSize: 18, color: '#fff', marginBottom: 6,
                background: 'rgba(0,0,0,0.75)', padding: '3px 12px', borderRadius: 6,
                display: 'inline-block', maxWidth: 360,
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>{titleMT(ch.content)}</div>
            )}
            <div>
              <span style={{
                fontSize: 22, color: '#fff', fontWeight: 600,
                background: 'rgba(0,0,0,0.75)', padding: '4px 14px', borderRadius: 6,
              }}>
                {formatDuration(scrubTarget)}
                <span style={{ color: '#7ecbff', marginLeft: 8, fontSize: 18 }}>
                  {delta >= 0 ? `+${delta}s` : `${delta}s`}
                </span>
              </span>
            </div>
          </div>
        );
      })()}

      {/* End screen (YouTube-TV style): dim + up-next autoplay card */}
      {ended && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.55)' }} />
      )}
      {ended && endNextIn != null && relatedVideos[0] && (
        <div style={{
          position: 'absolute', top: '14%', left: '50%', transform: 'translateX(-50%)',
          textAlign: 'center', cursor: 'pointer',
        }}
          onClick={() => { // pointer click on the up-next card = OK (play now)
            const rv = relatedRef.current[0];
            setEndNextIn(null);
            if (rv && onPlayNext) onPlayNext(rv);
          }}>
          <div style={{ fontSize: 22, color: '#aeb4bd', marginBottom: 14, letterSpacing: 6 }}>{t('接下来播放')}</div>
          <div style={{
            width: 560, borderRadius: 12, overflow: 'hidden', margin: '0 auto',
            border: '1px solid rgba(255,255,255,0.16)',
            boxShadow: '0 18px 60px rgba(0,0,0,0.75)',
            background: '#0d1020',
          }}>
            <div style={{ width: '100%', height: 315, background: '#0a0d1a', position: 'relative' }}>
              {relatedVideos[0].pic && (
                <img src={proxyImg(relatedVideos[0].pic)} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {/* quiet countdown: a thin progress line filling along the cover's bottom edge */}
              <div style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 3, background: 'rgba(255,255,255,0.18)' }}>
                <div style={{
                  height: '100%', background: 'rgba(255,255,255,0.85)',
                  width: `${Math.min(100, ((10 - endNextIn) / 10) * 100)}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
            </div>
            <div style={{ padding: '14px 18px 6px', fontSize: 24, color: '#f0f0f0', lineHeight: 1.45, textAlign: 'left',
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {titleMT(cleanTitle(relatedVideos[0].title))}
            </div>
            {(relatedVideos[0].owner?.name || relatedVideos[0].pubdate) && (
              <div style={{ padding: '0 18px 14px', fontSize: 18, color: '#9aa0a8', textAlign: 'left' }}>
                {[cleanTitle(relatedVideos[0].owner?.name), formatTime(relatedVideos[0].pubdate)].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <div style={{ marginTop: 14, fontSize: 20, color: '#9aa0a8' }}>
            {t('{n} 秒后自动播放', { n: endNextIn })}&nbsp;&nbsp;·&nbsp;&nbsp;{t('OK 立即播放')}&nbsp;&nbsp;·&nbsp;&nbsp;{t('其他键取消')}
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className={`player-controls ${showControls ? '' : 'hidden'}`}>
        <div className="player-title">{titleMT(cleanTitle(videoTitle))}</div>
        {(metaOwner || metaPubdate > 0 || argueMsg) && (
          <div style={{ fontSize: 18, color: '#999', marginBottom: 4 }}>
            {metaOwner}
            {metaPubdate > 0 && `${metaOwner ? ' · ' : ''}${new Date(metaPubdate * 1000).toLocaleDateString('zh-CN')}`}
            {argueMsg && (
              <span style={{ color: '#e6a23c', marginLeft: metaOwner || metaPubdate > 0 ? 14 : 0 }}>
                ⚠️ {titleMT(argueMsg)}
              </span>
            )}
          </div>
        )}
        <div className="player-progress-bar" style={{ cursor: 'pointer' }}
          onClick={(e) => {
            // Pointer click-to-seek: generous target courtesy of the row itself.
            if (!(duration > 0)) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            queueOrApplySeek(frac * duration);
            hideControlsLater();
          }}>
          <div className="player-progress-fill" style={{ width: `${progress}%` }} />
          {/* Chapter boundaries (YouTube-style segment gaps) */}
          {chapters.length > 1 && duration > 0 && chapters.slice(1).map((c, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${(c.from / duration) * 100}%`, top: 0,
              width: 3, height: '100%', background: 'rgba(0,0,0,0.85)',
            }} />
          ))}
          {scrubTarget != null && duration > 0 && (
            <div style={{
              position: 'absolute', left: `${Math.min(100, Math.max(0, (scrubTarget / duration) * 100))}%`,
              top: -7, width: 4, height: 20, background: '#fff',
              transform: 'translateX(-50%)', borderRadius: 2, boxShadow: '0 0 6px rgba(0,0,0,0.8)',
            }} />
          )}
        </div>
        <div className="player-btns">
          {CONTROLS.map((btn, i) => (
            <button key={btn} className={`player-btn ${focusArea === 'controls' && focusIdx === i ? 'focused' : ''}`}
              onMouseEnter={() => { setFocusArea('controls'); setFocusIdx(i); hideControlsLater(); }}
              onClick={() => pressControl(btn)}>
              {btn === 'play' ? (ended ? t('🔁 重播') : playing ? t('⏸ 暂停') : t('▶ 播放')) :
                btn === 'danmaku' ? (danmakuEnabled ? t('弹幕 开') : t('弹幕 关')) :
                  btn === 'subtitle' ? (subLan == null ? t('字幕 关')
                    // Known lan codes get a localized name (t over our enum,
                    // see subtitles.js); unknown codes show lan_doc verbatim.
                    : `${t('字幕')} ${t(subLan === 'x-mt' ? mtLanName(getLocale())
                      : subtitleLanName(subLan, (subTracks.find(s => s.lan === subLan) || {}).lan_doc)).slice(0, 22)}`) :
                    QUALITY_MAP[currentQuality] || `${currentQuality}`}
            </button>
          ))}
          <span className="player-time">
            {formatDuration(currentTime)} / {formatDuration(duration)}
            {(() => {
              const ch = chapters.find(c => currentTime >= c.from && currentTime < c.to);
              return ch ? <span style={{ color: '#7ecbff', marginLeft: 10 }}>· {titleMT(ch.content)}</span> : null;
            })()}
          </span>
        </div>

        {/* Tabbed panel below controls: 相关推荐 / UP主投稿 */}
        {showRelated && (
          <div style={{ marginTop: 16, paddingBottom: 10 }}>
            <div className="panel-tab-row" style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              {(isMultiP
                ? [['parts', partsLabel], ['related', t('相关推荐')], ['up', upName ? t('UP主投稿 · {name}', { name: upName }) : t('UP主投稿')]]
                : [['related', t('相关推荐')], ['up', upName ? t('UP主投稿 · {name}', { name: upName }) : t('UP主投稿')]]
              ).map(([key, label]) => (
                <div key={key} style={{
                  padding: '6px 18px', fontSize: 18, borderRadius: 6, cursor: 'pointer',
                  color: panelTab === key ? '#fff' : '#aaa',
                  background: panelTab === key ? '#00a1d6' : 'rgba(255,255,255,0.08)',
                  outline: focusArea === 'tabs' && panelTab === key ? '3px solid #fff' : 'none',
                }}
                  onMouseEnter={() => { setFocusArea('tabs'); if (controlsTimer.current) clearTimeout(controlsTimer.current); }}
                  onClick={() => {
                    setPanelTab(key);
                    setFocusIdx(0);
                    if (key === 'up' && upVideos.length === 0) loadUpVideos(true);
                  }}>{label}</div>
              ))}
            </div>

            {(() => {
              const list = panelTab === 'parts' ? partsList : panelTab === 'up' ? upVideos : relatedVideos;
              if (list.length === 0) {
                return <div style={{ color: '#888', fontSize: 18, padding: '20px 4px' }}>
                  {panelTab === 'up' ? (upMidRef.current ? t('加载中…') : t('暂无 UP 主信息')) : panelTab === 'parts' ? t('暂无选集') : t('暂无相关推荐')}
                </div>;
              }
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                  {list.map((rv, i) => {
                    const thumb = proxyImg(rv.pic);
                    const nowPlaying = panelTab === 'parts' && rv.cid === cidRef.current;
                    return (
                      <div key={rv.cid || rv.bvid || i} className="related-card" onClick={() => onPlayNext?.(panelTab === 'parts' ? playPart(rv) : rv)}
                        onMouseEnter={() => {
                          setFocusArea('related'); setFocusIdx(i);
                          if (controlsTimer.current) clearTimeout(controlsTimer.current);
                        }}
                        style={{
                          cursor: 'pointer',
                          outline: focusArea === 'related' && focusIdx === i ? '4px solid #00a1d6'
                            : (nowPlaying ? '3px solid #00a1d6' : 'none'),
                          borderRadius: 6, overflow: 'hidden',
                        }}>
                        <div style={{ width: '100%', height: 0, paddingTop: '56.25%', background: '#1a1a2e', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                          {thumb && <img src={thumb} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                          {nowPlaying && <div style={{ position: 'absolute', top: 6, left: 6, background: '#00a1d6', color: '#fff', fontSize: 16, padding: '2px 9px', borderRadius: 4 }}>{t('▶ 播放中')}</div>}
                          {rv.duration != null && <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 16, padding: '1px 7px', borderRadius: 3 }}>
                            {typeof rv.duration === 'number' ? formatDuration(rv.duration) : rv.duration}
                          </div>}
                        </div>
                        <div style={{ padding: '6px 4px 0', fontSize: 18, color: nowPlaying ? '#00a1d6' : '#ccc', lineHeight: 1.3,
                          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                          {titleMT(cleanTitle(rv.title))}
                        </div>
                        <div style={{ padding: '2px 4px 6px', fontSize: 16, color: '#999',
                          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {[cleanTitle(rv.owner?.name), formatTime(rv.pubdate)].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Quality panel */}
      {showSubPanel && (
        <div className="quality-panel">
          <div className="quality-panel-title">{t('字幕')}</div>
          {subOptions.map((o, i) => (
            <div key={o.key} className={`quality-option ${focusArea === 'subpanel' && focusIdx === i ? 'focused' : ''} ${(subLan || 'off') === o.key ? 'active' : ''}`}
              onMouseEnter={() => { setFocusArea('subpanel'); setFocusIdx(i); }}
              onClick={() => {
                applySubOption(o);
                setShowSubPanel(false);
                setFocusArea('controls');
                setFocusIdx(CONTROLS.indexOf('subtitle'));
                hideControlsLater();
              }}>
              {o.label}
            </div>
          ))}
        </div>
      )}

      {showQuality && (
        <div className="quality-panel">
          <div className="quality-panel-title">{t('画质')}</div>
          {qualities.map((q, i) => (
            <div key={q.qn} className={`quality-option ${focusArea === 'quality' && focusIdx === i ? 'focused' : ''} ${currentQuality === q.qn ? 'active' : ''}`}
              onMouseEnter={() => { setFocusArea('quality'); setFocusIdx(i); }}
              onClick={() => { changeQuality(q.qn); setShowQuality(false); setFocusArea('controls'); setFocusIdx(CONTROLS.indexOf('quality')); hideControlsLater(); }}>
              {q.label}
            </div>
          ))}
        </div>
      )}

      {/* End screen */}
    </div>
  );
}
