// Regression: 三连后按钮点亮状态(app/src/player/tripleState.js)。
// 证据:owner 2026-08-09 报「一键三连之后,只有收藏的数字的颜色变了,另外两个怎么不变」。
// 复现条件 = 这个视频之前已经赞过/投过币,三连接口只回 {like:false,coin:false,fav:true},
// 而老代码把"这次做了什么"当成"最终是什么状态"来 OR。下面第 2、3 条就是那个场景,
// 在旧逻辑下必挂。
// Run: node tools/test-triplestate.mjs   (exit 0 = pass)
import { tripleNextRel, tripleNextStat, mergeServerRel } from '../app/src/player/tripleState.js';

const DARK = { liked: false, coined: 0, faved: false };
const allLit = (r) => r.liked && r.coined > 0 && r.faved;

const tests = [
  ['全新三连 → 三项全亮',
    allLit(tripleNextRel(DARK, { like: true, coin: true, fav: true, multiply: 2 }))],

  // ↓ owner 报的那个 bug:之前已赞已投,本次只新增收藏
  ['之前已赞已投(接口只回 fav)→ 仍然三项全亮',
    allLit(tripleNextRel(DARK, { like: false, coin: false, fav: true }))],

  ['本地状态是空的(relation 请求失败)→ 三连后照样全亮',
    allLit(tripleNextRel(undefined, { like: false, coin: false, fav: true }))],

  ['投币数封顶 2',
    tripleNextRel({ liked: true, coined: 2, faved: true }, { coin: true, multiply: 2 }).coined === 2],

  // 计数是另一套语义:只加这次真做了的,已经赞过的不能再 +1
  ['计数:已赞过 → like 不再 +1',
    tripleNextStat({ like: 100, coin: 10, favorite: 5 }, { liked: true, coined: 2, faved: false },
      { like: false, coin: false, fav: true }).like === 100],
  ['计数:本次新增收藏 → favorite +1',
    tripleNextStat({ like: 100, coin: 10, favorite: 5 }, { liked: true, coined: 2, faved: false },
      { like: false, coin: false, fav: true }).favorite === 6],
  ['计数:本次投 2 币 → coin +2',
    tripleNextStat({ like: 1, coin: 8, favorite: 1 }, DARK,
      { like: true, coin: true, fav: true, multiply: 2 }).coin === 10],

  // 服务端校准只能往上合并 —— 直接覆盖会把刚写成功的状态按回去
  ['校准:服务端还没同步(全 false)也不会把已亮的按灭',
    allLit(mergeServerRel({ liked: true, coined: 2, faved: true },
      { like: false, coin: 0, favorite: false }))],
  ['校准:服务端说已赞已投已藏 → 从暗变亮',
    allLit(mergeServerRel(DARK, { like: true, coin: 2, favorite: true }))],
  ['校准:字段名以实测为准(favorite 不是 fav)',
    mergeServerRel(DARK, { favorite: true }).faved === true],
];

let fail = 0;
for (const [name, ok] of tests) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
