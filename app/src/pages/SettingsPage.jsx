import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { getHistory, getLiveRoomInfo } from '../api/client';
import VideoCard from '../components/VideoCard';

// Proxy + resize avatar (B站 image CDN needs a Referer; the proxy adds it).
function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) u += '@160w_160h_1c.webp';
  const base = (typeof window !== 'undefined' && window.webOS) ? 'http://127.0.0.1:7654' : storage.getProxyUrl();
  try { const p = new URL(u); return `${base}/proxy/${p.host}${p.pathname}${p.search}`; } catch { return u; }
}

export default function SettingsPage({ user, onPlayVideo }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));

  React.useEffect(() => {
    let cancelled = false;

    // B站 history mixes videos and live rooms (business:'live'), each with a real
    // watch time (view_at) — that's the source of truth for time-ordering. Map
    // each row to a card, tagging live rows so we can badge them.
    const mapHistory = (item) => {
      const h = item.history || {};
      const ts = item.view_at || 0;
      if (h.business === 'live') {
        const roomid = h.oid || h.epid || h.kid;
        return {
          kind: 'live', isLive: true, ts, roomid, bvid: 'live-' + roomid,
          title: item.title, pic: item.cover, owner: { name: item.author_name },
          duration: '未开播',
        };
      }
      const isBangumi = h.business === 'pgc' || item.badge === '番剧';
      return {
        kind: 'video', ts, bvid: h.bvid, cid: h.cid,
        title: item.title, pic: item.cover, duration: item.duration,
        progress: item.progress, owner: { name: item.author_name },
        ...(isBangumi ? { isBangumi: true, epid: h.epid, seasonId: h.oid, badge: '番剧' } : {}),
      };
    };

    async function load() {
      setLoading(true);

      // Watch history (#11: walk a few cursor pages so it's more than a dozen).
      const history = [];
      if (user) {
        try {
          let max = 0, viewAt = 0;
          for (let page = 0; page < 3; page++) {
            const res = await getHistory(max, viewAt, 30);
            const list = res?.data?.list;
            if (!list?.length) break;
            history.push(...list.map(mapHistory));
            const cur = res.data.cursor || {};
            if (!cur.max && !cur.view_at) break;
            max = cur.max; viewAt = cur.view_at;
          }
        } catch {}
      }

      // Supplement with local recent-live entries the history hasn't recorded yet
      // (dedup by roomid). Real ts interleaves them; legacy entries without a ts
      // sink to the bottom rather than clumping at the top.
      const haveRooms = new Set(history.filter(x => x.kind === 'live').map(x => String(x.roomid)));
      const localLive = storage.getRecentLive()
        .filter(r => !haveRooms.has(String(r.roomid)))
        .map(r => ({
          kind: 'live', isLive: true, roomid: r.roomid, bvid: 'live-' + r.roomid,
          title: r.title, pic: r.cover, owner: { name: r.uname },
          ts: r.ts || 0, duration: '未开播',
        }));

      const merged = [...history, ...localLive].sort((a, b) => (b.ts || 0) - (a.ts || 0));

      // Refresh each live card's status (直播/未开播) + cover in parallel.
      await Promise.all(merged.filter(x => x.kind === 'live').map(async (it) => {
        try {
          const res = await getLiveRoomInfo(it.roomid);
          const info = res?.data?.room_info;
          if (info) {
            const status = info.live_status; // 0 未开播 / 1 直播 / 2 轮播
            it.duration = status === 1 ? '🔴 直播' : (status === 2 ? '轮播' : '未开播');
            it.pic = info.cover || info.keyframe || it.pic;
            if (info.title) it.title = info.title;
          }
        } catch {}
      }));

      if (cancelled) return;
      setItems(merged);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [user]);

  const avatar = proxyImg(user?.face);

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18 }}>
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

      <div style={{ fontSize: 20, color: '#aaa', marginBottom: 14 }}>最近观看</div>
      {items.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 20 }}>
          {items.map((v, i) => (
            <VideoCard
              key={v.bvid || `i-${i}`}
              video={v}
              focusId={`content-${Math.floor(i / cols)}-${i % cols}`}
              row={Math.floor(i / cols)}
              col={i % cols}
              group="content"
              onSelect={onPlayVideo}
            />
          ))}
        </div>
      ) : (
        <div style={{ color: '#666', fontSize: 16 }}>
          {loading ? '加载中…' : (user ? '暂无观看记录' : '登录后可查看视频历史')}
        </div>
      )}
    </div>
  );
}
