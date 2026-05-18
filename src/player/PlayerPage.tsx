// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getPlayUrl,
  getDanmaku,
  getVideoInfo,
  reportHeartbeat,
  getRelated,
  castReportProgress,
  castReportState,
} from '../api/client';
import { formatDuration, QUALITY_MAP } from '../utils/format';
import { getProxyBase } from '../utils/proxy';
import { setCustomKeyHandler } from '../hooks/useFocus';
import { storage } from '../utils/storage';
import DanmakuLayer from './DanmakuLayer';

const SEEK_BASE_STEP_SEC = 5;
const SEEK_IDLE_RESET_MS = 250;
const SEEK_MIN_EVENT_GAP_MS = 10;
const SEEK_MULTIPLIER_INCREMENT = 0.5;
const SEEK_MAX_MULTIPLIER = 6;
const SEEK_END_BUFFER_SEC = 1;
const SEEK_EPSILON = 0.001;

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
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [videoTitle, setVideoTitle] = useState(video?.title || '');
  const [loading, setLoading] = useState(true);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState([]);
  // Focus: 'none' (no UI) | 'timeline' | 'controls' | 'quality' | 'related' | 'endscreen'
  const [focusArea, setFocusArea] = useState('none');
  const [focusIdx, setFocusIdx] = useState(0);
  const controlsTimer = useRef(null);
  const timeUpdateRef = useRef(null);
  const cidRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const displayTimeRef = useRef(0);
  const scrubActiveRef = useRef(false);
  const lastSeekEventAtRef = useRef(0);
  const lastSeekDirectionRef = useRef(0);
  const seekMultiplierRef = useRef(1);
  const blockedSeekDirectionRef = useRef(0);
  const seekCommitTimerRef = useRef(null);
  const progressFillRef = useRef(null);
  const timeTextRef = useRef(null);

  const pendingSeekRef = useRef(null);

  const queueOrApplySeek = useCallback((seekSec) => {
    const target = Math.max(0, Number(seekSec) || 0);
    if (!videoRef.current) return;
    const canSeekNow =
      Number.isFinite(videoRef.current.duration) &&
      videoRef.current.duration > 0;
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
    if (
      !(
        Number.isFinite(videoRef.current.duration) &&
        videoRef.current.duration > 0
      )
    )
      return;
    const max = Math.max(0, (videoRef.current.duration || 0) - 0.2);
    videoRef.current.currentTime = Math.min(
      pendingSeekRef.current,
      max || pendingSeekRef.current,
    );
    pendingSeekRef.current = null;
  }, []);

  const CONTROLS = ['play', 'danmaku', 'quality'];

  const clearSeekCommitTimer = useCallback(() => {
    if (seekCommitTimerRef.current) {
      clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
  }, []);

  const resetSeekController = useCallback(() => {
    clearSeekCommitTimer();
    scrubActiveRef.current = false;
    lastSeekEventAtRef.current = 0;
    lastSeekDirectionRef.current = 0;
    seekMultiplierRef.current = 1;
    blockedSeekDirectionRef.current = 0;
  }, [clearSeekCommitTimer]);

  const getSeekBounds = useCallback(() => {
    const mediaDuration = Number(videoRef.current?.duration);
    const safeDuration =
      Number.isFinite(mediaDuration) && mediaDuration > 0
        ? mediaDuration
        : Number.isFinite(duration) && duration > 0
          ? duration
          : 0;
    if (!safeDuration) return null;
    return {
      duration: safeDuration,
      max: Math.max(0, safeDuration - SEEK_END_BUFFER_SEC),
    };
  }, [duration]);

  const renderTimelinePreview = useCallback((timeSec, durationSec) => {
    const safeDuration =
      Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
    const safeTime = Math.max(0, Number(timeSec) || 0);
    displayTimeRef.current = safeTime;
    if (progressFillRef.current) {
      const progress = safeDuration > 0 ? (safeTime / safeDuration) * 100 : 0;
      progressFillRef.current.style.width = `${progress}%`;
    }
    if (timeTextRef.current) {
      timeTextRef.current.textContent = `${formatDuration(safeTime)} / ${formatDuration(safeDuration)}`;
    }
  }, []);

  const syncTimelineFromPlayer = useCallback(() => {
    if (scrubActiveRef.current) return;
    const nextTime = Number(videoRef.current?.currentTime) || 0;
    const nextDuration = Number(videoRef.current?.duration) || duration || 0;
    renderTimelinePreview(nextTime, nextDuration);
  }, [duration, renderTimelinePreview]);

  const commitPreviewSeek = useCallback(() => {
    const bounds = getSeekBounds();
    clearSeekCommitTimer();
    if (!scrubActiveRef.current) return;

    if (bounds && videoRef.current) {
      const target = Math.min(
        bounds.max,
        Math.max(0, Number(displayTimeRef.current) || 0),
      );
      if (
        Math.abs((Number(videoRef.current.currentTime) || 0) - target) >
        SEEK_EPSILON
      ) {
        videoRef.current.currentTime = target;
      }
      setCurrentTime(target);
      setDuration(bounds.duration);
      renderTimelinePreview(target, bounds.duration);
    }

    scrubActiveRef.current = false;
    lastSeekEventAtRef.current = 0;
    lastSeekDirectionRef.current = 0;
    seekMultiplierRef.current = 1;
    blockedSeekDirectionRef.current = 0;
  }, [clearSeekCommitTimer, getSeekBounds, renderTimelinePreview]);

  const scheduleSeekCommit = useCallback(() => {
    clearSeekCommitTimer();
    seekCommitTimerRef.current = setTimeout(() => {
      commitPreviewSeek();
    }, SEEK_IDLE_RESET_MS);
  }, [clearSeekCommitTimer, commitPreviewSeek]);

  const applySeekInput = useCallback(
    (direction) => {
      const bounds = getSeekBounds();
      if (!bounds) return true;

      const now = Date.now();
      const gap = now - lastSeekEventAtRef.current;
      if (
        direction === lastSeekDirectionRef.current &&
        gap >= 0 &&
        gap < SEEK_MIN_EVENT_GAP_MS
      ) {
        return true;
      }

      if (gap >= SEEK_IDLE_RESET_MS) {
        blockedSeekDirectionRef.current = 0;
      }
      if (
        blockedSeekDirectionRef.current &&
        blockedSeekDirectionRef.current !== direction
      ) {
        blockedSeekDirectionRef.current = 0;
      }
      if (
        blockedSeekDirectionRef.current === direction &&
        gap >= 0 &&
        gap < SEEK_IDLE_RESET_MS
      ) {
        return true;
      }

      const nextMultiplier =
        direction === lastSeekDirectionRef.current &&
        gap >= 0 &&
        gap < SEEK_IDLE_RESET_MS
          ? Math.min(
              seekMultiplierRef.current + SEEK_MULTIPLIER_INCREMENT,
              SEEK_MAX_MULTIPLIER,
            )
          : 1;
      seekMultiplierRef.current = nextMultiplier;
      lastSeekEventAtRef.current = now;
      lastSeekDirectionRef.current = direction;

      const baseTime = scrubActiveRef.current
        ? displayTimeRef.current
        : Number(videoRef.current?.currentTime) || 0;
      const unclampedTarget =
        baseTime + direction * SEEK_BASE_STEP_SEC * nextMultiplier;
      const target = Math.min(bounds.max, Math.max(0, unclampedTarget));
      const changed = Math.abs(target - baseTime) > SEEK_EPSILON;

      if (!changed) {
        blockedSeekDirectionRef.current = direction;
        seekMultiplierRef.current = 1;
        clearSeekCommitTimer();
        renderTimelinePreview(target, bounds.duration);
        return true;
      }

      scrubActiveRef.current = true;
      renderTimelinePreview(target, bounds.duration);

      const hitMin = target <= 0 && direction < 0;
      const hitMax = target >= bounds.max && direction > 0;
      if (hitMin || hitMax) {
        blockedSeekDirectionRef.current = direction;
        seekMultiplierRef.current = 1;
      } else {
        blockedSeekDirectionRef.current = 0;
      }

      scheduleSeekCommit();
      return true;
    },
    [
      clearSeekCommitTimer,
      getSeekBounds,
      renderTimelinePreview,
      scheduleSeekCommit,
    ],
  );

  // Initialize Shaka Player
  useEffect(() => {
    let mounted = true;
    async function init() {
      const shaka = await import('shaka-player');
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) return;
      const player = new shaka.Player();
      player.configure({
        streaming: {
          bufferingGoal: 5,
          rebufferingGoal: 1,
          bufferBehind: 20,
        },
      });
      await player.attach(videoRef.current);
      shakaRef.current = player;
      player.addEventListener('error', (e) =>
        console.error('Shaka error:', e.detail),
      );
      if (mounted) loadVideo(player);
    }
    init();
    return () => {
      mounted = false;
      shakaRef.current?.destroy();
    };
  }, []);

  const loadVideo = useCallback(
    async (player) => {
      if (!video?.bvid && !video?.aid) return;
      setLoading(true);
      setFirstFrameReady(false);
      castReportState({ playState: 'loading' }).catch(() => {});
      try {
        let cid = video.cid;
        if (!cid) {
          const info = await getVideoInfo(video);
          cid = info?.data?.cid;
          if (info?.data?.title) setVideoTitle(info.data.title);
          if (!video.bvid && info?.data?.bvid) video.bvid = info.data.bvid;
        }
        if (!cid) return;
        cidRef.current = cid;

        const settings = storage.getSettings();
        const res = await getPlayUrl(video, cid, settings.quality || 80);
        const dash = res?.data?.dash;
        if (!dash) return;

        setQualities(
          (res?.data?.accept_quality || []).map((q) => ({
            qn: q,
            label: QUALITY_MAP[q] || `${q}`,
          })),
        );
        setCurrentQuality(res?.data?.quality || 80);

        const mpd = buildMPD(dash);
        const blob = new Blob([mpd], { type: 'application/dash+xml' });
        const mpdUrl = URL.createObjectURL(blob);

        player.getNetworkingEngine().registerRequestFilter((type, request) => {
          if (request.uris[0].startsWith('http')) {
            const originalUrl = new URL(request.uris[0]);
            // Use local proxy on TV (JS Service), fallback to Mac proxy
            const proxyBase = getProxyBase();
            request.uris[0] = `${proxyBase}/proxy/${originalUrl.host}${originalUrl.pathname}${originalUrl.search}`;
          }
        });

        const danmakuPromise = getDanmaku(cid).catch(() => []);
        const relatedPromise = getRelated(video.bvid).catch(() => ({
          data: [],
        }));

        await player.load(mpdUrl);
        URL.revokeObjectURL(mpdUrl);

        if (video.progress && video.progress > 0) {
          queueOrApplySeek(video.progress);
        }

        videoRef.current.play().catch(() => {});
        setPlaying(true);
        castReportState({ playState: 'playing' }).catch(() => {});

        videoRef.current.addEventListener('ended', () => {
          setEnded(true);
          setShowControls(true);
          setFocusArea('endscreen');
          setFocusIdx(0);
          castReportState({ playState: 'end' }).catch(() => {});
        });

        const [danmakuData, rel] = await Promise.all([
          danmakuPromise,
          relatedPromise,
        ]);
        setDanmakus(danmakuData);
        setRelatedVideos((rel?.data || []).slice(0, 12));
      } catch (err) {
        console.error('Load video error:', err);
        setLoading(false);
        castReportState({
          playState: 'error',
          error: err?.message || 'load-failed',
        }).catch(() => {});
      }
    },
    [video, queueOrApplySeek],
  );

  function buildMPD(dash) {
    const duration = dash.duration || 0;
    const minBuffer = dash.minBufferTime || 1.5;
    let videoAdaptations = '';
    if (dash.video?.length > 0) {
      const reps = dash.video
        .map((v) => {
          const baseUrl = v.baseUrl || v.base_url || '';
          return `<Representation id="${v.id}" bandwidth="${v.bandwidth || 1000000}" codecs="${v.codecs || 'avc1.640032'}" mimeType="${v.mimeType || 'video/mp4'}" width="${v.width || 1920}" height="${v.height || 1080}" frameRate="${v.frameRate || v.frame_rate || '30'}">
          <BaseURL>${escapeXml(baseUrl)}</BaseURL>
          <SegmentBase indexRange="${v.SegmentBase?.indexRange || v.segment_base?.index_range || '0-0'}">
            <Initialization range="${v.SegmentBase?.Initialization || v.segment_base?.initialization || '0-0'}" />
          </SegmentBase>
        </Representation>`;
        })
        .join('\n');
      videoAdaptations = `<AdaptationSet contentType="video" mimeType="video/mp4" segmentAlignment="true">${reps}</AdaptationSet>`;
    }
    let audioAdaptations = '';
    if (dash.audio?.length > 0) {
      const reps = dash.audio
        .map((a) => {
          const baseUrl = a.baseUrl || a.base_url || '';
          return `<Representation id="${a.id}" bandwidth="${a.bandwidth || 128000}" codecs="${a.codecs || 'mp4a.40.2'}" mimeType="${a.mimeType || 'audio/mp4'}">
          <BaseURL>${escapeXml(baseUrl)}</BaseURL>
          <SegmentBase indexRange="${a.SegmentBase?.indexRange || a.segment_base?.index_range || '0-0'}">
            <Initialization range="${a.SegmentBase?.Initialization || a.segment_base?.initialization || '0-0'}" />
          </SegmentBase>
        </Representation>`;
        })
        .join('\n');
      audioAdaptations = `<AdaptationSet contentType="audio" mimeType="audio/mp4" segmentAlignment="true">${reps}</AdaptationSet>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
  type="static" mediaPresentationDuration="PT${duration}S" minBufferTime="PT${minBuffer}S">
  <Period>${videoAdaptations}${audioAdaptations}</Period>
</MPD>`;
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    const handleLoadedData = () => {
      setFirstFrameReady(true);
      setLoading(false);
      syncTimelineFromPlayer();
    };

    const handlePause = () => {
      if (!ended) castReportState({ playState: 'paused' }).catch(() => {});
      setPlaying(false);
    };

    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);
    el.addEventListener('loadedmetadata', handleLoadedMetadata);
    el.addEventListener('canplay', handleCanPlay);
    el.addEventListener('loadeddata', handleLoadedData);
    return () => {
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
      el.removeEventListener('canplay', handleCanPlay);
      el.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [ended, flushPendingSeek, syncTimelineFromPlayer]);

  useEffect(() => {
    return () => {
      resetSeekController();
      castReportState({ playState: 'stop' }).catch(() => {});
    };
  }, [resetSeekController]);

  // Heartbeat
  useEffect(() => {
    const hb = setInterval(() => {
      if (
        videoRef.current &&
        video?.bvid &&
        cidRef.current &&
        !videoRef.current.paused
      ) {
        reportHeartbeat(
          video.bvid,
          cidRef.current,
          videoRef.current.currentTime,
          (Date.now() - startTimeRef.current) / 1000,
        );
      }
    }, 15000);
    return () => clearInterval(hb);
  }, [video?.bvid]);

  // Auto-hide controls
  const hideControlsLater = useCallback(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!ended) {
        commitPreviewSeek();
        setShowControls(false);
        setShowRelated(false);
        setShowQuality(false);
        setFocusArea('none');
      }
    }, 5000);
  }, [commitPreviewSeek, ended]);

  const showTimelineControls = useCallback(() => {
    setShowControls(true);
    setShowRelated(false);
    setShowQuality(false);
    setFocusArea('timeline');
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
        const newItems = (rel?.data || [])
          .filter((v) => {
            if (relatedSeenRef.current.has(v.bvid)) return false;
            relatedSeenRef.current.add(v.bvid);
            return true;
          })
          .slice(0, 8);
        if (newItems.length > 0) {
          setRelatedVideos((prev) => [...prev, ...newItems]);
        }
      }
    } catch {}
    loadingRelatedRef.current = false;
  }, [relatedVideos]);

  // Init seen set when related first loads
  useEffect(() => {
    relatedSeenRef.current = new Set(
      relatedVideos.map((v) => v.bvid).filter(Boolean),
    );
  }, [relatedVideos.length === 0]);

  useEffect(() => {
    syncTimelineFromPlayer();
  }, [currentTime, duration, focusArea, syncTimelineFromPlayer]);

  useEffect(() => {
    const registerMediaKeys = () => {
      const registerKey =
        window.webOS?.platform?.tv?.registerKey ||
        window.webOS?.tv?.registerKey ||
        window.webOSDev?.registerKey;
      if (typeof registerKey !== 'function') return;
      for (const key of [
        'MediaPlay',
        'MediaPause',
        'MediaPlayPause',
        'MediaRewind',
        'MediaFastForward',
      ]) {
        try {
          registerKey(key);
        } catch {}
      }
    };

    registerMediaKeys();
  }, []);

  // Change quality
  const changeQuality = useCallback(
    async (qn) => {
      if ((!video?.bvid && !video?.aid) || !shakaRef.current) return;
      setCurrentQuality(qn);
      storage.setSettings({ ...storage.getSettings(), quality: qn });
      try {
        let cid = video.cid || cidRef.current;
        const res = await getPlayUrl(video, cid, qn);
        const dash = res?.data?.dash;
        if (dash) {
          const pos = videoRef.current.currentTime;
          const mpd = buildMPD(dash);
          const blob = new Blob([mpd], { type: 'application/dash+xml' });
          const mpdUrl = URL.createObjectURL(blob);
          await shakaRef.current.load(mpdUrl);
          URL.revokeObjectURL(mpdUrl);
          videoRef.current.currentTime = pos;
          videoRef.current.play();
          setCurrentQuality(res?.data?.quality || qn);
        }
      } catch (e) {
        console.error('Quality change error:', e);
      }
    },
    [video],
  );

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
    return () =>
      window.removeEventListener('bili-cast-command', handleCastCommand);
  }, [onBack, queueOrApplySeek]);

  // ========== Keyboard handler ==========
  useEffect(() => {
    const handler = (e) => {
      const keyCode = Number(e.keyCode || e.which || 0);
      const key = e.key || '';
      const isMediaPlay = key === 'MediaPlay' || keyCode === 415;
      const isMediaPause = key === 'MediaPause' || keyCode === 19;
      const isMediaPlayPause = key === 'MediaPlayPause';
      const isMediaRewind = key === 'MediaRewind' || keyCode === 412;
      const isMediaFastForward = key === 'MediaFastForward' || keyCode === 417;

      if (
        isMediaRewind ||
        isMediaFastForward ||
        isMediaPlayPause ||
        isMediaPlay ||
        isMediaPause
      ) {
        e.preventDefault();
        if (!videoRef.current) return true;

        if (isMediaRewind) {
          showTimelineControls();
          applySeekInput(-1);
        } else if (isMediaFastForward) {
          showTimelineControls();
          applySeekInput(1);
        } else if (isMediaPause) {
          commitPreviewSeek();
          videoRef.current.pause();
          setPlaying(false);
          castReportState({ playState: 'paused' }).catch(() => {});
        } else if (isMediaPlay) {
          commitPreviewSeek();
          videoRef.current.play();
          setPlaying(true);
          castReportState({ playState: 'playing' }).catch(() => {});
        } else if (videoRef.current.paused) {
          commitPreviewSeek();
          videoRef.current.play();
          setPlaying(true);
          castReportState({ playState: 'playing' }).catch(() => {});
        } else {
          commitPreviewSeek();
          videoRef.current.pause();
          setPlaying(false);
          castReportState({ playState: 'paused' }).catch(() => {});
        }
        hideControlsLater();
        return true;
      }

      if (
        keyCode === 461 ||
        key === 'Backspace' ||
        key === 'GoBack' ||
        key === 'Escape'
      ) {
        e.preventDefault();
        e.stopPropagation();

        if (ended) {
          // End screen: back exits player
          commitPreviewSeek();
          onBack();
        } else if (showControls || showQuality || showRelated) {
          // Controls/quality/related visible: close them
          commitPreviewSeek();
          setShowControls(false);
          setShowQuality(false);
          setShowRelated(false);
          setFocusArea('none');
          if (controlsTimer.current) clearTimeout(controlsTimer.current);
        } else {
          // Nothing visible: exit player
          commitPreviewSeek();
          onBack();
        }
        return true;
      }

      // === No controls visible (focusArea === 'none') ===
      if (focusArea === 'none') {
        if (key === 'ArrowLeft') {
          e.preventDefault();
          showTimelineControls();
          applySeekInput(-1);
          return true;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          showTimelineControls();
          applySeekInput(1);
          return true;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          e.preventDefault();
          showTimelineControls();
          return true;
        }
        if (key === 'Enter') {
          e.preventDefault();
          // Toggle play/pause
          if (isMediaPause) {
            videoRef.current.pause();
            setPlaying(false);
          } else if (isMediaPlay) {
            videoRef.current.play();
            setPlaying(true);
          } else if (videoRef.current.paused) {
            videoRef.current.play();
            setPlaying(true);
          } else {
            videoRef.current.pause();
            setPlaying(false);
          }
          return true;
        }
        return false;
      }

      if (focusArea === 'timeline') {
        if (key === 'ArrowLeft') {
          e.preventDefault();
          applySeekInput(-1);
          hideControlsLater();
          return true;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          applySeekInput(1);
          hideControlsLater();
          return true;
        }
        if (key === 'ArrowDown') {
          e.preventDefault();
          commitPreviewSeek();
          setFocusArea('controls');
          setFocusIdx(0);
          hideControlsLater();
          return true;
        }
        if (key === 'ArrowUp') {
          e.preventDefault();
          commitPreviewSeek();
          setShowControls(false);
          setShowRelated(false);
          setShowQuality(false);
          setFocusArea('none');
          if (controlsTimer.current) clearTimeout(controlsTimer.current);
          return true;
        }
        if (key === 'Enter') {
          e.preventDefault();
          hideControlsLater();
          return true;
        }
        return false;
      }

      // === Controls visible ===
      if (focusArea === 'controls') {
        if (key === 'ArrowLeft') {
          e.preventDefault();
          setFocusIdx((prev) => Math.max(0, prev - 1));
          hideControlsLater();
          return true;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          setFocusIdx((prev) => Math.min(CONTROLS.length - 1, prev + 1));
          hideControlsLater();
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (relatedVideos.length > 0) {
            setShowRelated(true);
            setFocusArea('related');
            setFocusIdx(0);
            if (controlsTimer.current) clearTimeout(controlsTimer.current);
          }
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          commitPreviewSeek();
          setShowRelated(false);
          setShowQuality(false);
          setFocusArea('timeline');
          return true;
        }
        if (key === 'Enter') {
          e.preventDefault();
          const btn = CONTROLS[focusIdx];
          if (btn === 'play') {
            commitPreviewSeek();
            if (isMediaPause) {
              videoRef.current.pause();
              setPlaying(false);
              castReportState({ playState: 'paused' }).catch(() => {});
            } else if (isMediaPlay) {
              videoRef.current.play();
              setPlaying(true);
              castReportState({ playState: 'playing' }).catch(() => {});
            } else if (videoRef.current.paused) {
              videoRef.current.play();
              setPlaying(true);
              castReportState({ playState: 'playing' }).catch(() => {});
            } else {
              videoRef.current.pause();
              setPlaying(false);
              castReportState({ playState: 'paused' }).catch(() => {});
            }
          } else if (btn === 'danmaku') {
            setDanmakuEnabled((prev) => !prev);
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
          setFocusIdx((prev) => Math.max(0, prev - 1));
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusIdx((prev) => Math.min(qualities.length - 1, prev + 1));
          return true;
        }
        if (key === 'Enter') {
          e.preventDefault();
          const q = qualities[focusIdx];
          if (q) {
            changeQuality(q.qn);
            setShowQuality(false);
            setFocusArea('controls');
            setFocusIdx(2);
          }
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

      // === Related videos panel (4-column grid) ===
      if (focusArea === 'related') {
        const RCOLS = 4;
        if (key === 'ArrowLeft') {
          e.preventDefault();
          if (focusIdx % RCOLS > 0) {
            setFocusIdx((prev) => prev - 1);
            scrollRelatedIntoView(focusIdx - 1);
          }
          return true;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          if (
            focusIdx % RCOLS < RCOLS - 1 &&
            focusIdx < relatedVideos.length - 1
          ) {
            setFocusIdx((prev) => prev + 1);
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
            setFocusArea('controls');
            setFocusIdx(0);
          }
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = focusIdx + RCOLS;
          if (nextIdx < relatedVideos.length) {
            setFocusIdx(nextIdx);
            scrollRelatedIntoView(nextIdx);
          } else {
            loadMoreRelated();
          }
          return true;
        }
        if (key === 'Enter') {
          e.preventDefault();
          const rv = relatedVideos[focusIdx];
          if (rv && onPlayNext) onPlayNext(rv);
          return true;
        }
        return false;
      }

      // === End screen ===
      if (focusArea === 'endscreen') {
        if (key === 'ArrowLeft') {
          e.preventDefault();
          setFocusIdx((prev) => Math.max(0, prev - 1));
          return true;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          setFocusIdx((prev) => Math.min(relatedVideos.length - 1, prev + 1));
          return true;
        }
        if (key === 'Enter') {
          e.preventDefault();
          const rv = relatedVideos[focusIdx];
          if (rv && onPlayNext) onPlayNext(rv);
          return true;
        }
        return false;
      }

      return false;
    };

    setCustomKeyHandler(handler);
    return () => setCustomKeyHandler(null);
  }, [
    focusArea,
    focusIdx,
    qualities,
    showControls,
    showQuality,
    showRelated,
    ended,
    relatedVideos,
    onBack,
    onPlayNext,
    applySeekInput,
    commitPreviewSeek,
    hideControlsLater,
    changeQuality,
    showTimelineControls,
  ]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-page">
      <video
        ref={videoRef}
        className="player-video"
        preload="auto"
        playsInline
      />

      <DanmakuLayer
        danmakus={danmakus}
        currentTime={currentTime}
        enabled={danmakuEnabled && firstFrameReady}
      />

      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)',
            zIndex: 50,
          }}
        >
          <div className="loading">
            <div className="loading-spinner" />
            加载中...
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className={`player-controls ${showControls ? '' : 'hidden'}`}>
        <div className="player-title">{videoTitle}</div>
        {video?.owner?.name && (
          <div style={{ fontSize: 18, color: '#999', marginBottom: 4 }}>
            {video.owner.name}
            {video.pubdate &&
              ` · ${new Date(video.pubdate * 1000).toLocaleDateString('zh-CN')}`}
          </div>
        )}
        <div
          className={`player-progress-bar ${focusArea === 'timeline' ? 'focused' : ''}`}
        >
          <div
            ref={progressFillRef}
            className="player-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="player-btns">
          {CONTROLS.map((btn, i) => (
            <button
              key={btn}
              className={`player-btn ${focusArea === 'controls' && focusIdx === i ? 'focused' : ''}`}
            >
              {btn === 'play'
                ? playing
                  ? '⏸ 暂停'
                  : '▶ 播放'
                : btn === 'danmaku'
                  ? danmakuEnabled
                    ? '弹幕 开'
                    : '弹幕 关'
                  : QUALITY_MAP[currentQuality] || `${currentQuality}`}
            </button>
          ))}
          <span ref={timeTextRef} className="player-time">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
        </div>

        {/* Related videos panel (4-column grid below controls) */}
        {showRelated && relatedVideos.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 14,
              marginTop: 16,
              paddingBottom: 10,
            }}
          >
            {relatedVideos.map((rv, i) => {
              const thumb = (rv.pic || '').startsWith('//')
                ? 'https:' + rv.pic
                : rv.pic;
              return (
                <div
                  key={rv.bvid || i}
                  className="related-card"
                  onClick={() => onPlayNext?.(rv)}
                  style={{
                    cursor: 'pointer',
                    outline:
                      focusArea === 'related' && focusIdx === i
                        ? '4px solid #00a1d6'
                        : 'none',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16/9',
                      background: '#1a1a2e',
                      borderRadius: 6,
                      overflow: 'hidden',
                    }}
                  >
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      padding: '6px 4px',
                      fontSize: 18,
                      color: '#ccc',
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {rv.title}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quality panel */}
      {showQuality && (
        <div className="quality-panel">
          {qualities.map((q, i) => (
            <div
              key={q.qn}
              className={`quality-option ${focusArea === 'quality' && focusIdx === i ? 'focused' : ''} ${currentQuality === q.qn ? 'active' : ''}`}
            >
              {q.label}
            </div>
          ))}
        </div>
      )}

      {/* End screen */}
      {ended && relatedVideos.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.85)',
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 28, color: '#fff', marginBottom: 30 }}>
            播放结束
          </div>
          <div style={{ fontSize: 20, color: '#aaa', marginBottom: 20 }}>
            接下来播放
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {relatedVideos.map((rv, i) => {
              const thumb = (rv.pic || '').startsWith('//')
                ? 'https:' + rv.pic
                : rv.pic;
              return (
                <div
                  key={rv.bvid || i}
                  onClick={() => onPlayNext?.(rv)}
                  style={{
                    width: 280,
                    cursor: 'pointer',
                    outline:
                      focusArea === 'endscreen' && focusIdx === i
                        ? '4px solid #00a1d6'
                        : 'none',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16/9',
                      background: '#1a1a2e',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      padding: '8px 4px',
                      fontSize: 14,
                      color: '#ccc',
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {rv.title}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
