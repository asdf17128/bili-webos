// 性能优化的运行时开关。
//
// 为什么要有:做 A/B 对照时,如果靠 git stash 把优化收起来,**打点也一起没了**
// (两者在同一批文件里),对照那一栏直接全是"无样本"(2026-08-30 踩过)。
// 放在开关后面,同一个构建、同一套打点,只翻开关 —— 这才是可比的对照。
//
// 默认全开;测试时用 localStorage 关掉:
//   localStorage.setItem('bili_perfopt', JSON.stringify({prefetchPage:false}))
let flags = null;
export function perfFlag(name) {
  if (flags === null) {
    flags = {};
    try { flags = JSON.parse(localStorage.getItem('bili_perfopt') || '{}') || {}; } catch (e) { flags = {}; }
  }
  // prefetch2Rows 默认**关**:实测两行相对一行没有增益(358.7 vs 360.1ms),
  // 白多占带宽和解码内存。其余开关默认开。
  if (name === 'prefetch2Rows' || name === 'thumbSmall' || name === 'unloadOffscreen') return flags[name] === true;   // 默认关,待 A/B 定夺
  return flags[name] !== false;   // 只有显式 false 才关
}

// ── 预取闸门 ────────────────────────────────────────────────
// 实测教训(2026-08-30,6× 降速对照):无节制预取会**把机器拖垮**——
// 翻页确实从 279ms 降到 36ms,但图片 285→575ms、播放器首帧 1850→4185ms、
// 长任务 310ms→3041ms。原因是预取在慢 CPU 上跟当前可见内容抢主线程和带宽。
//
// 规则:预取是"闲时才做的事"。只要前台有重活(播放器开着、页面正在加载),
// 闸门就关上;而且**同一时刻只允许一个预取在飞**,不排队堆积。
let gateReasons = 0;
let inFlight = 0;

export function holdPrefetch() {          // 前台开始重活
  gateReasons++;
  return () => { gateReasons = Math.max(0, gateReasons - 1); };
}

export function canPrefetch() {
  return gateReasons === 0 && inFlight === 0;
}

export function trackPrefetch(promiseLike) {
  inFlight++;
  const done = () => { inFlight = Math.max(0, inFlight - 1); };
  if (promiseLike && promiseLike.then) promiseLike.then(done, done);
  else done();
  return promiseLike;
}
