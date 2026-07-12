import React, { useState, useEffect, useRef } from 'react';
import { getLiveStreamUrl, getRoomInit, getDanmuInfo, getBuvid3, danmakuSubscribe, danmakuStop, castReportState } from '../api/client';
import { storage } from '../utils/storage';
import { setCustomKeyHandler } from '../hooks/useFocus';
import { rewriteCastUrl } from '../utils/casturl';
import LiveDanmakuLayer from './LiveDanmakuLayer';
import { t } from '../i18n';

export default function LivePlayerPage({ room, onBack }) {
  const videoRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(true);
  const [danmakuEnabled, setDanmakuEnabled] = useState(storage.getSettings().danmaku !== false);
  const infoTimer = useRef(null);
  const dmLayerRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    const MAX_RETRIES = 5;
    // Diagnostics breadcrumbs, readable after the fact via CDP — live drops
    // used to leave NO trace ("有断的情况…黑屏", owner 2026-07-11).
    const diag = (window.__liveDiag = window.__liveDiag || []);
    const note = (why, extra) => {
      diag.push({ t: Date.now() % 1000000, why, ...(extra || {}) });
      if (diag.length > 100) diag.shift();
      console.info('[live] ' + why + (extra ? ' ' + JSON.stringify(extra) : ''));
    };

    async function resolveSrc() {
      if (room.directUrl) {
        // DLNA cast (Huya etc): third-party CDNs aren't in our proxy
        // allowlist and <video> needs no CORS, so play direct. Known-FLV
        // senders get the HLS rewrite first (this TV's FLV demux is flaky —
        // MEDIA_ERR 4); if two rewritten attempts fail, fall back to the
        // original URL.
        return retries >= 2 ? room.directUrl : rewriteCastUrl(room.directUrl);
      }
      // B站 live: refetch on every (re)connect — the signed URL expires, so a
      // reconnect with the OLD URL would just fail again.
      const hlsUrl = await getLiveStreamUrl(room.roomid);
      if (!hlsUrl) return null;
      const proxyBase = (typeof window !== 'undefined' && window.webOS)
        ? 'http://127.0.0.1:7654'
        : storage.getProxyUrl();
      const parsed = new URL(hlsUrl);
      return `${proxyBase}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
    }

    async function connect(reason) {
      if (disposed) return;
      try {
        note('connect', { reason, attempt: retries });
        castReportState({ playState: 'loading' }).catch(() => {});
        const src = await resolveSrc();
        if (!src || !videoRef.current || disposed) return;
        videoRef.current.src = src;
        videoRef.current.play();
        setLoading(false);
        infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
      } catch (err) {
        note('connect-failed', { msg: err?.message });
        scheduleRetry('connect-failed');
      }
    }

    function scheduleRetry(why) {
      if (disposed) return;
      if (retries >= MAX_RETRIES) {
        note('gave-up', { after: retries });
        setLoading(false);
        castReportState({ playState: 'error', error: 'live-' + why }).catch(() => {});
        return;
      }
      retries++;
      setLoading(true);
      setTimeout(() => connect(why), Math.min(1000 * retries, 4000));
    }

    const v = videoRef.current;
    // Honest state + self-healing: a live stream must never just sit black.
    const onPlaying = () => {
      retries = 0; // healthy again — future drops get a fresh retry budget
      setLoading(false);
      castReportState({ playState: 'playing' }).catch(() => {});
    };
    const onError = () => {
      const e = v && v.error;
      note('media-error', e ? { code: e.code, msg: e.message } : {});
      scheduleRetry('media-error');
    };
    const onEnded = () => { note('ended'); scheduleRetry('ended'); }; // live never "ends" on purpose
    if (v) {
      v.addEventListener('playing', onPlaying);
      v.addEventListener('error', onError);
      v.addEventListener('ended', onEnded);
    }

    // Stall watchdog: frozen currentTime while "playing" = silent black screen.
    let lastT = -1;
    let stuckSince = 0;
    const watchdog = setInterval(() => {
      if (disposed || !v || v.paused || v.readyState < 2) return; // still buffering/connecting
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
    connect('initial');

    return () => {
      disposed = true;
      clearInterval(watchdog);
      if (infoTimer.current) clearTimeout(infoTimer.current);
      if (v) {
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('error', onError);
        v.removeEventListener('ended', onEnded);
      }
      castReportState({ playState: 'stop' }).catch(() => {});
    };
  }, [room.roomid]);

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
          (text) => dmLayerRef.current?.push(text)
        );
      } catch (e) {
        console.warn('[live danmaku] failed:', e?.message || e);
      }
    }
    startDm();
    return () => { active = false; if (cancel) cancel(); danmakuStop().catch(() => {}); };
  }, [room.roomid]);

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
  useEffect(() => {
    const handler = (e) => {
      if (e.keyCode === 461 || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onBack();
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        setDanmakuEnabled(prev => {
          const next = !prev;
          storage.setSettings({ ...storage.getSettings(), danmaku: next });
          if (!next) dmLayerRef.current?.clear();
          return next;
        });
        setShowInfo(true);
        if (infoTimer.current) clearTimeout(infoTimer.current);
        infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
        return true;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setShowInfo(true);
        if (infoTimer.current) clearTimeout(infoTimer.current);
        infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
        return true;
      }
      return false;
    };
    setCustomKeyHandler(handler);
    return () => setCustomKeyHandler(null);
  }, [onBack]);

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
      onClick={() => {
        setDanmakuEnabled(prev => {
          const next = !prev;
          storage.setSettings({ ...storage.getSettings(), danmaku: next });
          if (!next) dmLayerRef.current?.clear();
          return next;
        });
        showInfoBriefly();
      }}>
      <video ref={videoRef} className="player-video" autoPlay />

      <LiveDanmakuLayer ref={dmLayerRef} enabled={danmakuEnabled} />

      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', zIndex: 50 }}>
          <div className="loading"><div className="loading-spinner" />{t('加载直播...')}</div>
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
          <div style={{ fontSize: 16, color: '#888', marginTop: 6 }}>
            {t('OK 键：弹幕')} {danmakuEnabled ? t('开') : t('关')}
          </div>
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
