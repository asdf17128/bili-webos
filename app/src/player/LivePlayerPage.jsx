import React, { useState, useEffect, useRef } from 'react';
import { getLiveStreamUrl, castReportState } from '../api/client';
import { storage } from '../utils/storage';
import { setCustomKeyHandler } from '../hooks/useFocus';

export default function LivePlayerPage({ room, onBack }) {
  const videoRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(true);
  const infoTimer = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        castReportState({ playState: 'loading' }).catch(() => {});
        const hlsUrl = await getLiveStreamUrl(room.roomid);
        if (!hlsUrl || !videoRef.current) return;

        // Proxy the HLS stream (local service or Mac proxy)
        const proxyBase = (typeof window !== 'undefined' && window.webOS)
          ? 'http://127.0.0.1:7654'
          : storage.getProxyUrl();
        const parsed = new URL(hlsUrl);
        const proxied = `${proxyBase}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;

        videoRef.current.src = proxied;
        videoRef.current.play();
        setLoading(false);
        castReportState({ playState: 'playing' }).catch(() => {});

        // Hide info after 3s
        infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
      } catch (err) {
        console.error('Live stream error:', err);
        setLoading(false);
        castReportState({ playState: 'error', error: err?.message || 'live-load-failed' }).catch(() => {});
      }
    }
    load();
    return () => {
      if (infoTimer.current) clearTimeout(infoTimer.current);
      castReportState({ playState: 'stop' }).catch(() => {});
    };
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
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') {
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

  return (
    <div className="player-page">
      <video ref={videoRef} className="player-video" autoPlay />

      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', zIndex: 50 }}>
          <div className="loading"><div className="loading-spinner" />加载直播...</div>
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
            {room.owner?.name || ''} · 直播中
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
