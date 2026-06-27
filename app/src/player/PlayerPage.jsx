import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayUrl, getDanmaku, getVideoInfo, reportHeartbeat, getRelated, getUpVideos, getBangumiPlayUrl, getBangumiInfo, castReportProgress, castReportState } from '../api/client';
import { formatDuration, formatTime, QUALITY_MAP, cleanTitle } from '../utils/format';
import { storage } from '../utils/storage';
import { setCustomKeyHandler } from '../hooks/useFocus';
import DanmakuLayer from './DanmakuLayer';

// Proxy + resize card thumbnails (same as VideoCard): the proxy adds the
// Referer B站 image CDN needs, and @672w webp keeps the TV's image decoder from
// choking on full-size covers (which is why direct-loaded thumbs failed).
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
  // Danmaku font scale (设置 → 弹幕字号). Read once per mount.
  const [danmakuScale] = useState(() => storage.getSettings().danmakuScale || 1);
  const [videoTitle, setVideoTitle] = useState(video?.title || '');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [ended, setEnded] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState([]);
  // Bottom panel: 'related' (相关推荐) | 'up' (UP主投稿)
  const [panelTab, setPanelTab] = useState('related');
  const [upVideos, setUpVideos] = useState([]);
  const [upName, setUpName] = useState('');
  // Focus: 'none' | 'controls' | 'quality' | 'tabs' | 'related' (=grid) | 'endscreen'
  const [focusArea, setFocusArea] = useState('none');
  const [focusIdx, setFocusIdx] = useState(0);
  const controlsTimer = useRef(null);
  const timeUpdateRef = useRef(null);
  const cidRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const upMidRef = useRef(null);
  const upLoadingRef = useRef(false);
  const upPnRef = useRef(1);
  const upSeenRef = useRef(new Set());

  const pendingSeekRef = useRef(null);

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

  const CONTROLS = ['play', 'danmaku', 'quality'];
  const END_SCREEN_MAX = 8; // up to 2 rows of 4 on the end screen

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
        setErrorMsg('当前设备不支持视频播放(浏览器内核过旧)');
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
      } else if (!cid) {
        const info = await getVideoInfo(video);
        cid = info?.data?.cid;
        if (info?.data?.title) setVideoTitle(info.data.title);
        if (info?.data?.owner) {
          ownerMid = ownerMid || info.data.owner.mid;
          ownerName = ownerName || info.data.owner.name;
        }
        // Cast can hand us an aid-only video (no bvid). Backfill bvid from the
        // view response so heartbeat/related (which key on bvid) keep working.
        if (!video.bvid && info?.data?.bvid) video.bvid = info.data.bvid;
      }
      if (!isBangumi && !cid) throw new Error('No cid for video');
      cidRef.current = cid;
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
            const resumeAt = (video.progress && video.progress > 0 && video.progress < (dash.duration || 9999) - 10)
              ? video.progress : 0;
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
      if (video.progress && video.progress > 0) {
        queueOrApplySeek(video.progress);
      }

      selectBestVariant(player);
      videoRef.current.play();
      setPlaying(true);
      setLoading(false);
      castReportState({ playState: 'playing' }).catch(() => {});

      videoRef.current.addEventListener('ended', () => {
        castReportState({ playState: 'end' }).catch(() => {});
        // Order-play (收藏夹顺序播放, #11): if this video came in as part of a
        // playlist, auto-advance to the next item instead of stopping on the
        // endscreen. The playlist + index ride along on the video object.
        const pl = video?.playlist;
        const idx = video?.playlistIndex;
        if (pl && Array.isArray(pl) && typeof idx === 'number' && idx + 1 < pl.length && onPlayNext) {
          const next = pl[idx + 1];
          onPlayNext({ ...next, playlist: pl, playlistIndex: idx + 1 });
          return;
        }
        setEnded(true);
        setShowControls(true);
        setFocusArea('endscreen');
        setFocusIdx(0);
      });

      try { setDanmakus(await getDanmaku(cid)); } catch {}
      if (isBangumi) {
        // "相关推荐" → the season's episode list; each plays via the PGC path.
        try {
          const info = await getBangumiInfo({ epid, seasonId });
          const result = info?.result || info?.data || {};
          const eps = (result.episodes || []).map(e => ({
            isBangumi: true, epid: e.id, cid: e.cid,
            title: e.long_title ? `第${e.title}话 ${e.long_title}` : (e.share_copy || `第${e.title}话`),
            pic: e.cover, owner: { name: result.season_title || '' },
          }));
          setRelatedVideos(eps.slice(0, 60));
        } catch {}
      } else {
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
        onPlayNext({ ...pl[idx + 1], playlist: pl, playlistIndex: idx + 1 });
        return;
      }
      setLoading(false);
      setLoadError(true);
      castReportState({ playState: 'error', error: err?.message || 'load-failed' }).catch(() => {});
    }
  }, [video, queueOrApplySeek]);

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
    };
  }, []);

  // Heartbeat
  useEffect(() => {
    const hb = setInterval(() => {
      if (videoRef.current && video?.bvid && cidRef.current && !videoRef.current.paused) {
        reportHeartbeat(video.bvid, cidRef.current, videoRef.current.currentTime, (Date.now() - startTimeRef.current) / 1000);
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

  // Auto-hide controls
  const hideControlsLater = useCallback(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!ended) {
        setShowControls(false);
        setShowRelated(false);
        setShowQuality(false);
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
      if (e.keyCode === 461 || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        if (ended) {
          // End screen: back exits player
          onBack();
        } else if (showControls || showQuality || showRelated) {
          // Controls/quality/related visible: close them
          setShowControls(false);
          setShowQuality(false);
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
          if (videoRef.current) videoRef.current.currentTime -= 10;
          return true;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime += 10;
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
          if (relatedVideos.length > 0 || upMidRef.current) {
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
          const btn = CONTROLS[focusIdx];
          if (btn === 'play') {
            if (videoRef.current.paused) {
              videoRef.current.play(); setPlaying(true);
              castReportState({ playState: 'playing' }).catch(() => {});
            } else {
              videoRef.current.pause(); setPlaying(false);
              castReportState({ playState: 'paused' }).catch(() => {});
            }
          } else if (btn === 'danmaku') {
            setDanmakuEnabled(prev => !prev);
          } else if (btn === 'quality') {
            setShowQuality(true);
            setFocusArea('quality');
            setFocusIdx(0);
          }
          hideControlsLater();
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
          if (q) { changeQuality(q.qn); setShowQuality(false); setFocusArea('controls'); setFocusIdx(2); }
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
          const next = panelTab === 'related' ? 'up' : 'related';
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
        const gridList = panelTab === 'up' ? upVideos : relatedVideos;
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
          if (rv && onPlayNext) onPlayNext(rv);
          return true;
        }
        return false;
      }

      // === End screen (4-column grid) ===
      if (focusArea === 'endscreen') {
        e.preventDefault();
        const ECOLS = 4;
        const n = Math.min(END_SCREEN_MAX, relatedVideos.length);
        if (e.key === 'ArrowLeft') {
          if (focusIdx % ECOLS > 0) setFocusIdx(focusIdx - 1);
        } else if (e.key === 'ArrowRight') {
          if (focusIdx % ECOLS < ECOLS - 1 && focusIdx < n - 1) setFocusIdx(focusIdx + 1);
        } else if (e.key === 'ArrowUp') {
          if (focusIdx >= ECOLS) setFocusIdx(focusIdx - ECOLS);
        } else if (e.key === 'ArrowDown') {
          if (focusIdx + ECOLS < n) setFocusIdx(focusIdx + ECOLS);
        } else if (e.key === 'Enter') {
          const rv = relatedVideos[focusIdx];
          if (rv && onPlayNext) onPlayNext(rv);
        }
        return true;
      }

      return false;
    };

    setCustomKeyHandler(handler);
    return () => setCustomKeyHandler(null);
  }, [focusArea, focusIdx, qualities, showControls, showQuality, showRelated, ended, relatedVideos, panelTab, upVideos, loadUpVideos, onBack, onPlayNext, openControls, hideControlsLater, changeQuality]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-page">
      <video ref={videoRef} className="player-video" />

      <DanmakuLayer danmakus={danmakus} currentTime={currentTime} enabled={danmakuEnabled} fontScale={danmakuScale} />

      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', zIndex: 50 }}>
          <div className="loading"><div className="loading-spinner" />加载中...</div>
        </div>
      )}

      {loadError && !loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, background: 'rgba(0,0,0,0.85)', zIndex: 50 }}>
          <div style={{ fontSize: 26, color: '#fff' }}>{errorMsg || '视频加载失败'}</div>
          <div style={{ fontSize: 18, color: '#aaa' }}>
            {errorMsg ? '请按返回键退出' : '该视频源节点异常,请按返回键重试或换一个视频'}
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className={`player-controls ${showControls ? '' : 'hidden'}`}>
        <div className="player-title">{cleanTitle(videoTitle)}</div>
        {video?.owner?.name && (
          <div style={{ fontSize: 18, color: '#999', marginBottom: 4 }}>
            {video.owner.name}
            {video.pubdate && ` · ${new Date(video.pubdate * 1000).toLocaleDateString('zh-CN')}`}
          </div>
        )}
        <div className="player-progress-bar">
          <div className="player-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="player-btns">
          {CONTROLS.map((btn, i) => (
            <button key={btn} className={`player-btn ${focusArea === 'controls' && focusIdx === i ? 'focused' : ''}`}>
              {btn === 'play' ? (playing ? '⏸ 暂停' : '▶ 播放') :
                btn === 'danmaku' ? (danmakuEnabled ? '弹幕 开' : '弹幕 关') :
                  QUALITY_MAP[currentQuality] || `${currentQuality}`}
            </button>
          ))}
          <span className="player-time">{formatDuration(currentTime)} / {formatDuration(duration)}</span>
        </div>

        {/* Tabbed panel below controls: 相关推荐 / UP主投稿 */}
        {showRelated && (
          <div style={{ marginTop: 16, paddingBottom: 10 }}>
            <div className="panel-tab-row" style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              {[['related', '相关推荐'], ['up', upName ? `UP主投稿 · ${upName}` : 'UP主投稿']].map(([key, label]) => (
                <div key={key} style={{
                  padding: '6px 18px', fontSize: 18, borderRadius: 6,
                  color: panelTab === key ? '#fff' : '#aaa',
                  background: panelTab === key ? '#00a1d6' : 'rgba(255,255,255,0.08)',
                  outline: focusArea === 'tabs' && panelTab === key ? '3px solid #fff' : 'none',
                }}>{label}</div>
              ))}
            </div>

            {(() => {
              const list = panelTab === 'up' ? upVideos : relatedVideos;
              if (list.length === 0) {
                return <div style={{ color: '#888', fontSize: 18, padding: '20px 4px' }}>
                  {panelTab === 'up' ? (upMidRef.current ? '加载中…' : '暂无 UP 主信息') : '暂无相关推荐'}
                </div>;
              }
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                  {list.map((rv, i) => {
                    const thumb = proxyImg(rv.pic);
                    return (
                      <div key={rv.bvid || i} className="related-card" onClick={() => onPlayNext?.(rv)}
                        style={{
                          cursor: 'pointer',
                          outline: focusArea === 'related' && focusIdx === i ? '4px solid #00a1d6' : 'none',
                          borderRadius: 6, overflow: 'hidden',
                        }}>
                        <div style={{ width: '100%', aspectRatio: '16/9', background: '#1a1a2e', borderRadius: 6, overflow: 'hidden' }}>
                          {thumb && <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </div>
                        <div style={{ padding: '6px 4px 0', fontSize: 18, color: '#ccc', lineHeight: 1.3,
                          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                          {cleanTitle(rv.title)}
                        </div>
                        <div style={{ padding: '2px 4px 6px', fontSize: 14, color: '#888',
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
      {showQuality && (
        <div className="quality-panel">
          {qualities.map((q, i) => (
            <div key={q.qn} className={`quality-option ${focusArea === 'quality' && focusIdx === i ? 'focused' : ''} ${currentQuality === q.qn ? 'active' : ''}`}>
              {q.label}
            </div>
          ))}
        </div>
      )}

      {/* End screen */}
      {ended && relatedVideos.length > 0 && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.85)', zIndex: 60,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 30, color: '#fff', marginBottom: 6 }}>播放结束</div>
          <div style={{ fontSize: 20, color: '#999', marginBottom: 28 }}>接下来播放</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 300px)', gap: '24px 24px',
            justifyContent: 'center',
          }}>
            {relatedVideos.slice(0, END_SCREEN_MAX).map((rv, i) => {
              const thumb = proxyImg(rv.pic);
              const focused = focusArea === 'endscreen' && focusIdx === i;
              return (
                <div key={rv.bvid || i} onClick={() => onPlayNext?.(rv)}
                  style={{
                    width: 300, cursor: 'pointer',
                    background: focused ? '#1f2440' : 'transparent',
                    outline: focused ? '4px solid #00a1d6' : 'none',
                    borderRadius: 8, overflow: 'hidden',
                    transition: 'background 0.15s',
                  }}>
                  <div style={{ width: '100%', aspectRatio: '16/9', background: '#1a1a2e', overflow: 'hidden' }}>
                    {thumb && <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                  <div style={{ padding: '8px 8px 2px', fontSize: 15, color: '#eee', lineHeight: 1.35,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', height: 42 }}>
                    {cleanTitle(rv.title)}
                  </div>
                  <div style={{ padding: '0 8px 10px', fontSize: 13, color: '#888',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {[cleanTitle(rv.owner?.name), formatTime(rv.pubdate)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 24, fontSize: 16, color: '#666' }}>
            ← → ↑ ↓ 选择 · OK 播放 · 返回键 退出
          </div>
        </div>
      )}
    </div>
  );
}
