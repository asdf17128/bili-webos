import React from 'react';
import { useFocusable } from '../hooks/useFocus';
import { formatCount, formatDuration, formatTime } from '../utils/format';
import { buildProxyUrl } from '../utils/proxy';

function proxyImg(url) {
  if (!url) return '';
  let u = url.startsWith('//') ? 'https:' + url : url;
  if (u.includes('hdslb.com') && !u.includes('@')) {
    u += '@672w_420h_1c.webp';
  }
  try {
    return buildProxyUrl(u);
  } catch {
    return u;
  }
}

export default React.memo(function VideoCard({ video, focusId, row, col, group, onSelect }) {
  const { props } = useFocusable({
    id: focusId, row, col, group, onSelect: () => onSelect?.(video),
  });

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
        {video.progress > 0 && video.duration > 0 && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
            background: 'rgba(255,255,255,0.2)',
          }}>
            <div style={{
              height: '100%', background: '#00a1d6',
              width: `${Math.min(100, (video.progress / video.duration) * 100)}%`,
            }} />
          </div>
        )}
      </div>
      <div className="video-card-info">
        <div className="video-card-title">{video.title}</div>
        <div className="video-card-meta">
          {video.owner?.name && <span>{video.owner.name}</span>}
          {video.stat?.view != null && <span>{formatCount(video.stat.view)}播放</span>}
          {video.play != null && <span>{formatCount(video.play)}播放</span>}
          {video.pubdate && <span>{formatTime(video.pubdate)}</span>}
        </div>
      </div>
    </div>
  );
});
