import React, { useEffect, useRef } from 'react';
import Icon from '../components/Icon';
import { t } from '../i18n';
import './playerMoreControls.css';

// Keep the same Bilibili coin artwork as the main player's interaction buttons.
function CoinIcon() {
  return <svg className="coin-icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="11" fill="#ffc331" />
    <circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9" />
    <text x="12" y="16.4" textAnchor="middle" fontSize="12" fontWeight="900" fill="#fff" fontFamily="Arial">B</text>
  </svg>;
}

// The player owns remote input, action state and hold timers. This panel only
// renders those states and forwards pointer actions to the same controller.
export default function PlayerMoreControls({
  items, focusedId, onFocus, onAction, onClose, onLikeStart, onLikeEnd,
  buttonRef, likeRing, triplePop,
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
    <section className="player-more-panel" role="dialog" aria-modal="true" aria-label={t('更多操作')}
      onClick={event => event.stopPropagation()}>
      <header className="player-more-header">
        <h2>{t('更多操作')}</h2>
        <button className="player-more-back" type="button" tabIndex={-1} onClick={onClose}>{t('返回')}</button>
      </header>
      <div className="player-more-actions" ref={rowsRef}>
        {items.map(({ id, label, value, icon, active }) => {
          const focused = id === focusedId;
          const isStat = id === 'like' || id === 'coin' || id === 'fav';
          const handlers = id === 'like' ? {
            onMouseDown: event => { if (event.button === 0) onLikeStart(); },
            onMouseUp: event => { if (event.button === 0) onLikeEnd(false); },
            onMouseLeave: () => onLikeEnd(true),
          } : { onClick: () => onAction(id) };
          return <button key={id} type="button" data-control={id}
            ref={element => { actionRefs.current[id] = element; buttonRef?.(id, element); }}
            className={`player-btn player-more-action${focused ? ' focused' : ''}${active ? ' lit' : ''}${isStat && triplePop ? ' triple-pop' : ''}`}
            aria-label={label} aria-pressed={typeof active === 'boolean' ? active : undefined}
            tabIndex={focused ? 0 : -1}
            onFocus={() => onFocus(id)} onMouseMove={() => onFocus(id)} {...handlers}>
            <span className="player-more-icon">{id === 'coin' ? <CoinIcon /> : <Icon size={26} name={icon || (id === 'fav' ? 'star' : id)} />}</span>
            <span className="player-more-label">{label}</span>
            {value != null && value !== '' && <span className="player-more-value">{value}</span>}
            {id === 'like' && likeRing && <svg className="like-ring" aria-hidden="true" width={likeRing.w + 8} height={likeRing.h + 8}
              style={{ left: -7, top: -7 }}>
              <rect className="like-ring-track" x="4" y="4" width={likeRing.w} height={likeRing.h} rx={likeRing.rx} />
              <rect className="like-ring-fill" x="4" y="4" width={likeRing.w} height={likeRing.h} rx={likeRing.rx}
                style={{ strokeDasharray: likeRing.perim, strokeDashoffset: likeRing.perim }} />
            </svg>}
          </button>;
        })}
      </div>
    </section>
  </div>;
}
