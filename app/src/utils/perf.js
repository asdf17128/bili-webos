// 轻量性能记录器。目标是"能测出用户感知到的等待",而不是收集一堆好看的指标。
//
// 三条硬约束(owner 2026-08-29:"还需要考虑性能和机器硬件消耗的平衡"):
//  1. **记录本身不能成为负担**:只存定长环形数组(200 条),不存对象树、不做
//     字符串拼接、不 JSON.stringify;单条记录 = 一次 performance.now() + 一次写入。
//  2. **不依赖新 API**:用户机器上跑的是 Chromium 68/79(owner 的 C4 是 120)。
//     PerformanceObserver 的 longtask/event 在老机器上没有,所以核心指标一律用
//     performance.now() 在明确的代码点打点,老新机器都成立。
//  3. **默认不占内存**:环形数组固定 200 条 × 3 个数字字段,几 KB 量级,
//     且不随运行时间增长。
//
// 读法:CDP 里 window.__perf.dump() → 工具侧算分位数(tools/perf.mjs)。

const CAP = 200;
const buf = new Array(CAP);
let head = 0;
let n = 0;

const now = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() : Date.now());

// 记一条:kind = 指标名,ms = 耗时,extra = 一个数字(可选,比如条数)
export function mark(kind, ms, extra) {
  buf[head] = { k: kind, ms: Math.round(ms * 10) / 10, x: extra == null ? 0 : extra, t: Math.round(now()) };
  head = (head + 1) % CAP;
  if (n < CAP) n++;
}

// 计时器:t = start('grid-page'); …; t()  —— 闭包比全局 Map 便宜,也不会泄漏
export function start(kind) {
  const t0 = now();
  return (extra) => { mark(kind, now() - t0, extra); };
}

// 下一帧真正画完之后再记 —— 这才是"用户看到"的时刻。
// 单个 rAF 只保证"下一帧开始前",双 rAF 才跨过这一帧的绘制。
export function markAfterPaint(kind, t0, extra) {
  if (typeof requestAnimationFrame !== 'function') { mark(kind, now() - t0, extra); return; }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { mark(kind, now() - t0, extra); });
  });
}

function dump() {
  const out = [];
  for (let i = 0; i < n; i++) out.push(buf[(head - n + i + CAP) % CAP]);
  return out;
}

// 内存快照:webOS 上 performance.memory 是有的(非标准但 Chromium 系都给)。
// 优化时必须和耗时一起看,否则很容易用"缓存一切"把 2GB 的机器拖垮。
function memory() {
  const m = typeof performance !== 'undefined' && performance.memory;
  if (!m) return null;
  return { used: Math.round(m.usedJSHeapSize / 1048576), total: Math.round(m.totalJSHeapSize / 1048576) };
}

if (typeof window !== 'undefined') {
  window.__perf = {
    dump, memory, mark,
    clear() { head = 0; n = 0; },
    // 长任务(>50ms 主线程阻塞)= 卡顿的直接证据。老引擎没有这个 API,
    // 拿不到就返回 null,报告里如实标注"该机型无法观测",不假装有数据。
    longTasks: null,
  };
  try {
    if (typeof PerformanceObserver === 'function' &&
        PerformanceObserver.supportedEntryTypes &&
        PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0) {
      const lt = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          lt.push(Math.round(e.duration));
          if (lt.length > 100) lt.shift();
        }
      }).observe({ entryTypes: ['longtask'] });
      window.__perf.longTasks = () => lt.slice();
    }
  } catch (e) { /* 老引擎:保持 null */ }
}
