import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { initKeyboardNav, setFocus, onFocusChange, getCurrentFocusId, focusFirstContent, setLastSidebarFocus, isPointerFocus } from './hooks/useFocus';
import { castAck, castSubscribe, getNavInfo, pingVersionAsset } from './api/client';
import { normalizePlay, playAt } from './player/playIntent';
import { storage } from './utils/storage';
import SidebarItem from './components/SidebarItem';

import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import FavoritesPage from './pages/FavoritesPage';
import ConfigPage from './pages/ConfigPage';
import { t } from './i18n';
// Lazy-loaded so the video engine (Shaka Player) is NOT pulled into the startup
// bundle. On older webOS (6.x / Chromium 79) Shaka's module init throws at load
// and blanked the entire app — even the home screen (issue #10). Deferring it
// lets the browse UI render on those TVs; the player chunk loads only when a
// video or live stream is actually opened.
const PlayerPage = lazy(() => import('./player/PlayerPage'));
const LivePlayerPage = lazy(() => import('./player/LivePlayerPage'));

// The 6 pulled-out partitions, each its own sidebar entry (replaces the single
// "分区" tab, which used a RANDOM old rid per fetch → mixed unrelated partitions
// AND showed the FROZEN pre-2024-reform ranking, all ~2025-03 videos). rid here
// is B站's NEW partition id (pid_v2) — ranking/v2 on these returns the current
// hot ranking (~top 100). Easily swappable.
const PARTITIONS = [
  { key: 'p-1008', label: () => t('游戏'), icon: '🎮', rid: 1008 },
  { key: 'p-1005', label: () => t('动画'), icon: '📺', rid: 1005 },
  { key: 'p-1003', label: () => t('音乐'), icon: '🎵', rid: 1003 },
  { key: 'p-1010', label: () => t('知识'), icon: '📚', rid: 1010 },
  { key: 'p-1002', label: () => t('娱乐'), icon: '🎭', rid: 1002 },
  { key: 'p-1007', label: () => t('鬼畜'), icon: '😜', rid: 1007 },
];

// Sidebar: main feeds · [divider] partitions · [divider] utilities — regular
// partitions grouped apart from the rest (owner).
// 搜索置顶(像 YouTube),但默认落地页仍是推荐;Back 回到推荐按钮(不落搜索)。
const NAV_ITEMS = [
  { key: 'search', label: () => t('搜索'), icon: '🔍' },
  { key: 'recommend', label: () => t('推荐'), icon: '🏠', dividerBefore: true },
  { key: 'hot', label: () => t('热门'), icon: '🔥' },
  { key: 'live', label: () => t('直播'), icon: '📡' },
  { key: 'follow', label: () => t('关注'), icon: '👤' },
  { key: 'favorites', label: () => t('收藏'), icon: '⭐' },
  ...PARTITIONS.map((p, i) => (i === 0 ? { ...p, dividerBefore: true } : p)),
  { key: 'settings', label: () => t('我的'), icon: '🕘', dividerBefore: true },
  { key: 'config', label: () => t('设置'), icon: '⚙️' },
];

const PARTITION_KEYS = PARTITIONS.reduce((m, p) => { m[p.key] = p.rid; return m; }, {});

// The sidebar cell id for a page key (partition keys are in NAV_ITEMS too).
// Unknown keys fall back to the 推荐 button — the home target for Back.
function sidebarIdForPage(key) {
  let i = NAV_ITEMS.findIndex(n => n.key === key);
  if (i < 0) i = NAV_ITEMS.findIndex(n => n.key === 'recommend');
  return `sidebar-${i}-0`;
}

// Detect a bangumi (PGC) item across the shapes it arrives in: watch history
// (business:'pgc', badge:'番剧'), the recommend feed (goto:'bangumi', a /ep|/ss
// uri), or an already-normalized item. Returns {epid, seasonId, cid} or null.
function detectBangumi(v) {
  if (!v) return null;
  if (v.isBangumi) return { epid: v.epid, seasonId: v.seasonId, cid: v.cid };
  const uri = v.uri || v.url || v.redirect_url || '';
  const epFromUri = (uri.match(/ep(\d+)/) || [])[1];
  const ssFromUri = (uri.match(/ss(\d+)/) || [])[1];
  const epid = v.epid || v.ep_id || epFromUri;
  const seasonId = v.seasonId || v.season_id || ssFromUri || (v.business === 'pgc' ? v.oid : null);
  const isPgc = v.business === 'pgc' || v.badge === '番剧' || v.goto === 'bangumi' || !!epid || !!ssFromUri;
  if (isPgc && (epid || seasonId)) return { epid: epid || null, seasonId: seasonId || null, cid: v.cid || null };
  return null;
}

function Sidebar({ activePage, onPreview, onSelect, user }) {
  // Arrowing onto a sidebar item previews that page (no refresh). Pointer hover
  // only highlights — it does NOT switch pages — so the Magic Remote cursor
  // drifting over the menu no longer rapid-switches pages (#11). Click still
  // selects via onSelect.
  useEffect(() => {
    return onFocusChange((fid) => {
      if (!fid?.startsWith('sidebar-')) return;
      if (isPointerFocus()) return;
      const match = fid.match(/^sidebar-(\d+)-/);
      if (!match) return;
      const idx = parseInt(match[1]);
      if (idx < NAV_ITEMS.length) onPreview(NAV_ITEMS[idx].key);
    });
  }, [onPreview]);

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
            label={item.label()}
            icon={item.icon}
            active={activePage === item.key}
            onSelect={() => onSelect(item.key)}
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
          <div className="sidebar-user-login">{t('未登录')}</div>
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
    setLastSidebarFocus(sidebarIdForPage('recommend')); // home = 推荐, not 搜索(top)
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
            title: command.title || t('投屏直播'),
            owner: { name: '' },
          });
        } else {
          setLiveRoom(null);
          setPlayerVideo(playAt({
            aid: command.aid,
            bvid: command.bvid,
            cid: command.cid,
            epid: command.epid,
            title: command.title || t('投屏视频'),
            owner: { name: '' },
            fromCast: true,
          }, Number(command.seekTs || 0)));
        }
        return;
      }

      if (command.type === 'playDirectUrl') {
        // DLNA cast (Huya/generic): play the sender's URL via the live player's
        // native <video> path (HLS/MP4; FLV isn't decodable on webOS).
        pendingCastAckRef.current = command;
        setPlayerVideo(null);
        setLiveRoom({
          roomid: 'dlna-' + Date.now(),
          directUrl: command.url,
          title: command.title || t('投屏视频'),
          owner: { name: '' },
        });
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
      } else if (getCurrentFocusId()?.startsWith('content-')) {
        // First Back from inside a page returns to the sidebar, landing on THIS
        // page's own button (not sidebar[0], which is now 搜索).
        setFocus(sidebarIdForPage(page));
      } else if (page !== 'recommend') {
        // On a non-home sidebar item → go home (推荐) and highlight it. Switch
        // the page explicitly (a pointer-hovered item makes setFocus a no-op,
        // so the preview wouldn't fire and Back would wedge, #11).
        setPage('recommend');
        setFocus(sidebarIdForPage('recommend'));
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
    showToastMsg(t('登录成功'));
    setPage('recommend');
  }, [loadUserInfo]);

  const handleLogout = useCallback(() => {
    storage.clearAuth();
    setUser(null);
    setLoggedIn(false);
    showToastMsg(t('已退出登录'));
    setPage('recommend');
  }, []);

  const handlePlayVideo = useCallback((video) => {
    video = normalizePlay(video); // 续播 policy lives in playIntent.js
    if (video?.isLive && video?.roomid) {
      setLiveRoom(video);
      return;
    }
    const bg = detectBangumi(video);
    if (bg) {
      setLiveRoom(null);
      setPlayerVideo({
        ...video, isBangumi: true,
        epid: bg.epid, seasonId: bg.seasonId, cid: video.cid || bg.cid,
      });
      return;
    }
    if (!video?.bvid) {
      // Order-play: a 失效 favorites item has no bvid — skip forward to the next
      // playable item in the playlist instead of just toasting (#11).
      const pl = video?.playlist;
      const idx = video?.playlistIndex;
      if (pl && Array.isArray(pl) && typeof idx === 'number') {
        for (let j = idx + 1; j < pl.length; j++) {
          if (pl[j]?.bvid) { setPlayerVideo({ ...pl[j], playlist: pl, playlistIndex: j }); return; }
        }
      }
      showToastMsg(t('无法播放此视频')); return;
    }
    setPlayerVideo(video);
  }, []);

  // Test deep-link: lets the CDP harness play an exact video without driving
  // the whole UI to it (tools/cases scripts; see tv-test skill "深链直达").
  // Same entry as a card press — everything downstream is production code.
  useEffect(() => {
    window.__openVideo = (v) => handlePlayVideo(v);
    return () => { delete window.__openVideo; };
  }, [handlePlayVideo]);

  // Once-a-day countable version check (see client.pingVersionAsset). The date
  // stamps regardless of outcome so a missing asset doesn't retry all day.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (storage.get('verPing') === today) return;
    storage.set('verPing', today);
    pingVersionAsset().catch(() => {});
  }, []);

  // Arrowing onto a sidebar item just previews its page — no refresh, no
  // jumping into the content.
  const previewPage = useCallback((key) => {
    if ((key === 'follow' || key === 'favorites') && !loggedIn) { setShowLogin(true); return; }
    if (key !== page) setPage(key);
  }, [loggedIn, page]);

  // OK/click on a sidebar item commits: switch (or refresh if already active)
  // and move focus into the content so the user doesn't need a second key.
  const selectPage = useCallback((key) => {
    if ((key === 'follow' || key === 'favorites') && !loggedIn) { setShowLogin(true); return; }
    if (key === page) setRefreshKey(n => n + 1);
    else setPage(key);
    focusFirstContent();
  }, [loggedIn, page]);

  const showToastMsg = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  return (
    <>
      <div className="app-container" style={{ display: (playerVideo || liveRoom) ? 'none' : 'flex' }}>
        <Sidebar activePage={page} onPreview={previewPage} onSelect={selectPage} user={user} />
        <div className="main-content">
          {page === 'recommend' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="recommend" />}
          {page === 'hot' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="hot" />}
          {page === 'live' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="live" />}
          {PARTITION_KEYS[page] != null && <HomePage key={page} onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="partition" rid={PARTITION_KEYS[page]} />}
          {page === 'follow' && <HomePage onPlayVideo={handlePlayVideo} refreshKey={refreshKey} mode="follow" />}
          {page === 'search' && <SearchPage onPlayVideo={handlePlayVideo} />}
          {page === 'favorites' && <FavoritesPage userMid={user?.mid} onPlayVideo={handlePlayVideo} />}
          {page === 'settings' && <SettingsPage user={user} onPlayVideo={handlePlayVideo} onRequestLogin={() => setShowLogin(true)} />}
          {page === 'config' && <ConfigPage onLogout={handleLogout} user={user} />}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>

      {(playerVideo || liveRoom) && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 150, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20 }}>{t('加载播放器…')}</div>}>
          {playerVideo && <PlayerPage key={`${playerVideo.bvid || playerVideo.epid || playerVideo.aid || ''}-${playerVideo.cid || playerVideo.epid || ''}`} video={playerVideo} onBack={() => setPlayerVideo(null)} onPlayNext={(v) => setPlayerVideo(normalizePlay(v))} />}
          {liveRoom && <LivePlayerPage key={liveRoom.roomid} room={liveRoom} onBack={() => setLiveRoom(null)} />}
        </Suspense>
      )}

      {showLogin && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: 1920, height: 1080, zIndex: 200, background: '#0d0d1a' }}>
          <LoginPage onLogin={handleLogin} />
        </div>
      )}
    </>
  );
}
