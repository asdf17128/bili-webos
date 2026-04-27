import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPopular, getRecommend, getRegionDynamic, getFollowFeed, getLiveList } from '../api/client';
import { useFocusable, setFocus, onFocusChange, getCurrentFocusId } from '../hooks/useFocus';
import { formatCount, formatDuration, formatTime } from '../utils/format';
import { storage } from '../utils/storage';

const FETCH_SIZE = 30;

function getProxyBase() {
  return (typeof window !== 'undefined' && window.webOS)
    ? 'http://127.0.0.1:7654'
    : storage.getProxyUrl();
}

function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) {
    u += '@720w_450h_1c.webp';
  }
  try {
    const parsed = new URL(u);
    return `${getProxyBase()}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return u;
  }
}

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

function VideoListItem({ video, index, group, onSelect, isSelected }) {
  const handleSelect = useCallback(() => {
    onSelect?.(video);
  }, [video, onSelect]);

  const { props, isFocused } = useFocusable({
    id: `${group}-${index}-0`,
    row: index,
    col: 0,
    group,
    onSelect: handleSelect,
  });

  return (
    <div
      {...props}
      className={`tv-list-item ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
    >
      <div className="tv-list-thumb">
        {video.pic && <img src={proxyImg(video.pic)} alt="" loading="lazy" decoding="async" />}
        {video.duration != null && (
          <span className="tv-list-duration">
            {typeof video.duration === 'number' ? formatDuration(video.duration) : video.duration}
          </span>
        )}
        {video.isLive && <span className="tv-list-live-badge">直播中</span>}
      </div>
      <div className="tv-list-info">
        <div className="tv-list-title">{video.title}</div>
        <div className="tv-list-meta">
          {video.owner?.name && <span className="tv-list-up">{video.owner.name}</span>}
          {video.stat?.view != null && <span>{formatCount(video.stat.view)}次观看</span>}
          {video.play != null && <span>{formatCount(video.play)}次观看</span>}
          {video.pubdate && <span>{formatTime(video.pubdate)}</span>}
        </div>
      </div>
    </div>
  );
}

export default function HomePage({ onPlayVideo, refreshKey, mode = 'recommend' }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const pageRef = useRef(1);
  const seenRef = useRef(new Set());
  const fetchingRef = useRef(false);
  const containerRef = useRef(null);

  // Load videos
  useEffect(() => {
    let cancelled = false;
    seenRef.current = new Set();
    pageRef.current = 1;
    setLoading(true);
    setVideos([]);
    setSelectedIndex(0);

    fetchByMode(mode, 1).then(items => {
      if (cancelled) return;
      const unique = dedupe(items);
      setVideos(unique);
      setLoading(false);
      pageRef.current = 2;
      setTimeout(() => {
        const cur = getCurrentFocusId();
        if (!cur || !cur.startsWith('nav-')) {
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

  // Track focus changes for selected index
  useEffect(() => {
    return onFocusChange((fid) => {
      if (!fid || !fid.startsWith('content-')) return;
      const m = fid.match(/^content-(\d+)-/);
      if (!m) return;
      const idx = parseInt(m[1]);
      setSelectedIndex(idx);

      // Load more when near bottom
      if (idx >= videos.length - 5 && !fetchingRef.current) {
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

  // Scroll selected item into view
  useEffect(() => {
    if (containerRef.current) {
      const item = containerRef.current.querySelector(`[data-focus-id="content-${selectedIndex}-0"]`);
      if (item) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const selectedVideo = videos[selectedIndex];

  if (loading) {
    return (
      <div className="tv-home tv-home-loading">
        <div className="tv-loading"><div className="loading-spinner" />加载中...</div>
      </div>
    );
  }

  return (
    <div className="tv-home">
      {/* Background layer */}
      <div className="tv-bg-layer">
        {selectedVideo?.pic && (
          <>
            <img
              className="tv-bg-image"
              src={proxyImg(selectedVideo.pic)}
              alt=""
            />
            <div className="tv-bg-overlay" />
          </>
        )}
      </div>

      {/* Left video list */}
      <div className="tv-list-panel" ref={containerRef}>
        <div className="tv-list-header">
          {mode === 'recommend' && '推荐'}
          {mode === 'hot' && '热门'}
          {mode === 'live' && '直播'}
          {mode === 'partition' && '分区'}
          {mode === 'follow' && '关注'}
        </div>
        <div className="tv-list">
          {videos.map((video, idx) => (
            <VideoListItem
              key={video.bvid || video.bv_id || `v-${idx}`}
              video={video}
              index={idx}
              group="content"
              onSelect={(v) => {
                setSelectedIndex(idx);
                onPlayVideo?.(v);
              }}
              isSelected={selectedIndex === idx}
            />
          ))}
        </div>
      </div>

      {/* Right preview info */}
      <div className="tv-preview-panel">
        {selectedVideo && (
          <div className="tv-preview-content">
            <div className="tv-preview-title">{selectedVideo.title}</div>
            <div className="tv-preview-meta">
              {selectedVideo.owner?.name && (
                <span className="tv-preview-up">UP主: {selectedVideo.owner.name}</span>
              )}
              {selectedVideo.stat?.view != null && (
                <span>{formatCount(selectedVideo.stat.view)}次观看</span>
              )}
              {selectedVideo.pubdate && (
                <span>{formatTime(selectedVideo.pubdate)}</span>
              )}
            </div>
            <div className="tv-preview-hint">
              按「确定」播放视频 · 按「返回」返回列表
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

