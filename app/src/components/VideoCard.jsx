import React, { useCallback } from 'react';
import { useFocusable } from '../hooks/useFocus';
import { formatCount, formatDuration, formatTime, cleanTitle } from '../utils/format';
import { storage } from '../utils/storage';
import { t } from '../i18n';
import { titleMT, useTitlesMT } from '../utils/titlemt';

function getProxyBase() {
  return (typeof window !== 'undefined' && window.webOS)
    ? 'http://127.0.0.1:7654'
    : storage.getProxyUrl();
}

function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) {
    u += '@672w_420h_1c.webp';
  }
  try {
    const parsed = new URL(u);
    return `${getProxyBase()}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return u;
  }
}

export default React.memo(function VideoCard({ video, focusId, row, col, group, onSelect, followed = false }) {
  const handleSelect = useCallback(() => {
    onSelect?.(video);
  }, [video, onSelect]);

  const { props } = useFocusable({
    id: focusId, row, col, group, onSelect: handleSelect,
  });

  // Non-zh UIs machine-translate card titles (no-op subscription on zh).
  useTitlesMT();

  const thumbUrl = proxyImg(video.pic || video.cover || '');

  return (
    <div {...props} className="video-card">
      <div className="video-card-thumb">
        {thumbUrl && <img src={thumbUrl} alt="" loading="lazy" decoding="async" />}
        {video.duration != null && (
          <span className="video-card-duration">
            {typeof video.duration === 'number' ? formatDuration(video.duration) : video.duration}
          </span>
        )}
        {(() => {
          // Watch-progress bar on EVERY list (owner request): server-annotated
          // progress (history rows) wins; otherwise the local map covers feed/
          // search/favorites/related for anything watched on this TV.
          let p = video.progress > 0 && video.duration > 0
            ? video.progress / video.duration : 0;
          if (!p && video.bvid && !video.isLive) {
            const lp = storage.getProgress(video.bvid);
            if (lp) p = lp.progress / lp.duration;
          }
          if (!(p > 0)) return null;
          return (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
              background: 'rgba(255,255,255,0.2)',
            }}>
              <div style={{
                height: '100%', background: '#00a1d6',
                width: `${Math.min(100, p * 100)}%`,
              }} />
            </div>
          );
        })()}
      </div>
      <div className="video-card-info">
        <div className="video-card-title">{titleMT(cleanTitle(video.title))}</div>
        <div className="video-card-meta">
          {video.owner?.name && <span>{cleanTitle(video.owner.name)}</span>}
          {followed && <span style={{ color: '#00a1d6', fontWeight: 600 }}>{t('已关注')}</span>}
          {video.stat?.view != null && <span>{formatCount(video.stat.view)}{t('播放')}</span>}
          {video.play != null && <span>{formatCount(video.play)}{t('播放')}</span>}
          {video.pubdate && <span>{formatTime(video.pubdate)}</span>}
        </div>
      </div>
    </div>
  );
});
