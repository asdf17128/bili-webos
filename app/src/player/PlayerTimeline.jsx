import React, { memo } from 'react';
import { useMediaClock } from './useMediaClock';
import { t } from '../i18n';
import { formatDuration } from '../utils/format';
import { titleMT, useTitlesMT } from '../utils/titlemt';

export default memo(function PlayerTimeline({ videoRef, visible, chapters, scrubTarget, progressElRef, queueOrApplySeek, hideControlsLater }) {
  useTitlesMT();
  const { currentTime, duration } = useMediaClock(videoRef, visible);
  const selecting = scrubTarget != null;
  const displayTime = selecting ? scrubTarget : currentTime;
  const progress = duration > 0 ? Math.min(100, Math.max(0, displayTime / duration * 100)) : 0;
  return <>
        <div className="player-timeline-meta">
          <span className="player-time">
            {formatDuration(displayTime)} / {formatDuration(duration)}
            {(() => {
              const ch = chapters.find(c => currentTime >= c.from && currentTime < c.to);
              return ch ? <span style={{ color: '#7ecbff', marginLeft: 10 }}>· {titleMT(ch.content)}</span> : null;
            })()}
          </span>
        </div>
        <div ref={progressElRef} className={`player-progress-bar ${selecting ? 'scrubbing focused' : ''}`} style={{ cursor: 'pointer' }}
          role="slider" aria-label={t('播放进度')} aria-valuemin={0} aria-valuemax={Math.floor(duration) || 0}
          aria-valuenow={Math.floor(displayTime)} aria-valuetext={formatDuration(displayTime)} tabIndex={-1}
          onClick={(e) => {
            // Pointer click-to-seek: generous target courtesy of the row itself.
            if (!(duration > 0)) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            queueOrApplySeek(frac * duration);
            hideControlsLater();
          }}>
          <div className="player-progress-fill" style={{ width: `${progress}%` }} />
          {/* Chapter boundaries (YouTube-style segment gaps) */}
          {chapters.length > 1 && duration > 0 && chapters.slice(1).map((c, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${(c.from / duration) * 100}%`, top: 0,
              width: 3, height: '100%', background: 'rgba(0,0,0,0.85)',
            }} />
          ))}
          {scrubTarget != null && duration > 0 && (
            <div className="player-progress-cursor" style={{ left: `${progress}%` }} />
          )}
        </div>
  </>;
});
