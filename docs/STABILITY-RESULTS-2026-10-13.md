# 2026-10-13 稳定性测试结果（已完成，保留发现）

**测试已完成，整体为 COMPLETED_WITH_FINDINGS，未宣告全部验收通过。** Candidate 4 两条完整本地门禁、真机 60 分钟 4K50、20 次同页 4K 循环、15 分钟直播及功能补测均已执行。长播 61 轮主站/直播/更新源探针全部成功，实际解码零新增丢帧；直播段的 13.326 秒恢复间隔、两次更新源探测失败和循环后的少量保留堆增长仍需跟进。本轮修复了多项订阅/异步状态/重连缺陷，旧失败和新证据均保留。**未发布、未推送、未更新 Homebrew。**

执行要求与预先约定的门禁见 [STABILITY-PLAN.md](STABILITY-PLAN.md)。历史“播放约 20 分钟后全部请求失败，重启 App 恢复”的现场已经丢失；本轮找到的资源和异步状态缺陷**不等于该历史故障的根因已证实**。即使本轮 60 分钟通过，也只能说明该构建在记录的设备和网络条件下未复现。

## 1. 最终候选身份与状态

包与安装文件的完整指纹见 [environment.json](ux-evidence/2026-10-13-stability/environment.json)。身份表依据其中的 candidate 4 记录；candidate 3 失败与功能通过记录分别保留；若后续源码或安装包变化，必须重新标识并重跑受影响层，不能沿用本表结论。

| 项目 | 已记录内容 |
| --- | --- |
| 测试构建 | `2.3.0 stability-test.4`，未发布测试包 |
| 基线提交 | `4eb77e0c14ee04c51ba07739d92dd6bd9a650e73`，另含本轮未提交修改 |
| IPK SHA256 | `afd179deb5dc4aa223623b1dbbe4a13373b7534e55167441b1b38862a27c0691` |
| 生产源码 diff SHA256 | `ef1125343cec968e95406b536347b9d39765dac080b5a4d167e72b05a3c5bcd6` |
| 真机 | LG `OLED65C4PCA.ACNQLJD`，SDK 10.3.1，3840×2160；Chromium 120，服务 Node 16.20.2 |
| 安装核对 | 安装前后均核对 service.js / danmaku.js 及 6 个 legacy bundle；[最终 8 项 hash/入口核对](ux-evidence/2026-10-13-stability/package-final-confirmation.json)和[13 项源/产物核对](ux-evidence/2026-10-13-stability/source-final-confirmation.json)通过 |
| 本地完整回归 | **PASS**；[candidate 4 两条完整门禁](ux-evidence/2026-10-13-stability/local/final-4/REPORT.md)，15:30:47 / 15:34:32 完成，13 个源/产物 hash 一致 |
| 真机功能/资源回归 | **已完成**；各功能专项通过，UI 53 通过/3 明确跳过；直播与保留堆 finding 另列 |
| 同包连续 60 分钟 | **PASS，67/67**；15:51:11.895–16:51:14.826，61 轮样本，未拼接旧候选；[完整证据](ux-evidence/2026-10-13-stability/final-tv-4/soak/README.md) |

## 2. 已证实缺陷与修复对照

以下“新通过”限定为所链接专项，不提前代表最终包整体验收。套件有重叠，数字不相加为总覆盖数。

| 已确认问题 | 旧实现的实际失败 | 修复与新专项结果 |
| --- | --- | --- |
| TV SDK 订阅只屏蔽回调，未取消请求句柄 | 弹幕、投屏各创建 20 个请求，实际 cancel 均为 0；旧套件 4/6，两个正常释放项失败。[旧证据](ux-evidence/2026-10-13-stability/local/subscription-before/results.json) | 保存并幂等取消 SDK 返回句柄；两类各 20/20 取消，迟到回调不再交付。最终服务修复后的 [SDK 复查 6/6](ux-evidence/2026-10-13-stability/service/client-tv-cancel-recheck/results.json)。 |
| 服务订阅在客户端取消后仍保留 | 50 次投屏取消留下 50 条 message，50 次直播取消同样留下 50 条；旧套件 0/5。[旧证据](ux-evidence/2026-10-13-stability/service/subscriptions-before/results.json) | 注册服务 cancel handler，按 uniqueToken/对象身份清理；最后一个直播订阅取消后停止 relay。新 [5/5](ux-evidence/2026-10-13-stability/service/subscriptions-after/results.json)，50 次启停平衡，多订阅互不误删。 |
| 开发桥没有把 WebSocket 关闭传给服务取消回调 | 真实本机 WebSocket 各开关 50 次，投屏和直播仍各保留 50 条；旧 0/3。[旧证据](ux-evidence/2026-10-13-stability/service/bridge-before/results.json) | 独立 token、保留注册的 cancel handler，close/error 只转发一次。新 [3/3](ux-evidence/2026-10-13-stability/service/bridge-after/results.json)，两类订阅均归零，另一活跃订阅仍可用。 |
| DEV 客户端提前退出后，迟到桥探测仍创建订阅 | 20 次提前取消后留下 20 个迟到 bridge socket；旧 0/4。[旧证据](ux-evidence/2026-10-13-stability/service/dev-client-before/results.json) | 探测后只选择一个传输，共享幂等清理并阻止迟到建连/帧；新 [4/4](ux-evidence/2026-10-13-stability/service/dev-client-after/results.json)。此项只改 DEV 分支。 |
| 匿名指纹初始化绕过有界传输路径 | DNS、无响应头、停滞响应体在 11.2 秒仍持有请求；截断没有生产 response error handler；无效 JSON 不安排重试，HTTP 503 却可保存指纹；旧 0/7。[旧证据](ux-evidence/2026-10-13-stability/service/buvid-before/results.json) | 复用 upstreamRequest/httpBody，保留生产 10 秒期限、15 秒回退和最多 6 轮，校验 HTTP/JSON/字段。最终 [8/8](ux-evidence/2026-10-13-stability/service/buvid-null-after/results.json)，零未捕获异常。仅影响尚无 buvid3 的启动，不替代账号凭据。 |
| 指纹接口返回合法 JSON `null` 引发 TypeError | 补充审查的旧跑次为 7/8；`null` 触发异常且没有安排重试。[旧证据](ux-evidence/2026-10-13-stability/service/buvid-null-before/results.json) | 增加空值检查，走相同有界失败恢复；已包含在上述最终 8/8 中。 |
| 字幕翻译退出后仍启动或继续批次 | 迟到字幕体仍发起 8 批；前 4 批发出后退出仍发后 4 批；旧 1/3。[旧证据](ux-evidence/2026-10-13-stability/subtitle-lifecycle/before/results.json) | 退出/替换时取消旧任务，批次边界检查失效状态；新字幕生命周期 [3/3](ux-evidence/2026-10-13-stability/lifecycle-browser-after/results.json)，正常翻译正对照通过。 |
| 原生倍速的迟到 URL/卸载覆盖退出或新播放意图 | 退出、回 1x、换画质/视频、更新倍速等 7 项失败，正常路径 1 项通过。[旧 1/8](ux-evidence/2026-10-13-stability/speed-lifecycle/before-final/results.json) | 生命周期代际与播放器身份检查；原 8 项 [8/8](ux-evidence/2026-10-13-stability/speed-lifecycle/after/results.json)。 |
| 交叠倍速切换失败后，已卸载 DASH 无法恢复 | 故障先于/晚于旧 unload 完成两个顺序均失败，旧 0/2。[旧证据](ux-evidence/2026-10-13-stability/speed-unload-before/results.json) | 共享 unload Promise 与卸载前位置/暂停快照，等待旧卸载后恢复，禁止迟到意图覆盖新源；[22/22 专项](ux-evidence/2026-10-13-stability/speed-unload-verified/results.json) 含播放/暂停、元数据前回退及 2x→1x→1.5x。 |
| 暂停状态 native 2x→DASH 1x 实际回到 0 秒 | Candidate 2 真机传入 14.9 秒，loading 结束再等待 15 秒仍 time=0；并非只读到了过渡态。[真机时间线](ux-evidence/2026-10-13-stability/regression/speed-paused-candidate2-timeline/README.md)。相同边界本地旧 1/2，[暂停项失败](ux-evidence/2026-10-13-stability/speed-paused-before/results.json) | 回 DASH 前显式卸载已赋值的 native 源，并保留位置/暂停及代际检查。新 [24/24](ux-evidence/2026-10-13-stability/speed-paused-after/results.json)，含新增两个实际 currentTime 断言；另 [2/2](ux-evidence/2026-10-13-stability/speed-paused-detach/results.json) 验证卸载中退出/新倍速。Candidate 3 [真机 17/17](ux-evidence/2026-10-13-stability/regression/speed-final/results.json)：21.5s 暂停往返后仍为 21.5s，继续播放实际推进；2x 推进率 1.9993，恢复 1x 为 0.9930。本片实际 640×480，不称为 4K 倍速。 |

直播耐久还发现独立的 relay 交付故障：[candidate 3 真机对照](ux-evidence/2026-10-13-stability/live-candidate3-stalled/README.md)证实后半程停止交付。源码可复现的缺陷是生命周期累计重试预算用尽后永久停止、缺少连接/认证/心跳期限，以及旧 `ws-legacy` 的 terminate 不能及时回收底层握手。Candidate 4 增加真实状态诊断、单连接与单重试定时器、3/6/12/30/60 秒退避、20 秒心跳响应期限和逐连接 request/socket 清理；健康连接恢复预算。持续故障保持每分钟一次低频探测，退出立即取消。

[旧 0/22、新 22/22 专项](ux-evidence/2026-10-13-stability/relay-after/README.md)包含机制边界和四种实际旧版 WS/TLS/socket 实验；旧库实验运行在现代 Node 宿主，不称为旧电视 TLS 全验收。旧 6/6 检查曾把永久停止视作合规，不能沿用它证明连续性。新的 [21 项连续性监控测试](ux-evidence/2026-10-13-stability/live-continuity-monitor/README.md)能够用独立新聊天时间识别 candidate 3 的漏检。现场缺少旧包 socket/protocol 状态，所以以上可复现机制仍不冒认为该现场的唯一根因。

服务原有单测在最终空值修复后保持 [41/41](ux-evidence/2026-10-13-stability/service/unit-after-null.log)。旧失败、修复中间失败和最终专项分别保留，没有用重跑成功覆盖最初失败。

## 3. S01–S09 验收矩阵（逐项注明候选与实测状态）

下表为实际结案状态。PASS 仅适用于所列观察范围，失败与待调查项不因其他专项成功而取消；脚本断言有重叠，不能相加宣称独立用例总数。

| 编号 | Candidate 4 状态 | 已有证据与仍须补录内容 |
| --- | --- | --- |
| S01 完整回归与旧运行时 | **PASS，显式跳过另列** | [最终完整门禁](ux-evidence/2026-10-13-stability/local/final-4/REPORT.md)：两条 exit 0；真实 Node 0.12.2/8.17.0；UI 68/68、播放器 70/70、模拟器 54 通过/0 失败/3 登录权限跳过。 |
| S02 60 分钟 4K50/网络 | **PASS** | [67/67，61 个分钟样本](ux-evidence/2026-10-13-stability/final-tv-4/soak/README.md)：完整 60 分钟同一 document，3840×2160/HEVC/50fps 元数据，解码增量 180,118 帧、丢帧 0，一次自然循环，最大进度间隔 1.999s；三类 API 各 61/61。服务 uptime 1785→5385 秒，观察到 9 条自动恢复的连接重置重试记录。 |
| S03 同页反复点播清理 | **清理 PASS；堆增长 NEEDS_REVIEW** | 同页 3 次热身 + 20 次实际 4K 播放进出 + 5 次加载中退出，[145/145](ux-evidence/2026-10-13-stability/final-tv-4/lifecycle/README.md)。每次正常 Back 释放播放器，清理后 2 秒内无新媒体请求。统一 GC 后保留堆增加 210,344 B（3.69%）且五点单调增长，来源未归因，不因低于预算就声称无泄漏。 |
| S04 直播耐久与订阅 | **完成，保留 FAIL / NEEDS_REVIEW** | [完整 15 分钟/16 样本](ux-evidence/2026-10-13-stability/final-tv-4/live/README.md)：833 条实时弹幕、2857 事件，心跳超时后自主恢复，退出清理 PASS。视频自动恢复 1 次、最大推进间隔 13.326s，流畅性待改善；更新源末两轮探测失败，原 43/45 及 exit 1 保留，之后独立补测正常，不覆盖失败。 |
| S05 播放失败恢复 | **PASS** | 真机运行期错误 [7/7](ux-evidence/2026-10-13-stability/final-tv-4/runtime/results.json)，包含暂停的致命网络/媒体错误和原生倍速失败后实际 DASH 解码；真实坏 CDN 与诊断 [16/16](ux-evidence/2026-10-13-stability/final-tv-4/cdn/device.json)。有限预算/退出取消由完整本地专项补足；不是海外故障复现。 |
| S06 服务故障与资源 | **PASS** | 最终完整门禁包含本机压力 20/20、匿名指纹 8/8、服务订阅 5/5、真实 WS 桥 3/3、DEV 取消 4/4、真实 SDK 6/6、新 relay 22/22；电视另验证 [20 次真实 Luna 取消](ux-evidence/2026-10-13-stability/final-tv-4/native-subscriptions/results.json)。 |
| S07 会员/画质/倍速/片尾 | **PASS，显式范围限制另列** | [暂停/倍速 17/17](ux-evidence/2026-10-13-stability/final-tv-4/speed/results.json)、[高级画质 9/9](ux-evidence/2026-10-13-stability/final-tv-4/premium/results.json)、[快进 24/24](ux-evidence/2026-10-13-stability/final-tv-4/scrub/device.json)、[片尾 13/13](ux-evidence/2026-10-13-stability/final-tv-4/ended/device.json)。分别核对实际位置、解码和自然结束；长播 61/61 样本登录及 VIP 有效，[直播多画质 3/3](ux-evidence/2026-10-13-stability/final-tv-4/live-quality/README.md)。不代替完整 Dolby 120 样本或面板 HDR 验收。 |
| S08 长会话性能 | **完成，保留堆 NEEDS_REVIEW** | 同页前后各 32 次焦点变化：p50 3.2→3.5ms、p95 4.2→6.0ms，在预设预算内。统一 GC 保留堆 +3.69% 尚未归因；DOM 608 / 监听器 210 / document 1 不变。60 分钟自然 CDP 堆 6,142,540–7,983,200 B，途中回落；长任务 3 次/总 172ms/最大 60ms，新增丢帧 0。自然采样不取消 GC 后保留堆的待查结论。 |
| S09 可用且脱敏的诊断 | **PASS** | [电视实际 QR 解码与启动分段](ux-evidence/2026-10-13-stability/final-tv-4/cdn/device.json) 通过；本地诊断 4/4 覆盖全失败。账号截图只留本地，公开证据不含 Cookie、身份和完整媒体签名 URL。 |

全界面真机回归为 [53 通过 / 0 失败 / 3 跳过](ux-evidence/2026-10-13-stability/final-tv-4/smoke/results.json)。跳过分别为安静房间即时弹幕、该房间仅一档画质，以及本轮未执行的账号列表写入；真实弹幕连续性已有另一个活跃房间的 15 分钟证据，画质切换已在固定多档房间补测 3/3，账号写入不计通过。原三项 skip 记录不改写。

## 4. 服务压力实际规模与资源证据

[压力结果](ux-evidence/2026-10-13-stability/service/results.json) 在 Node 25.4.0 执行，2026-10-13 13:35:09–13:35:22（Asia/Shanghai），**20/20 组通过，历时 12.833 秒**。这是重复故障/恢复压力，不能称为长时间耐久或吞吐量基准。

| 实際完成范围 | 数量与判据 |
| --- | --- |
| Helper 逻辑请求 | 2,300 次，含故障后的健康请求；真实生产 upstreamRequest/requestDeadline/httpBody 对本机 HTTP socket |
| 生产 HTTP 代理请求 | 400 次：响应头前取消、响应体中取消、截断、持续 reset 各 50 次，并各跟随 50 次健康恢复 |
| 实际 ClientRequest | 创建 2,450，close 2,450，包含安全读取的重试；不是 2,450 个独立业务操作 |
| 常规故障/恢复 | JSON、gzip、单次/连续 reset、POST 不重放、503 不重放、截断、停滞响应体/响应头、损坏 gzip，每类 50 次 |
| DNS 与重试取消 | DNS 期限 50 次、DNS 立即取消 50 次、已连接重试取消 50 次；零迟到结果回调 |
| 饱和池 | 50 轮，每轮 2 个占用连接、12 个排队超时、6 个排队取消和健康恢复；600 次超时、300 次取消均未到达夹具，队列排空 |
| 故障正对照 | 3 个：原始 HTTP reset 确实失败；截断体没有 end；仅 req.setTimeout 不能覆盖挂起 DNS |
| 最终清理 | 所有自有 Agent 销毁后，fixture socket、自有 request、Agent active/queued/idle 均归零；无进程 warning |

存活的 keep-alive 空闲连接按池上限核对，不在销毁前误判为泄漏。资源判据使用自有请求创建/close 配对、Agent 队列和 fixture socket，不用单个瞬时 activeHandles 总数声称无泄漏。

压力 helper 使用 120ms 测试期限，生产超时未改；生产代理的取消/错误路径未缩短其内置期限。匿名指纹专项则实际等待 **10 秒生产 deadline 和 15 秒回退**；仅“始终无效、最多 6 轮”用例把回退压缩为 20ms，验证有界次数/定时器清理，不宣称完成 75 秒重试耐久。完整细节和复跑参数见 [服务证据说明](ux-evidence/2026-10-13-stability/service/README.md)。

首次压力工具跑次为 19/20：夹具漏管 Node 25 默认 keep-alive Agent，导致 teardown 失败；修复夹具所有权后通过，**该项不是生产 socket 泄漏**。[原始失败](ux-evidence/2026-10-13-stability/service/initial-harness-failure.json) 仍保留。

## 5. 旧候选结果的适用范围

- [Candidate 2 本地完整报告](ux-evidence/2026-10-13-stability/local/final-2/REPORT.md)：两条 verify 均 exit 0，真实旧 Node 运行时通过；UI 68/68、播放器 66/66、真实网络模拟器 54 通过/0 失败/3 跳过。之后新增真机暂停回退故障、指纹 null 和 DEV 迟到订阅修复，因此不能把这份结果标为 candidate 3 通过。
- [Candidate 1 同页循环](ux-evidence/2026-10-13-stability/lifecycle-candidate1/results.json)：20 次点播、5 次加载中退出，116 条断言通过；同页前后各 32 次焦点变化，p95 5.6→6.0ms；统一 GC 后保留堆增长 138,816 字节。这些是旧包局部证据，最终点播修改后需要复跑。
- [早期候选直播完整跑次](ux-evidence/2026-10-13-stability/live-candidate1-complete/results.json)：5 次进出及 15 分钟直播，39 条断言通过，25 个真实实时弹幕帧到达可见覆盖层；某轮首次出画等待 12.584 秒亦保留。不能用其成功隐藏前面的选房/启动失败，也不替代最终候选矩阵。
- [Candidate 2 原生订阅](ux-evidence/2026-10-13-stability/regression/native-subscriptions-candidate2/results.json)：20 次真实 SDK/Luna 投屏订阅由基线 1 升至 2、取消后回 1。首页自身的一条订阅应保留，验收目标是回到基线，不是强制全局归零。
- [旧基线长播](ux-evidence/2026-10-13-stability/baseline-superseded/README.md) 仅有 17 个分钟样本，因更换修复候选而停止，不是完整 60 分钟，也不能与新包拼接。

## 6. 环境边界与未覆盖项

| 环境/方法 | 实际能证明的范围 | 明确不能外推 |
| --- | --- | --- |
| 确定性浏览器/React 夹具 | 真正执行组件与事件/Promise 顺序，验证取消、新旧意图和指定故障恢复 | 受控媒体边界不是电视硬解；已因此补充实际 currentTime 与真机时间线 |
| 本机 service/socket 压力 | 真实 Node HTTP/socket 生命周期与生产 helper；服务磁盘、webOS、网络边界隔离，无真实账号文件 | 不覆盖 TLS 握手、真实 DNS 基础设施、当地 CDN/运营商、GPU 或全进程内存 |
| DEV 客户端/桥 | 客户端确定性探测边界；桥的真实本机 WebSocket close→service cancel | SDK/Luna 原生取消必须单独真机核对；桥 fixture 不完整启动开发进程的 module hook |
| 真实旧 Node 门禁 | Node 0.12.2/8.17.0 服务语法与关键运行路径 | 不能替代 C6/C9 的 Chromium、硬件解码和可用内存 |
| 匿名真实网络模拟器 | Chromium + 生产开发桥 + 实际匿名点播/直播路径；隔离状态，不写账号 | 会员权限与 4K 硬解不由模拟器验收；登录后互动、账号写入、关注标缺账号时明确跳过 |
| 单台 C4 真机 | 该构建、该账号权限、该设备与该时段网络的实际行为 | 不代表所有型号、全部片源或海外报告者网络均已修好 |

未提供的完整 Dolby 120 版权样本仍是显式跳过，不计通过。物理面板 HDR/DV、音响 Atmos、音画同步、GPU/全进程内存、待机唤醒、真实路由器断网/重连、2–8 小时或 24 小时长跑、海外家庭签名媒体路径、其他电视型号均未纳入本轮已验证结论。当地复测入口见 [NETWORK-TESTING.md](NETWORK-TESTING.md)。

焦点耗时是 keydown→DOM 焦点变更，不含物理遥控链路或最终绘制；强制 GC 后 JS 堆不是自然内存峰值；1 秒采样的进度间隔不是逐帧流畅度。超过 3 秒的推进间隔要调查，15 秒失活门禁不意味着低于 15 秒都流畅。第三方 GitHub 请求失败须单列，不能删掉，也不能把它自动归类为 B 站播放失败。

## 7. 结案、剩余问题与复跑

本轮必要观察均已完成。电视正常回首页，原设置摘要一致、焦点唯一、无 video/活动播放器/测试标记，cast 订阅保留首页基线 1、直播订阅 0、relay 已停。[最终清理](ux-evidence/2026-10-13-stability/final-tv-4/idle-after-quality.json)与安装身份核对通过。本地临时服务已退出；未发布或推送。逐项状态和证据映射见 [summary.json](ux-evidence/2026-10-13-stability/summary.json)。

仍需跟进的三个发现：

1. **直播流畅性**：实际进度恢复间隔 13.326s，虽然自动恢复且聊天在心跳超时后续传，仍不满足流畅体验。下一步按同格式/画质核对真实备用 CDN 与分片期限，保留当地网络对照；目前不能确定 CDN 与中间网络各自的责任。
2. **更新源失败**：直播段最后两轮只有 failed/耗时，现场缺少响应状态，无法归因。已补充测试探针的脱敏 HTTP/解析/错误类别；后续成功不覆盖失败。
3. **保留堆趋势**：同页 20 次进出后统一 GC 保留量 +210,344 B（3.69%），五点单调增加但来源未归因。需要隔离组件并比较 heap snapshot 的对象保留路径；不根据 DOM/监听器不变就断言无泄漏。

认证 token 长期失效时，中继使用现有 token 低频重试，未实现自动刷新；这是恢复边界，不是本轮已复现的现场故障。独立只读代码及隐私复核见 [复核记录](ux-evidence/2026-10-13-stability/final-review.md)。

常规独立复跑入口如下，完整独占真机步骤见方案，不能与正在运行的电视长播并发执行：

```sh
bash tools/verify.sh --no-tv --ux
bash tools/verify.sh --sim --no-tv
STABILITY_ROUNDS=50 STABILITY_OUTPUT=/tmp/bili-stability/service node tools/test-service-stability.mjs
BUVID_OUTPUT=/tmp/bili-stability/buvid node tools/test-buvid-stability.mjs
SERVICE_SUB_OUTPUT=/tmp/bili-stability/subscriptions node tools/test-service-subscriptions.mjs
BRIDGE_SUB_OUTPUT=/tmp/bili-stability/bridge node tools/test-dev-bridge-subscriptions.mjs
DEV_SUB_OUTPUT=/tmp/bili-stability/dev-client node tools/test-dev-subscription-cleanup.mjs
```

每次使用独立输出目录，保留原始退出码与失败记录；测试完成后仍不自动发布。
