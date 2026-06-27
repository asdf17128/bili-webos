import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { getHistory } from '../api/client';
import VideoCard from '../components/VideoCard';

// Proxy + resize avatar (B站 image CDN needs a Referer; the proxy adds it).
function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) u += '@160w_160h_1c.webp';
  const base = (typeof window !== 'undefined' && window.webOS) ? 'http://127.0.0.1:7654' : storage.getProxyUrl();
  try { const p = new URL(u); return `${base}/proxy/${p.host}${p.pathname}${p.search}`; } catch { return u; }
}

// A labeled grid of cards. Focus rows are continuous across sections (the
// caller passes startRow) so D-pad up/down crosses from one section to the next.
function Section({ title, items, startRow, cols, onPlayVideo }) {
  if (!items.length) return null;
  return (
    <>
      <div style={{ fontSize: 20, color: '#aaa', margin: '22px 0 12px' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 20 }}>
        {items.map((v, i) => (
          <VideoCard
            key={v.bvid || `${title}-${i}`}
            video={v}
            focusId={`content-${startRow + Math.floor(i / cols)}-${i % cols}`}
            row={startRow + Math.floor(i / cols)}
            col={i % cols}
            group="content"
            onSelect={onPlayVideo}
          />
        ))}
      </div>
    </>
  );
}

export default function SettingsPage({ user, onPlayVideo }) {
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recentLive] = useState(() => storage.getRecentLive());
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));

  // Locally-tracked live rooms (B站's history API doesn't record live viewing
  // without its obfuscated heartbeat, so we keep our own).
  const liveItems = recentLive.map(r => ({
    isLive: true, roomid: r.roomid, bvid: 'live-' + r.roomid,
    title: r.title, pic: r.cover, owner: { name: r.uname }, duration: '直播',
  }));

  React.useEffect(() => {
    if (!user) return;
    const mapItem = (item) => {
      const h = item.history || {};
      const isBangumi = h.business === 'pgc' || item.badge === '番剧';
      return {
        bvid: h.bvid, cid: h.cid,
        title: item.title, pic: item.cover, duration: item.duration,
        progress: item.progress, owner: { name: item.author_name },
        ...(isBangumi ? { isBangumi: true, epid: h.epid, seasonId: h.oid, badge: '番剧' } : {}),
      };
    };
    async function load() {
      setHistoryLoading(true);
      try {
        // The history cursor API caps each page at ~30; walk a few pages so the
        // video history shows more than a dozen rows (#11).
        const all = [];
        let max = 0, viewAt = 0;
        for (let page = 0; page < 3; page++) {
          const res = await getHistory(max, viewAt, 30);
          const list = res?.data?.list;
          if (!list?.length) break;
          all.push(...list.map(mapItem));
          const cur = res.data.cursor || {};
          if (!cur.max && !cur.view_at) break;
          max = cur.max; viewAt = cur.view_at;
        }
        if (all.length) setHistory(all);
      } catch {}
      setHistoryLoading(false);
    }
    load();
  }, [user]);

  const avatar = proxyImg(user?.face);
  // 直播 occupies the first ceil(live/cols) focus rows; 历史记录 starts after it.
  const liveRows = Math.ceil(liveItems.length / cols);

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 12 }}>
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

      <Section title="直播" items={liveItems} startRow={0} cols={cols} onPlayVideo={onPlayVideo} />
      <Section title="历史记录" items={history} startRow={liveRows} cols={cols} onPlayVideo={onPlayVideo} />

      {liveItems.length === 0 && history.length === 0 && (
        <div style={{ color: '#666', fontSize: 16, marginTop: 22 }}>
          {historyLoading ? '加载中…' : (user ? '暂无观看记录' : '登录后可查看视频历史')}
        </div>
      )}
    </div>
  );
}
