import React, { useState, useEffect, useRef } from 'react';
import { getPopular, getRecommend, getRanking, getFollowFeed, getLiveList } from '../api/client';
import VideoGrid from '../components/VideoGrid';
import PageState, { GridSkeleton, FocusButton } from '../components/PageState';
import { onFocusChange, isHoverDriven, focusSidebar, resetContentMemory, focusFirstContent } from '../hooks/useFocus';
import { storage } from '../utils/storage';
import { loadFollowedMids } from '../utils/follow';
import { t } from '../i18n';
import { markAfterPaint } from '../utils/perf';
import { perfFlag, canPrefetch, trackPrefetch } from '../utils/perfFlags';
import ContinueWatching, { useContinueWatching } from '../components/ContinueWatching';

const FETCH_SIZE = 20;
const feedCache = new Map(); // At most four recent sections; metadata only, never image objects.

function checked(res) {
  if (res?.code && res.code !== 0) throw new Error(res.message || String(res.code));
  return res;
}

// Returns { items, offset } — offset is the follow-feed cursor (undefined for
// other modes, which paginate by page number).
async function fetchByMode(mode, pn, offset, rid) {
  if (mode === 'hot') {
    const res = checked(await getPopular(pn, FETCH_SIZE));
    return { items: res?.data?.list || [], hasMore: !res?.data?.no_more };
  } else if (mode === 'live') {
    const res = checked(await getLiveList(pn, FETCH_SIZE));
    const items = res?.data?.list || res?.data?.recommend_room_list || [];
    return { items: items.map(item => ({
      bvid: `live-${item.roomid || item.room_id}`,
      title: item.title,
      // Followed-rooms (GetWebList) carry cover_from_user / keyframe, NOT
      // cover/system_cover — the old mapping left them blank (#11).
      pic: item.cover_from_user || item.cover || item.keyframe || item.system_cover || item.face,
      owner: { name: item.uname },
      stat: { view: item.online || item.watched_show?.num },
      isLive: true,
      roomid: item.roomid || item.room_id,
    })) };
  } else if (mode === 'partition') {
    // Per-partition CURRENT hot ranking via B站's NEW partition id (pid_v2).
    // The old region rankings are frozen at the 2024 reform (~2025-03 videos,
    // owner: "都是去年的"); ranking/v2 on the new pid returns today's top ~100.
    // Not paginated — load-more just no-ops via dedupe.
    const res = checked(await getRanking(rid || 1008, 'all'));
    return { items: res?.data?.list || [], hasMore: false };
  } else if (mode === 'follow') {
    const res = checked(await getFollowFeed(pn, offset));
    const items = (res?.data?.items || []).map(item => {
      const archive = item.modules?.module_dynamic?.major?.archive;
      if (!archive) return null;
      return {
        bvid: archive.bvid, title: archive.title, pic: archive.cover,
        duration: archive.duration_text, pubdate: archive.pubdate,
        owner: { name: item.modules?.module_author?.name, mid: item.modules?.module_author?.mid },
        stat: { view: archive.stat?.play },
      };
    }).filter(Boolean);
    items.sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0)); // newest first
    return { items, offset: res?.data?.offset, hasMore: res?.data?.has_more !== false && res?.data?.has_more !== 0 };
  } else {
    const res = checked(await getRecommend(4, FETCH_SIZE));
    return { items: res?.data?.item || [] };
  }
}

export default function HomePage({ onPlayVideo, refreshKey, mode = 'recommend', rid, title }) {
  const cacheKey = `${mode}:${rid || ''}:${storage.getAuth()?.DedeUserID || (storage.getAuth()?.SESSDATA ? 'member' : 'guest')}`;
  const firstLoad = useRef(true);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [moreState, setMoreState] = useState('');
  const [retry, setRetry] = useState(0);
  const [focusRow, setFocusRow] = useState(0);
  const [followedMids, setFollowedMids] = useState(null);
  const rowRef = useRef(0);
  const snapshot = useRef(null);
  const loadMoreRef = useRef(null);
  const retryFocusRef = useRef(false);
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));
  const resumeItems = useContinueWatching(mode === 'recommend');
  const reload = () => {
    focusSidebar(); resetContentMemory();
    // Commit the skeleton in the input event, before the fetch effect starts.
    // A fast result can otherwise batch loading=true/false into one render,
    // skipping the loading effect that requests focus after the retry unmounts.
    retryFocusRef.current = true; setLoading(true); setRetry(n => n + 1);
  };

  useEffect(() => {
    // Only request entry after the skeleton commits and the old cells are gone.
    if (loading && retryFocusRef.current) { retryFocusRef.current = false; focusFirstContent(); }
  }, [loading]);

  useEffect(() => {
    let alive = true, timer = null, flight = null, ready = null, busy = false, failedPage = false;
    let page = 1, offset = '', hasMore = true, list = [], seen = new Set();
    const cached = firstLoad.current ? feedCache.get(cacheKey) : null;
    firstLoad.current = false;
    const validCache = cached && cached.refreshKey === refreshKey && Date.now() - cached.at < 5 * 60 * 1000 && cached.cols === cols;
    setError(false); setMoreState('');
    rowRef.current = validCache ? cached.row : 0;
    setFocusRow(rowRef.current);

    const saveSnapshot = () => {
      snapshot.current = { videos: list, page, offset, hasMore, cols, refreshKey, at: Date.now() };
    };
    const append = result => {
      const unique = result.items.filter(v => {
        const id = v.bvid || v.bv_id;
        if (!id || seen.has(id)) return false;
        seen.add(id); return true;
      });
      list = list.concat(unique);
      hasMore = result.hasMore !== false && unique.length > 0;
      page++; offset = result.offset || offset;
      setVideos(list); setMoreState(hasMore ? '' : 'end'); saveSnapshot();
      return unique.length;
    };
    const request = () => {
      if (!flight) {
        flight = fetchByMode(mode, page, offset, rid);
        // The foreground can consume the exact same in-flight prefetch.
        const current = flight;
        current.then(() => { if (flight === current) flight = null; }, () => { if (flight === current) flight = null; });
      }
      return flight;
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!perfFlag('prefetchPage') || !hasMore || failedPage || ready || flight) return;
      timer = setTimeout(() => {
        if (!alive || busy || !hasMore || ready || !canPrefetch()) return;
        trackPrefetch(request()).then(result => {
          if (alive && !busy) ready = result;
        }).catch(() => {});
      }, 250);
    };
    const loadMore = async () => {
      if (!alive || busy || !hasMore || !list.length) return;
      busy = true; failedPage = false; setMoreState('loading');
      const start = performance.now();
      const prefetched = !!ready;
      try {
        const result = ready || await request();
        if (!alive) return;
        ready = null;
        const count = append(result);
        markAfterPaint(prefetched ? 'grid-page-prefetched' : 'grid-page', start, count);
      } catch (e) { if (alive) { failedPage = true; setMoreState('error'); } }
      finally { busy = false; if (alive) schedule(); }
    };
    loadMoreRef.current = loadMore;

    if (validCache) {
      list = cached.videos; page = cached.page; offset = cached.offset; hasMore = cached.hasMore;
      seen = new Set(list.map(v => v.bvid || v.bv_id));
      setVideos(list); setLoading(false); setMoreState(hasMore ? '' : 'end');
      saveSnapshot(); schedule();
    } else {
      setLoading(true); setVideos([]); snapshot.current = null;
      request().then(result => {
        if (!alive) return;
        append(result); setLoading(false); schedule();
      }).catch(() => { if (alive) { setError(true); setLoading(false); } });
    }

    const unsubscribe = onFocusChange(fid => {
      if (isHoverDriven()) return;
      const match = fid?.match(/^content-(\d+)-/);
      if (!match) return;
      rowRef.current = Number(match[1]);
      if (!perfFlag('scrollDirect')) setFocusRow(rowRef.current);
      // A failed page waits for an explicit retry; moving sideways is not a retry loop.
      if (!failedPage && rowRef.current >= Math.ceil(list.length / cols) - 2) loadMore();
      else schedule();
    });
    return () => {
      alive = false; clearTimeout(timer); unsubscribe();
      const snap = snapshot.current;
      // Avoid retaining very long feeds on a 2 GB TV. Mounted pages own their data.
      if (snap?.videos.length && snap.videos.length <= 200) {
        feedCache.delete(cacheKey);
        feedCache.set(cacheKey, { ...snap, row: rowRef.current });
        if (feedCache.size > 4) feedCache.delete(feedCache.keys().next().value);
      } else feedCache.delete(cacheKey);
    };
  }, [cacheKey, mode, rid, refreshKey, retry, cols]);

  useEffect(() => {
    let alive = true;
    if (storage.getAuth()?.SESSDATA) loadFollowedMids().then(set => { if (alive && set?.size) setFollowedMids(set); });
    return () => { alive = false; };
  }, []);

  return <section className="browse-page">
    <header className="browse-header">
      <h1>{title || t('推荐')}</h1>
    </header>
    <div className="browse-body" aria-busy={loading}>
      {loading ? <GridSkeleton cols={cols} /> : error ?
        <PageState title={t('内容加载失败')} description={t('请检查网络连接后重试')} action={t('重试')} onAction={reload} /> : !videos.length ?
        <PageState title={t('这里暂时没有内容')} description={t('稍后刷新，或到其他栏目看看')} action={t('刷新')} onAction={reload} /> :
        <VideoGrid videos={videos} group="content" startRow={0} cols={cols} onSelect={onPlayVideo} focusRow={focusRow} followedMids={followedMids}
          header={resumeItems.length ? <ContinueWatching items={resumeItems} onSelect={onPlayVideo} /> : null}
          footer={moreState === 'error' ? <FocusButton row={Math.ceil(videos.length / cols)} id={`content-${Math.ceil(videos.length / cols)}-0`} onSelect={() => loadMoreRef.current?.()}>{t('加载失败，按确认重试')}</FocusButton> : null} />}
    </div>
    <footer className="browse-footer">
      <span><kbd>OK</kbd>{t('开始播放')}<span className="hint-separator">·</span>{t('长按打开菜单')}</span>
      <span role="status">{moreState === 'loading' ? t('正在加载更多…') : moreState === 'end' ? t('已显示全部内容') : t('返回键回到侧栏')}</span>
    </footer>
  </section>;
}
