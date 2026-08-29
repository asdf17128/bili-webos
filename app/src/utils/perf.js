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

// 按**指标分桶**存,每桶各自定长。
// 教训(2026-08-31 真机):原来是一个 200 条的大环形数组,结果一屏 173 张图片
// 的打点把翻页记录整个挤掉了,报告里显示"无样本"——观测工具自己把数据吃了。
const CAP_PER_KIND = 60;
const buckets = Object.create(null);

const now = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() : Date.now());

export function mark(kind, ms, extra) {
  let b = buckets[kind];
  if (!b) b = buckets[kind] = { arr: new Array(CAP_PER_KIND), head: 0, n: 0 };
  b.arr[b.head] = { k: kind, ms: Math.round(ms * 10) / 10, x: extra == null ? 0 : extra };
  b.head = (b.head + 1) % CAP_PER_KIND;
  if (b.n < CAP_PER_KIND) b.n++;
}

export function start(kind) {
  const t0 = now();
  return (extra) => { mark(kind, now() - t0, extra); };
}

export function markAfterPaint(kind, t0, extra) {
  if (typeof requestAnimationFrame !== 'function') { mark(kind, now() - t0, extra); return; }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { mark(kind, now() - t0, extra); });
  });
}

function dump() {
  const out = [];
  for (const k in buckets) {
    const b = buckets[k];
    for (let i = 0; i < b.n; i++) out.push(b.arr[(b.head - b.n + i + CAP_PER_KIND) % CAP_PER_KIND]);
  }
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
    clear() { for (const k in buckets) delete buckets[k]; },
    // 长任务(>50ms 主线程阻塞)= 卡顿的直接证据。老引擎没有这个 API,
    // 拿不到就返回 null,报告里如实标注"该机型无法观测",不假装有数据。
    longTasks: null,
  };
  try {
    if (typeof PerformanceObserver === 'function' &&
        PerformanceObserver.supportedEntryTypes &&
        PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0) {
      const lt = [];
      const attr = Object.create(null);     // 归因:哪类容器贡献了多少毫秒
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          lt.push(Math.round(e.duration));
          if (lt.length > 100) lt.shift();
          // Chrome 120 会给 attribution(老引擎没有,拿不到就算 unknown)。
          const a = (e.attribution && e.attribution[0]) || null;
          const kkey = a ? (a.containerType || 'window') + ':' + (a.containerName || a.containerSrc || '-') : 'unknown';
          attr[kkey] = (attr[kkey] || 0) + Math.round(e.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
      window.__perf.longTasks = () => lt.slice();
      window.__perf.longTaskAttribution = () => Object.assign({}, attr);
    }
  } catch (e) { /* 老引擎:保持 null */ }
}
