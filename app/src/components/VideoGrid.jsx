import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import VideoCard from './VideoCard';
import { t } from '../i18n';

// Use transform:translateY for scrolling instead of overflow:scroll
// This pushes scroll to GPU compositor, avoiding layout recalculation
export default React.memo(function VideoGrid({ videos, group = 'content', startRow = 0, cols = 2, onSelect, focusRow = 0, followedMids = null }) {
  if (!videos || videos.length === 0) {
    return <div className="empty-state">{t('暂无内容')}</div>;
  }

  // Scroll offset for the focused row. The row pitch used to be a FORMULA
  // (620/cols + 110), which is off by a few px against the real layout — the
  // error accumulates per row, so deep rows drifted above the viewport
  // (measured on-device: focused card top -33px by row 11 at 4 cols). Measure
  // the real pitch from two adjacent rows instead and fall back to the formula
  // only before the first measurement.
  const gridRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);
  // Scroll to the focused row's ACTUAL position instead of row×rowHeight.
  // Rows are not uniform — a 2-line card title makes that row taller — so any
  // single pitch (the old 620/cols+110 formula, or a measured one) accumulates
  // error and eventually clips the focused card (owner 2026-07-30: "滚动到最上
  // 面的时候会丢一小部分内容"). Reading the row's own offsetTop is exact, and
  // it also clamps naturally at the end of the list.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || !el.children.length) return;
    const first = el.children[0];
    const target = el.children[Math.min(focusRow * cols, el.children.length - 1)];
    if (!target) return;
    // Leave a sliver of the previous row on screen whenever we're not at the
    // very top, so "there is more above" is visible instead of implied (owner
    // 2026-07-30). At row 0 there's nothing above, so no peek — the top edge
    // itself is the signal. The bottom needs no counterpart: the focused row
    // sits near the top, so following rows are always in view, and the
    // maxScroll clamp makes the last row land flush at the end.
    const PEEK = focusRow > 0 ? 46 : 0;
    const want = Math.max(0, target.offsetTop - first.offsetTop - PEEK);
    const maxScroll = Math.max(0, el.scrollHeight - 1080);
    const next = Math.min(want, maxScroll);
    setScrollY(prev => (Math.abs(prev - next) > 1 ? next : prev));
  }, [focusRow, cols, videos.length]);

  return (
    <div style={{
      height: '1080px',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div ref={gridRef} className={`video-grid cols-${cols}`} style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '24px',
        padding: '24px 40px',
        transform: `translateY(-${scrollY}px)`,
        transition: 'transform 0.2s ease',
        willChange: 'transform',
      }}>
        {videos.map((video, idx) => {
          const row = startRow + Math.floor(idx / cols);
          const col = idx % cols;
          const bvid = video.bvid || video.bv_id;
          return (
            <VideoCard
              key={bvid || `v-${row}-${col}`}
              video={video}
              focusId={`${group}-${row}-${col}`}
              row={row}
              col={col}
              group={group}
              onSelect={onSelect}
              followed={!!(followedMids && video.owner?.mid && followedMids.has(video.owner.mid))}
            />
          );
        })}
      </div>
    </div>
  );
});
