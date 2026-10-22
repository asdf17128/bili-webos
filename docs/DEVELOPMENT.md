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
6. **每个正式 release 必须上传 `version.json` 资产**(`{"version":"x.y.z"}`)——
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
| tools/test-playback-end.mjs / test-playback-end-tv.mjs | #41 片尾三模式：本地受控 React 回归与真机原生 ended、遥控重播/暂停及设置持久化；真机结束恢复用户偏好 |
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

### 点播阶段计时与推荐面板

`app/src/player/startupTrace.test.js` 已进入静态门禁。`tools/test-player-loading.mjs` 覆盖并发阶段、媒体响应与就绪间隔、失败/退出、无记录及诊断接口全失败；`LOADING_FILTER='player shelf|startup|diagnostics'` 可定向运行。读取 Vite 单例模块时使用实际加载的含 HMR 时间戳 URL。

`tools/test-tv-ux-device.mjs` 额外检查推荐展开时标准/特大字号进度条和按钮边界，并保存真机截图；`tools/test-cdn-tv.mjs` 从真实电视二维码读取阶段与媒体事件，将不含账号内容的摘录保存为 `startup-report.txt`。阶段耗时可以并行，不作求和；总起播仍以 loadeddata 为界，不等同于逐帧上屏。未发生的事件保留为空，网络重试单列于播放中卡顿恢复次数。


### C9 起播测试包（不更新正式通道）

`node tools/release.mjs v2.2.3-c9-test.1 --test --notes-file docs/C9-TEST.md` 仅供已授权的测试分发。`--dry-run` 输出计划；真正分发要求独立分支已提交并推送、tag 与 `TEST_BUILD` 一致、当前 latest 仍是对应基础版。新建不可覆盖的 prerelease，显式 `latest=false`，只上传带测试标记的 IPK 和 SHA256，不上传稳定版 metadata。上传后匿名下载校验 IPK，并比较操作前后稳定版 tag / version.json / Homebrew manifest 的哈希。包含非空 `TEST_BUILD` 的代码禁止走正式发布入口。

webOS 安装版本保持 2.2.3，设置/诊断显示 `2.2.3 c9-test.1`；同版本覆盖与回滚由真机安装验证。该测试分支随后收到 C9 回传，改动已整合进 v2.3.0；保留此节作为测试包分发流程。

`tools/test-manifest-mime.mjs` 使用真实 Shaka 4.16.24 和 Chromium Blob 网络栈，固定空 MPD 使两组都到达同一个解析错误；对照无 MIME 的 4 次 HEAD 失败与显式 DASH 的零次重试。它证明网络路径，不测视频解码或 C9 性能。已加入 `verify.sh --ux`；PlayerPage 的失败恢复路径另由加载回归测试覆盖。

扩展起播报告：`dispatch` 是各阶段首次派发时间；`first-host` 是首次媒体请求（可能是索引）及首次响应的节点，不随后续后台测速覆盖；`vappend/aappend` 是 Shaka 公共 `segmentappended` 事件（写入完成，不代表画面已上屏）；`buffer` 为相应时点的缓冲毫秒与 readyState；`net-retry` 按请求类型/协议/错误码/主机聚合，最多四组，多余计入 other。不保留路径、签名、响应体或请求头。


### 2026-10-11：网络恢复、UP 关注与旧 WebSocket 接收限制

- `LOADING_FILTER='outage recovery|creator follow' node tools/test-player-loading.mjs`：真实 React + 受控解码器，覆盖无 online 事件的恢复、原分 P/进度、手动重试、退出取消、长期断网的两次重建预算和播放器关注入口。
- `UX_FILTER='creator follow' node tools/test-tv-ux.mjs`：受信遥控/指针输入，隔离账号写入；包括关注/取消关注、服务拒绝、关系查询失败、未登录、连续 OK、菜单关闭后的成功回写与首页标记。
- `node tools/test-recovery-follow-tv.mjs`：Luna 回调注入临时解析失败，恢复后使用真实取流/解码；真实关系 API 读取，关注写入在请求发出前拦截并模拟拒绝。不会修改真实关注列表；结束恢复包装器和设置。后者不计为服务器关注写入验收。
- `wsLegacyLimits.test.js`：旧接收器 4100 个空分片的正对照、单次 socket chunk 中的过多分片、队列上限及正常多消息；Node 0.12/8 管线也执行真实旧接收器限额检查。服务 v7 已含 CVE-2026-48779 上游补丁；遗留 v1.1.5 保留版本以支持 0.12，使用本地限额保护而非声称升级到上游修补版。
- 本地服务就绪探针用 `curl -fsS --noproxy '*'`。本机代理返回 HTTP 502 时，原来的 `curl -s` 仍退出 0，导致模拟套件跳过启动桥接服务；HTTP 错误不能算就绪。


### v2.3.0：请求期限与发布耐久验证

`service/com.biliwebos.app.service/requestDeadline.js`在 socket 超时外覆盖 DNS/Agent 排队/响应头等待，保持 ES5。`requestDeadline.test.js` 含真实 HTTP lookup/连接池正对照；`test-node8/run8.js` 在 0.12.2/8.17.0 上执行真实排队测试。请求头收到后由调用方管理响应流，普通响应完成不破坏池中连接。

`tools/test-scrub-tv.mjs` 使用 CDP 受信键、页内时间戳与原生 seeking 记录，三轮检查短延迟取消、OK 提交、迟到 Back。`test-tv-ux-device.mjs` 取消操作的两次按键之间不再插入状态读取。

`tools/test-network-soak-tv.mjs` 临时设循环、实际播放 25 分钟，每分钟并行检查 B 站 API、直播 API 与 GitHub 更新请求，记录视频尺寸/进度/最长停滞和服务 uptime；原设置最终恢复。结果只保留状态、耗时与计数，不保存认证、账号信息或媒体地址。正常耐久运行不能代替 DNS 故障复现。每次完整耐久会主动下载 26 次 `version.json`，这些下载是测试流量，不应计作真实日活；失败的运行也会产生部分下载。

`upstreamRequest.js` 仅对无体 GET/HEAD 在响应头前的 ECONNRESET/EPIPE 换新连接重试一次，与第一次请求共用总期限。单元测试用真实 HTTP 对端断连验证；POST、HTTP 错误、部分响应不能重发，取消句柄必须跟随当前尝试。旧运行时门禁包含断连→新连接成功。


### 2026-10-13：真机退出登录与动态代理端口

- 已获设备验证授权后，用 `UX_OUTPUT=/tmp/bili-session-tv node tools/test-session-tv.mjs` 验证真实遥控退出、失败提示、前端/服务/磁盘清理、B站匿名响应、重启持久化和旧观察器 API。脚本会暂时退出当前账号，在 finally 恢复原 Cookie、前端认证与设置；私有恢复文件权限 0600，确认原账号恢复后删除，截图只留本地。`--baseline` 可对旧包复现；不要把含凭据的恢复文件提交仓库。
- `UX_OUTPUT=/tmp/bili-proxy-port-tv node tools/test-proxy-port-tv.mjs` 在电视上启动临时回环 TCP 转发器，注入 Luna 返回的端口，验证生产前端的封面及真实 Shaka 媒体请求跟随端口、206 响应及解码进度。finally 移除注入、重载并关闭临时转发器。它测的是电视前端端口协商；生产服务的 EADDRINUSE 自动换端口另由 `test-session-proxy.mjs` 在真实本机 socket 上验证。
- 两脚本须在同一电视上串行执行。CDP 先 `Page.enable` 再注册新文档脚本，注入必须有可读标记；Page.reload 返回不代表新文档已就绪，使用文档代次标记等待新页面，避免把旧 DOM 当重启成功。
- 当前分支以 `TEST_BUILD=bugfix-test.1` 区分设备测试包，数值版本保持 2.3.0。安装与测试不等于发布，未调用 release 工具、未推送测试包或更新 Homebrew。

## 会员画质与 Dolby 真机补验

测试账号必须由 `/x/web-interface/nav` 确认登录和 VIP 状态，Cookie 存在不算。测试需要电视已启动，并在隔离工作树部署带 TEST_BUILD 的包；安装命令成功后须再次确认前台可见、`__openVideo` 就绪、实际安装 bundle/IPK 哈希与本地一致。

```bash
node tools/_cdp.mjs tools/probe-premium-tv.js             # 11 个真实片源：codec / qn / 实际尺寸 / 推进 / 丢帧
UX_OUTPUT=/tmp/premium-controls node tools/test-premium-tv.mjs # 遥控画质、seek、注入解码故障后的真实恢复
node tools/_cdp.mjs tools/probe-premium-soak-tv.js          # 约 3 分钟，实际自然播完特定 DV60 片源
```

上述工具会播放指定视频并产生正常历史记录，结束恢复原播放设置。只可串行操作同一电视；证据不导出 Cookie、签名媒体 URL 或视频字节。会员番剧用 ep 433953（API 当次 badge=会员），不要用免费第一集代替会员权限验收。

`probe-dolby-corpus-tv.js` 需先在电视内取得目标 playurl，将它临时放入 `window.__premiumSources[bvid+':'+cid]`。用 app 的 esbuild 将探针打包成 IIFE（globalName=`premiumCorpus`），追加 `premiumCorpus.probe()`，经 `_cdp.mjs` 执行。它在电视内读取、转换并检查全部 35 个实际分片，仅返回脱敏计数/耗时。结束删除临时变量或重新启动页面。不要把签名响应写到仓库。

`__dolbyRuntime().fragments` 是已处理响应次数，不是去重分片数，Shaka 可能重复请求；完整性依据逐分片 corpus 校验及自然 ended / 时间轴 / 解码帧数共同判断。CDP 截图只核对控制栏，不能证明 GPU 画面或面板 Dolby/Atmos 输出。


## 最小化诊断报告（2026-10-22，本地候选）

`app/src/utils/diagnosticReport.js` 是预览与二维码共用的导出边界。只重建固定 schema，禁止导出整个错误/API/service 对象；版本有格式及长度约束，阶段/状态/错误类别为枚举，错误码为有限整数或指定系统错误码，耗时与计数有上限。正文最多 1800 ASCII 字符，整行截断并加 `truncated=1`。Chrome 只保留主版本，Node 保留数值版本，测试包保留受限的构建标记。

导出内容：应用/运行环境版本、固定 CDN 路线枚举、诊断阶段及状态、原始错误码、`hasStream`、`voucher` 布尔值、阶段耗时/尝试次数/错误次数、已观察到的起播媒体重试次数。未知值用 `?` 或省略，不凭空填零。`voucher` 从不包含挑战值；不含账号/用户名、IP、cookie/token、设备指纹、完整 UA、主机名/签名 URL、BV/cid、标题或观看时间点。原有自由文本错误缓冲仅降为固定类别和安全错误码。

设置 → 网络诊断先显示本机预览，按右键到“生成反馈二维码”后按 OK，或点击该按钮，才在本机生成 QR。预览与扫码正文完全相同。生成时不发请求；手机扫码后 URL 查询参数会到达 GitHub，只有用户提交 issue 才公开，UI 明确说明这两步。原有 B 站网络诊断探针仍按用户打开诊断时运行。

没有自动遥测接收端、后台上传队列或新配置端点。若后续需要自动汇总，必须先明确接收方/端点、服务器 IP 日志策略、保留期、访问权限与用户同意界面；本轮不猜测或启用。原始本地缓冲只在运行时内存中，未新增持久化日志。DAU 与更新检查行为未改。

本地测试：`node --test app/src/utils/diagnosticReport.test.js app/src/player/startupTrace.test.js`；浏览器专项 `DIAG_BASE_URL=http://127.0.0.1:<隔离端口> node tools/test-diagnostic-privacy.mjs`，仅连接本地 Vite，其他网络均由夹具截获。完整发布门禁、旧运行时和真机二维码验收仍需在获授权的发布流程中执行，本轮没有部署/发布。

### Docker 不可用时的实际旧 Node 补验

`tools/test-node8/test-native.sh` 是手动替代运行器：显式传入 `BILI_NODE012_BINARY` 和 `BILI_NODE8_BINARY`，分别指向已用 nodejs.org 官方 `SHASUMS256.txt` 校验的 Darwin x64 0.12.2 / 8.17.0 发行文件。运行器不下载或安装任何东西；先核对精确版本和空闲的本地代理端口，再将生产服务、已有依赖和未修改的 `run8.js` 复制到临时目录。机器必须已有 x86 执行能力，不能自动安装 Rosetta。

`native-preload.js` 仅将 `/media` 文件操作重定向到临时目录，并禁止 SSDP 对外广播；使用原 Luna stub。服务、compat、网络传输和 WS 代码仍在真实旧 Node 内执行，匿名 B 站 API/排行榜请求仍走真实 TLS。退出清理临时数据。结果必须明确标为 Darwin 运行时覆盖，不能写成 Linux Docker、webOS 真机或播放解码通过。2026-10-22 两个真实版本均通过原运行时断言，见 [证据](ux-evidence/2026-10-22-private-diagnostics/native-runtime/results.json)。
