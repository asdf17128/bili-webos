import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { getHistory } from '../api/client';
import VideoGrid from '../components/VideoGrid';

// Proxy + resize avatar (B站 image CDN needs a Referer; the proxy adds it).
function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) u += '@160w_160h_1c.webp';
  const base = (typeof window !== 'undefined' && window.webOS) ? 'http://127.0.0.1:7654' : storage.getProxyUrl();
  try { const p = new URL(u); return `${base}/proxy/${p.host}${p.pathname}${p.search}`; } catch { return u; }
}

export default function SettingsPage({ user, onPlayVideo }) {
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  React.useEffect(() => {
    if (!user) return;
    async function load() {
      setHistoryLoading(true);
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
      setHistoryLoading(false);
    }
    load();
  }, [user]);

  const avatar = proxyImg(user?.face);

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 26 }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
          background: 'linear-gradient(135deg, #00a1d6, #2a2a4a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, color: '#fff', border: '2px solid rgba(0,161,214,0.5)',
        }}>
          {avatar
            ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (user?.uname || '游')[0]}
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 600, color: '#fff' }}>{user ? user.uname : '未登录'}</div>
          <div style={{ fontSize: 15, color: '#7a7a8c', marginTop: 4 }}>哔哩哔哩 webOS</div>
        </div>
      </div>

      {user ? (
        <>
          <div style={{ fontSize: 20, color: '#aaa', marginBottom: 14 }}>最近观看</div>
          {history.length > 0 ? (
            <VideoGrid videos={history} group="content" startRow={0} cols={2} onSelect={onPlayVideo} />
          ) : (
            <div style={{ color: '#666', fontSize: 16 }}>
              {historyLoading ? '加载中…' : '暂无观看记录'}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: '#888', fontSize: 16 }}>登录后可查看观看历史</div>
      )}
    </div>
  );
}
