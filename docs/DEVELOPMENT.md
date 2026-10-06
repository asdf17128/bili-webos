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
bash tools/verify.sh --full     # 六层:语法→静态规范/逻辑→真Node0.12/8→构建→部署→真机+UI smoke
```

1. 🤖 自动层全绿(任何 FAIL = 不发,先修);
2. test-ui 若有失败:对照 TESTCASES.md"已知 flaky"清单 —— 在列的**人工核对**后可放行,
   不在列的一律当真回归处理;
3. 本次改动**触碰过的领域**,把 TESTCASES.md 中对应的 📜/👁 case 跑一遍
   (如动了播放器 → C-PLAY-03~08;动了焦点 → C-FOCUS-*;动了投屏 → C-CAST-01 需手机);
4. 涉及 UI 的改动:真机截图**当用户视角逐像素过目**(v1.2.7 黑封面就是只看断言没看图);
5. 发布节奏:改动攒批、部署给 owner 过目、点头再发(feedback_release_pace)。
6. **每个 release 必须上传 `version.json` 资产**(`{"version":"x.y.z"}`)——
   app 每日一次的版本检查拉它,其 download_count 即日活代理
   (`gh api repos/asdf17128/bili-webos/releases --jq '...download_count'`);
   忘传则当日计数断档(app 侧静默容错,次日重试)。

## 文档地图

| 文件 | 职责 |
|---|---|
| docs/DEVELOPMENT.md | 本文件:开发循环 + 门禁定义 |
| docs/TESTCASES.md | 回归 case 登记簿(带佐证,发布前照单回归) |
| docs/DESIGN.md | 10-foot 设计规范(字号/颜色/焦点/兼容底线) |
| tools/verify.sh | 门禁执行入口(自动层) |
| docs/TV-UX.md | 侧栏刷新/位置恢复规则、2026-09-06 UX 改动与实测边界 |
| tools/test-tv-ux.mjs | 隔离夹具下的遥控器/指针/慢请求回归；`verify.sh --no-tv --ux` |
| tools/test-tv-ux-device.mjs | 真机单会话导航、刷新、深列表、暂停、快进快退、弹层和播放返回检查 |
| tools/test-tv-settings.mjs | 真机通过选择器设置 2/3/4 列与大字号，重启验证并恢复用户偏好 |
| tools/test-player-loading.mjs | 取消、重试、Luna 超时及弹幕/字幕实际 DOM 字号；`verify.sh --ux` |
| tools/test-live-loading.mjs | 直播单次取流、fMP4/TS 回退、加载提示、启动超时、解码阶梯和退出取消；`verify.sh --ux` |
| tools/probe-live-startup.js | LG 原生 HLS 的接口、playing、实际时间推进及稳定性采样 |
| tools/test-playback-health.mjs | 缓冲耗尽恢复、所选 CDN 顺序、真实 HTTP 超时/Range/取消；`verify.sh --ux` |
| tools/test-library.mjs | 收藏/合集分页映射、跨页连播、去重和网络失败 |
| tools/test-cdn-tv.mjs | 真机坏 CDN 回退、按所选线路测速、从截图解码反馈二维码；结束恢复设置 |
| app/src/player/mediaSelection.test.js | 杜比初始化段解析、格式选择与音轨回退；`verify.sh` |
| .claude/skills/tv-test | 测试方法论 + 工具箱 + 坑(每踩新坑必追加) |


## 发版(不要手搓 `gh release create`)

```bash
node tools/release.mjs v2.0.0 --notes-file notes.md
```

release 必须挂**三件**资产,少一件都会静默出事:

| 资产 | 谁在用 | 少了会怎样 |
|---|---|---|
| `com.biliwebos.app_X.Y.Z_all.ipk` | 用户安装 | 装不了(唯一看得见的故障) |
| `version.json` | app 查更新 + **我们的 DAU 计数** | 全部电视查更新 404;DAU 计数器冻死,报表却平静地显示 "+0" |
| `com.biliwebos.app.manifest.json` | webOS Homebrew 目录(`manifestUrl` 指向 `latest/download/`) | 目录侧看不到新版本,更新根本铺不出去 |

后两个的 URL 都是 `releases/latest/download/…`,所以**只要发了新 release 却没带上它们,上一版的链接也一起失效** —— 不是"新版没上",是整个通道断掉。

2026-08-31 就这么翻过一次:v1.7.0 只挂了 ipk,15 小时里更新通道和 DAU 计数全断,而 GitHub 的 release 页面看着完全正常。

`tools/release.mjs` 因此在发完之后**以外人身份**把三个 URL 都请求一遍,并核对 manifest 里的 sha256 与 ipk 一致;`--check` 可以随时单独体检线上。`tools/verify.sh` 的第 7 步也会跑它。


## webOS 4.x 兼容验证

前端生产目标为 Chromium 53，构建后额外以 ES2016 解析全部产物。CSS Grid 主布局保留，4.x 使用 `@supports not (display: grid)` 的 flex 降级。

服务代码以 ES5 解析；`tools/test-node8/test.sh` 使用校验过 SHA256 的官方 Node 0.12.2 Linux 二进制和真实 Node 8，在 x86 Docker 容器内分别启动服务。Apple Silicon 下，0.12.2 经显式 ELF loader 启动，避免旧 CLI 与模拟环境的参数兼容问题。缓存保存在临时目录，可用 `BILI_NODE012_DIR` 指定。

`UX_LEGACY_LAYOUT=1 node tools/test-tv-ux.mjs` 可在现代浏览器强制启用降级 CSS；这只能验证布局，不能代替 Chromium 53 或旧电视的解码实测。

## 模拟与真机报告

`test-sim.mjs` 使用 Chromium 和真实服务桥，`SIM_OUTPUT` 指定 JSON/截图目录；`test-ui.mjs` 使用电视 CDP，`TV_OUTPUT` 指定结果目录，`TV_TEST_FILTER` 可按测试函数名定向复测。两者均将跳过项与通过项分开记录。认证以 API 的实际登录状态为准，本地 Cookie 的存在不代表有效登录。

账号增删默认关闭。模拟套件的 `SIM_ACCOUNT_WRITES=1` 仅用于独立测试账号。真机的 `TV_ACCOUNT_WRITES=1` 使用有保护的测试流程：先取得完整原列表，只允许加入原列表不存在的固定测试视频；Luna 请求校验精确 aid，拒绝其他条目及批量清除；长按菜单也核对事件中的 aid，最后在 `finally` 清理测试视频并比对原列表顺序和成员。用户已授权账号测试时可启用；测试视频已存在、列表已满或原列表读取不完整时不写入。账号页面截图仅保存在本地，不提交到公共仓库。

### 直播启动专项

本地 Vite 启动后，`node tools/test-live-loading.mjs` 使用隔离接口及受控媒体事件验证 React 播放器失败路径；`LIVE_FILTER` 可筛选用例，`LIVE_TEST_OUTPUT` 指定 JSON 和截图目录。`node --test app/src/player/liveStream.test.js` 检查选源及同一响应的画质元数据。

真机运行 `node tools/_cdp.mjs tools/probe-live-startup.js`。可先用 `tools/eval.mjs` 设置 `window.__startupCases=[{roomid:13171605,format:'default'}]` 与 `window.__startupObserveMs=30000`；房间必须当时在播。`default` 保持生产选源，`ts`/`fmp4` 仅从真实 API 响应筛选指定格式，供同画质 A/B 对照，结束恢复请求包装与监听。报告区分接口耗时、`playing` 事件和实际播放时间推进，不包含签名播放 URL。原生视频合成层可能既无法截图，也不触发已暴露的 `requestVideoFrameCallback`，不能把时间推进称作逐帧像素测量。

`TV_LIVE_ROOM=13171605 TV_TEST_FILTER=testLiveQuality node tools/test-ui.mjs` 用遥控器切换画质并切回，等待实际播放事件；选择当前提供多档画质的房间，只有一档时报告跳过。按钮文字是当前画质（例如“原画”），不能按固定“画质”文案寻找。真机测试结束恢复设置。详细对照见 `docs/TESTCASES.md`。

### 点播自动 CDN 专项

- `node --test app/src/player/cdnAuto.test.js`：缓存时效、两次测速取较慢值、15% 切换门槛、手动优先、低缓冲/退出取消、迟到响应与原生签名保护。静态门禁已包含。
- `CDN_TEST_OUTPUT=/tmp/bili-cdn-auto node tools/test-cdn-auto.mjs`：真实 React 请求过滤器配合最小 Shaka 测试替身，检查最终发出的媒体请求、冷启动/缓存命中、暂停门控、全失败回退、网络重连与退出取消；`CDN_FILTER` 可筛选。不是实际解码测试，已加入 `verify.sh --ux`。
- `node tools/test-playback-health.mjs`：本地真实 HTTP 服务器覆盖完整 206、忽略 Range、错位/短 Range、短响应体、合法 EOF、超时及取消。自动测速只接受完整样本，不把超时前的部分下载当作成功。
- `UX_OUTPUT=/tmp/bili-cdn-tv node tools/test-cdn-tv.mjs`：真机实际解码、坏节点回退、后台测量、缓存隐私、所选节点的实际媒体响应和二维码像素解码。完成测速后 seek 到缓冲区外以确保发生新请求，同时确认播放器实例未重载。结束恢复偏好、缓存和坏节点标记。
- `TV_TEST_FILTER=testCdnSettings TV_OUTPUT=/tmp/bili-cdn-settings node tools/test-ui.mjs`：仅用遥控按键选中 HWO1、重载核对持久化、切回自动；最后恢复原设置。截图只取弹窗，避免包含账号信息。

自动模式不等待测速再起播。每个候选串行测两块 256KiB，单块超时 4 秒；完整一轮最多 12 个候选、6MiB 成功样本。暂停或缓冲不少于 15 秒才开始，低缓冲、seek、换源和退出取消，不把主动取消写为失败。成功缓存 4 小时、失败 15 分钟，当前首选超过 15 分钟复测；网络 online 事件清空缓存。缓存仅保存 host/耗时折算速度/时间/成功状态。`window.__cdnAuto()` 查看无签名诊断，实际请求节点另见播放报告。

新增镜像仅使用普通 `.bilivideo.com/upgcxcode/` 地址作为模板。Akamai-only 片源保留 API 原生 URL，不合成跨域签名；直播走自己的取流路径。`.bilivideo.cn` 可作为原生候选测速，但不作为改写模板。未知域名保留原生回退、不进入无法缓存的测速队列。

### 重试焦点、分区和海外网络

`UX_FILTER='retry|feed failure' node tools/test-tv-ux.mjs` 包含立即完成的 Promise、正常网络任务与慢响应、再次失败、主动返回侧栏、短列表及续播栏组合。`TV_TEST_FILTER=testFeedRetry node tools/test-ui.mjs` 在真机拦截推荐流的 Luna 回调制造失败与立即恢复，其他请求保持原样，结束恢复原入口。断言既看 DOM，也看只读 `window.__focusState()` 的真实注册目标，并继续按方向键验证只有一个焦点。不能把残留的白框当作成功。

`UX_FILTER='leaving search' node tools/test-tv-ux.mjs` 验证搜索页切到设置页后第一行仍可达，下/上往返不跳行。焦点注册须统一在 layout effect 中，包含原生搜索输入框的手动注册，避免旧页面延迟清理删除新页面复用的 ID。完整真机导航套件也覆盖这一转换。

`TV_TEST_FILTER=testHotAndPartition node tools/test-ui.mjs` 验证热门与六个分区的真实 API 和卡片。`tools/test-node8/run8.js` 也通过真实服务取游戏排行榜，覆盖实际请求头。排行榜的 Referer 策略在 `service/com.biliwebos.app.service/biliReferer.js`，电视服务与独立 Mac 代理共用；仅对 `api.bilibili.com/x/web-interface/ranking/v2` 使用排行榜页，其余请求沿原策略。

`REGION_SSH=<已有 SSH 别名> REGION_OUTPUT=/tmp/bili-region node tools/test-region-network.mjs` 通过已有 SSH 主机做匿名网络检查。远端只运行 stdin 传入的 Python HTTP worker，不安装依赖、不写文件、不改服务、不传用户登录凭据；进程结束清理。复用生产的 Referer、WBI 签名及 CDN 候选/排序/缓存代码，记录国家代码、API 结果、主机级速度、Range 字节数及摘要；签名地址仅在内存中。所有请求串行、超时有界；每候选两块 256KiB，再从胜出节点读取新的 64KiB。探针将 API HTTP 412 保留为响应状态，使既有 pagelist 回退可验证。它验证远端 HTTP 链路，不运行 React、Shaka 解码或电视音视频输出，也不应加入要求任意开发机都可运行的默认门禁。
