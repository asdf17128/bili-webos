# stability-test.4 真机证据索引

本目录记录同一个 **2.3.0 stability-test.4** 候选在电视上的验证。候选身份、13 个源/构建产物 hash 及 8 个安装文件的核对见 [environment.json](../environment.json)；安装包 SHA256 为 `afd179deb5dc4aa223623b1dbbe4a13373b7534e55167441b1b38862a27c0691`。旧候选结果不合并进本目录。

**测试已完成，整体为 COMPLETED_WITH_FINDINGS。** 同包 60 分钟长播与直播多画质补测通过；直播段失败和保留堆待查项保留。本轮未发布。

## 已归档的实际结果

以下数量逐项取自链接中的原始 JSON：数组长度或 `checks` 数组，以及各项 `pass` / `status`。它们是脚本断言数，含重复循环和重叠覆盖，**不相加宣称总独立用例数**。共有 12 个已归档专项子目录。

| 子目录 | 原始断言结果 | 状态及覆盖 | 证据 |
| --- | --- | --- | --- |
| `speed` | 17 通过 / 0 失败 | PASS。实际 DASH→原生 2x→DASH 1x，播放与暂停往返、位置保持、退出及设置恢复。 | [results.json](speed/results.json) |
| `runtime` | 7 通过 / 0 失败 | PASS。暂停中的媒体/网络错误恢复、可恢复通知、原生倍速故障后恢复实际 DASH 解码。 | [results.json](runtime/results.json) |
| `premium` | 9 通过 / 0 失败 | PASS。会员音轨与 DV/4K 往返、未缓存位置 seek、转换后 DV 片尾及受控解码错误后同画质 HLG 回退。 | [results.json](premium/results.json) |
| `scrub` | 24 通过 / 0 失败 | PASS。3 轮快进预览取消、确认、自动提交后迟到 Back；检查播放器保持打开。 | [device.json](scrub/device.json) |
| `ended` | 13 通过 / 0 失败 | PASS。片尾停止/重复/下一集、暂停恢复、遥控模式选择、持久化与原设置恢复。 | [device.json](ended/device.json) |
| `cdn` | 16 通过 / 0 失败 | PASS。不可用主 CDN 回退、候选测速和实际媒体推进、持久化、诊断及脱敏二维码信息。 | [device.json](cdn/device.json) |
| `native-subscriptions` | 1 通过 / 0 失败 | PASS。该汇总断言内保存 **20 轮**真实 SDK cast 订阅/取消；每轮服务订阅数回到原基线，没有发送投屏命令。不能另算成 20 条顶层断言。 | [results.json](native-subscriptions/results.json) |
| `smoke` | **53 通过 / 0 失败 / 3 跳过** | 已完成，保留跳过。覆盖内容、点播、直播、评论、已登录账号列表读取、搜索、分类、更新和 CDN 设置等。 | [results.json](smoke/results.json) |
| `lifecycle` | **145 通过 / 0 失败** | 清理/交互断言 PASS，**保留堆趋势 NEEDS_REVIEW**。同页 3 次热身 + 20 次 4K 进出 + 5 次加载中退出。 | [results.json](lifecycle/results.json)、[assessment.json](lifecycle/assessment.json)、[说明](lifecycle/README.md) |
| `live` | **43 通过 / 2 失败，共 45 条** | 原工具 `status=failed`、exit 1。5 次开关和完整 15 分钟/16 个样本已完成；两条更新源探测失败保留，**流畅性 NEEDS_REVIEW**。 | [results.json](live/results.json)、[assessment.json](live/assessment.json)、[说明](live/README.md) |

`smoke` 的 3 个跳过分别是首个房间没有弹幕样本、该房间只有一种画质、未执行稍后再看写入。后续推荐房间确有实时弹幕交付的独立通过记录，不覆盖首个房间的跳过；直播多画质切换已有 3/3 补测通过，原 skip 不改写。

## 仍需保留的发现

直播弹幕实际收到 833 条聊天和 2857 个互动事件，观察到 `heartbeat-timeout` 后自主重连并恢复交付，退出后的订阅/relay 恢复基线。视频为 1920×1080 原生 HLS，发生 1 次恢复，最大媒体时间推进间隔 **13.326 秒**；这证明有恢复能力，同时留下流畅性问题，不能写成整轮全过或确定为某一个 CDN 根因。第 14、15 分钟 GitHub 更新源探测失败；后续 HTTP 200/有效 JSON 复测单独保存在 [update-response-followup.json](live/update-response-followup.json)，不改写原失败。原生帧计数为 0，视为该通路不可测，不能解释为零丢帧。

生命周期统一 GC 后第 0/5/10/15/20 轮保留堆连续增加，首末增量 **210,344 B（3.69%）**。DOM/监听器/document 计数保持基线，退出清理和在飞请求排空后的迟到请求检查通过，但该小幅增长尚未归因，**不声称无内存泄漏**。前后焦点 p95 为 4.2→6.0 ms，在预设预算内；该值是 keydown→DOM 焦点变化，不代表实际屏幕绘制延迟。堆指标不覆盖 GPU 或全进程内存。

## 最终长播与补测

| 项目 | 当前状态 | 后续记录 |
| --- | --- | --- |
| 同包 60 分钟 4K 长播 | **PASS，67/67** | [61 轮样本与完整清理](soak/README.md)，零新增丢帧，三类 API 各 61/61；不拼接旧候选。 |
| 直播多画质切换 `live-quality` | **PASS，3/3** | [房间 34348 原画→蓝光→原画实际播放](live-quality/README.md)；补足覆盖，不修改 smoke 的 skip。 |

本地完整门禁见 [local/final-4/REPORT.md](../local/final-4/REPORT.md)，整体方案和最终归纳见 [稳定性方案](../../../STABILITY-PLAN.md)及 [主结果报告](../../../STABILITY-RESULTS-2026-10-13.md)。[最终首页/设置/订阅清理](idle-after-quality.json)通过，[原始串行 runner](tv-runner-final4.json)保留首段直播 exit 1；人工审阅后继续独立专项，不能将其改成全绿。
