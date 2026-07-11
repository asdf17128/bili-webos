import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../utils/storage';
import { useFocusable, setCustomKeyHandler } from '../hooks/useFocus';
import { getLatestVersion } from '../api/client';
import { APP_VERSION, compareVersions } from '../version';
import DiagPanel from '../components/DiagPanel';
import { t, getLocale, setLanguage, availableLanguages } from '../i18n';

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
    setUpdateMsg(t('检查中…'));
    try {
      const latest = await getLatestVersion();
      if (!latest) { setUpdateMsg(t('检查失败,请稍后再试')); return; }
      if (compareVersions(latest, APP_VERSION) > 0) {
        setHasUpdate(true);
        setUpdateMsg(t('发现新版 v{v} — 按 OK 打开应用商店更新', { v: latest }));
      } else {
        setUpdateMsg(t('已是最新 (v{v})', { v: APP_VERSION }));
      }
    } catch {
      setUpdateMsg(t('检查更新失败,请检查网络后重试'));
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
    const fallback = () => setUpdateMsg(t('请在 Homebrew Channel 中更新'));
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

  // Stateful so the row VALUE flips on the same OK press — writing storage
  // alone left the label stale until some unrelated re-render (read: "按了没反应").
  const [danmakuOn, setDanmakuOn] = useState(() => settings.danmaku !== false);
  const { props: danmakuProps } = useFocusable({
    id: 'content-0-0', row: 0, col: 0, group: 'content',
    onSelect: () => {
      const s = storage.getSettings();
      const next = !(s.danmaku !== false);
      storage.setSettings({ ...s, danmaku: next });
      setDanmakuOn(next);
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
    { v: 1, label: t('标准') }, { v: 1.3, label: t('大') }, { v: 1.6, label: t('特大') }, { v: 0.8, label: t('小') },
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

  // 字幕字号 — same scale ladder as danmaku. Takes effect on the next video.
  const [subtitleScale, setSubtitleScale] = useState(() => settings.subtitleScale || 1);
  const SUB_SCALES = [
    { v: 1, label: t('标准') }, { v: 1.2, label: t('大') }, { v: 1.4, label: t('特大') }, { v: 0.85, label: t('小') },
  ];
  const { props: subtitleScaleProps } = useFocusable({
    id: 'content-3-0', row: 3, col: 0, group: 'content',
    onSelect: () => {
      setSubtitleScale(prev => {
        const i = SUB_SCALES.findIndex(s => s.v === prev);
        const next = SUB_SCALES[(i + 1) % SUB_SCALES.length].v;
        storage.setSettings({ ...storage.getSettings(), subtitleScale: next });
        return next;
      });
    },
  });

  // CDN线路 — cycle 自动 → 阿里云 → 腾讯云 → 金山云. Forces the video CDN onto
  // that mirror when the auto-assigned node is slow (#10). Takes effect on the
  // next video load.
  const CDN_OPTS = [
    { v: 'auto', label: t('自动') }, { v: 'ali', label: t('阿里云') },
    { v: 'cos', label: t('腾讯云') }, { v: 'ks3', label: t('金山云') },
    { v: 'akam', label: t('海外 Akamai') },
  ];
  const { props: cdnProps } = useFocusable({
    id: 'content-4-0', row: 4, col: 0, group: 'content',
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
    id: 'content-5-0', row: 5, col: 0, group: 'content',
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
    id: 'content-6-0', row: 6, col: 0, group: 'content',
    onSelect: () => setShowDiag(v => !v),
  });

  // 语言 / Language (#14) — OK opens a picker LIST (cycling reloaded the app on
  // every press, brutal for a low-frequency setting). OK in the list applies
  // (persist + reload, only if actually changed); Back cancels with no reload.
  // Names stay endonyms (each language in itself) — standard for language
  // pickers, so users can find their way back from a language they can't read.
  const LANG_LABELS = { auto: t('自动'), zh: '中文', en: 'English', es: 'Español' };
  const langPref = storage.getSettings().language || 'zh';
  const langOpts = availableLanguages();
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [pickerIdx, setPickerIdx] = useState(0);
  const { props: langProps } = useFocusable({
    id: 'content-7-0', row: 7, col: 0, group: 'content',
    onSelect: () => {
      setPickerIdx(Math.max(0, langOpts.indexOf(langPref)));
      setShowLangPicker(true);
    },
  });

  // Modal key handling: swallow everything while the picker is open so the
  // grid/sidebar underneath doesn't move.
  useEffect(() => {
    if (!showLangPicker) return;
    const handler = (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIdx(p => Math.max(0, p - 1)); return true; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIdx(p => Math.min(langOpts.length - 1, p + 1)); return true; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = langOpts[pickerIdx];
        setShowLangPicker(false);
        if (sel && sel !== langPref) setLanguage(sel); // persists + reloads
        return true;
      }
      if (e.keyCode === 461 || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        setShowLangPicker(false);
        return true;
      }
      return true;
    };
    setCustomKeyHandler(handler);
    return () => setCustomKeyHandler(null);
  }, [showLangPicker, pickerIdx, langPref]);

  const { props: logoutProps } = useFocusable({
    id: 'content-8-0', row: 8, col: 0, group: 'content',
    onSelect: () => { if (user) { storage.clearAuth(); onLogout(); } },
  });

  const dmScaleLabel = (DM_SCALES.find(s => s.v === danmakuScale) || DM_SCALES[0]).label;
  const cdnLabel = (CDN_OPTS.find(o => o.v === cdnRoute) || CDN_OPTS[0]).label;

  return (
    <div style={{ padding: '28px 40px', height: '100%', overflowY: 'auto', maxWidth: 720 }}>
      <div style={{ fontSize: 26, fontWeight: 600, color: '#fff', marginBottom: 24 }}>{t('设置')}</div>

      <div className="settings-row" {...danmakuProps}>
        <span>{t('弹幕')}</span>
        <span className="settings-row-value">{danmakuOn ? t('开') : t('关')}</span>
      </div>

      <div className="settings-row" {...gridProps}>
        <span>{t('每行视频')}</span>
        <span className="settings-row-value">{t('{n} 个', { n: gridCols })}</span>
      </div>

      <div className="settings-row" {...danmakuScaleProps}>
        <span>{t('弹幕字号')}</span>
        <span className="settings-row-value">{dmScaleLabel}</span>
      </div>

      <div className="settings-row" {...subtitleScaleProps}>
        <span>{t('字幕字号')}</span>
        <span className="settings-row-value">{(SUB_SCALES.find(s => s.v === subtitleScale) || SUB_SCALES[0]).label}</span>
      </div>

      <div className="settings-row" {...cdnProps}>
        <span>{t('CDN 线路')}</span>
        <span className="settings-row-value">{cdnLabel}</span>
      </div>

      <div className="settings-row" {...checkUpdateProps}>
        <span>{t('检查更新')}</span>
        <span className="settings-row-value">{updateMsg || `v${APP_VERSION}`}</span>
      </div>

      <div className="settings-row" {...diagProps}>
        <span>{t('网络诊断')}</span>
        <span className="settings-row-value">{showDiag ? t('按 OK 收起') : t('检测网络与服务状态')}</span>
      </div>

      {showDiag && <DiagPanel />}

      <div className="settings-row" {...langProps}>
        <span>语言 / Language</span>
        <span className="settings-row-value">
          {LANG_LABELS[langPref] || langPref}{langPref === 'auto' ? ` (${getLocale() === 'zh' ? '中文' : getLocale()})` : ''}
        </span>
      </div>

      {showLangPicker && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
          zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowLangPicker(false)}>
          <div style={{ background: 'rgba(24,26,44,0.98)', borderRadius: 12, padding: '18px 0', minWidth: 360,
            boxShadow: '0 18px 60px rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={(e) => e.stopPropagation()}>
            {/* Fixed bilingual label on purpose — a language picker must stay
                findable from a language you can't read. */}
            <div style={{ fontSize: 20, color: '#9aa0a8', padding: '0 26px 12px' }}>语言 / Language</div>
            {langOpts.map((code, i) => (
              <div key={code} style={{
                padding: '12px 26px', fontSize: 22, display: 'flex', justifyContent: 'space-between', gap: 48,
                cursor: 'pointer',
                color: i === pickerIdx ? '#fff' : '#c6cad2',
                background: i === pickerIdx ? '#00a1d6' : 'transparent',
              }}
                onMouseEnter={() => setPickerIdx(i)}
                onClick={() => {
                  setShowLangPicker(false);
                  if (code !== langPref) setLanguage(code); // persists + reloads
                }}>
                <span>{LANG_LABELS[code] || code}{code === 'auto' ? ` (${LANG_LABELS[getLocale()] || getLocale()})` : ''}</span>
                {code === langPref && <span>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {user && (
        <div className="settings-row settings-row-danger" {...logoutProps}>
          <span>{t('退出登录')}</span>
          <span className="settings-row-value">{user.uname}</span>
        </div>
      )}

      <div style={{ marginTop: 28, color: '#888', fontSize: 18, lineHeight: 2 }}>
        <div style={{ fontSize: 20, color: '#aaa', marginBottom: 6 }}>{t('关于')}</div>
        <div>{t('哔哩哔哩 webOS · 版本 v{v}', { v: APP_VERSION })}</div>
        <div>{t('联系 / 反馈：')}{CONTACT_EMAIL}</div>
        <div>{t('项目主页：')}github.com/asdf17128/bili-webos</div>
        <div style={{ fontSize: 16, color: '#667', marginTop: 8 }}>{t('代理: ')}{proxyUrl}</div>
      </div>
    </div>
  );
}
