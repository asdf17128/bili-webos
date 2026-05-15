import React, { useState, useEffect, useRef } from 'react';
import { getPopular, getRecommend, getRegionDynamic, getFollowFeed, getLiveList } from '../api/client';
import VideoGrid from '../components/VideoGrid';
import { getCurrentFocusId, setFocus, onFocusChange } from '../hooks/useFocus';

const COLS = 2;
const FETCH_SIZE = 20;

async function fetchByMode(mode, pn) {
  if (mode === 'hot') {
    const res = await getPopular(pn, FETCH_SIZE);
    return res?.data?.list || [];
  } else if (mode === 'live') {
    const res = await getLiveList(pn, FETCH_SIZE);
    const items = res?.data?.list || res?.data?.recommend_room_list || [];
    return items.map(item => ({
      bvid: `live-${item.roomid}`,
      title: item.title,
      pic: item.cover || item.system_cover,
      owner: { name: item.uname },
      stat: { view: item.online || item.watched_show?.num },
      isLive: true,
      roomid: item.roomid,
    }));
  } else if (mode === 'partition') {
    const rids = [1, 3, 4, 5, 17, 36, 160, 188, 211];
    const rid = rids[Math.floor(Math.random() * rids.length)];
    const res = await getRegionDynamic(rid, pn, FETCH_SIZE);
    return res?.data?.archives || [];
  } else if (mode === 'follow') {
    const res = await getFollowFeed(pn, FETCH_SIZE);
    return (res?.data?.items || []).map(item => {
      const archive = item.modules?.module_dynamic?.major?.archive;
      if (!archive) return null;
      return {
        bvid: archive.bvid, title: archive.title, pic: archive.cover,
        duration: archive.duration_text, pubdate: archive.pubdate,
        owner: { name: item.modules?.module_author?.name },
        stat: { view: archive.stat?.play },
      };
    }).filter(Boolean);
  } else {
    const res = await getRecommend(4, FETCH_SIZE);
    return res?.data?.item || [];
  }
}

export default function HomePage({ onPlayVideo, refreshKey, mode = 'recommend' }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusRow, setFocusRow] = useState(0);
  const pageRef = useRef(1);
  const seenRef = useRef(new Set());
  const fetchingRef = useRef(false);

  // Load
  useEffect(() => {
    let cancelled = false;
    seenRef.current = new Set();
    pageRef.current = 1;
    setLoading(true);
    setVideos([]);
    setFocusRow(0);

    fetchByMode(mode, 1).then(items => {
      if (cancelled) return;
      setVideos(dedupe(items));
      setLoading(false);
      pageRef.current = 2;
      // Only focus content if not currently in sidebar
      setTimeout(() => {
        const cur = getCurrentFocusId();
        if (!cur || !cur.startsWith('sidebar-')) {
          setFocus('content-0-0');
        }
      }, 50);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [refreshKey, mode]);

  function dedupe(items) {
    return items.filter(v => {
      const id = v.bvid || v.bv_id;
      if (!id || seenRef.current.has(id)) return false;
      seenRef.current.add(id);
      return true;
    });
  }

  // Track focus row for transform scroll + load more
  useEffect(() => {
    return onFocusChange((fid) => {
      if (!fid) return;
      const m = fid.match(/^content-(\d+)-/);
      if (!m) return;
      const row = parseInt(m[1]);
      setFocusRow(row);

      // Load more when near bottom
      const totalRows = Math.ceil(videos.length / COLS);
      if (row >= totalRows - 2 && !fetchingRef.current) {
        fetchingRef.current = true;
        fetchByMode(mode, pageRef.current).then(items => {
          const unique = dedupe(items);
          if (unique.length > 0) setVideos(prev => [...prev, ...unique]);
          pageRef.current++;
          fetchingRef.current = false;
        }).catch(() => { fetchingRef.current = false; });
      }
    });
  }, [videos.length, mode]);

  if (loading) {
    return <div className="loading"><div className="loading-spinner" />加载中...</div>;
  }

  return (
    <VideoGrid
      videos={videos}
      group="content"
      startRow={0}
      cols={COLS}
      onSelect={onPlayVideo}
      focusRow={focusRow}
    />
  );
}
