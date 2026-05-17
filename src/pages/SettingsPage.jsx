import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';
import { getHistory } from '../api/client';
import VideoGrid from '../components/VideoGrid';

export default function SettingsPage({ onLogout, user, onPlayVideo }) {
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(storage.getSettings());

  React.useEffect(() => {
    if (!user) return;
    async function load() {
      try {
        const res = await getHistory(0, 0, 12);
        if (res?.data?.list) {
          setHistory(res.data.list.map(item => ({
            bvid: item.history?.bvid, cid: item.history?.cid,
            title: item.title, pic: item.cover, duration: item.duration,
            progress: item.progress, owner: { name: item.author_name },
          })));
        }
      } catch {}
    }
    load();
  }, [user]);

  const { props: danmakuProps } = useFocusable({
    id: 'content-0-0', row: 0, col: 0, group: 'content',
    onSelect: () => {
      const nextSettings = { ...settings, danmaku: !settings.danmaku };
      storage.setSettings(nextSettings);
      setSettings(nextSettings);
    },
  });

  const { props: logoutProps } = useFocusable({
    id: 'content-0-1', row: 0, col: 1, group: 'content',
    onSelect: () => { storage.clearAuth(); onLogout(); },
  });

  return (
    <div style={{ padding: '20px 28px', height: '100%', overflow: 'auto' }}>
      <div style={{ fontSize: 26, fontWeight: 600, color: '#fff', marginBottom: 20 }}>
        {user ? `${user.uname} 的空间` : '我的'}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div {...danmakuProps} className="detail-btn" style={{ fontSize: 16 }}>
          弹幕: {settings.danmaku ? '开' : '关'}
        </div>
        <div {...logoutProps} className="detail-btn secondary" style={{ fontSize: 16, background: '#4a2020' }}>
          退出登录
        </div>
      </div>
      {user && history.length > 0 && (
        <>
          <div style={{ fontSize: 20, color: '#aaa', marginBottom: 14 }}>最近观看</div>
          <VideoGrid videos={history} group="content" startRow={1} cols={2} onSelect={onPlayVideo} />
        </>
      )}
    </div>
  );
}
