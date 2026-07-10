# 项目开发指导(bili_webos)

一句话:**每次开发完成,必须沉淀带事实佐证的测试 case 进登记簿;每次发布前,必须跑门禁回归。**

## 开发循环(每个功能/修复都走一遍)

```
1. 开发     按 docs/DESIGN.md(UI)与 tv-test skill(兼容/工具)约束写代码
            新增 UI 文案一律 t('中文') 包裹 + 同步 app/src/i18n/en.js(i18n 规矩,见下)
2. 验证     按验证纪律实测(见下),拿到"事实佐证"
3. 沉淀     把验证过的场景写进 docs/TESTCASES.md(带佐证,能自动化的进 verify.sh)
4. 门禁     发布前跑回归(见下),全绿或逐条人工解释后才 gh release
5. 复盘     踩到新坑 → 追加到 .claude/skills/tv-test/SKILL.md
```

## 验证纪律(case 的"事实佐证"从哪来)

一个 case 只有两种合法出身,写进 TESTCASES.md 时必须注明是哪种:

1. **它抓过真 bug** —— 注明 issue/事故(如 C-SVC-01 之于 webOS 5 全挂);
2. **做过正对照** —— 在坏版本(`git checkout <旧commit> -- <文件>` 部署)上用同一
   方法复现失败,再在新版确认通过(如 C-FOCUS-01 的 0→8 漂移对照)。

只写"理论上应该对"的 case **不收录** —— 那是没测。**没法测试的功能不允许上线**
(owner 规矩,2026-07-10):验证不了就先补测试能力 —— 允许为可测试性开发专门的
测试钩子(如 `window.__openVideo` 深链直达,见 tv-test skill),而不是降低标准。配套纪律(血泪版全文在 tv-test skill):
失败路径必测;结果反常先验工具;交互语义用受信输入(Playwright);悬浮 UI 看像素不是 rect;
时序敏感操作单 CDP 会话内完成。

## i18n 规矩(2026-07 起,owner 指示:后续加功能必须考虑 i18n)

1. 所有用户可见文案用 `t('中文')` 包裹(**单引号**,覆盖率门禁靠它提取);
   键同步加进 `app/src/i18n/en.js` —— 漏了会被 tools/test-i18n-coverage.mjs 挡下。
2. 数字/时间格式化走 `utils/format.js`(locale 感知),不在组件里硬拼中文单位。
3. 门禁盲区:**没包 t() 的裸中文串抓不到**(覆盖率只查已包裹的键)——
   code review 时人工过一眼新增 jsx 里的中文字面量。
4. 不翻译的例外(有意为之):API 返回的内容文本、'番剧' 等与 API 值比较的徽标、
   二维码 ASCII 报告、service 端错误串。

**加一门语言的完整清单**(2026-07-10 以 es 实测,共 5 处):
1. `app/src/i18n/<code>.js` —— 抄 en.js 全量翻译(含字幕轨道名等动态键);
2. `i18n/index.js` DICTS 注册(一行 import + 一行);
3. `player/subtitles.js` MT_NAMES 加 `<code>: '<语言名>(机翻)'`,且该中文名要加进
   **其他所有字典**(coverage/lan-name 门禁会挡漏);
4. `ConfigPage.jsx` LANG_LABELS 加自称名(endonym,如 'Español');
5. `tools/test-i18n-format.mjs` 补该 locale 的格式化断言。
门禁自动兜住 1/3;4/5 靠本清单。字幕/标题/章节机翻自动获得该语言(gtx tl=<code>)。

## 发布门禁(gh release 前的硬性检查单)

```bash
bash tools/verify.sh --full     # 六层:语法→静态规范/逻辑→真Node8→构建→部署→真机+UI smoke
```

1. 🤖 自动层全绿(任何 FAIL = 不发,先修);
2. test-ui 若有失败:对照 TESTCASES.md"已知 flaky"清单 —— 在列的**人工核对**后可放行,
   不在列的一律当真回归处理;
3. 本次改动**触碰过的领域**,把 TESTCASES.md 中对应的 📜/👁 case 跑一遍
   (如动了播放器 → C-PLAY-03~08;动了焦点 → C-FOCUS-*;动了投屏 → C-CAST-01 需手机);
4. 涉及 UI 的改动:真机截图**当用户视角逐像素过目**(v1.2.7 黑封面就是只看断言没看图);
5. 发布节奏:改动攒批、部署给 owner 过目、点头再发(feedback_release_pace)。

## 文档地图

| 文件 | 职责 |
|---|---|
| docs/DEVELOPMENT.md | 本文件:开发循环 + 门禁定义 |
| docs/TESTCASES.md | 回归 case 登记簿(带佐证,发布前照单回归) |
| docs/DESIGN.md | 10-foot 设计规范(字号/颜色/焦点/兼容底线) |
| tools/verify.sh | 门禁执行入口(自动层) |
| .claude/skills/tv-test | 测试方法论 + 工具箱 + 坑(每踩新坑必追加) |
