import React, { useState, useEffect } from 'react';
import { getHistory } from '../api/client';
import VideoGrid from '../components/VideoGrid';

export default function HistoryPage({ onPlayVideo }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (loading) { setLoading(false); setError('加载超时'); }
    }, 10000);

    async function load() {
      try {
        const res = await getHistory(0, 0, 24);
        if (cancelled) return;
        if (res?.code === -101) { setError('请先登录'); }
        else if (res?.data?.list) {
          setVideos(res.data.list.map(item => ({
            bvid: item.history?.bvid, cid: item.history?.cid,
            title: item.title, pic: item.cover, duration: item.duration,
            progress: item.progress,
            owner: { name: item.author_name },
          })));
        } else { setError(res?.message || '加载失败'); }
      } catch (err) { if (!cancelled) setError(err.message); }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  if (loading) return <div className="loading"><div className="loading-spinner" />加载中...</div>;
  if (error) return <div><div className="page-title">历史记录</div><div className="empty-state">{error}</div></div>;

  return (
    <div className="content-scroll">
      <div className="section-title">历史记录</div>
      <VideoGrid videos={videos} group="content" startRow={0} onSelect={onPlayVideo} />
    </div>
  );
}
