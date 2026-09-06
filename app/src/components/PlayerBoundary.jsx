import React, { useEffect } from 'react';
import { cancelContentFocus } from '../hooks/useFocus';
import { holdPrefetch } from '../utils/perfFlags';
import { t } from '../i18n';

// Also owns remote input while the lazy player is loading. Without this,
// pressing OK/Right could operate the hidden browsing page behind the player.
export function PlayerPlaceholder({ title, failed = false, onBack }) {
  useEffect(() => {
    cancelContentFocus();
    const releasePrefetch = holdPrefetch();
    const handler = e => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'GoBack', 'Escape'].includes(e.key) && e.keyCode !== 461) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat && (e.key === 'Enter' || ['Backspace', 'GoBack', 'Escape'].includes(e.key) || e.keyCode === 461)) onBack();
    };
    const wheel = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => { releasePrefetch(); window.removeEventListener('keydown', handler, true); window.removeEventListener('wheel', wheel, true); };
  }, [onBack]);
  return <div className="player-placeholder" role="status">
    {!failed && <div className="loading-spinner" />}
    <h1>{failed ? t('播放器加载失败') : t('正在准备播放')}</h1>
    {title && <p>{title}</p>}
    <button className="tv-action focused" type="button" onClick={onBack}>{t('返回浏览')}</button>
  </div>;
}

export default class PlayerBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Player failed to load:', error); }
  render() {
    return this.state.failed ? <PlayerPlaceholder failed title={this.props.title} onBack={this.props.onBack} /> : this.props.children;
  }
}
