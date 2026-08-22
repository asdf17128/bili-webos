// Regression: 直播解码失败降档(app/src/player/liveQnLadder.js)。
// 证据:owner 2026-08-22「直播黑屏了」。现场 CDP 抓到 connect → media-error{code:3}
// → retry 同一 qn → media-error 的死循环 —— B站 房间当时**没有任何降档**
// (variant 阶梯只对投屏 directUrl 生效)。这条路没法按需复现,故做纯函数覆盖。
import { shouldStepDown, nextQn, MEDIA_ERR_DECODE } from '../app/src/player/liveQnLadder.js';
const L = [10000, 400, 250, 150, 80];   // 原画 → 蓝光 → 超清 → 高清 → 流畅
const tests = [
  ['解码错误(code 3)要降档', shouldStepDown({ isCast: false, errorCode: 3 })],
  ['网络错误(code 2)不降档,交给重试', !shouldStepDown({ isCast: false, errorCode: 2 })],
  ['格式错误(code 4)不降档', !shouldStepDown({ isCast: false, errorCode: 4 })],
  ['投屏流不走这套降档(它有自己的 variant 阶梯)', !shouldStepDown({ isCast: true, errorCode: 3 })],
  ['没有 error 对象时不降档', !shouldStepDown({ isCast: false, errorCode: undefined })],
  ['原画 → 蓝光', nextQn(L, 10000) === 400],
  ['蓝光 → 超清', nextQn(L, 400) === 250],
  ['已在最低档 → null(不再退)', nextQn(L, 80) === null],
  ['阶梯为空 → null(不乱退)', nextQn([], 10000) === null],
  ['当前档不在表里 → 回到最高档重来', nextQn(L, 99999) === 10000],
  ['MEDIA_ERR_DECODE 常量就是 3', MEDIA_ERR_DECODE === 3],
];
let fail = 0;
for (const [n, ok] of tests) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
