import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';
import { getLatestVersion } from '../api/client';
import { APP_VERSION, compareVersions } from '../version';
import DiagPanel from '../components/DiagPanel';

const CONTACT_EMAIL = 'asdf17128@gmail.com';

export default function ConfigPage({ onLogout, user }) {
  const [proxyUrl] = useState(storage.getProxyUrl());
  const [updateMsg, setUpdateMsg] = useState('');
  const [hasUpdate, setHasUpdate] = useState(false);
  const checking = useRef(false);
  const settings = storage.getSettings();
  const [gridCols, setGridCols] = useState(() => Math.min(4, Math.max(2, settings.gridCols || 3)));
  const [danmakuScale, setDanmakuScale] = useState(() => settings.danmakuScale || 1);
  const [cdnRoute, setCdnRoute] = useState(() => settings.cdnRoute || 'auto');

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

  // 每行视频数 — cycles 2 → 3 → 4 → 2 on OK.
  const { props: gridProps } = useFocusable({
    id: 'content-1-0', row: 1, col: 0, group: 'content',
    onSelect: () => {
      setGridCols(prev => {
        const next = prev >= 4 ? 2 : prev + 1;
        storage.setSettings({ ...storage.getSettings(), gridCols: next });
        return next;
      });
    },
  });

  // 弹幕字号 — cycle 标准 → 大 → 特大 → 小 on OK.
  const DM_SCALES = [
    { v: 1, label: '标准' }, { v: 1.3, label: '大' }, { v: 1.6, label: '特大' }, { v: 0.8, label: '小' },
  ];
  const { props: danmakuScaleProps } = useFocusable({
    id: 'content-2-0', row: 2, col: 0, group: 'content',
    onSelect: () => {
      setDanmakuScale(prev => {
        const i = DM_SCALES.findIndex(s => s.v === prev);
        const next = DM_SCALES[(i + 1) % DM_SCALES.length].v;
        storage.setSettings({ ...storage.getSettings(), danmakuScale: next });
        return next;
      });
    },
  });

  // CDN线路 — cycle 自动 → 阿里云 → 腾讯云 → 金山云. Forces the video CDN onto
  // that mirror when the auto-assigned node is slow (#10). Takes effect on the
  // next video load.
  const CDN_OPTS = [
    { v: 'auto', label: '自动' }, { v: 'ali', label: '阿里云' },
    { v: 'cos', label: '腾讯云' }, { v: 'ks3', label: '金山云' },
    { v: 'akam', label: '海外 Akamai' },
  ];
  const { props: cdnProps } = useFocusable({
    id: 'content-3-0', row: 3, col: 0, group: 'content',
    onSelect: () => {
      setCdnRoute(prev => {
        const i = CDN_OPTS.findIndex(o => o.v === prev);
        const next = CDN_OPTS[(i + 1) % CDN_OPTS.length].v;
        storage.setSettings({ ...storage.getSettings(), cdnRoute: next });
        return next;
      });
    },
  });

  const { props: checkUpdateProps } = useFocusable({
    id: 'content-4-0', row: 4, col: 0, group: 'content',
    onSelect: () => {
      // Once an update is known, OK opens the Homebrew Channel to install it;
      // otherwise re-run the check manually.
      if (hasUpdate) { openHomebrewChannel(); return; }
      checkForUpdate();
    },
  });

  // 网络诊断 (#10/#13) — OK toggles the inline panel; remounting it re-runs
  // the whole test suite.
  const [showDiag, setShowDiag] = useState(false);
  const { props: diagProps } = useFocusable({
    id: 'content-5-0', row: 5, col: 0, group: 'content',
    onSelect: () => setShowDiag(v => !v),
  });

  const { props: logoutProps } = useFocusable({
    id: 'content-6-0', row: 6, col: 0, group: 'content',
    onSelect: () => { if (user) { storage.clearAuth(); onLogout(); } },
  });

  const dmScaleLabel = (DM_SCALES.find(s => s.v === danmakuScale) || DM_SCALES[0]).label;
  const cdnLabel = (CDN_OPTS.find(o => o.v === cdnRoute) || CDN_OPTS[0]).label;

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto', maxWidth: 720 }}>
      <div style={{ fontSize: 26, fontWeight: 600, color: '#fff', marginBottom: 24 }}>设置</div>

      <div className="settings-row" {...danmakuProps}>
        <span>弹幕</span>
        <span className="settings-row-value">{settings.danmaku ? '开' : '关'}</span>
      </div>

      <div className="settings-row" {...gridProps}>
        <span>每行视频</span>
        <span className="settings-row-value">{gridCols} 个</span>
      </div>

      <div className="settings-row" {...danmakuScaleProps}>
        <span>弹幕字号</span>
        <span className="settings-row-value">{dmScaleLabel}</span>
      </div>

      <div className="settings-row" {...cdnProps}>
        <span>CDN 线路</span>
        <span className="settings-row-value">{cdnLabel}</span>
      </div>

      <div className="settings-row" {...checkUpdateProps}>
        <span>检查更新</span>
        <span className="settings-row-value">{updateMsg || `v${APP_VERSION}`}</span>
      </div>

      <div className="settings-row" {...diagProps}>
        <span>网络诊断</span>
        <span className="settings-row-value">{showDiag ? '按 OK 收起' : '检测网络与服务状态'}</span>
      </div>

      {showDiag && <DiagPanel />}

      {user && (
        <div className="settings-row settings-row-danger" {...logoutProps}>
          <span>退出登录</span>
          <span className="settings-row-value">{user.uname}</span>
        </div>
      )}

      <div style={{ marginTop: 28, color: '#888', fontSize: 18, lineHeight: 2 }}>
        <div style={{ fontSize: 20, color: '#aaa', marginBottom: 6 }}>关于</div>
        <div>哔哩哔哩 webOS · 版本 v{APP_VERSION}</div>
        <div>联系 / 反馈：{CONTACT_EMAIL}</div>
        <div>项目主页：github.com/asdf17128/bili-webos</div>
        <div style={{ fontSize: 16, color: '#667', marginTop: 8 }}>代理: {proxyUrl}</div>
      </div>
    </div>
  );
}
