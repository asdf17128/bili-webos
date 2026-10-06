import Icon from '../components/Icon';
import React, { useState, useEffect, useRef } from 'react';
import { getLivePlayback, getRoomInit, getDanmuInfo, getBuvid3, getLiveHistory, danmakuSubscribe, danmakuStop, castReportState, castReportProgress, mediaProxyBase } from '../api/client';
import { formatCount } from '../utils/format';
import { storage } from '../utils/storage';
import { setCustomKeyHandler } from '../hooks/useFocus';
import { shouldStepDown, nextQn } from './liveQnLadder';
import { rewriteCastUrl } from '../utils/casturl';
import LiveDanmakuLayer from './LiveDanmakuLayer';
import { t } from '../i18n';

const CHAT_W = 420;                       // YouTube-TV-ish chat rail width
const VIDEO_W = 1920 - CHAT_W;            // 1500
const VIDEO_H = Math.round(VIDEO_W * 9 / 16); // 844 — the rest holds metadata

export default function LivePlayerPage({ room, onBack }) {
  const videoRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const reconnectRef = useRef(null);
  const [showInfo, setShowInfo] = useState(true);
  const [danmakuEnabled, setDanmakuEnabled] = useState(storage.getSettings().danmaku !== false);
  const infoTimer = useRef(null);
  const dmLayerRef = useRef(null);
  const hlsRef = useRef(null);   // dev-only hls.js instance
  // 画质 (#18): live has its own ladder (原画/蓝光/超清…), separate from VOD's.
  const [qualities, setQualities] = useState([]);
  const [curQn, setCurQn] = useState(() => storage.getSettings().liveQn || 0);
  const qnRef = useRef(curQn);
  const qnLadderRef = useRef([]);   // 解码失败时按这个顺序往下退
  const [showQuality, setShowQuality] = useState(false);
  // Control bar: 弹幕 · 画质 · 互动 (owner: 直播没有控制台)
  const CONTROLS = ['danmaku', 'quality', 'interact'];
  // 聊天/互动 panel, YouTube-TV style: opt-in, and when open the video is
  // SHRUNK to the left rather than covered — floating cards over the picture
  // are exactly what gets in the way of watching (owner: 影响观看体验的部分
  // 就不要了; then: 参考 youtubetv 的做法). Choice persists.
  const [interactOn, setInteractOn] = useState(() => storage.getSettings().liveInteract === true);
  const [ctrlIdx, setCtrlIdx] = useState(0);
  const [showControls, setShowControls] = useState(false);
  // 互动: gifts / SC / 上舰 feed + room stats from the chat stream
  const [feed, setFeed] = useState([]);
  const [stats, setStats] = useState({ watched: 0, likes: 0, online: 0 });
  const feedSeq = useRef(0);
  const chatScrollRef = useRef(null);

  // Test hook (see tv-test skill "深链直达"): gifts/SC/上舰 are bursty and can't
  // be summoned on demand, so the RENDERING path gets its own entry point.
  // Same code path as a relayed event — only the source differs.
  useEffect(() => {
    window.__liveFeedPush = (evt) => {
      if (!evt) return;
      setFeed(prev => prev.concat([{ id: ++feedSeq.current, ...evt }]).slice(-40));
    };
    return () => { delete window.__liveFeedPush; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let requestId = 0;
    let retryTimer = null;
    let startupTimer = null;
    let everPlayed = false;
    let preferredFormat = 'fmp4';
    let currentFormat = '';
    // A live HLS stream fires `ended` on ordinary hiccups (playlist gap, mid-
    // stream discontinuity). Treating that as "this variant is broken" walked
    // the quality ladder down on every hiccup — and rung 2 is the raw FLV,
    // which this TV provably cannot demux (MEDIA_ERR 4 "Format error", see
    // casturl.js). Captured on-device 2026-07-30:
    //   ended → connect#1 → media-error 4 → connect#2 → media-error 4 → …
    // So: variant only steps after the SAME variant fails twice, the FLV rung
    // is skipped for Huya (it can never work here), and a healthy 'playing'
    // resets the counters. Retry budget is bigger because live hiccups are
    // normal — giving up after 5 turned a blip into a dead screen.
    let variant = 0;            // 0 = HLS 蓝光, 1 = HLS 原档, 2 = 原始 URL
    let variantFails = 0;
    const isHuyaFlv = /\.flv\.huya\.com\//.test(room.directUrl || '');
    const MAX_VARIANT = isHuyaFlv ? 1 : 2;
    const MAX_RETRIES = 12;
    // Diagnostics breadcrumbs, readable after the fact via CDP — live drops
    // used to leave NO trace ("有断的情况…黑屏", owner 2026-07-11).
    const diag = (window.__liveDiag = window.__liveDiag || []);
    const note = (why, extra) => {
      diag.push({ t: Date.now() % 1000000, why, ...(extra || {}) });
      if (diag.length > 100) diag.shift();
      console.info('[live] ' + why + (extra ? ' ' + JSON.stringify(extra) : ''));
    };

    async function resolveSrc(id) {
      if (room.directUrl) {
        // DLNA cast (Huya etc): third-party CDNs aren't in our proxy
        // allowlist and <video> needs no CORS, so play direct. Huya gets the
        // quality ladder (蓝光 HLS → sender-ratio HLS → original FLV); a 404
        // above the streamer's top tier trips the retry and steps down.
        return rewriteCastUrl(room.directUrl, variant);
      }
      // B站 live: refetch on every (re)connect — the signed URL expires, so a
      // reconnect with the OLD URL would just fail again.
      const playback = await getLivePlayback(room.roomid, qnRef.current || undefined, preferredFormat);
      if (disposed || id !== requestId) return null;
      currentFormat = playback.format;
      setQualities(playback.accept);
      qnLadderRef.current = playback.accept.map(q => q.qn);
      if (playback.qn) { qnRef.current = playback.qn; setCurQn(playback.qn); }
      note('source-ready', { format: currentFormat, qn: playback.qn });
      const proxyBase = mediaProxyBase();
      const parsed = new URL(playback.url);
      return `${proxyBase}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
    }

    // The TV plays HLS natively; desktop Chrome does not, so live streams were
    // untestable in the dev browser (owner 2026-08-02: "直播为什么测不了,解决
    // 一下"). In DEV only, attach hls.js when the engine can't do it itself —
    // the production bundle never imports it (import.meta.env.DEV is folded to
    // false and the dynamic import is dropped).
    async function attachSrc(v, src, id) {
      const nativeHls = v.canPlayType('application/vnd.apple.mpegurl');
      if (import.meta.env.DEV && !nativeHls && /\.m3u8(\?|$)/.test(src)) {
        const { default: Hls } = await import('hls.js');
        if (disposed || id !== requestId) return;
        if (Hls.isSupported()) {
          if (hlsRef.current) { try { hlsRef.current.destroy(); } catch (e) { /* ignore */ } }
          const h = new Hls({ lowLatencyMode: false, enableWorker: false });
          hlsRef.current = h;
          h.on(Hls.Events.ERROR, (_e, data) => {
            if (!data || !data.fatal) return;
            note('hls-error', { type: data.type, details: data.details });
            v.dispatchEvent(new Event('error'));   // same path as a native error
          });
          h.loadSource(src);
          h.attachMedia(v);
          v.play().catch(() => {});
          return;
        }
      }
      v.src = src;
      const playing = v.play();
      if (playing?.catch) playing.catch(err => {
        if (!disposed && id === requestId && err?.name !== 'AbortError') scheduleRetry('play-rejected');
      });
    }

    async function connect(reason) {
      if (disposed) return;
      const id = ++requestId;
      clearTimeout(retryTimer); retryTimer = null;
      clearTimeout(startupTimer);
      setLoading(true); setLoadError(false);
      try {
        note('connect', { reason, attempt: retries });
        castReportState({ playState: 'loading' }).catch(() => {});
        const src = await resolveSrc(id);
        if (!src || !videoRef.current || disposed || id !== requestId) return;
        startupTimer = setTimeout(() => scheduleRetry('startup-timeout'), 12000);
        await attachSrc(videoRef.current, src, id);
        if (disposed || id !== requestId) return;
        clearTimeout(infoTimer.current);
        infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
      } catch (err) {
        if (disposed || id !== requestId) return;
        note('connect-failed', { msg: err?.message });
        scheduleRetry('connect-failed');
      }
    }

    function scheduleRetry(why) {
      if (disposed || retryTimer != null) return;
      clearTimeout(startupTimer);
      requestId++; // Late API/import results cannot replace a newer attempt.
      // Preserve the full decoder ladder and the existing DLNA variant budget.
      const retryLimit = everPlayed || room.directUrl ? MAX_RETRIES : Math.max(2, qnLadderRef.current.length);
      if (retries >= retryLimit) {
        note('gave-up', { after: retries, variant });
        setLoading(false);
        setLoadError(true);
        castReportState({ playState: 'error', error: 'live-' + why }).catch(() => {});
        return;
      }
      if (!room.directUrl && currentFormat === 'fmp4' &&
          (why === 'startup-timeout' || why === 'format-error')) {
        preferredFormat = 'ts';
        note('format-fallback', { from: 'fmp4', to: 'ts' });
      }
      // Only a repeated failure means the VARIANT is wrong; a single hiccup
      // just needs the same stream again (with a freshly resolved URL).
      variantFails++;
      if (variantFails >= 2) {
        variantFails = 0;
        variant = variant < MAX_VARIANT ? variant + 1 : 0;   // cycle, don't dead-end
      }
      retries++;
      setLoading(true);
      note('retry', { why, attempt: retries, variant });
      retryTimer = setTimeout(() => { retryTimer = null; connect(why); }, Math.min(800 * retries, 4000));
    }

    const v = videoRef.current;
    // Honest state + self-healing: a live stream must never just sit black.
    const onPlaying = () => {
      clearTimeout(startupTimer);
      clearTimeout(retryTimer); retryTimer = null;
      everPlayed = true;
      note('playing', { format: currentFormat, qn: qnRef.current });
      retries = 0; // healthy again — future drops get a fresh retry budget
      variantFails = 0; // this variant works; don't step off it on a later blip
      setLoading(false);
      setLoadError(false);
      castReportState({ playState: 'playing' }).catch(() => {});
    };
    const onError = () => {
      const e = v && v.error;
      note('media-error', e ? { code: e.code, msg: e.message } : {});
      // B站 直播:解码失败(code 3)= 这台电视吃不下当前这档规格,重试同一档
      // 只会一直黑屏。variant 阶梯只对投屏的 directUrl 生效,B站 房间原本**没有
      // 任何降档**——2026-08-22 实测:原画解不了 → connect/media-error 死循环。
      // 所以这里主动往下退一档,退到能播为止。
      if (shouldStepDown({ isCast: !!room.directUrl, errorCode: e && e.code })) {
        const next = nextQn(qnLadderRef.current, qnRef.current);
        if (next != null) {
          note('qn-stepdown', { from: qnRef.current, to: next });
          qnRef.current = next;
          setCurQn(next);
          // 不写进设置:这是"这台电视/这个房间放不了"的临时退让,
          // 不该变成用户的长期偏好。
        }
      }
      scheduleRetry(e?.code === 4 ? 'format-error' : 'media-error');
    };
    const onWaiting = () => { if (!disposed) setLoading(true); };
    const onEnded = () => { note('ended'); scheduleRetry('ended'); }; // live never "ends" on purpose
    if (v) {
      v.addEventListener('playing', onPlaying);
      v.addEventListener('error', onError);
      v.addEventListener('ended', onEnded);
      v.addEventListener('waiting', onWaiting);
    }

    // Stall watchdog: frozen currentTime while "playing" = silent black screen.
    let lastT = -1;
    let stuckSince = 0;
    const watchdog = setInterval(() => {
      if (disposed || !v || v.paused || !everPlayed) return;
      if (Math.abs(v.currentTime - lastT) < 0.05) {
        if (!stuckSince) stuckSince = Date.now();
        else if (Date.now() - stuckSince > 8000) {
          note('stall', { t: Math.round(v.currentTime) });
          stuckSince = 0;
          scheduleRetry('stall');
        }
      } else {
        stuckSince = 0;
      }
      lastT = v.currentTime;
    }, 2000);

    if (!room.directUrl) storage.addRecentLive(room); // local "recent live" history
    reconnectRef.current = reason => { retries = 0; everPlayed = false; connect(reason); };
    connect('initial');

    return () => {
      disposed = true;
      requestId++;
      reconnectRef.current = null;
      clearTimeout(retryTimer); clearTimeout(startupTimer);
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch (e) { /* ignore */ } hlsRef.current = null; }
      clearInterval(watchdog);
      if (infoTimer.current) clearTimeout(infoTimer.current);
      if (v) {
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('error', onError);
        v.removeEventListener('ended', onEnded);
        v.removeEventListener('waiting', onWaiting);
        v.pause(); v.removeAttribute('src'); v.load();
      }
      castReportState({ playState: 'stop' }).catch(() => {});
    };
  }, [room.roomid, room.directUrl]);

  // Live danmaku via the service relay (the browser can't connect to B站's chat
  // WS — file:// origin gets reset; the Node service connects with a proper
  // Origin/Cookie instead). The app fetches the token here and hands it over.
  useEffect(() => {
    let active = true;
    let cancel = null;
    async function startDm() {
      try {
        if (room.directUrl) return; // DLNA cast: no B站 chat to join
        let realId = room.roomid;
        try {
          const ri = await getRoomInit(room.roomid);
          if (ri?.data?.room_id) realId = ri.data.room_id;
        } catch {}
        const info = await getDanmuInfo(realId);
        const token = info?.data?.token;
        if (!token || !active) return;
        const list = info?.data?.host_list || [];
        const h443 = list.find(h => h.wss_port === 443);
        const host = (h443 && h443.host) || 'broadcastlv.chat.bilibili.com';
        cancel = danmakuSubscribe(
          { host, port: 443, roomid: realId, token, buvid: getBuvid3(), uid: 0 },
          (text) => dmLayerRef.current?.push(text),  // scrolling overlay; the
          // chat rail is fed by the EVENT path instead ({t:'dm'} carries the
          // username, which this callback doesn't) — pushing here too would
          // duplicate every line.

          (evt) => {
            if (!active || !evt) return;
            // Breadcrumbs: which cmd types actually arrive from a given room
            // (gifts are bursty — "no feed items" alone can't tell a broken
            // relay from a quiet room).
            const seen = (window.__liveEvents = window.__liveEvents || []);
            seen.push(evt.t);
            if (seen.length > 200) seen.shift();
            if (evt.t === 'watched') { setStats(s => ({ ...s, watched: evt.num })); return; }
            if (evt.t === 'likes') { setStats(s => ({ ...s, likes: evt.num })); return; }
            if (evt.t === 'online') { setStats(s => ({ ...s, online: evt.num })); return; }
            // Interaction feed — newest first, keep the list short (TV screen
            // real estate + React churn on a busy room).
            if (evt.t === 'enter' && evt.kind !== 2) return; // only 关注, 进场太吵
            const item = { id: ++feedSeq.current, ...evt };
            // Newest last: the panel reads top→bottom like YouTube's live chat.
            setFeed(prev => prev.concat([item]).slice(-40));
          }
        );
      } catch (e) {
        console.warn('[live danmaku] failed:', e?.message || e);
      }
    }
    // 先把最近的聊天记录铺上,再接实时流 —— 否则聊天栏永远从空白开始。
    (async () => {
      try {
        const realId = room.roomid;
        const h = await getLiveHistory(realId);
        const rows = (h?.data?.room) || [];
        if (!active || !rows.length) return;
        setFeed(prev => (prev.length ? prev : rows.slice(-20).map(m => ({
          id: ++feedSeq.current, t: 'dm', user: m.nickname, text: m.text, history: true,
        }))));
      } catch (e) { /* 历史拿不到就照常走实时流 */ }
    })();
    startDm();
    return () => { active = false; if (cancel) cancel(); danmakuStop().catch(() => {}); };
  }, [room.roomid]);

  // Report playback POSITION to the DLNA sender (owner 2026-07-30: 虎牙投屏
  // "过一会儿就断"). Only the VOD player did this; live never did, so the
  // service answered GetPositionInfo with RelTime 00:00:00 forever. The Huya
  // app polls that, concludes the renderer is stuck, and re-pushes
  // SetAVTransportURI — which reloads the stream and looks like a drop.
  // Measured before the fix: playback ran fine for ~2 min, then currentTime
  // reset to 6s/16s twice in 40s, with NO entries in our own retry breadcrumbs
  // (i.e. the reload came from outside, not from our watchdog).
  useEffect(() => {
    if (!room.directUrl) return;              // only DLNA casts have a sender
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      castReportProgress({
        // Live has no meaningful duration; 0 is the DLNA convention for it.
        duration: isFinite(v.duration) && v.duration > 0 ? Math.floor(v.duration) : 0,
        position: Math.floor(v.currentTime || 0),
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [room.directUrl]);

  // The source and quality ladder are resolved together by connect().
  const applyQuality = (qn) => {
    qnRef.current = qn;
    setCurQn(qn);
    setShowQuality(false);
    storage.setSettings({ ...storage.getSettings(), liveQn: qn });
    reconnectRef.current?.('quality');
  };

  useEffect(() => {
    const handleCastCommand = (event) => {
      const command = event.detail;
      if (!command) return;
      if (command.type === 'stop') {
        onBack?.();
        return;
      }
      if (!videoRef.current) return;
      if (command.type === 'pause') {
        videoRef.current.pause();
        castReportState({ playState: 'paused' }).catch(() => {});
        return;
      }
      if (command.type === 'resume') {
        videoRef.current.play();
        castReportState({ playState: 'playing' }).catch(() => {});
      }
    };

    window.addEventListener('bili-cast-command', handleCastCommand);
    return () => window.removeEventListener('bili-cast-command', handleCastCommand);
  }, [onBack]);

  // Key handler
  const toggleInteract = () => {
    setInteractOn(prev => {
      const next = !prev;
      storage.setSettings({ ...storage.getSettings(), liveInteract: next });
      if (!next) setFeed([]);
      return next;
    });
  };

  const toggleDanmaku = () => {
    setDanmakuEnabled(prev => {
      const next = !prev;
      storage.setSettings({ ...storage.getSettings(), danmaku: next });
      if (!next) dmLayerRef.current?.clear();
      return next;
    });
  };

  useEffect(() => {
    const handler = (e) => {
      const bumpInfo = () => {
        setShowInfo(true);
        if (infoTimer.current) clearTimeout(infoTimer.current);
        infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
      };
      // Layered Back, same as the VOD player: 画质面板 → 控制条 → 退出.
      if (e.keyCode === 461 || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showQuality) { setShowQuality(false); return true; }
        if (showControls) { setShowControls(false); return true; }
        // The chat rail is a layer too — Back closes it before leaving the
        // room, matching the VOD comment rail. Without this the second Back
        // jumped straight out with the rail still open (measured 2026-08-02).
        if (interactOn) { toggleInteract(); return true; }
        onBack();
        return true;
      }
      // === Quality popup ===
      if (loadError && e.key === 'Enter') {
        e.preventDefault(); reconnectRef.current?.('manual'); return true;
      }
      if (showQuality) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const i = qualities.findIndex(q => q.qn === curQn);
          const next = e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(qualities.length - 1, i + 1);
          setCurQn(qualities[next].qn); // preview selection; applied on OK
          return true;
        }
        if (e.key === 'Enter') { e.preventDefault(); applyQuality(curQn); return true; }
        return false;
      }
      // === Control bar ===
      if (showControls) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setCtrlIdx(i => Math.min(CONTROLS.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))));
          return true;
        }
        // 上/下都能关 —— 和"上/下都能开"对称。点播的上=关、下=进相关推荐面板,
        // 直播没有下层面板,再让上键无反应就纯粹是手感不一致(owner 2026-08-22)。
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); setShowControls(false); return true;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = CONTROLS[ctrlIdx];
          if (btn === 'danmaku') toggleDanmaku();
          else if (btn === 'interact') toggleInteract();
          else if (btn === 'quality' && qualities.length) setShowQuality(true);
          return true;
        }
        return false;
      }
      // === 无浮层:上/下**都**呼出控制条,和点播页一致 ===
      // 原来只有上键能呼出,下键只是刷新信息条,按了像没反应(owner 2026-08-22)。
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setShowControls(true);
        setCtrlIdx(0);
        bumpInfo();
        return true;
      }
      if (e.key === 'Enter') { e.preventDefault(); toggleDanmaku(); bumpInfo(); return true; }
      return false;
    };
    setCustomKeyHandler(handler);
    return () => setCustomKeyHandler(null);
  }, [onBack, showControls, showQuality, ctrlIdx, qualities, curQn, interactOn, danmakuEnabled, loadError]);

  // Magic Remote pointer: moving shows the info bar, clicking toggles danmaku
  // (mirrors up/down and OK on the D-pad).
  const showInfoBriefly = () => {
    setShowInfo(true);
    if (infoTimer.current) clearTimeout(infoTimer.current);
    infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
  };

  return (
    <div className="player-page"
      onMouseMove={showInfoBriefly}
      onClick={(e) => {
        // Clicks on the control bar / quality popup drive their own handlers —
        // only a click on the video area toggles danmaku.
        if (e.target.closest && e.target.closest('.player-controls, .ctrl-popup')) return;
        toggleDanmaku();
        showInfoBriefly();
      }}>
      {/* Panel open → video is SHRUNK, never covered (YouTube TV behaviour).
          16:9 in a 1500-wide column leaves ~236px vertically; YouTube fills
          that with the video's metadata instead of black bars, so we do too. */}
      <div style={{ position: 'absolute', top: 0, left: 0,
        width: interactOn ? 1920 - CHAT_W : 1920, height: 1080, overflow: 'hidden' }}>
        <video ref={videoRef} className="player-video" autoPlay
          style={interactOn ? { width: VIDEO_W, height: VIDEO_H, marginTop: 0 } : undefined} />
        <LiveDanmakuLayer ref={dmLayerRef} enabled={danmakuEnabled} />
        {interactOn && (
          <div style={{
            position: 'absolute', top: VIDEO_H, left: 0, width: VIDEO_W,
            height: 1080 - VIDEO_H, padding: '22px 40px', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10,
          }}>
            <div style={{ fontSize: 26, color: '#fff', fontWeight: 600, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.title}</div>
            <div style={{ fontSize: 19, color: '#9aa0a8', display: 'flex', gap: 18, alignItems: 'center' }}>
              <span style={{ color: '#fb7299' }}>● {t('直播中')}</span>
              <span>{room.owner?.name || ''}</span>
              {stats.watched > 0 && <span>👀 {formatCount(stats.watched)}</span>}
              {stats.likes > 0 && <span>👍 {formatCount(stats.likes)}</span>}
            </div>
          </div>
        )}
      </div>

      {(loading || loadError) && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', zIndex: 50 }}>
          {loadError
            ? <button className="player-btn focused" onClick={e => { e.stopPropagation(); reconnectRef.current?.('manual'); }}>{t('加载失败，按确认重试')}</button>
            : <div className="loading"><div className="loading-spinner" />{t('加载直播...')}</div>}
        </div>
      )}

      {showInfo && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          background: 'linear-gradient(rgba(0,0,0,0.8), transparent)',
          padding: '30px 60px', zIndex: 30,
          transition: 'opacity 0.3s ease',
        }}>
          <div style={{ fontSize: 28, color: '#fff', fontWeight: 600 }}>{room.title}</div>
          <div style={{ fontSize: 20, color: '#aaa', marginTop: 8 }}>
            {room.owner?.name || ''} · {t('直播中')}
          </div>
          <div style={{ fontSize: 16, color: '#888', marginTop: 6, display: 'flex', gap: 18 }}>
            <span>{t('OK 键：弹幕')} {danmakuEnabled ? t('开') : t('关')}</span>
            <span>{t('↑ 控制栏')}</span>
            {stats.watched > 0 && <span>👀 {formatCount(stats.watched)}</span>}
            {stats.likes > 0 && <span>👍 {formatCount(stats.likes)}</span>}
          </div>
        </div>
      )}

      {/* 聊天/互动面板 (YouTube TV 式): 视频左缩,面板占右,互不遮挡 */}
      {interactOn && (
        <div style={{
          position: 'absolute', top: 0, right: 0, width: CHAT_W, height: 1080,
          background: '#16161c', borderLeft: '1px solid #2b2c33',
          display: 'flex', flexDirection: 'column', zIndex: 34,
        }}>
          <div style={{ padding: '20px 22px 12px', borderBottom: '1px solid #2b2c33' }}>
            <div style={{ fontSize: 20, color: '#fff', fontWeight: 600 }}>{t('聊天')}</div>
            <div style={{ fontSize: 16, color: '#8a8f98', marginTop: 6, display: 'flex', gap: 14 }}>
              {stats.watched > 0 && <span>👀 {formatCount(stats.watched)}</span>}
              {stats.likes > 0 && <span>👍 {formatCount(stats.likes)}</span>}
              {stats.online > 0 && <span>{t('在线')} {formatCount(stats.online)}</span>}
            </div>
          </div>
          <div ref={chatScrollRef} style={{
            flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-end', gap: 10, padding: '14px 22px 22px',
          }}>
            {feed.length === 0 && (
              <div style={{ fontSize: 17, color: '#6f7480' }}>{t('等待聊天消息…')}</div>
            )}
            {feed.slice(-14).map(it => (
              <div key={it.id} style={{
                fontSize: 18, lineHeight: 1.45, color: '#e1e1e6', wordBreak: 'break-word',
                background: it.t === 'sc' ? 'rgba(251,114,153,0.18)' : 'transparent',
                borderLeft: it.t === 'guard' ? '3px solid #ffc331' : 'none',
                padding: it.t === 'sc' || it.t === 'guard' ? '8px 10px' : 0,
                borderRadius: it.t === 'sc' ? 6 : 0,
              }}>
                {it.t === 'dm' && <span><b style={{ color: '#8ba7c0' }}>{it.user}</b>: {it.text}</span>}
                {it.t === 'gift' && <span><b style={{ color: '#8ba7c0' }}>{it.user}</b> {t('送出')} {it.gift} ×{it.num}</span>}
                {it.t === 'sc' && <span><b>{it.user}</b>（¥{it.price}）：{it.text}</span>}
                {it.t === 'guard' && <span><b style={{ color: '#ffc331' }}>{it.user}</b> {t('开通了')} {it.name}</span>}
                {it.t === 'enter' && <span><b style={{ color: '#8ba7c0' }}>{it.user}</b> {t('关注了直播间')}</span>}
                {it.t === 'redpacket' && <span>🧧 <b>{it.user}</b> {t('发起了红包')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 控制栏 (owner: 直播没有控制台) */}
      {showControls && (
        <div className="player-controls" style={{ zIndex: 40 }}>
          <div style={{ display: 'flex', gap: 14, padding: '18px 60px', alignItems: 'center' }}>
            {CONTROLS.map((btn, i) => (
              <button key={btn}
                className={`player-btn player-control ${ctrlIdx === i ? 'focused' : ''}`}
                onMouseEnter={() => setCtrlIdx(i)}
                onClick={() => {
                  setCtrlIdx(i);
                  if (btn === 'danmaku') toggleDanmaku();
                  else if (btn === 'interact') toggleInteract();
                  else if (btn === 'quality' && qualities.length) setShowQuality(true);
                }}>
                <Icon name={btn === 'interact' ? 'comments' : btn} size={26} />
                <span className="player-control-label">{btn === 'danmaku' ? (danmakuEnabled ? t('弹幕 开') : t('弹幕 关'))
                  : btn === 'interact' ? (interactOn ? t('聊天 开') : t('聊天 关'))
                    : ((qualities.find(q => q.qn === curQn) || {}).label || t('画质'))}</span>
              </button>
            ))}
            <span style={{ marginLeft: 'auto', color: '#aaa', fontSize: 18, display: 'flex', gap: 20 }}>
              {stats.online > 0 && <span>{t('在线')} {formatCount(stats.online)}</span>}
              {stats.watched > 0 && <span>👀 {formatCount(stats.watched)}</span>}
              {stats.likes > 0 && <span>👍 {formatCount(stats.likes)}</span>}
            </span>
          </div>
        </div>
      )}

      {/* 画质选择 — anchored above the control bar, rendered at page root */}
      {showQuality && (
        <div className="ctrl-popup" style={{ left: 150, bottom: 130 }}>
          {qualities.map(q => (
            <div key={q.qn}
              className={`quality-option ${curQn === q.qn ? 'focused active' : ''}`}
              onMouseEnter={() => setCurQn(q.qn)}
              onClick={() => applyQuality(q.qn)}>
              {q.label}
            </div>
          ))}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 20, right: 30,
        background: 'rgba(255,0,0,0.8)', color: '#fff',
        padding: '4px 14px', borderRadius: 4, fontSize: 16, zIndex: 31,
      }}>
        LIVE
      </div>
    </div>
  );
}
