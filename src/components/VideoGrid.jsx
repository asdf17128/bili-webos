import React from 'react';
import VideoCard from './VideoCard';

// Use transform:translateY for scrolling instead of overflow:scroll
// This pushes scroll to GPU compositor, avoiding layout recalculation
export default React.memo(function VideoGrid({ videos, group = 'content', startRow = 0, cols = 2, onSelect, focusRow = 0 }) {
  if (!videos || videos.length === 0) {
    return <div className="empty-state">暂无内容</div>;
  }

  // Calculate scroll offset based on which row is focused
  // Each row: card ~480px (16:9 at ~540px wide = 304px thumb + 90px info + 24px gap) ≈ 420px
  const ROW_HEIGHT = 420;
  const scrollY = Math.max(0, (focusRow - 0) * ROW_HEIGHT);

  return (
    <div style={{
      height: '1080px',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
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
            />
          );
        })}
      </div>
    </div>
  );
});
