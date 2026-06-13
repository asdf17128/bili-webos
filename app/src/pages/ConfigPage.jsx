import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';
import { getLatestVersion } from '../api/client';
import { APP_VERSION, compareVersions } from '../version';

const CONTACT_EMAIL = 'asdf17128@gmail.com';

export default function ConfigPage({ onLogout, user }) {
  const [proxyUrl] = useState(storage.getProxyUrl());
  const [updateMsg, setUpdateMsg] = useState('');
  const [hasUpdate, setHasUpdate] = useState(false);
  const checking = useRef(false);
  const settings = storage.getSettings();

  // Query GitHub for the latest release and compare with the running version.
  // Shared by the auto-check on mount and the manual OK press.
  async function checkForUpdate() {
    if (checking.current) return;
    checking.current = true;
    setUpdateMsg('检查中…');
    try {
      const latest = await getLatestVersion();
      if (!latest) { setUpdateMsg('检查失败,请稍后再试'); return; }
      if (compareVersions(latest, APP_VERSION) > 0) {
        setHasUpdate(true);
        setUpdateMsg(`发现新版 v${latest} — 按 OK 打开应用商店更新`);
      } else {
        setUpdateMsg(`已是最新 (v${APP_VERSION})`);
      }
    } catch {
      setUpdateMsg('检查更新失败,请检查网络后重试');
    } finally {
      checking.current = false;
    }
  }

  // Auto-check once when the 设置 page opens, so the row shows the status
  // without the user having to trigger it.
  useEffect(() => { checkForUpdate(); }, []);

  // Updates are installed by the webosbrew Homebrew Channel (it pulls the new
  // ipk from the GitHub release). When an update exists, open it for the user.
  function openHomebrewChannel() {
    const fallback = () => setUpdateMsg('请在 Homebrew Channel 中更新');
    try {
      if (!window.webOS?.service?.request) { fallback(); return; }
      // Launch via the public applicationManager bus. webOS.service.request
      // builds the URI as base + method, so the method goes in its own field
      // (matching how the app's own service calls are made).
      window.webOS.service.request('luna://com.webos.applicationManager/', {
        method: 'launch',
        parameters: { id: 'org.webosbrew.hbchannel', params: {} },
        onSuccess: () => {},
        onFailure: fallback,
      });
    } catch { fallback(); }
  }

  const { props: danmakuProps } = useFocusable({
    id: 'content-0-0', row: 0, col: 0, group: 'content',
    onSelect: () => {
      const s = storage.getSettings();
      storage.setSettings({ ...s, danmaku: !s.danmaku });
    },
  });

  const { props: logoutProps } = useFocusable({
    id: 'content-2-0', row: 2, col: 0, group: 'content',
    onSelect: () => { if (user) { storage.clearAuth(); onLogout(); } },
  });

  const { props: checkUpdateProps } = useFocusable({
    id: 'content-1-0', row: 1, col: 0, group: 'content',
    onSelect: () => {
      // Once an update is known, OK opens the Homebrew Channel to install it;
      // otherwise re-run the check manually.
      if (hasUpdate) { openHomebrewChannel(); return; }
      checkForUpdate();
    },
  });

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto', maxWidth: 720 }}>
      <div style={{ fontSize: 26, fontWeight: 600, color: '#fff', marginBottom: 24 }}>设置</div>

      <div className="settings-row" {...danmakuProps}>
        <span>弹幕</span>
        <span className="settings-row-value">{settings.danmaku ? '开' : '关'}</span>
      </div>

      <div className="settings-row" {...checkUpdateProps}>
        <span>检查更新</span>
        <span className="settings-row-value">{updateMsg || `v${APP_VERSION}`}</span>
      </div>

      {user && (
        <div className="settings-row settings-row-danger" {...logoutProps}>
          <span>退出登录</span>
          <span className="settings-row-value">{user.uname}</span>
        </div>
      )}

      <div style={{ marginTop: 28, color: '#888', fontSize: 15, lineHeight: 2 }}>
        <div style={{ fontSize: 16, color: '#aaa', marginBottom: 6 }}>关于</div>
        <div>哔哩哔哩 webOS · 版本 v{APP_VERSION}</div>
        <div>联系 / 反馈：{CONTACT_EMAIL}</div>
        <div>项目主页：github.com/asdf17128/bili-webos</div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>代理: {proxyUrl}</div>
      </div>
    </div>
  );
}
