import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';
import { getHistory, getLatestVersion } from '../api/client';
import { APP_VERSION, compareVersions } from '../version';
import VideoGrid from '../components/VideoGrid';

const CONTACT_EMAIL = 'asdf17128@gmail.com';

// Proxy + resize avatar (B站 image CDN needs a Referer; the proxy adds it).
function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) u += '@160w_160h_1c.webp';
  const base = (typeof window !== 'undefined' && window.webOS) ? 'http://127.0.0.1:7654' : storage.getProxyUrl();
  try { const p = new URL(u); return `${base}/proxy/${p.host}${p.pathname}${p.search}`; } catch { return u; }
}

const card = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: '18px 22px',
  marginBottom: 18,
};
const sectionTitle = { fontSize: 15, color: '#7a7a8c', letterSpacing: 1, marginBottom: 10 };
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 16, color: '#ccc' };

export default function SettingsPage({ onLogout, user, onPlayVideo }) {
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const settings = storage.getSettings();

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

  const { props: danmakuProps } = useFocusable({
    id: 'content-0-0', row: 0, col: 0, group: 'content',
    onSelect: () => {
      const s = storage.getSettings();
      storage.setSettings({ ...s, danmaku: !s.danmaku });
    },
  });

  const { props: logoutProps } = useFocusable({
    id: 'content-0-1', row: 0, col: 1, group: 'content',
    onSelect: () => { storage.clearAuth(); onLogout(); },
  });

  const { props: checkUpdateProps } = useFocusable({
    id: 'content-0-2', row: 0, col: 2, group: 'content',
    onSelect: async () => {
      setUpdateMsg('检查中…');
      try {
        const latest = await getLatestVersion();
        if (!latest) { setUpdateMsg('检查失败,请稍后再试'); return; }
        setUpdateMsg(compareVersions(latest, APP_VERSION) > 0
          ? `发现新版本 v${latest} — 请通过 Homebrew 频道更新`
          : `已是最新版本 (v${APP_VERSION})`);
      } catch {
        setUpdateMsg('检查更新失败,请检查网络后重试');
      }
    },
  });

  const avatar = proxyImg(user?.face);

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto' }}>
      {/* User header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 24 }}>
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
          <div style={{ fontSize: 15, color: '#7a7a8c', marginTop: 4 }}>
            {user ? '哔哩哔哩 webOS · 已登录' : '哔哩哔哩 webOS'}
          </div>
        </div>
      </div>

      {/* 设置 */}
      <div style={sectionTitle}>设置</div>
      <div style={card}>
        <div style={{ display: 'flex', gap: 14 }}>
          <div {...danmakuProps} className="detail-btn" style={{ fontSize: 16 }}>
            弹幕 {settings.danmaku ? '开' : '关'}
          </div>
          <div {...logoutProps} className="detail-btn secondary" style={{ fontSize: 16 }}>
            退出登录
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div style={sectionTitle}>关于</div>
      <div style={card}>
        <div style={{ ...row, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#888' }}>版本</span>
          <span style={{ color: '#fff' }}>v{APP_VERSION}</span>
        </div>
        <div style={{ ...row, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#888' }}>联系 / 反馈</span>
          <span>{CONTACT_EMAIL}</span>
        </div>
        <div style={{ ...row, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#888' }}>项目主页</span>
          <span style={{ fontSize: 14 }}>github.com/asdf17128/bili-webos</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
          <div {...checkUpdateProps} className="detail-btn" style={{ fontSize: 16 }}>检查更新</div>
          {updateMsg && <span style={{ color: '#00a1d6', fontSize: 15 }}>{updateMsg}</span>}
        </div>
      </div>

      {/* 最近观看 */}
      {user && (
        <>
          <div style={sectionTitle}>最近观看</div>
          {history.length > 0 ? (
            <VideoGrid videos={history} group="content" startRow={1} cols={2} onSelect={onPlayVideo} />
          ) : (
            <div style={{ ...card, color: '#666', fontSize: 16 }}>
              {historyLoading ? '加载中…' : '暂无观看记录'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
