import React, { useState, useEffect } from 'react';
import { getHistory } from '../api/client';
import { storage } from '../utils/storage';
import VideoGrid from '../components/VideoGrid';
import { t } from '../i18n';

export default function HistoryPage({ onPlayVideo }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (loading) { setLoading(false); setError(t('加载超时')); }
    }, 10000);

    async function load() {
      try {
        const res = await getHistory(0, 0, 24);
        if (cancelled) return;
        if (res?.code === -101) { setError(t('请先登录')); }
        else if (res?.data?.list) {
          // Backfill local progress from server history (see SettingsPage).
          res.data.list.forEach(item => {
            const bv = item.history?.bvid;
            if (bv && item.duration > 0 && !storage.getProgress(bv)) {
              const p = item.progress === -1 ? item.duration : item.progress;
              if (p > 0) storage.setProgress(bv, p, item.duration);
            }
          });
          setVideos(res.data.list.map(item => ({
            bvid: item.history?.bvid, cid: item.history?.cid,
            title: item.title, pic: item.cover, duration: item.duration,
            progress: item.progress,
            // Card time = when it was WATCHED (view_at) — that's what a
            // history list is about ("3小时前" = watched 3h ago).
            pubdate: item.view_at,
            owner: { name: item.author_name },
          })));
        } else { setError(res?.message || t('加载失败')); }
      } catch (err) { if (!cancelled) setError(err.message); }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  if (loading) return <div className="loading"><div className="loading-spinner" />{t('加载中...')}</div>;
  if (error) return <div><div className="page-title">{t('历史记录')}</div><div className="empty-state">{error}</div></div>;

  return (
    <div className="content-scroll">
      <div className="section-title">{t('历史记录')}</div>
      <VideoGrid videos={videos} group="content" startRow={0} onSelect={onPlayVideo} />
    </div>
  );
}
