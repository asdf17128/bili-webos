// @ts-nocheck
import React from 'react';
import { useFocusable } from '../hooks/useFocus';
import { buildProxyUrl } from '../utils/proxy';

function proxyImg(url) {
  if (!url) return '';
  const raw = url.startsWith('//') ? `https:${url}` : url;
  try {
    return buildProxyUrl(raw);
  } catch {
    return raw;
  }
}

function getSubscriptionFocusId(index, cols) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return `subscription-${row}-${col}`;
}

function SubscriptionCard({ item, index, cols, onSelect }) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const focusId = getSubscriptionFocusId(index, cols);
  const { props } = useFocusable({
    id: focusId,
    row,
    col,
    group: 'subscription',
    onSelect: () => onSelect(item, index, focusId),
  });

  const thumbUrl = proxyImg(item.cover);
  const ownerName = item.ownerName || item.upper?.name || '未知UP主';
  const videoCount = item.total > 0 ? `${item.total}个视频` : '暂无可用视频';

  return (
    <div
      {...props}
      className={`subscription-card card-focus-unified ${item.isInvalid ? 'invalid' : ''}`}
    >
      <div className="subscription-card-thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="subscription-card-thumb-placeholder" />
        )}
        <span className="subscription-card-badge">合集</span>
      </div>
      <div className="subscription-card-body">
        <div className="subscription-card-title">{item.title}</div>
        <div className="subscription-card-meta">UP主: {ownerName}</div>
        <div className="subscription-card-meta">{videoCount}</div>
      </div>
    </div>
  );
}

export default function SubscriptionList({ items, onSelect, cols = 3 }) {
  if (!items || items.length === 0) {
    return <div className="empty-state">暂无订阅内容</div>;
  }

  return (
    <div
      className="subscription-list"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map((item, index) => (
        <SubscriptionCard
          key={item.id || `subscription-${index}`}
          item={item}
          index={index}
          cols={cols}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
