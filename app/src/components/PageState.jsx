import React from 'react';
import { useFocusable } from '../hooks/useFocus';
import { t } from '../i18n';

export function FocusButton({ id = 'content-0-0', row = 0, col = 0, onSelect, onNavigate, children, className = '' }) {
  const { props, isFocused } = useFocusable({ id, row, col, onSelect, onNavigate });
  return <button {...props} type="button" tabIndex={-1}
    className={`tv-action ${className}${isFocused ? ' focused' : ''}`}>{children}</button>;
}

export default function PageState({ title, description, action, onAction, row = 0 }) {
  return <div className="page-state" role="status" aria-live="polite">
    <div className="page-state-symbol" aria-hidden="true">◇</div>
    <h2>{title}</h2>
    {description && <p>{description}</p>}
    {action && <FocusButton id={`content-${row}-0`} row={row} onSelect={onAction}>{action}</FocusButton>}
  </div>;
}

export function GridSkeleton({ cols = 3 }) {
  return <div className="grid-skeleton" role="status" aria-label={t('加载中...')}
    style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
    {Array.from({ length: cols * 2 }, (_, i) => <div className="skeleton-card" key={i} aria-hidden="true">
      <div className="skeleton-cover" /><div className="skeleton-title" /><div className="skeleton-meta" />
    </div>)}
  </div>;
}
