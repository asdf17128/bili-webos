import React, { useState, useEffect } from 'react';
import { getFavFolders, getFavList } from '../api/client';
import VideoGrid from '../components/VideoGrid';

export default function FavoritesPage({ userMid, onPlayVideo }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userMid) return;
    async function load() {
      setLoading(true);
      try {
        const res = await getFavFolders(userMid);
        const folders = res?.data?.list || [];
        if (folders.length > 0) {
          const favRes = await getFavList(folders[0].id, 1, 24);
          setVideos((favRes?.data?.medias || []).map(m => ({
            bvid: m.bvid, title: m.title, pic: m.cover, duration: m.duration,
            owner: { name: m.upper?.name }, stat: { view: m.cnt_info?.play },
          })));
        }
      } catch (err) { console.error('Fav error:', err); }
      setLoading(false);
    }
    load();
  }, [userMid]);

  if (!userMid) return <div><div className="page-title">收藏夹</div><div className="empty-state">请先登录</div></div>;
  if (loading) return <div className="loading"><div className="loading-spinner" />加载中...</div>;

  return (
    <div className="content-scroll">
      <div className="section-title">收藏夹</div>
      <VideoGrid videos={videos} group="content" startRow={0} onSelect={onPlayVideo} />
    </div>
  );
}
