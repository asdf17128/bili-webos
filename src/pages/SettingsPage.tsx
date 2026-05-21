import React, { useState } from 'react';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';

type SettingsPageProps = {
  onLogout: () => void;
  user?: { uname?: string } | null;
  onPlayVideo?: (video: any) => void;
};

export default function SettingsPage({ onLogout, user }: SettingsPageProps) {
  const [settings, setSettings] = useState(storage.getSettings());

  const { props: danmakuProps } = useFocusable({
    id: 'content-0-0',
    row: 0,
    col: 0,
    group: 'content',
    onSelect: () => {
      const nextSettings = { ...settings, danmaku: !settings.danmaku };
      storage.setSettings(nextSettings);
      setSettings(nextSettings);
    },
  });

  const { props: gridColsProps } = useFocusable({
    id: 'content-0-1',
    row: 0,
    col: 1,
    group: 'content',
    onSelect: () => {
      const current = Number(settings.videoGridCols) || 3;
      const nextCols = current >= 4 ? 2 : current + 1;
      const nextSettings = { ...settings, videoGridCols: nextCols };
      storage.setSettings(nextSettings);
      setSettings(nextSettings);
    },
  });

  const { props: logoutProps } = useFocusable({
    id: 'content-0-2',
    row: 0,
    col: 2,
    group: 'content',
    onSelect: () => {
      storage.clearAuth();
      onLogout();
    },
  });

  return (
    <div style={{ padding: '20px 28px', height: '100%', overflow: 'auto' }}>
      <div
        style={{
          fontSize: 26,
          fontWeight: 600,
          color: '#fff',
          marginBottom: 20,
        }}
      >
        {user ? `${user.uname} 的空间` : '我的'}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div {...danmakuProps} className="detail-btn" style={{ fontSize: 16 }}>
          弹幕: {settings.danmaku ? '开' : '关'}
        </div>
        <div {...gridColsProps} className="detail-btn" style={{ fontSize: 16 }}>
          每行视频数: {settings.videoGridCols}
        </div>
        <div
          {...logoutProps}
          className="detail-btn secondary"
          style={{ fontSize: 16, background: '#4a2020' }}
        >
          退出登录
        </div>
      </div>
    </div>
  );
}
