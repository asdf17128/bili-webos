import React, { useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { thumbUrl } from '../utils/thumb';
import { perfFlag, canPrefetch } from '../utils/perfFlags';
import { onFocusChange, isHoverDriven } from '../hooks/useFocus';
import VideoCard from './VideoCard';
import { t } from '../i18n';

// Use transform:translateY for scrolling instead of overflow:scroll
// This pushes scroll to GPU compositor, avoiding layout recalculation
export default React.memo(function VideoGrid({ videos = [], group = 'content', startRow = 0, cols = 2, onSelect, focusRow = 0, followedMids = null, footer = null, upTarget = null, header = null }) {

  // Scroll offset for the focused row. The row pitch used to be a FORMULA
  // (620/cols + 110), which is off by a few px against the real layout — the
  // error accumulates per row, so deep rows drifted above the viewport
  // (measured on-device: focused card top -33px by row 11 at 4 cols). Measure
  // the real pitch from two adjacent rows instead and fall back to the formula
  // only before the first measurement.
  const gridRef = useRef(null);
  const viewportRef = useRef(null);
  // 滚动**不进 React**:焦点系统早就做成零渲染了(直接改 classList),
  // 滚动却还留在 state 里 —— 每按一次方向键要把 100+ 张卡片渲染两遍
  // (setFocusRow 一次 + setScrollY 一次)。实测跟手 p50 29ms / p95 92ms。
  // 现在由 VideoGrid 自己监听焦点变化,算完直接写 transform。
  const scrollRef = useRef(0);
  // Scroll to the focused row's ACTUAL position instead of row×rowHeight.
  // Rows are not uniform — a 2-line card title makes that row taller — so any
  // single pitch (the old 620/cols+110 formula, or a measured one) accumulates
  // error and eventually clips the focused card (owner 2026-07-30: "滚动到最上
  // 面的时候会丢一小部分内容"). Reading the row's own offsetTop is exact, and
  // it also clamps naturally at the end of the list.
  // 把"滚到第 N 行"这件事抽成纯 DOM 操作(几何算法与之前逐字一致:读真实
  // offsetTop、留 46px peek、按 scrollHeight-1080 夹住)。
  const scrollToRow = useCallback((gridRow) => {
    const el = gridRef.current;
    const viewportHeight = viewportRef.current?.clientHeight;
    if (!el || !el.children.length || !viewportHeight) return;
    const first = el.querySelector('.video-card');
    const target = gridRow < 0 ? el.firstElementChild : el.querySelector(`[data-focus-id="${group}-${startRow + gridRow}-0"]`) || el.lastElementChild;
    if (!target) return;
    // Leave a sliver of the previous row on screen whenever we're not at the
    // very top, so "there is more above" is visible instead of implied (owner
    // 2026-07-30). At row 0 there's nothing above, so no peek — the top edge
    // itself is the signal. The bottom needs no counterpart: the focused row
    // sits near the top, so following rows are always in view, and the
    // maxScroll clamp makes the last row land flush at the end.
    const PEEK = gridRow > 0 ? 46 : 0;
    // A resume shelf is part of this scroll surface. Inserting it after a slow
    // history response must keep a deep focused card at the same screen Y.
    const want = gridRow < 0 ? 0 : gridRow === 0
      ? Math.max(0, target.offsetTop + target.offsetHeight + 16 - viewportHeight)
      : Math.max(0, target.offsetTop - (header ? 24 : first.offsetTop) - PEEK);
    const maxScroll = Math.max(0, el.scrollHeight - viewportHeight);
    const next = Math.min(want, maxScroll);
    if (Math.abs(scrollRef.current - next) <= 1) return;
    scrollRef.current = next;
    el.style.transform = `translateY(-${next}px)`;
  }, [cols, group, startRow, !!header]);

  // 焦点落到本网格的某一行 → 直接滚过去,不经过 React。
  useEffect(() => (perfFlag('scrollDirect') ? onFocusChange((fid) => {
    if (!fid || isHoverDriven()) return;
    const m = fid.match(/^(.+?)-(-?\d+)-(\d+)$/);
    if (!m || m[1] !== group) return;
    const gridRow = parseInt(m[2]) - startRow;
    if (gridRow < 0 && !(header && gridRow === -1)) return;
    lastRowRef.current = gridRow;
    scrollToRow(gridRow);
  }) : undefined), [group, startRow, scrollToRow, !!header]);

  // 列表增删/首次渲染后按当前行复位(翻页追加、切换分区都会走这里)
  const lastRowRef = useRef(0);
  useLayoutEffect(() => { scrollToRow(lastRowRef.current); }, [videos.length, cols, scrollToRow]);

  // 外部显式指定行(收藏页切夹子后回到顶部)时跟随
  useLayoutEffect(() => { lastRowRef.current = focusRow; scrollToRow(focusRow); }, [focusRow]);

  useEffect(() => {
    const update = () => scrollToRow(lastRowRef.current);
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (observer && viewportRef.current) observer.observe(viewportRef.current);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [scrollToRow]);

  // 预取:焦点行往下两行的缩略图提前开始下载。
  // 实测(C4 真机 2026-08-29):"卡片挂载→图片显示" p50 638ms,而请求本身只要
  // 254ms —— 差的 ~384ms 是浏览器的懒加载在等元素接近视口。往下两行提前发,
  // 用户翻到时图基本已经在了。
  // **有界**:每次最多 2 行(6-8 张),用完即弃,不做长期缓存 —— 在
  // deviceMemory=2GB 的电视上,"缓存一切"是拿内存换卡顿(owner 的平衡要求)。
  const prefetched = useRef(new Set());
  useEffect(() => {
    if (typeof Image === 'undefined' || !perfFlag('prefetchThumbs')) return;
    if (!canPrefetch()) return;          // 播放器开着等重活时不抢带宽
    const from = (lastRowRef.current + 1) * cols;
    // 预取行数:早先"两行"会抢带宽(那时既没有闸门、没有防抖,代理也不给缓存头)。
    // 三者都补上之后重新试两行 —— 用 prefetchRows 开关做 A/B。
    const rows = perfFlag('prefetch2Rows') ? 2 : 1;   // 实测两行无增益,默认一行(省带宽/内存)
    const to = Math.min(videos.length, from + cols * rows);
    // **停稳才预取**:连续按方向键时不要在按键那一刻做任何额外工作。
    // 真机实测(2026-08-31):不做防抖时跟手 p50 从 24.5 退到 30.2ms ——
    // 预取抢了按键→绘制这条关键路径。停 200ms 说明用户在看这一行了,
    // 这时候再去取下一行的图,既不抢手感又赶得上。
    const idle = (fn) => (typeof requestIdleCallback === 'function'
      ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 0));
    let cancelled = false;
    const settle = setTimeout(() => idle(() => {
      if (cancelled || !canPrefetch()) return;
      for (let i = from; i < to; i++) {
        const v = videos[i];
        const src = v && thumbUrl(v.pic || v.cover || '', cols);
        if (!src || prefetched.current.has(src)) continue;
        prefetched.current.add(src);
        const im = new Image();
        im.decoding = 'async';
        im.src = src;                      // 只是让它进 HTTP 缓存,不持有引用
      }
      // 集合本身也别无限长:超过 400 条就清掉(URL 字符串,几十 KB 量级)
      if (prefetched.current.size > 400) prefetched.current.clear();
    }), 200);
    return () => { cancelled = true; clearTimeout(settle); };
  }, [cols, videos]);

  return (
    <div ref={viewportRef} className="video-grid-viewport" style={{
      height: '100%', minHeight: 0, flex: 1,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div ref={gridRef} className={`video-grid cols-${cols}`} style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '24px',
        padding: '24px 40px',
        transform: 'translateY(0px)',
        transition: 'transform 0.2s ease',
        willChange: 'transform',
      }}>
        {header && <div className="grid-header" style={{ gridColumn: '1 / -1' }}>{header}</div>}
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
              onNavigate={upTarget && row === startRow ? direction => direction === 'up' ? upTarget : null : undefined}
              followed={!!(followedMids && video.owner?.mid && followedMids.has(Number(video.owner.mid)))}
            />
          );
        })}
        {footer && <div className="grid-footer" style={{ gridColumn: '1 / -1' }}>{footer}</div>}
        {!videos.length && <div className="empty-state">{t('暂无内容')}</div>}
      </div>
    </div>
  );
});
