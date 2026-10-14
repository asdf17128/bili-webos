# 候选 4：最终本地回归

`2.3.0 stability-test.4` 的两条完整门禁均通过，本轮没有失败或中途修改生产源码。此结论仅覆盖本地层；真机 15 分钟直播及 60 分钟长播另行验收。

| 命令 | 北京时间（2026-10-13） | 结果 |
| --- | --- | --- |
| `bash tools/verify.sh --no-tv --ux` | 15:26:07–15:30:47 | PASS，exit 0 |
| `bash tools/verify.sh --sim --no-tv` | 15:30:52–15:34:32 | PASS，exit 0；54 通过 / 0 失败 / 3 登录相关跳过 |

原始日志：[UX](verify-ux.log)、[模拟器](verify-sim.log)。精确时间、源码标识和环境见 [source.json](source.json)，全部分组计数见 [summary.json](summary.json)，第二次执行的静态门禁 JSON 保存在 `sim-gates/`。

| 重点覆盖 | 通过数 |
| --- | --- |
| 遥控 UX / 真实 React 播放器 / 会话 | 68 / 70 / 9 |
| 弹幕 relay 恢复与实际旧 WS socket 清理 / 直播监测工具 | 22 / 21 |
| SDK / 服务订阅 / 开发桥 / 迟到订阅取消 | 6 / 5 / 3 / 4 |
| 服务故障压力 / BUVID 启动边界 | 20 / 8 |
| 片尾 / 直播加载 / CDN / CDN 诊断 | 26 / 9 / 7 / 4 |
| CDP transport / 长播监测工具 / 弹幕渲染 | 17 / 8 / 6（另 2 项测量） |

既有逻辑/服务/媒体测试、ES5 服务与 ES2016 构建解析、真实 Node 0.12.2/8.17.0 Docker 服务检查、生产构建、HTTP Range 和家庭网络探针合约均通过。不将重复运行或共享断言加成一个总数。

独立读码复核了逐连接代际、认证与心跳分离、退避、私有 Agent 捕获请求及迟到 socket、取消和诊断脱敏，没有未处理的阻塞发现。真实 `ws-legacy@1.1.5` 本机 socket 四场景已验证：TLS 挂起、HTTP 升级挂起、OPEN 不回应关闭、真实 10 秒超时后重连再退出。它们在本机 Node v25.4.0 执行；旧 Node 的服务冒烟单独验证，不冒充旧电视硬件结果。

首次半开服务器夹具误判和修正说明保留在 [relay-after](../../relay-after/README.md)，旧源码对照保留在 [relay-before](../../relay-before/results.json)。候选 3 的原本地 PASS 没有覆盖或删除，已明确标记被真机直播停交付取代：[follow-up](../final-3/FOLLOWUP.md)。这些旧样本不计入候选 4 的通过时间。

匿名模拟器使用全新隔离目录并禁止账号写入。点赞/投币/收藏界面、稍后再看、关注标记三项因未登录跳过；可选的完整 35 片 Dolby 120 fps 版权媒体集缺失，单独记跳过。直播房间历史为 0 条，其短 UI 检查不能证明持续实时聊天交付。会员与硬件播放不由本地结果代替。

已查看 [首页截图](simulator-home.png) 与评论栏原图（含公开评论者资料，仅保留在本地 `/tmp/bili-stability-20261013/private-reviewed-images/`）：卡片对齐、焦点可见、右侧评论与控制栏无重叠；播放器截图只作布局证据。测试启动的 PID 99705/99755 均已退出，5173/9528 无监听。未操作电视、发布、提交或写真实账号。

生产 diff SHA256 前后始终为 `ef1125343cec968e95406b536347b9d39765dac080b5a4d167e72b05a3c5bcd6`（`app/src`、`service/com.biliwebos.app.service`）。最终构建的 13 个源/产物 hash 全部匹配 root 的候选 4 安装清单：[核对结果](manifest-verification.json)。IPK SHA256：`afd179deb5dc4aa223623b1dbbe4a13373b7534e55167441b1b38862a27c0691`。工具版本见 [test-file-sha256.json](test-file-sha256.json)。


## 门禁结束后的真机工具变更

两条完整本地门禁在 15:34:32 前完成，[test-file-sha256.json](test-file-sha256.json) 保留当时工具 hash，未覆盖成后改版本。随后仅有真机工具变更：生命周期暂停检查增加 `paused` 和绝对时间差（旧判定 2/4 正确→新 4/4）；直播/长播 API 探针补充 HTTP 状态、响应格式/长度及脱敏错误类别。两条门禁不执行真机工具本身，其本地监测夹具使用的是当时源码，不能声称验证过后改诊断字段。

后续专项独立保存：[暂停谓词 4/4](../../lifecycle-predicate/results.json)、[最终诊断解析/真实请求边界 34/34](../../probe-diagnostics/results-final.json)、[直播 monitor 21/21](../../probe-diagnostics/live-monitor/results.json)、[长播 monitor 8/8](../../probe-diagnostics/soak-monitor/results.json)。诊断专项保留 helper 位置调整前的初轮记录，并已对最终 live `eb5036c7…` / soak `01abb7c9…` 完整复测 34/34；初轮和最终快照分开存档。没有重跑两条完整门禁；[后续 hash 核对](test-file-sha256-followup.json) 分列执行时与当前版本，生产代码及 13 个源/产物 hash 仍与候选 4 包一致。

后续真机直播原始结果为 **43/45 通过、2 项更新源失败，exit 1**；已观察到心跳超时自动恢复与持续弹幕，仍保留 13.326 秒视频推进间隔的流畅性调查，不能由本地 PASS 将整轮真机改写为通过。见[真机分项评估](../../final-tv-4/live/assessment.json)。
