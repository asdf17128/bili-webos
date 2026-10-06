---
name: tv-test
description: bili_webos 的测试与验证方法论 — 发版前验证管线、真机 CDP 测试、旧设备(webOS 5/Node 8)兼容、修 bug 的验证纪律。改动 service/ 或 app/、修 bug、发版前都应使用。
---

# bili_webos 测试与验证

## 一键管线(发版前必跑)

```bash
bash tools/verify.sh          # 全链路:语法 → 真Node0.12/8 → 构建 → 部署 → 真机DOM检查
bash tools/verify.sh --no-tv  # 只跑本地层(电视不在时)
bash tools/verify.sh --full   # 额外跑真机 UI smoke(test-ui.mjs,~3分钟)
```

五层,逐层 fail-fast:
1. **syntax** — service 全部文件用 acorn 按 ES5 解析(webOS 4.x = Node 0.12.2)
2. **node8** — docker x86 内分别运行真实 Node 0.12.2 和 8，跑**真实 service.js**:stub webos-service、驱动 fetch handler 真连 api.bilibili.com、调 getDiagnostics。见 `tools/test-node8/`
3. **build** — vite 生产构建
4. **deploy** — build.sh 部署 + `tools/launch.mjs` 重启 app
5. **device** — CDP 断言:卡片>5、侧栏存在、0 张裂图,并存截图

## 验证纪律(血泪教训,违反必翻车)

1. **正对照原则:先证明测试方法能复现 bug,再声称修复已验证。**
   做法:`git checkout <旧commit> -- <文件>` → 部署坏版 → 同一操作复现 bug → 恢复新版 → 同一操作确认消失。边缘滚动 bug 连续两个版本"修好了"都是假的,就是因为没做正对照。
2. **失败路径必须测。** 诊断页/错误处理类功能,happy path 全绿毫无意义 —— 用 Playwright `route.abort()` 掐断 API,确认错误文本上屏、进报告。
3. **测试结果反常时,先验证测试工具本身。** 在页面挂原生事件计数器(`document.addEventListener('mousemove',...,true)`)再注入 CDP 事件 —— 曾经 CDP 鼠标注入静默失效,把"工具坏了"误判成"产品坏了"浪费了一整轮。
4. **交互语义用受信输入管线验证**:`npm run dev` + Playwright(`page.mouse`/`page.keyboard` 走真实 Chromium 输入管线),`addInitScript` 干掉 `window.webOS` 强制走 proxy,`page.route` mock 数据流(mock 端点注意 wbi 路径:`**/top/feed/rcmd**`)。TV 的 CDP `Input.dispatchMouseEvent` 不可靠,不要依赖它测 hover。

## 旧设备(webOS 5/6)兼容

- **service 层 = Node 8**:没有 `URL`/`URLSearchParams`/`globalThis` 全局、没有 `?.`/`??`/optional catch binding。`new URL` 要写 `require('url').URL`(曾导致 webOS 5 全部请求失败,#10/#13)。`ws` 必须 v7(v8 要 Node 14)。
- **app 层 = Chromium 68(webOS 5)/ 79(webOS 6)**:vite legacy 插件管语法;要防的是缺失的全局(globalThis 已 polyfill)和新 Web API。
- **官方模拟器**:VirtualBox Emulator 只到 webOS 6.0 且 x86-only(Apple Silicon 跑不了);Simulator 只覆盖 webOS 22+。→ 所以用 docker node:8 测 service,这是最接近真机的手段。
- 新增 service 依赖/语法时:`npx acorn --ecma5 --silent <file>` 快速把关，再跑实际运行时。

## 真机工具箱(tools/)

| 工具 | 用途 | 坑 |
|---|---|---|
| `launch.mjs <appId>` | 启动/切换 app | **必须 luna-send-pub**(公共总线);私有 luna-send 对 prisoner 永远 Permission denied |
| `wake.mjs` | WoL 唤醒电视 (MAC 14:7f:67:a1:6b:56) | |
| `drive.mjs "keys"` | 遥控按键 + STATE | 从未知焦点开始导航不可靠,先 `left,left` 回侧栏 |
| `point.mjs "move:x:y,wheel:d,click"` | 指针模拟 + focus/underPointer/match | 注入可能静默失效(见纪律3);端口已改 ephemeral |
| `eval.mjs "<expr>"` | 页内执行 JS | 验证 UI 状态首选(截图对 GPU 层是白的) |
| `screenshot.mjs` | 真机截图 | 视频/GPU合成层截不到 |
| `test-ui.mjs` | 真机 UI smoke 全家桶 | app 须在前台 |
| `test-e2e.mjs` | API 集成测试 | 需先 `node proxy/server.js` |

## 深链直达(测试专用钩子,owner 授权 2026-07-10)

**"没法测试 = 不允许上线"。为可测试性可以给 app 加专门的测试钩子。**

- `window.__openVideo({bvid, cid, title})`(App.jsx 注册)——CDP 里直接播放指定视频,
  跳过整个 UI 导航;入口与卡片按键完全同路(normalizePlay 起全是生产代码)。
  找"具备某特征"的测试素材(有字幕轨/有章节/多P):先用页内 luna fetch 查
  `history/cursor` 或 `player/v2`,拿到 bvid+cid 再深链。
- **保持瞬态 UI 存活以便截图**(scrub 气泡这类 1s 自动消失的):页内起
  `setInterval(()=>dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'})),700)`
  合成键反复续命,另一个连接从容截图,完事 clearInterval。合成键走 JS 层
  keydown handler,足够(不需要 trusted input 时)。
- 逐卡片盲探(back,right,ok 循环 + eval 断言)是没有素材线索时的兜底,慢但可靠。

## 专项验证清单

- **QR 码功能**:报告体必须纯 ASCII(CJK percent-encode 后 1 字变 9 字,QR 密到扫不出);用 jsQR 从**真机截图**解码验证,再开解码出的 URL 确认 GitHub 表单预填(body 在第 3 个 textarea,前两个是 GitHub 反馈组件)。
- **诊断页**:真机 happy path 全绿 + dev 掐断 API 全红,两头都要。
- **悬浮 UI(气泡/弹层)**:`getBoundingClientRect` 只给布局位置,**测不出 overflow 裁剪** —— 必须截图看像素。`.player-controls` 是 `overflow-y:auto`,往上探出的元素会被静默裁掉(v1.2.4 预览气泡被裁就是这么漏掉的);悬浮层挂到根节点。
- **播放器改动**:`ended` 决策逻辑(收藏连播 vs 分P)可用真实数据在本地 node 里跑决策函数做确定性验证,比 flaky 的真机播放可靠。

## Case 沉淀(硬性规则)

开发完成 → 验证过的场景**必须**追加到 `docs/TESTCASES.md`(带事实佐证:抓过的真 bug 或正对照记录);
发布前按 `docs/DEVELOPMENT.md` 的门禁清单回归。能自动化的 case 升级进 `tools/verify.sh`。

## 丰富本 skill

每次踩到新坑/建立新方法,追加到对应小节。宁可啰嗦,不可失传。

**通用方法论的正式版**在独立仓库 `~/code1/webos-tv-skill`(github.com/asdf17128/webos-tv-app-skill,`reference/testing.md`)—— 本文件放 bili_webos 项目专属细节(IP/密钥/工具名),提炼出的通用经验要**同步一份**过去。

## 2026-10-06：4.x 与播放卡顿

- Node 0.12.2 的 URL/Buffer/String/CA 与旧 ws 兼容由 `service/compat.js` 提供，必须最先加载；语法门禁降为 ES5，真实运行时门禁同时测 0.12.2 和 8。Docker 历史镜像可能拉不下来，使用官方 SHA256 校验二进制；Apple Silicon 旧 CLI 参数异常可经 ELF loader 启动，记录实际 process.version。
- 模拟播放停滞时，Playwright clock 必须在播放器创建计时器前安装。`readyState=1` 是缓冲耗尽，不能把它排除出卡顿检测。暂停/seek/退出必须不会继续重试。
- 设置页添加新开关后，要同步遥控器回归的行顺序。2026-10-06 全量回归发现 #27 新开关使旧测试点错行，更新顺序后浏览器与真机均复验。
- 诊断二维码必须按整数像素绘制并保留 quiet zone，重复错误去重；变更后，`tools/test-cdn-tv.mjs` 从真实电视截图用 jsQR 解码，核对选路和最近播放节点；测试结束恢复所有偏好与坏 CDN 注入标记。

## 2026-10-06：模拟与真机广覆盖补验

- 构建成功与 DOM 数量正确不证明画面正确。本次评论栏缺少 JSX 花括号，条件源码与空态直接显示在已加载评论旁；截图才发现。新增改前失败的复现，同时断言条件文本、空态互斥和控制条几何，并看模拟/真机截图。
- 真实评论接口返回数量会变化；对照同一次 API 响应，不用固定的“至少 5 条”。异步焦点恢复使用有上限的状态等待，不能用任意 100ms 睡眠判失败。
- 账号是否有效以 `/x/web-interface/nav` 为准，残留 SESSDATA 不证明已登录。账号增删测试默认跳过；`SIM_ACCOUNT_WRITES=1` 仅限独立测试账号。`TV_ACCOUNT_WRITES=1` 已改为固定测试视频、完整原列表快照、请求层精确 aid 保护与 finally 清理，用户已授权账号测试时可启用。跳过不计为通过。
- 保留首次失败、修复后结果和真机失败响应。本次 UP 投稿真机返回 `-352`，即使 Mac 同接口成功也不能冲抵；记录环境并保留待验收状态。采集响应码/条数即可，不把签名 URL 或认证信息写入证据。
- 动态标签页不能靠固定按键次数证明命中。有“选集/合集”时初始标签不同，旧测试会把相关推荐当作 UP 投稿通过；必须同时核对选中标签和该标签 API 的成功响应。
- 稍后再看测试不能按标题片段决定删除对象。采用原列表不存在的固定视频，长按后核对 `card-menu` 事件的 aid；请求层只允许该 aid 的单条 add/del，结束比对原列表顺序与成员。账号截图只留本地。
- 安静直播间短时间没有弹幕，不能直接判中继坏了，也不能只凭图层存在判通过。`testLiveRelay` 动态选当前在播房间，分开记录 token 响应码、Luna 订阅、实时帧数与 DOM 数量，并截实际弹幕；历史聊天不算实时帧。

## 2026-10-06：原生 HLS 起播测量

- LG C4 原生视频暴露 `requestVideoFrameCallback` 却未回调；分别记录 API、`playing`、元数据后 `currentTime` 实际推进、解码尺寸，不能把时间推进写成逐帧画面测量。`tools/probe-live-startup.js` 的 default 模式测生产选源，其他模式仅筛选真实响应的格式；不要保存带签名的流 URL。
- 比较 TS/fMP4 时保持 qn、编码与解码尺寸相同，记录 CDN 主机差异，交替采样并区分冷/热启动。首次 TS 慢不代表热启动每次都慢；先用真实数据定位瓶颈，最终无覆盖测部署版本，并继续观察起播后的 waiting、error、重连。
- 播放 URL 和画质阶梯必须来自同一次选定格式响应，避免默认画质请求覆盖正在播放的元数据。加载提示等实际 playing 才消失；用受控事件覆盖格式回退、超时最终错误、手动重试、完整解码阶梯和退出后迟到响应，再看加载/失败截图。
- 真机画质按钮显示当前画质（如“原画”），不是固定“画质”。用 `TV_LIVE_ROOM` 选当前有多档的房间，切换及切回都等实际播放事件；仅有一档时明确跳过切换，不能判产品失败，也不能假称已验证。

## 2026-10-06：自动 CDN 验证

- 节点名含“海外”不证明在当前网络快。测真实媒体 Range，核对 206、起止范围、总长度与完整响应体；超时部分下载可供诊断，但不能作为自动选路成功。两次采样取较慢值，切换留门槛，避免一次缓存命中决定长期选择。
- 自动测速必须等暂停/缓冲充足；换源、低缓冲和退出取消不应污染健康缓存。缓存只含主机与测量信息，不能存签名 URL。候选必须能被缓存：本轮正对照发现 `.bilivideo.cn` 不能缓存时会反复占据队列，旧逻辑 10 次 tick 发 20 个请求，修复后仅 2 个且其他节点继续得到机会。
- 设置值和 MPD 顺序不证明实际选路。浏览器测试经生产请求过滤器检查发出的请求，标清 Shaka/解码替身；真机另查 Shaka 的实际媒体响应，seek 到已缓冲区之外并验证进度继续、播放器实例不变。测试后恢复原偏好、测速缓存和故障注入标记。
- CDN 设置截图只截弹窗，避免把账号页发布到公共仓库。Akamai 原生签名、仅 Akamai 源和直播 URL 都要作为禁止通用 host 改写的回归场景；本地网络测试不等于海外验收。

## 2026-10-06：快速重试与实际焦点

- 重试请求可能在 React 提交 loading=true 前完成，true/false 被批处理合并。先在输入事件中提交加载态，再开始副作用请求；测试必须包含立即完成的 Promise，只有网络延迟用例会漏掉。
- 白框不等于焦点系统可用：真机复现了旧按钮的 passive cleanup 在新卡片已高亮后清掉全局焦点，下一次方向键跑回侧栏。注册/注销改为 useLayoutEffect，与 DOM 同次提交；`__focusState()` 核对真实目标，再按方向键、断言只有一个高亮。保留“只修加载态仍失败”的中间证据。
- `-352` 不能一律归咎账号或网络。排行榜本轮只改 Referer，就从两次 -352 变为两次 code=0/100 条；修生产服务和独立代理共享策略，并通过真实 Node 0.12/8、C4 六分区验证。不要把游戏失败改成跳过来让测试全绿。
- 海外探针必须匹配生产错误语义：本轮初版 worker 把 API HTTP 412 抛成异常，提前中止，漏测 app 已有的 pagelist 回退。纠正工具后 HK/JP 均能取流并实收分片。服务器线路、模拟媒体事件与电视实际解码分开陈述，匿名探针不上传用户 Cookie 或保存签名 URL。

- 注册生命周期必须覆盖手动注册者：`SearchPage` 原生输入框绕过 useFocusable，仍用 passive effect 清理，导致切到设置页时删掉刚注册的第一行。新增搜索 → 设置 → 下 → 上正对照（改前 0/1、改后 1/1），手动注册也改为 layout effect；不要通过把测试起点改到第二行来掩盖真正回归。

## 2026-10-06：发布前核对社区补丁边界

- 部分移植必须读上游 PR 的完整说明：PR #17 明确指出单独开启 4K120 的杜比信令会引入黑屏风险。未移植专用帧转换时，超过 60fps 或帧率未知保持原有基础层信令；MSE 接受 codec 字符串不证明该帧率可解码。用真实 PlayerPage 生成的 MPD 证明旧实现 0/2、新实现 2/2，再覆盖正常帧率的 DV 和音轨回退。

## 2026-10-06：片尾模式与设置迁移

- 片尾测试必须经过真实 `PlayerPage` 的 `ended` handler：只测辅助决策函数会漏掉收藏、稍后再看、分 P、合集和分页入口绕过全局偏好。正对照 v2.2.0 在这五种入口均加载下一条，普通推荐视频停止；电视另用真实媒体自然触发 `ended`，不能把人工 dispatch 当成解码验证。
- Playwright `addInitScript` 会在每次 reload 重跑；验证持久化时只在没有存储值时初始化设置。无条件重种默认值会把测试工具清空设置误判为产品丢失偏好。
- 真机测试开始前用公共 Luna launch 保证应用在前台。已退出应用留下的 CDP 页面可能仍可读 DOM/storage，但 reload 后不会恢复 React 测试入口；保留这类准备阶段失败，重新前台启动后再做同场景对照。
