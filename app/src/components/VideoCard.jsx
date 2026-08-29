import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { useFocusable } from '../hooks/useFocus';
import { formatCount, formatDuration, formatTime, cleanTitle } from '../utils/format';
import { thumbUrl } from '../utils/thumb';
import { storage } from '../utils/storage';
import { t } from '../i18n';
import { mark } from '../utils/perf';
import { titleMT, useTitlesMT } from '../utils/titlemt';

function getProxyBase() {
  return mediaProxyBase();
}



export default React.memo(function VideoCard({ video, focusId, row, col, group, onSelect, onLongPress, followed = false }) {
  const handleSelect = useCallback(() => {
    onSelect?.(video);
  }, [video, onSelect]);

  // 长按 OK:默认弹卡片菜单(加入/移出稍后再看)。页面可以传 onLongPress 覆盖。
  // 菜单挂在根节点(App 接 'card-menu' 事件),不从这里穿 props 到 6 个页面。
  const handleLongPress = useCallback(() => {
    if (onLongPress) { onLongPress(video); return; }
    window.dispatchEvent(new CustomEvent('card-menu', { detail: video }));
  }, [video, onLongPress]);

  const { props } = useFocusable({
    id: focusId, row, col, group, onSelect: handleSelect,
    onLongPress: handleLongPress,
  });

  // 缩略图按当前列数取尺寸(每行几个 = 卡片多宽)。
  const cols = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));

  // 图片:从卡片挂载到缩略图 onload。占位灰块停留多久,用户是直接看得见的。
  const mountT = useRef((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  const imgRef = useRef(null);

  // Non-zh UIs machine-translate card titles (no-op subscription on zh).
  useTitlesMT();

  // Refresh the resume bar when the player exits (fires once per exit).
  const [, bumpProgress] = useReducer(x => x + 1, 0);
  useEffect(() => storage.onProgressChange(bumpProgress), []);

  const thumb = thumbUrl(video.pic || video.cover || '', cols);

  return (
    <div {...props} className="video-card">
      <div className="video-card-thumb">
        {thumb && <img src={thumb} alt="" loading="lazy" decoding="async"
          ref={imgRef}
          onLoad={() => mark('img', ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - mountT.current)}
          onError={() => mark('img-fail', 0)} />}
        {video.duration != null && (
          <span className="video-card-duration">
            {typeof video.duration === 'number' ? formatDuration(video.duration) : video.duration}
          </span>
        )}
        {(() => {
          // Watch-progress bar on EVERY list (owner request). The LOCAL map is
          // this TV's live truth (written on player exit) — it outranks the
          // server annotation on history rows, which is only as fresh as the
          // page fetch ("都放一半了列表里还在一开始").
          let p = 0;
          if (video.bvid && !video.isLive) {
            const lp = storage.getProgress(video.bvid);
            if (lp) p = lp.progress / lp.duration;
          }
          if (!p && video.progress > 0 && video.duration > 0) {
            p = video.progress / video.duration;
          }
          if (!(p > 0)) return null;
          return (
            // Blue again (owner) — readable now that the focus ring wraps the
            // whole card instead of ending at the thumb's bottom edge.
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 5,
              background: 'rgba(255,255,255,0.25)',
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
