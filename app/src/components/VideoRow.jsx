import React from 'react';
import VideoCard from './VideoCard';

export default React.memo(function VideoRow({ title, videos, rowIndex, group, onSelect }) {
  return (
    <div style={{ marginTop: 8 }}>
      {title && <div className="section-title">{title}</div>}
      <div style={{ display: 'flex', gap: 20, padding: '10px 36px', overflow: 'hidden' }}>
        {videos.map((video, idx) => {
          const bvid = video.bvid || video.bv_id;
          return (
            <VideoCard
              key={bvid || `v-${rowIndex}-${idx}`}
              video={video}
              focusId={`${group}-${rowIndex}-${idx}`}
              row={rowIndex}
              col={idx}
              group={group}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
});
