import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../utils/storage';
import { setCustomKeyHandler } from '../hooks/useFocus';
import { t } from '../i18n';
import DanmakuLayer from '../player/DanmakuLayer';
import { DANMAKU_FIELDS, normalizeDanmaku } from '../player/danmakuSettings';

const SAMPLE = Array.from({ length: 80 }, (_, i) => ({ time: i * 0.2,
  text: i % 3 === 0 ? t('这段太精彩了！') : t('弹幕效果预览'), mode: [1, 5, 4, 1][i % 4],
  color: i % 5 === 0 ? '#ffcc66' : '#ffffff' }));

export default function DanmakuSettings({ onClose }) {
  const [settings, setSettings] = useState(() => normalizeDanmaku(storage.getSettings()));
  const [row, setRow] = useState(0);
  const [choice, setChoice] = useState(null);
  const [time, setTime] = useState(0);
  const rowsRef = useRef(null);
  const field = DANMAKU_FIELDS[row];
  const save = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next); storage.setSettings({ ...storage.getSettings(), ...next });
  };
  const activate = index => {
    const f = DANMAKU_FIELDS[index];
    setRow(index);
    if (typeof f[4] === 'boolean') save(f[0], !settings[f[0]]);
    else setChoice(f[2].indexOf(settings[f[0]]));
  };
  useEffect(() => {
    const timer = setInterval(() => setTime(v => v >= 16 ? 0 : v + 0.25), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { rowsRef.current?.children[row]?.scrollIntoView({ block: 'nearest' }); }, [row]);
  useEffect(() => {
    setCustomKeyHandler(e => {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat && (e.key === 'Enter' || e.keyCode === 461 || ['Escape', 'Backspace', 'GoBack'].includes(e.key))) return true;
      if (e.keyCode === 461 || ['Escape', 'Backspace', 'GoBack'].includes(e.key)) {
        if (choice !== null) setChoice(null); else onClose();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const delta = e.key === 'ArrowUp' ? -1 : 1;
        if (choice !== null) setChoice(v => Math.max(0, Math.min(field[2].length - 1, v + delta)));
        else setRow(v => Math.max(0, Math.min(DANMAKU_FIELDS.length - 1, v + delta)));
      } else if (e.key === 'Enter') {
        if (choice !== null) { save(field[0], field[2][choice]); setChoice(null); }
        else activate(row);
      }
      return true;
    });
    return () => setCustomKeyHandler(null);
  }, [row, choice, settings, onClose]);
  return <div className="dm-settings-backdrop" onClick={onClose}>
    <section className="dm-settings" role="dialog" aria-modal="true" aria-label={t('弹幕设置')} onClick={e => e.stopPropagation()}>
      <header><h2>{t('弹幕设置')}</h2><button onClick={onClose}>{t('返回')}</button></header>
      <div className="dm-settings-body">
        <div className="dm-settings-rows" ref={rowsRef}>
          {DANMAKU_FIELDS.map(([key, label, values, labels], i) => <button key={key}
            className={'dm-setting-row' + (i === row ? ' selected' : '')}
            onMouseEnter={() => { if (choice === null) setRow(i); }} onClick={() => activate(i)}>
            <span>{t(label)}</span><strong>{t(labels[values.indexOf(settings[key])])}</strong>
          </button>)}
        </div>
        <aside><div className="dm-preview"><div className="dm-preview-stage">
          <DanmakuLayer danmakus={SAMPLE} currentTime={time} enabled settings={settings} fontScale={settings.danmakuScale} />
        </div></div><p>{t('调整后自动保存，下次播放生效。')}</p>
          <p>{t('密集弹幕可能增加电视负担；卡顿时可降低密度。')}</p>
          <p>{t('直播应用外观和滚动设置；固定与彩色弹幕取决于片源。')}</p>
        </aside>
      </div>
      {choice !== null && <div className="dm-choice-backdrop" onClick={() => setChoice(null)}>
        <div className="settings-picker dm-choice" onClick={e => e.stopPropagation()}><h3>{t(field[1])}</h3>
          {field[2].map((value, i) => <button key={String(value)} className={choice === i ? 'selected' : ''}
            onMouseEnter={() => setChoice(i)} onClick={() => { save(field[0], value); setChoice(null); }}>
            {t(field[3][i])}{settings[field[0]] === value ? ' ✓' : ''}
          </button>)}
        </div>
      </div>}
    </section>
  </div>;
}
