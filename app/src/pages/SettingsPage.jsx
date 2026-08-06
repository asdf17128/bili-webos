import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { getHistory, getLiveRoomInfo, mediaProxyBase, getToView, delToView } from '../api/client';
import VideoCard from '../components/VideoCard';
import { useFocusable, setFocus, onFocusChange } from '../hooks/useFocus';
import { t } from '../i18n';

// 「观看历史 / 稍后再看」切换。焦点落到 chip 上就切换(选中即切换),与收藏页
// 的收藏夹 chip 行为一致;OK 只是把焦点送进网格。
function TabChip({ label, idx, active, onSelect }) {
  const { props } = useFocusable({
    id: `content-0-${idx}`, row: 0, col: idx, group: 'content', onSelect,
  });
  return (
    <div {...props} className={`fav-chip${active ? ' fav-chip-active' : ''}`}>{label}</div>
  );
}

// 扫码登录 button shown when logged out — the 我的 page previously had no way to
// summon the login QR (only 关注/收藏 triggered it) (#11).
function LoginButton({ onRequestLogin }) {
  const { props } = useFocusable({
    id: 'content-0-0', row: 0, col: 0, group: 'content', onSelect: onRequestLogin,
  });
  return (
    <div {...props} className="settings-row" style={{ maxWidth: 420, marginTop: 18 }}>
      <span>{t('扫码登录')}</span>
      <span className="settings-row-value">{t('按 OK 显示二维码')}</span>
    </div>
  );
}

// Proxy + resize avatar (B站 image CDN needs a Referer; the proxy adds it).
function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) u += '@160w_160h_1c.webp';
  const base = mediaProxyBase();
  try { const p = new URL(u); return `${base}/proxy/${p.host}${p.pathname}${p.search}`; } catch { return u; }
}

export default function SettingsPage({ user, onPlayVideo, onRequestLogin }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0);            // 0 = 观看历史, 1 = 稍后再看
  const [toview, setToview] = useState(null);   // null = 还没拉过
  const [toviewLoading, setToviewLoading] = useState(false);
  const [toast, setToast] = useState('');
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));

  const flash = React.useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }, []);

  // 稍后再看:整表一次返回(无分页,上限 100 条)。懒加载 —— 只有真的切过去才拉。
  const loadToView = React.useCallback(async () => {
    if (!user) { setToview([]); return; }
    setToviewLoading(true);
    try {
      const res = await getToView();
      // 空列表时 B站返回 list:null,不是 []
      const list = (res?.data?.list || []).map(v => ({
        kind: 'video', bvid: v.bvid, aid: v.aid, cid: v.cid,
        title: v.title, pic: v.pic, duration: v.duration,
        progress: v.progress, owner: { name: v.owner?.name, mid: v.owner?.mid },
        stat: { view: v.stat?.view },
        pubdate: v.add_at,   // 卡片上显示"加入时间"比投稿时间更有用
      }));
      setToview(list);
    } catch { setToview([]); }
    setToviewLoading(false);
  }, [user]);

  // 焦点落到 chip 行就切 tab;第一次切到稍后再看时才发请求。
  React.useEffect(() => {
    return onFocusChange((fid) => {
      const m = fid && fid.match(/^content-0-(\d+)$/);
      if (!m) return;
      const col = parseInt(m[1]);
      if (col > 1) return;
      setTab(col);
      if (col === 1 && toview === null && !toviewLoading) loadToView();
    });
  }, [toview, toviewLoading, loadToView]);

  // 长按卡片 = 从稍后再看移除。先本地摘掉(手感即时),失败再放回去。
  const removeFromToView = React.useCallback(async (v) => {
    if (!v?.aid) return;
    const before = toview || [];
    setToview(before.filter(x => x.aid !== v.aid));
    try {
      const res = await delToView(v.aid);
      if (res?.code !== 0) throw new Error(res?.message || 'failed');
      flash(t('已从稍后再看移除'));
    } catch {
      setToview(before);
      flash(t('移除失败,请重试'));
    }
  }, [toview, flash]);

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
          duration: t('未开播'),
          pubdate: ts, // card time = when it was watched
        };
      }
      const isBangumi = h.business === 'pgc' || item.badge === '番剧';
      // Backfill the local progress map from server history so videos watched
      // BEFORE the map existed (or on other devices) also get resume bars.
      // progress -1 = watched to the end. Local entries stay authoritative.
      if (h.bvid && item.duration > 0 && !storage.getProgress(h.bvid)) {
        const p = item.progress === -1 ? item.duration : item.progress;
        if (p > 0) storage.setProgress(h.bvid, p, item.duration);
      }
      return {
        kind: 'video', ts, bvid: h.bvid, cid: h.cid,
        title: item.title, pic: item.cover, duration: item.duration,
        progress: item.progress, owner: { name: item.author_name },
        pubdate: ts, // card time = when it was watched
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
          ts: r.ts || 0, duration: t('未开播'),
          pubdate: r.ts || 0, // recentLive ts is unix seconds (see storage.js)
        }));

      const merged = [...history, ...localLive].sort((a, b) => (b.ts || 0) - (a.ts || 0));

      // Refresh each live card's status (直播/未开播) + cover in parallel.
      await Promise.all(merged.filter(x => x.kind === 'live').map(async (it) => {
        try {
          const res = await getLiveRoomInfo(it.roomid);
          const info = res?.data?.room_info;
          if (info) {
            const status = info.live_status; // 0 未开播 / 1 直播 / 2 轮播
            it.duration = status === 1 ? t('🔴 直播') : (status === 2 ? t('轮播') : t('未开播'));
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
          <div style={{ fontSize: 26, fontWeight: 600, color: '#fff' }}>{user ? user.uname : t('未登录')}</div>
          <div style={{ fontSize: 18, color: '#8a8a9c', marginTop: 4 }}>{t('哔哩哔哩 webOS')}</div>
        </div>
      </div>

      {!user && <LoginButton onRequestLogin={onRequestLogin} />}

      {/* 焦点行 0:登录后是 tab 行,未登录是上面的扫码按钮 —— 两种情况下
          卡片都从行 1 开始,所以下面的行号不用再分情况。 */}
      {user && (
        <div style={{ whiteSpace: 'nowrap', margin: '18px 0 14px' }}>
          <TabChip label={t('观看历史')} idx={0} active={tab === 0} onSelect={() => setFocus('content-1-0')} />
          <TabChip label={t('稍后再看')} idx={1} active={tab === 1} onSelect={() => setFocus('content-1-0')} />
        </div>
      )}
      {!user && <div style={{ fontSize: 20, color: '#aaa', margin: '18px 0 14px' }}>{t('最近观看')}</div>}

      {(() => {
        const list = tab === 1 ? (toview || []) : items;
        const busy = tab === 1 ? (toviewLoading || toview === null) : loading;
        if (list.length === 0) {
          return (
            <div style={{ color: '#666', fontSize: 16 }}>
              {busy ? t('加载中…')
                : !user ? t('登录后可查看视频历史')
                : tab === 1 ? t('稍后再看是空的 · 在播放页按「稍后再看」加入')
                : t('暂无观看记录')}
            </div>
          );
        }
        return (
          <>
            {tab === 1 && (
              <div style={{ fontSize: 18, color: '#8a8f98', marginBottom: 10 }}>
                {t('长按 OK 可从列表移除')}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 20 }}>
              {list.map((v, i) => {
                const row = Math.floor(i / cols) + 1;
                return (
                  <VideoCard
                    key={v.bvid || `i-${i}`}
                    video={v}
                    focusId={`content-${row}-${i % cols}`}
                    row={row}
                    col={i % cols}
                    group="content"
                    onSelect={onPlayVideo}
                    onLongPress={tab === 1 ? removeFromToView : undefined}
                  />
                );
              })}
            </div>
          </>
        );
      })()}

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 70, transform: 'translateX(-50%)',
          background: 'rgba(13,16,32,0.94)', border: '1px solid #2b2c33', borderRadius: 12,
          padding: '12px 22px', fontSize: 20, color: '#f0f0f0', zIndex: 60,
        }}>{toast}</div>
      )}
    </div>
  );
}
