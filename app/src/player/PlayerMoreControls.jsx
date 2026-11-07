import React, { useEffect, useRef } from 'react';
import Icon from '../components/Icon';
import { t } from '../i18n';
import './playerMoreControls.css';

// The player owns remote input, setting state and nested-panel navigation.
// Interaction buttons and their hold timers remain in the primary control row.
export default function PlayerSettingsControls({
  items, focusedId, onFocus, onAction, onClose, buttonRef,
  title = t('播放设置'), panelClassName = '', rowClassName = '',
}) {
  const rowsRef = useRef(null);
  const actionRefs = useRef({});
  useEffect(() => {
    const row = actionRefs.current[focusedId], list = rowsRef.current;
    if (!row || !list) return;
    const box = row.getBoundingClientRect(), viewport = list.getBoundingClientRect();
    if (box.top >= viewport.top + 8 && box.bottom <= viewport.bottom - 8) return;
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else if (box.top < viewport.top) list.scrollTop += box.top - viewport.top - 8;
    else list.scrollTop += box.bottom - viewport.bottom + 8;
  }, [focusedId, items.length]);

  return <div className="player-more-backdrop" onClick={onClose}>
    <section className={`player-more-panel ${panelClassName}`} role="dialog" aria-modal="true" aria-label={title}
      onClick={event => event.stopPropagation()}>
      <header className="player-more-header">
        <h2>{title}</h2>
        <button className="player-more-back" type="button" tabIndex={-1} onClick={onClose}>{t('返回')}</button>
      </header>
      <div className="player-more-actions" ref={rowsRef}>
        {items.map(({ id, label, value, icon, active, opensPanel }) => {
          const focused = id === focusedId;
          const hasValue = value != null && value !== '';
          return <button key={id} type="button" data-control={id}
            ref={element => { actionRefs.current[id] = element; buttonRef?.(id, element); }}
            className={`player-btn player-more-action ${rowClassName}${focused ? ' focused' : ''}${active ? ' active lit' : ''}`}
            aria-label={hasValue ? `${label} ${value}` : label}
            aria-pressed={typeof active === 'boolean' ? active : undefined}
            aria-haspopup={opensPanel ? 'dialog' : undefined}
            tabIndex={focused ? 0 : -1}
            onFocus={() => onFocus(id)} onMouseMove={() => onFocus(id)} onClick={() => onAction(id)}>
            <span className="player-more-icon"><Icon size={26} name={icon || id} /></span>
            <span className="player-more-text">
              <span className="player-more-label">{label}</span>
              {hasValue && <span className="player-more-value">{value}</span>}
            </span>
            {opensPanel && <span className="player-more-next" aria-hidden="true"><Icon size={20} name="arrow" /></span>}
          </button>;
        })}
      </div>
    </section>
  </div>;
}
