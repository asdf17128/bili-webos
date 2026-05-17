import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initKeyboardNav, setFocus } from './hooks/useFocus';
import { castAck, castSubscribe, getNavInfo } from './api/client';
import { storage } from './utils/storage';
import SidebarItem from './components/SidebarItem';

import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import PlayerPage from './player/PlayerPage';
import LivePlayerPage from './player/LivePlayerPage';

const NAV_ITEMS = [
  { key: 'recommend', label: '推荐', icon: '🏠' },
  { key: 'hot', label: '热门', icon: '🔥' },
  { key: 'live', label: '直播', icon: '📡' },
  { key: 'partition', label: '分区', icon: '📁' },
  { key: 'follow', label: '关注', icon: '👤' },
  { key: 'search', label: '搜索', icon: '🔍', dividerBefore: true },
  { key: 'settings', label: '我的', icon: '⚙️' },
];

function Sidebar({ activePage, onPageChange, user }) {
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <h1>B站</h1>
        <span>webOS</span>
      </div>

      {NAV_ITEMS.map((item, i) => (
        <React.Fragment key={item.key}>
          {item.dividerBefore && <div className="sidebar-divider" />}
          <SidebarItem
            id={`sidebar-${i}-0`}
            row={i}
            label={item.label}
            icon={item.icon}
            active={activePage === item.key}
            onSelect={() => onPageChange(item.key)}
          />
        </React.Fragment>
      ))}

      <div className="sidebar-user">
        {user ? (
          <>
            <div className="sidebar-user-avatar">
              {user.face && <img src={user.face} alt="" />}
            </div>
            <div className="sidebar-user-name">{user.uname}</div>
          </>
        ) : (
          <div className="sidebar-user-login">未登录</div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('recommend');
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [playerVideo, setPlayerVideo] = useState(null);
  const [liveRoom, setLiveRoom] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingCastAckRef = useRef(null);

  useEffect(() => {
    initKeyboardNav();
    const auth = storage.getAuth();
    if (auth?.SESSDATA) {
      setLoggedIn(true);
      loadUserInfo();
    }
    setTimeout(() => setFocus('content-0-0'), 500);
  }, []);

  useEffect(() => {
    const unsubscribe = castSubscribe(async (event) => {
      if (!event || event.kind !== 'command' || !event.command) return;
      const command = event.command;

      if (command.type === 'play') {
        pendingCastAckRef.current = command;
        if (command.contentType === 'live') {
          setPlayerVideo(null);
          setLiveRoom({
            roomid: command.roomId,
            title: command.title || '投屏直播',
            owner: { name: '' },
          });
        } else {
          setLiveRoom(null);
          setPlayerVideo({
            aid: command.aid,
            bvid: command.bvid,
            cid: command.cid,
            epid: command.epid,
            title: command.title || '投屏视频',
            owner: { name: '' },
            fromCast: true,
            progress: Math.max(0, Number(command.seekTs || 0)),
          });
        }
        return;
      }

      if (command.type === 'stop') {
        window.dispatchEvent(new CustomEvent('bili-cast-command', { detail: command }));
        setPlayerVideo(null);
        setLiveRoom(null);
        return;
      }

      window.dispatchEvent(new CustomEvent('bili-cast-command', { detail: command }));
    }, (err) => {
      console.error('Cast subscribe error:', err);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const pending = pendingCastAckRef.current;
    if (!pending) return;
    if ((pending.contentType === 'video' && playerVideo) || (pending.contentType === 'live' && liveRoom)) {
      castAck({
        accepted: true,
        command: pending,
        at: Date.now(),
      }).catch(() => {});
      pendingCastAckRef.current = null;
    }
  }, [playerVideo, liveRoom]);

  useEffect(() => {
    const handleBack = () => {
      if (playerVideo) {
        setPlayerVideo(null);
      } else if (liveRoom) {
        setLiveRoom(null);
      } else if (showLogin) {
        setShowLogin(false);
      } else if (page !== 'recommend') {
        setPage('recommend');
      } else {
        try { window.webOS?.platformBack?.(); } catch { window.close(); }
      }
    };
    window.addEventListener('tv-back', handleBack);
    return () => window.removeEventListener('tv-back', handleBack);
  }, [playerVideo, showLogin, page]);

  const loadUserInfo = useCallback(async () => {
    try {
      const res = await getNavInfo();
      if (res?.data?.isLogin) {
        setUser({ mid: res.data.mid, uname: res.data.uname, face: res.data.face });
        setLoggedIn(true);
      }
    } catch (err) {
      console.error('Nav info error:', err);
    }
  }, []);

  const handleLogin = useCallback(() => {
    setShowLogin(false);
    setLoggedIn(true);
    loadUserInfo();
    showToastMsg('登录成功');
    setPage('recommend');
  }, [loadUserInfo]);

  const handleLogout = useCallback(() => {
    storage.clearAuth();
    setUser(null);
    setLoggedIn(false);
    showToastMsg('已退出登录');
    setPage('recommend');
  }, []);

  const handlePlayVideo = useCallback((video) => {
    if (video?.isLive && video?.roomid) {
      setLiveRoom(video);
      return;
    }
    if (!video?.bvid) { showToastMsg('无法播放此视频'); return; }
    setPlayerVideo(video);
  }, []);

  // Sidebar select (Enter/click) = switch page, select same page = refresh
  const handlePageChange = useCallback((key) => {
    if ((key === 'follow') && !loggedIn) {
      setShowLogin(true);
      return;
    }
    if (key === page) {
      setRefreshKey(n => n + 1);
    } else {
      setPage(key);
    }
  }, [loggedIn, page]);

  const showToastMsg = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  return (
    <>
      <div className="app-container" style={{ display: (playerVideo || liveRoom) ? 'none' : 'flex' }}>
        <Sidebar activePage={page} onPageChange={handlePageChange} user={user} />
        <div className="main-content">
          {page === 'recommend' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="recommend" />}
          {page === 'hot' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="hot" />}
          {page === 'live' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="live" />}
          {page === 'partition' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="partition" />}
          {page === 'follow' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="follow" />}
          {page === 'search' && <SearchPage onPlayVideo={handlePlayVideo} />}
          {page === 'settings' && <SettingsPage onLogout={handleLogout} user={user} onPlayVideo={handlePlayVideo} />}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>

      {playerVideo && <PlayerPage key={playerVideo.bvid || playerVideo.aid || playerVideo.cid} video={playerVideo} onBack={() => setPlayerVideo(null)} onPlayNext={(v) => setPlayerVideo(v)} />}
      {liveRoom && <LivePlayerPage key={liveRoom.roomid} room={liveRoom} onBack={() => setLiveRoom(null)} />}

      {showLogin && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: 1920, height: 1080, zIndex: 200, background: '#0d0d1a' }}>
          <LoginPage onLogin={handleLogin} />
        </div>
      )}
    </>
  );
}
