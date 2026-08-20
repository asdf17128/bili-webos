// Regression: 接口错误码 → 用户提示(app/src/utils/apiHint.js)。
// 证据:issue #20 / #23 两位用户都只看到 `playurl code=-351` 或泛泛的"视频加载失败",
// 不知道那是风控、也不知道登录通常能解决。映射错一个码,用户就白白卡住。
// Run: node tools/test-apihint.mjs
process.env.NODE_ENV = 'test';
const { apiErrorHint } = await import('../app/src/utils/apiHint.js');
const has = (c, kw) => { const s = apiErrorHint(c); return !!s && s.includes(kw); };
const tests = [
  ['-351 提示风控且提到登录', has(-351, '登录')],
  ['-352 同样提示风控', has(-352, '风控')],
  ['-351 提到换 CDN 线路(海外用户的第二条路)', has(-351, 'CDN')],
  ['-10403 提示地区限制', has(-10403, '地区')],
  ['-404 提示稿件失效', has(-404, '稿件')],
  ['-403 提示权限/大会员', has(-403, '权限')],
  ['未知码返回 null(调用方回落默认文案)', apiErrorHint(-999) === null],
  ['code=0 也返回 null', apiErrorHint(0) === null],
];
let fail = 0;
for (const [n, ok] of tests) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
