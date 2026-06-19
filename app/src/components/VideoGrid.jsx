import React, { useMemo } from 'react';
import VideoCard from './VideoCard';

// Use transform:translateY for scrolling instead of overflow:scroll
// This pushes scroll to GPU compositor, avoiding layout recalculation
export default React.memo(function VideoGrid({ videos, group = 'content', startRow = 0, cols = 2, onSelect, focusRow = 0, followedMids = null }) {
  if (!videos || videos.length === 0) {
    return <div className="empty-state">暂无内容</div>;
  }

  // Calculate scroll offset based on which row is focused. Row height scales
  // with column count: at 2 cols a row is ~420px; with more (smaller) cards the
  // 16:9 thumbnail shrinks ∝ 1/cols, so a row gets shorter. (620/2+110 = 420.)
  const ROW_HEIGHT = Math.round(620 / cols) + 110;
  const scrollY = Math.max(0, (focusRow - 0) * ROW_HEIGHT);

  return (
    <div style={{
      height: '1080px',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div className={`video-grid cols-${cols}`} style={{
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
