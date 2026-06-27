import React, { useState, useEffect, useRef } from 'react';
import { getFavFolders, getFavList } from '../api/client';
import VideoGrid from '../components/VideoGrid';
import { storage } from '../utils/storage';
import { useFocusable, getCurrentFocusId, setFocus, onFocusChange } from '../hooks/useFocus';

// A single folder chip in the top selector row (focus group 'content', row 0).
function FolderChip({ folder, idx, active, onSelect }) {
  const { props } = useFocusable({
    id: `content-0-${idx}`, row: 0, col: idx, group: 'content', onSelect,
  });
  return (
    <div {...props} className={`fav-chip${active ? ' fav-chip-active' : ''}`} style={{
      display: 'inline-block', padding: '8px 18px', marginRight: 12, borderRadius: 20,
      fontSize: 16, whiteSpace: 'nowrap',
      background: active ? '#00a1d6' : 'rgba(255,255,255,0.08)',
      color: active ? '#fff' : '#bbb',
    }}>
      {folder.title}<span style={{ opacity: 0.7, marginLeft: 6 }}>{folder.media_count}</span>
    </div>
  );
}

export default function FavoritesPage({ userMid, onPlayVideo }) {
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(0);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusRow, setFocusRow] = useState(0);
  const pageRef = useRef(1);
  const fetchingRef = useRef(false);
  const seenRef = useRef(new Set());
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));

  // Map a fav "media" into the card/player shape used across the app.
  const mapMedia = (m) => ({
    bvid: m.bvid, cid: m.ugc?.first_cid, title: m.title, pic: m.cover, duration: m.duration,
    owner: { name: m.upper?.name, mid: m.upper?.mid }, stat: { view: m.cnt_info?.play },
  });

  // Load the user's folder list once.
  useEffect(() => {
    if (!userMid) { setLoading(false); return; }
    getFavFolders(userMid).then(res => {
      setFolders(res?.data?.list || []);
    }).catch(() => setFolders([]));
  }, [userMid]);

  // Load (or switch to) a folder's contents.
  useEffect(() => {
    const folder = folders[activeFolder];
    if (!folder) return;
    let cancelled = false;
    seenRef.current = new Set();
    pageRef.current = 1;
    setLoading(true);
    setVideos([]);
    setFocusRow(0);
    getFavList(folder.id, 1, 36).then(res => {
      if (cancelled) return;
      const medias = (res?.data?.medias || []).map(mapMedia);
      medias.forEach(v => v.bvid && seenRef.current.add(v.bvid));
      setVideos(medias);
      setLoading(false);
      pageRef.current = 2;
      setTimeout(() => {
        const cur = getCurrentFocusId();
        if (!cur || !cur.startsWith('sidebar-')) setFocus(medias.length ? 'content-1-0' : 'content-0-0');
      }, 50);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [folders, activeFolder]);

  // Track focused row → scroll the grid + load more near the bottom.
  useEffect(() => {
    return onFocusChange((fid) => {
      const m = fid && fid.match(/^content-(\d+)-/);
      if (!m) return;
      const row = parseInt(m[1]);
      // Videos start at content row 1; row 0 is the folder chips (no scroll).
      setFocusRow(Math.max(0, row - 1));

      const totalRows = Math.ceil(videos.length / cols);
      if (row >= totalRows && !fetchingRef.current) {
        const folder = folders[activeFolder];
        if (!folder) return;
        fetchingRef.current = true;
        getFavList(folder.id, pageRef.current, 36).then(res => {
          const more = (res?.data?.medias || []).map(mapMedia)
            .filter(v => v.bvid && !seenRef.current.has(v.bvid));
          more.forEach(v => seenRef.current.add(v.bvid));
          if (more.length) setVideos(prev => [...prev, ...more]);
          pageRef.current++;
          fetchingRef.current = false;
        }).catch(() => { fetchingRef.current = false; });
      }
    });
  }, [videos.length, folders, activeFolder]);

  if (!userMid) return <div><div className="page-title">收藏夹</div><div className="empty-state">请先登录</div></div>;

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      {/* Folder selector (focus row 0). Selecting a chip switches folder. */}
      <div style={{ padding: '20px 40px 6px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {folders.length === 0
          ? <span style={{ color: '#888', fontSize: 16 }}>{loading ? '加载收藏夹…' : '暂无收藏夹'}</span>
          : folders.map((f, i) => (
            <FolderChip key={f.id} folder={f} idx={i} active={i === activeFolder}
              onSelect={() => { if (i !== activeFolder) setActiveFolder(i); }} />
          ))}
      </div>

      {loading ? (
        <div className="loading"><div className="loading-spinner" />加载中...</div>
      ) : videos.length === 0 ? (
        <div className="empty-state">这个收藏夹是空的</div>
      ) : (
        <VideoGrid
          videos={videos}
          group="content"
          startRow={1}
          cols={cols}
          focusRow={focusRow}
          // Order-play (#11): start from the picked video and auto-advance
          // through the rest of the folder (handled in the player on 'ended').
          onSelect={(v) => {
            const idx = videos.findIndex(x => x.bvid === v.bvid);
            onPlayVideo({ ...v, playlist: videos, playlistIndex: idx < 0 ? 0 : idx });
          }}
        />
      )}
    </div>
  );
}
