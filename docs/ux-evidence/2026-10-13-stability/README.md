# 2026-10-13 稳定性测试证据

执行方案见 [STABILITY-PLAN.md](../../STABILITY-PLAN.md)，分项状态见 [测试结果](../../STABILITY-RESULTS-2026-10-13.md)。当前候选为 **2.3.0 stability-test.4**。两条完整本地门禁与同包 60 分钟 4K50 长播已通过；真机直播、同页循环和功能补测均已完成，仍保留直播失败/流畅性及保留堆待调查项。整体为 **COMPLETED_WITH_FINDINGS**，不能宣称整体验收全绿。本轮不发布 Release、不更新 Homebrew。

- [environment.json](environment.json)：候选 4 的包、13 个源/构建产物及 8 个电视安装文件的身份核对；旧身份分别保留在 [candidate 1](environment-candidate1.json)、[candidate 2](environment-candidate2.json)、[candidate 3](environment-candidate3.json)。
- [local/final-4/REPORT.md](local/final-4/REPORT.md)：最终两条完整本地门禁，UI 68/68、播放器 70/70，匿名模拟器 54 通过 / 0 失败 / 3 登录相关跳过；新增 relay 22/22、直播监测 21/21。门禁执行时与后改真机工具的 hash [分开记录](local/final-4/test-file-sha256-followup.json)，不混写测试版本。
- [final-tv-4/](final-tv-4/)：候选 4 的实际电视功能结果，包含倍速、播放恢复、会员画质、快进、片尾、CDN/诊断、原生订阅和综合 smoke；逐项结论以原始 JSON 和主报告为准。
- [final-tv-4/live/](final-tv-4/live/README.md)：5 次开关及完整 15 分钟/16 样本。实时聊天持续交付、心跳超时后自动恢复、退出清理有证据；原始 **43/45，2 项更新源失败，exit 1**。视频最大推进间隔 13.326 秒，流畅性仍需调查，不能写成整轮全过。
- [final-tv-4/lifecycle/](final-tv-4/lifecycle/README.md)：同页 3 次热身 + 20 次 4K 进出 + 5 次加载中退出，145 条清理/交互检查通过；统一 GC 后保留堆增长 210,344 B（3.69%），来源未归因，仍为 NEEDS_REVIEW。
- [relay-after/](relay-after/README.md)、[live-continuity-monitor/](live-continuity-monitor/README.md)：新版 relay 的机制/真实旧 WS socket 对照，以及能识别中途停止交付的监测判据。工具修正另见 [暂停谓词](lifecycle-predicate/README.md)和 [API 诊断](probe-diagnostics/README.md)。
- [local/final-3/FOLLOWUP.md](local/final-3/FOLLOWUP.md)、[live-candidate3-stalled/](live-candidate3-stalled/README.md)：候选 3 的本地通过之后，完整直播发现中途停止交付；独立新聊天历史确证失败。旧累计帧工具漏判，原结果与复核均保留，不用候选 4 的成功覆盖。
- [soak-candidate3-aborted/](soak-candidate3-aborted/)、[baseline-superseded/](baseline-superseded/README.md)：被替代候选的 minute 0 / 17 个样本不是完整长播，不能拼接进候选 4 的 60 分钟。
- [regression/](regression/)、[lifecycle/](lifecycle/)、[service/](service/README.md)及各 `speed-*` 目录：旧候选功能、服务压力、异步切源等原始失败与修后证据。候选身份和测试工具误判分别说明，不混为最终候选的通过数。

普通播放可能正常更新观看历史，本轮没有增删真实账号列表。真实账号页面截图不纳入此目录；匿名模拟器首页截图显示公开视频卡片，夹具截图含合成内容。全部 34 张原图已逐张审查；两张含公开评论者昵称/头像/文字的评论布局原图仅留本地，公开目录保留 32 张。诊断仅保留脱敏计数、状态及时间，不保存登录凭据、私密聊天正文或完整媒体签名 URL。未执行、安静房间缺少实时聊天、缺少权限或未知帧计数均不按通过处理。

最终逐项结果见 [summary.json](summary.json)、[真机矩阵](final-tv-4/README.md)、[60 分钟长播](final-tv-4/soak/README.md)、[补测后清理](final-tv-4/idle-after-quality.json)和[最终安装核对](package-final-confirmation.json)。
