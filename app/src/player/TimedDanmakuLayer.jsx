import React, { memo } from 'react';
import DanmakuLayer from './DanmakuLayer';
import { useMediaClock } from './useMediaClock';

export default memo(function TimedDanmakuLayer(props) {
  const { currentTime } = useMediaClock(props.videoRef, props.enabled);
  return <DanmakuLayer {...props} currentTime={currentTime} />;
});
