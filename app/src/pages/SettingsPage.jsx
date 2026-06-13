import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';
import { getHistory, getLatestVersion } from '../api/client';
import { APP_VERSION, compareVersions } from '../version';
import VideoGrid from '../components/VideoGrid';

const CONTACT_EMAIL = 'asdf17128@gmail.com';

export default function SettingsPage({ onLogout, user, onPlayVideo }) {
  const [proxyUrl] = useState(storage.getProxyUrl());
  const [history, setHistory] = useState([]);
  const [updateMsg, setUpdateMsg] = useState('');
  const settings = storage.getSettings();

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
        if (compareVersions(latest, APP_VERSION) > 0) {
          setUpdateMsg(`发现新版本 v${latest} — 请通过 Homebrew 频道更新`);
        } else {
          setUpdateMsg(`已是最新版本 (v${APP_VERSION})`);
        }
      } catch {
        setUpdateMsg('检查更新失败,请检查网络后重试');
      }
    },
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
        <div {...checkUpdateProps} className="detail-btn" style={{ fontSize: 16 }}>
          检查更新
        </div>
      </div>

      {/* 关于 */}
      <div style={{ marginBottom: 24, color: '#888', fontSize: 15, lineHeight: 1.9 }}>
        <div style={{ fontSize: 18, color: '#aaa', marginBottom: 8 }}>关于</div>
        <div>哔哩哔哩 webOS · 版本 v{APP_VERSION}</div>
        <div>联系 / 反馈：{CONTACT_EMAIL}</div>
        <div>项目主页：github.com/asdf17128/bili-webos</div>
        {updateMsg && <div style={{ marginTop: 8, color: '#00a1d6' }}>{updateMsg}</div>}
      </div>

      <div style={{ fontSize: 13, color: '#555', marginBottom: 20 }}>
        代理: {proxyUrl}
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
