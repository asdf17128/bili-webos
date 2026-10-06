import React, { useState, useEffect, useRef } from 'react';
import { getFavFolders, getSubscribedFolders, getLibraryPage } from '../api/client';
import VideoGrid from '../components/VideoGrid';
import PageState, { GridSkeleton, FocusButton } from '../components/PageState';
import { libraryKey, librarySource } from '../utils/library';
import { storage } from '../utils/storage';
import { useFocusable, getCurrentFocusId, setFocus, onFocusChange, isHoverDriven, focusSidebar, focusFirstContent } from '../hooks/useFocus';
import { t } from '../i18n';
import { markAfterPaint } from '../utils/perf';
import { perfFlag, canPrefetch, trackPrefetch } from '../utils/perfFlags';

// A single folder chip in the top selector row (focus group 'content', row 1).
// Styling lives in styles.css so the global `.focused` class gives the chip a
// clear cursor highlight (the old inline background hid it) (#11).
function FolderChip({ folder, idx, active, onSelect, tabIndex }) {
  // 同 SettingsPage 的 TabChip:切收藏夹会重渲染,React 的 className 会把焦点
  // 系统加的 .focused 覆盖掉,所以焦点态要一起进 className。
  const { props, isFocused } = useFocusable({
    id: `content-1-${idx}`, row: 1, col: idx, group: 'content', onSelect,
    onNavigate: direction => direction === 'up' ? `content-0-${tabIndex}` : null,
  });
  return (
    <div {...props}
      className={`fav-chip${active ? ' fav-chip-active' : ''}${isFocused ? ' focused' : ''}`}>
      {folder.title}<span className="fav-chip-count">{folder.media_count}</span>
    </div>
  );
}

function LibraryTab({ idx, active, children, onSelect }) {
  const { props, isFocused } = useFocusable({ id: `content-0-${idx}`, row: 0, col: idx, group: 'content', onSelect });
  return <div {...props} role="tab" aria-selected={active} className={`fav-chip${active ? ' fav-chip-active' : ''}${isFocused ? ' focused' : ''}`}>{children}</div>;
}

export default function FavoritesPage({ userMid, onPlayVideo }) {
  const [mode, setMode] = useState('own');
  return <div className="favorites-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <header className="page-heading library-heading">
      <h1>{t('收藏夹')}</h1>
      <div className="library-tabs" role="tablist">
        {[['own', t('我的收藏')], ['subscribed', t('订阅')]].map(([key, label], idx) =>
          <LibraryTab key={key} idx={idx} active={mode === key} onSelect={() => { setMode(key); }}>{label}</LibraryTab>)}
      </div>
    </header>
    <FolderLibrary key={mode} mode={mode} userMid={userMid} onPlayVideo={onPlayVideo} />
  </div>;
}

function FolderLibrary({ mode, userMid, onPlayVideo }) {
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(0);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusRow, setFocusRow] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [moreError, setMoreError] = useState(false);
  const [foldersMore, setFoldersMore] = useState(false);
  const [foldersBusy, setFoldersBusy] = useState(false);
  const [foldersError, setFoldersError] = useState(false);
  const foldersPageRef = useRef(2);
  const foldersBusyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const generationRef = useRef(0);
  const hasMoreRef = useRef(true);
  const pageFlightRef = useRef(null);
  const enterFolderRef = useRef(false);
  const retryFocusRef = useRef(false);
  const pageRef = useRef(1);
  const fetchingRef = useRef(false);
  const seenRef = useRef(new Set());
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));
  useEffect(() => {
    if (loading && retryFocusRef.current) {
      retryFocusRef.current = false; focusSidebar(); focusFirstContent();
    }
  }, [loading]);

  // 空闲预取下一页(过闸门:播放器开着或已有预取在飞就让路)
  const nextPageRef = useRef(null);
  const requestPage = (folder, pn) => {
    const folderId = libraryKey(folder);
    const generation = generationRef.current;
    const pending = pageFlightRef.current;
    if (pending?.generation === generation && pending.pn === pn && pending.folderId === folderId) return pending.promise;
    const promise = getLibraryPage(folder, pn, 36);
    pageFlightRef.current = { generation, pn, folderId, promise };
    promise.then(() => { if (pageFlightRef.current?.promise === promise) pageFlightRef.current = null; }, () => { if (pageFlightRef.current?.promise === promise) pageFlightRef.current = null; });
    return promise;
  };
  const prefetchNext = React.useCallback(() => {
    if (!perfFlag('prefetchPage') || !canPrefetch() || nextPageRef.current || !hasMoreRef.current) return;
    const folder = foldersRef.current[activeFolderRef.current];
    if (!folder) return;
    const generation = generationRef.current, pn = pageRef.current;
    const run = () => {
      if (generation !== generationRef.current || fetchingRef.current || !canPrefetch() || nextPageRef.current) return;
      trackPrefetch(requestPage(folder, pn)).then(result => {
        if (generation === generationRef.current && pn === pageRef.current && !fetchingRef.current) nextPageRef.current = result;
      }).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 400);
  }, []);
  const foldersRef = useRef([]);
  const activeFolderRef = useRef(0);

  // Load the user's folder list once.
  useEffect(() => {
    if (!userMid) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setError('');
    (mode === 'subscribed' ? getSubscribedFolders(userMid) : getFavFolders(userMid)).then(res => {
      if (!alive) return;
      if (res?.code && res.code !== 0) throw new Error(res.message || String(res.code));
      const list = res?.data?.list || [];
      setFolders(list);
      setActiveFolder(0);
      foldersPageRef.current = 2;
      setFoldersMore(mode === 'subscribed' && !!res?.data?.has_more && list.length > 0);
      if (!list.length) setLoading(false);
    }).catch(() => { if (alive) { setError('folders'); setLoading(false); } });
    return () => { alive = false; };
  }, [userMid, retry]);

  const loadMoreFolders = async () => {
    if (foldersBusyRef.current) return;
    foldersBusyRef.current = true; setFoldersBusy(true); setFoldersError(false);
    try {
      const res = await getSubscribedFolders(userMid, foldersPageRef.current);
      if (!aliveRef.current) return;
      if (res?.code !== 0) throw new Error('Subscriptions failed');
      const seen = new Set(folders.map(libraryKey));
      const more = (res.data?.list || []).filter(f => !seen.has(libraryKey(f)) && seen.add(libraryKey(f)));
      setFolders(prev => prev.concat(more));
      setFoldersMore(!!res.data?.has_more && more.length > 0);
      foldersPageRef.current++;
      setTimeout(() => { if (aliveRef.current) setFocus(`content-1-${more.length ? folders.length : activeFolder}`); }, 0);
    } catch { if (aliveRef.current) setFoldersError(true); }
    finally { if (aliveRef.current) { setFoldersBusy(false); foldersBusyRef.current = false; } }
  };
  const selectedFolder = folders[activeFolder];
  foldersRef.current = folders; activeFolderRef.current = activeFolder;

  // Load (or switch to) a folder's contents.
  useEffect(() => {
    const folder = folders[activeFolder];
    if (!folder) return;
    let cancelled = false;
    generationRef.current++;
    fetchingRef.current = false; hasMoreRef.current = true;
    setError(''); setMoreError(false);
    seenRef.current = new Set();
    pageRef.current = 1;
    setLoading(true);
    setVideos([]);
    setFocusRow(0);
    nextPageRef.current = null;
    foldersRef.current = folders; activeFolderRef.current = activeFolder;
    requestPage(folder, 1).then(result => {
      if (cancelled) return;
      const medias = result.items;
      hasMoreRef.current = result.hasMore && medias.length > 0;
      medias.forEach(v => v.bvid && seenRef.current.add(v.bvid));
      setVideos(medias);
      setLoading(false);
      pageRef.current = 2;
      foldersRef.current = folders; activeFolderRef.current = activeFolder;
      prefetchNext();          // 首屏一出来就在空闲时备好下一页
      // Don't steal focus on folder switch — the chip stays focused so the user
      // can keep arrowing across folders (选中即切换). Initial focus is handled by
      // App's focusFirstContent landing on the first chip (content-1-0).
    }).catch(() => { if (!cancelled) { setError('contents'); setLoading(false); } });
    return () => { cancelled = true; generationRef.current++; };
  }, [selectedFolder?.id, selectedFolder?.type, activeFolder, retry]);

  useEffect(() => {
    if (!loading && videos.length && enterFolderRef.current) {
      enterFolderRef.current = false;
      if (getCurrentFocusId()?.startsWith('content-1-')) setFocus('content-2-0');
    }
  }, [loading, videos]);

  // Track focused row → scroll the grid + load more near the bottom.
  // Row 1 is the folder chips: focusing a chip switches to that folder (选中即切换).
  useEffect(() => {
    return onFocusChange((fid) => {
      const m = fid && fid.match(/^content-(\d+)-(\d+)/);
      if (!m) return;
      const row = parseInt(m[1]);
      const col = parseInt(m[2]);
      if (row === 0) return;
      if (row === 1) {
        if (isHoverDriven()) return;
        if (col !== activeFolder && col < folders.length) setActiveFolder(col);
        return;
      }
      // Pointer hover only highlights — don't scroll the grid (edge loop, #11).
      if (isHoverDriven()) return;
      // Videos start at content row 2.
      setFocusRow(Math.max(0, row - 2));

      const totalRows = Math.ceil(videos.length / cols);
      if (row >= totalRows + 1 && !fetchingRef.current && hasMoreRef.current && !moreError) {
        const folder = folders[activeFolder];
        if (!folder) return;
        // 和首页同一套:命中预取直接贴,再在空闲时备下一页(见 HomePage 注释)
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const ready = nextPageRef.current;
        if (ready) {
          nextPageRef.current = null;
          const more = ready.items.filter(v => v.bvid && !seenRef.current.has(v.bvid));
          hasMoreRef.current = ready.hasMore && more.length > 0;
          more.forEach(v => seenRef.current.add(v.bvid));
          if (more.length) setVideos(prev => [...prev, ...more]);
          pageRef.current++;
          markAfterPaint('grid-page-prefetched', t0, more.length);
          prefetchNext();
          return;
        }
        fetchingRef.current = true;
        const generation = generationRef.current;
        requestPage(folder, pageRef.current).then(result => {
          if (generation !== generationRef.current) return;
          const more = result.items
            .filter(v => v.bvid && !seenRef.current.has(v.bvid));
          hasMoreRef.current = result.hasMore && more.length > 0;
          more.forEach(v => seenRef.current.add(v.bvid));
          if (more.length) setVideos(prev => [...prev, ...more]);
          markAfterPaint('grid-page', t0, more.length);
          pageRef.current++;
          fetchingRef.current = false;
          prefetchNext();
        }).catch(() => { if (generation === generationRef.current) { fetchingRef.current = false; setMoreError(true); } });
      }
    });
  }, [videos.length, folders, activeFolder, moreError]);

  if (!userMid) return <div className="empty-state">{t('请先登录')}</div>;

  return (
    <div className="folder-library" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Folder selector (focus row 1). Selecting a chip switches folder. */}
      <div className="folder-selector" style={{ flexShrink: 0, padding: '32px 40px 14px', whiteSpace: 'nowrap', overflowX: 'auto' }}>
        {folders.length === 0
          ? <span style={{ color: '#888', fontSize: 'calc(16px * var(--ui-scale))' }}>{loading ? t('加载收藏夹…') : mode === 'subscribed' ? t('暂无订阅，可先在 B 站订阅收藏夹或合集') : t('暂无收藏夹')}</span>
          : folders.map((f, i) => (
            <FolderChip key={libraryKey(f)} folder={f} idx={i} active={i === activeFolder} tabIndex={mode === 'subscribed' ? 1 : 0}
              // Focus already switched the folder; OK just drops into the grid.
              onSelect={() => {
                if (i !== activeFolder) { enterFolderRef.current = true; setActiveFolder(i); }
                else if (loading) enterFolderRef.current = true;
                else setFocus('content-2-0');
              }} />
          ))}
        {foldersMore && <FocusButton id={`content-1-${folders.length}`} row={1} col={folders.length} onSelect={loadMoreFolders}>
          {foldersBusy ? t('加载中...') : foldersError ? t('重试') : t('更多订阅')}
        </FocusButton>}
      </div>

      {error ? <PageState row={2} title={t('内容加载失败')} description={t('请检查网络连接后重试')} action={t('重试')} onAction={() => { retryFocusRef.current = true; setRetry(n => n + 1); }} /> : loading ? (
        <GridSkeleton cols={cols} />
      ) : videos.length === 0 ? (
        <div className="empty-state">{folders.length ? t('这个收藏夹是空的') : ''}</div>
      ) : (
        <VideoGrid
          videos={videos}
          group="content"
          startRow={2}
          cols={cols}
          focusRow={focusRow}
          upTarget={`content-1-${activeFolder}`}
          footer={moreError ? <FocusButton row={Math.ceil(videos.length / cols) + 2} id={`content-${Math.ceil(videos.length / cols) + 2}-0`} onSelect={() => { setMoreError(false); setTimeout(() => setFocus(`content-${Math.ceil(videos.length / cols) + 1}-0`), 0); }}>{t('加载失败，按确认重试')}</FocusButton> : null}
          // Order-play (#11): start from the picked video and auto-advance
          // through the rest of the folder (handled in the player on 'ended').
          onSelect={(v) => {
            const idx = videos.findIndex(x => x.bvid === v.bvid);
            onPlayVideo({ ...v, playlist: videos, playlistIndex: idx < 0 ? 0 : idx, playlistSource: { ...librarySource(selectedFolder), nextPage: pageRef.current, hasMore: hasMoreRef.current } });
          }}
        />
      )}
    </div>
  );
}
