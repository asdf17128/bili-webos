import React, { useState, useEffect, useRef } from 'react';
import { getFavFolders, getFavList } from '../api/client';
import VideoGrid from '../components/VideoGrid';
import { storage } from '../utils/storage';
import { useFocusable, getCurrentFocusId, setFocus, onFocusChange, isHoverDriven } from '../hooks/useFocus';
import { t } from '../i18n';

// A single folder chip in the top selector row (focus group 'content', row 0).
// Styling lives in styles.css so the global `.focused` class gives the chip a
// clear cursor highlight (the old inline background hid it) (#11).
function FolderChip({ folder, idx, active, onSelect }) {
  const { props } = useFocusable({
    id: `content-0-${idx}`, row: 0, col: idx, group: 'content', onSelect,
  });
  return (
    <div {...props} className={`fav-chip${active ? ' fav-chip-active' : ''}`}>
      {folder.title}<span className="fav-chip-count">{folder.media_count}</span>
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
      // Don't steal focus on folder switch — the chip stays focused so the user
      // can keep arrowing across folders (选中即切换). Initial focus is handled by
      // App's focusFirstContent landing on the first chip (content-0-0).
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [folders, activeFolder]);

  // Track focused row → scroll the grid + load more near the bottom.
  // Row 0 is the folder chips: focusing a chip switches to that folder (选中即切换).
  useEffect(() => {
    return onFocusChange((fid) => {
      const m = fid && fid.match(/^content-(\d+)-(\d+)/);
      if (!m) return;
      const row = parseInt(m[1]);
      const col = parseInt(m[2]);
      if (row === 0) {
        setFocusRow(0);
        if (col !== activeFolder && col < folders.length) setActiveFolder(col);
        return;
      }
      // Pointer hover only highlights — don't scroll the grid (edge loop, #11).
      if (isHoverDriven()) return;
      // Videos start at content row 1.
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

  if (!userMid) return <div><div className="page-title">{t('收藏夹')}</div><div className="empty-state">{t('请先登录')}</div></div>;

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      {/* Folder selector (focus row 0). Selecting a chip switches folder. */}
      <div style={{ padding: '20px 40px 6px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {folders.length === 0
          ? <span style={{ color: '#888', fontSize: 16 }}>{loading ? t('加载收藏夹…') : t('暂无收藏夹')}</span>
          : folders.map((f, i) => (
            <FolderChip key={f.id} folder={f} idx={i} active={i === activeFolder}
              // Focus already switched the folder; OK just drops into the grid.
              onSelect={() => setFocus('content-1-0')} />
          ))}
      </div>

      {loading ? (
        <div className="loading"><div className="loading-spinner" />{t('加载中...')}</div>
      ) : videos.length === 0 ? (
        <div className="empty-state">{t('这个收藏夹是空的')}</div>
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
