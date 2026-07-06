import React, { useState, useEffect, useRef } from 'react';
import { getPopular, getRecommend, getRegionDynamic, getFollowFeed, getLiveList } from '../api/client';
import VideoGrid from '../components/VideoGrid';
import { getCurrentFocusId, setFocus, onFocusChange, isHoverDriven } from '../hooks/useFocus';
import { storage } from '../utils/storage';
import { loadFollowedMids } from '../utils/follow';

const FETCH_SIZE = 20;

// Returns { items, offset } — offset is the follow-feed cursor (undefined for
// other modes, which paginate by page number).
async function fetchByMode(mode, pn, offset) {
  if (mode === 'hot') {
    const res = await getPopular(pn, FETCH_SIZE);
    return { items: res?.data?.list || [] };
  } else if (mode === 'live') {
    const res = await getLiveList(pn, FETCH_SIZE);
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
    const rids = [1, 3, 4, 5, 17, 36, 160, 188, 211];
    const rid = rids[Math.floor(Math.random() * rids.length)];
    const res = await getRegionDynamic(rid, pn, FETCH_SIZE);
    return { items: res?.data?.archives || [] };
  } else if (mode === 'follow') {
    const res = await getFollowFeed(pn, offset);
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
    return { items, offset: res?.data?.offset };
  } else {
    const res = await getRecommend(4, FETCH_SIZE);
    return { items: res?.data?.item || [] };
  }
}

export default function HomePage({ onPlayVideo, refreshKey, mode = 'recommend' }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusRow, setFocusRow] = useState(0);
  const [followedMids, setFollowedMids] = useState(null);
  const pageRef = useRef(1);
  const offsetRef = useRef('');
  const seenRef = useRef(new Set());
  const fetchingRef = useRef(false);
  // Per-row video count (设置 → 每行视频). Read once per mount; navigating back
  // from 设置 remounts this page, so a change applies on return.
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));

  // Load
  useEffect(() => {
    let cancelled = false;
    seenRef.current = new Set();
    pageRef.current = 1;
    offsetRef.current = '';
    setLoading(true);
    setVideos([]);
    setFocusRow(0);

    fetchByMode(mode, 1, '').then(({ items, offset }) => {
      if (cancelled) return;
      setVideos(dedupe(items));
      setLoading(false);
      pageRef.current = 2;
      offsetRef.current = offset || '';
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

  // Load followed UP mids once (logged-in only) to badge "已关注" on cards
  useEffect(() => {
    if (storage.getAuth()?.SESSDATA) {
      loadFollowedMids().then(set => { if (set && set.size) setFollowedMids(set); });
    }
  }, []);

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
      // Pointer hover only highlights — don't scroll the grid (edge loop, #11).
      if (isHoverDriven()) return;
      const row = parseInt(m[1]);
      setFocusRow(row);

      // Load more when near bottom
      const totalRows = Math.ceil(videos.length / cols);
      if (row >= totalRows - 2 && !fetchingRef.current) {
        fetchingRef.current = true;
        fetchByMode(mode, pageRef.current, offsetRef.current).then(({ items, offset }) => {
          const unique = dedupe(items);
          if (unique.length > 0) setVideos(prev => [...prev, ...unique]);
          pageRef.current++;
          if (offset) offsetRef.current = offset;
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
      cols={cols}
      onSelect={onPlayVideo}
      focusRow={focusRow}
      followedMids={followedMids}
    />
  );
}
