// 缩略图 URL:按**实际显示宽度**取图,卡片和预取共用同一份逻辑
// (两边各算一次会导致预取的 URL 和真正加载的对不上,预取就白做了)。
//
// 实测账(C4 真机 2026-08-29):4 列时卡片显示宽 392px,原来一律拉 672w。
// 除了多传字节,更贵的是解码后的位图常驻内存(宽×高×4):
//   672×420 = 1.1MB/张   vs   420×264 = 0.44MB/张
// 一屏十几张就是几 MB,对 deviceMemory=2GB 的电视是实打实的负担。
import { mediaProxyBase } from '../api/client';
import { perfFlag } from './perfFlags';

// 两档尺寸,用开关对照:真机 CPU 采样显示主线程 66% 空闲、我们的 JS 只占 ~250ms,
// 而引擎内部(布局/绘制/**图片解码**)占了 2169ms —— 继续优化 JS 没意义,
// 减少解码量才是杠杆。small 档按显示宽的 0.86× 取图(3 米外看不出差别)。
const THUMB_W = { 2: 720, 3: 540, 4: 420 };
const THUMB_W_SMALL = { 2: 600, 3: 450, 4: 336 };

export function thumbUrl(pic, cols) {
  if (!pic) return '';
  let u = pic.startsWith('//') ? 'https:' + pic : pic;
  if (u.includes('hdslb.com') && !u.includes('@')) {
    const table = perfFlag('thumbSmall') ? THUMB_W_SMALL : THUMB_W;
    const w = perfFlag('thumbRightsize') ? (table[cols] || 540) : 672;
    u += `@${w}w_${Math.round(w / 1.6)}h_1c.webp`;
  }
  try {
    const p = new URL(u);
    return `${mediaProxyBase()}/proxy/${p.host}${p.pathname}${p.search}`;
  } catch (e) {
    return u;
  }
}
