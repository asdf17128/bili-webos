# 更新日志 / Changelog

[中文介绍](README.md) · [English overview](README.en.md) · [GitHub Releases](https://github.com/asdf17128/bili-webos/releases)

这里保留原 README 中的更新记录；更早版本请查看 GitHub Releases。未发布条目仅描述测试分支，不代表已上架安装包。

历史验收 / Historical validation: [2.0.0](docs/RELEASE-2.0.0.md)。

This log collects the release history previously included in the README. For earlier versions, see GitHub Releases. Unreleased entries describe the test branch, not the published package.

<a id="unreleased"></a>

## v2.5.0 — unreleased / 合并测试中

- 推荐卡片长按支持「不感兴趣：当前视频／UP」、本机隐藏和恢复。具备有效账号与推荐上下文时才可提交官方反馈；结果未知不自动重发，UP 隐藏按账号隔离。
- 点播控制栏采用透明渐变布局，增加 UP 粉丝数，支持大字号、小屏幕、评论栏与分层返回。
- 设置统一为「账号修复」：检查账号、清理临时签名缓存、确认后重建设备标识或重新扫码登录。与自动风控恢复共享持久化冷却及并发保护。
- 无效 WBI 签名密钥不再污染缓存；旧响应不能覆盖已刷新缓存。
- 账号修复兼容实际设备标识格式及缺省可选 Cookie，避免合法接口响应被误判失败。
- 诊断先显示白名单预览，再主动生成二维码；保留播放失败与恢复结果，排除账号标识、观看内容、原始日志和签名地址。
- 尚未发布：合并版本本地回归已完成，最终候选真机长测进行中。

## v2.4.1 — playback verification recovery / 播放风控恢复

- 针对 #50、#51、#52：UGC、WBI、PGC 取流遇到 `-351` / `-352`，或只有 `v_voucher` 而没有视频流时，尝试刷新匿名设备标识后重试一次。并发共享一次刷新，5 分钟冷却写入磁盘，失败不清空原标识或登录。
- 设置新增「重置设备标识」，保留账号登录。电视上的标识统一由服务管理，直播使用服务当前标识。
- 修复诊断导出只剩 “B”、取流失败误报缺少 cid，以及 `code=0` 但只有 voucher 被误判成功。报告只记录 voucher 有无，不导出其内容。
- Adds bounded device-identity recovery and a manual reset that preserves login. Diagnostics retain API codes and voucher presence, distinguish missing media from missing video metadata, and never export voucher contents.
- 限制：这是设备标识相关故障的恢复措施，不保证解除账号、地区或运营商限制；报告者原设备仍需复验。

## v2.4.0 — premium playback and stability / 会员播放与稳定性

### 播放信息

- 设置新增「Nerd 信息」开关，默认关闭，点播与直播共用并记住选择。音频编码、分辨率、帧率、CDN、已完成媒体请求的下载量/速率、缓冲与丢帧集中显示；普通播放栏移除 AAC 等技术标签。原生直播无法读取的指标显示「—」。

### 会员体验（2026-10-14）

[使用方式、迁移规则与验证范围](docs/MEMBER-EXPERIENCE.md)。

- 新增有效大会员／年度大会员身份标识，显示在侧栏与「我的」页；以登录接口状态与到期信息为准。
- 默认画质改为「自动 · 最高可用」，点播和番剧按账号实际可用片源与电视解码能力选择。4K 电视继续排除 8K；高级音轨仍独立优先，不把 AAC 错当成杜比视界失效。
- 清晰度菜单可在自动和手动档位间切换；手动成功后记住偏好，失败保留原选择，倍速恢复不会偷偷改成手动。大字号下长画质菜单可滚动，遥控焦点保持可见。
- 旧版未标记的 1080P 设置无法区分默认与手选，本次迁移为自动；旧版其他明确档位保留，新版手选 1080P 则按手动保存。

Active Premium badges now appear beside the account identity. Playback defaults to the best available tier supported by the account and TV, with an explicit Auto option and persistent manual choices. Unmarked legacy 1080p settings migrate to Auto; other legacy tiers and new explicit choices remain manual. Premium audio selection remains independent from video quality. Included in v2.4.0.

本版修复会员 4K / Dolby 影院片源退到 1080p、不同编码按码率误选、手动画质失败后的恢复；支持 3996/4096 宽片源，并保留 4K 电视的 8K 回退边界。进一步集成 [PR #17](https://github.com/asdf17128/bili-webos/pull/17) 的特定杜比 120→60fps 路径，仍保留原分辨率和音轨。正式版验收见 [2.4.0 发布记录](docs/RELEASE-2.4.0.md)。适用片源、设备限制及真实测试范围见 [会员播放说明](docs/DOLBY_VISION.md)。

This release preserves supported cinema-width 4K, prefers efficient codecs within the selected quality, restores failed manual switches, and integrates PR #17's source-specific Dolby 120→60fps path. Device resolution limits still apply. See [scope and verification](docs/DOLBY_VISION.md); see the release validation report for final-package testing.

测试包同时修复播放中致命错误后停住且没有重试入口的问题，保留原分 P 和进度进行有限重试；手动 CDN、杜比检测及网络诊断保留接口返回的备用签名地址。诊断测速复用实际成功的地址，不再因丢失备用地址而误报全部不可用。[故障对照与验证边界](docs/TESTCASES.md#2026-10-13其他播放失败排查未发布)。

稳定性验证覆盖真实服务连接故障、播放器切换与退出、直播订阅清理及真机长播，计划与验收标准见 [稳定性测试方案](docs/STABILITY-PLAN.md)。本轮已完成真机 60 分钟 4K 长播、循环/直播耐久与完整本地回归；直播恢复间隔、更新源失败及保留堆增长仍有待调查，详见 [实测报告](docs/STABILITY-RESULTS-2026-10-13.md)，不代表整体验收全绿。后续直播 CDN 轮换与更新检查容错已修复并做本地验证，内存与新包真机复核范围见 [修复报告](docs/STABILITY-FIXES-2026-10-13.md)。

The test package also restores bounded recovery after fatal playback errors and preserves native signed backup URLs in manual routing, Dolby inspection and diagnostics. Reporter-specific CDN 403 responses and account verification blocks still require confirmation on the affected connection.

海外故障新增 [家庭网络检测方案与菲律宾 ISP 实测](docs/NETWORK-TESTING.md)：可在电视同网络的电脑运行匿名诊断，无需账号，报告不含媒体签名。公共 ISP 探针用于定位区域差异，仍需结合故障电视日志。性能测量与长播结果见 [性能记录](docs/PERFORMANCE.md)。

## v2.3.0 — playback recovery and creator follow / 播放恢复与 UP 关注

- 服务请求为 DNS 查询、连接池排队和响应头增加总超时；提前退出会释放尚未建立的代理请求。读取请求在收到响应前断开时换新连接重试一次，避免网络故障后长期等待；写入操作不会重发。
- 点播网络错误或持续卡顿后可在原分 P、原进度重试；网络恢复后最多自动重建播放器两次，耗尽后仍可按 OK 手动重试，返回键退出即取消。
- 播放控制栏和视频卡片长按菜单增加 **关注 UP 主 / 取消关注 UP 主**；成功后同步首页标记，失败不改变状态，重复按键不会重复提交。
- 整合 C9 测试包的显式 DASH 格式及首段诊断。社区 C9 用户在上海移动同片源各测试三次：自动 6.43–7.74 秒、手动腾讯 5.41–5.87 秒，六次均无卡住、网络重试为零。[用户实测](https://github.com/asdf17128/bili-webos/issues/34#issuecomment-6030725380)。这不代表所有机型或网络的起播时间。
- 风控提示建议用官方客户端对照同一账号，不凭一个错误码断言账号被封，也不将媒体 CDN 切换当成 API 风控的解法。
- 开发工具升级到已修补的 ws 8.22；电视服务保留兼容 Node 8 的 ws 7.5.11，Node 0.12 路径补上分片和接收队列上限。

验证范围及限制见 [测试登记](docs/TESTCASES.md)。DNS 服务器或路由器故障仍需恢复网络；应用现在能释放超时请求，并在网络恢复后于原进度重试播放。

This release adds bounded playback recovery and creator-follow shortcuts, incorporates the C9-tested DASH startup fix, and improves verification-error guidance. Request deadlines also cover DNS lookup and connection-pool queues; cancelled proxy requests release their upstream resources. Interrupted reads retry once over a fresh connection within the same deadline, without replaying writes.

## v2.2.3 — player layout and startup diagnostics / 播放器布局与起播诊断

- 修复推荐列表展开后挤压进度条的问题，控制按钮和推荐标签按内容高度排列；从列表返回时，遥控焦点自动回到可见区域。
- **设置 → 网络诊断** 直接显示最近一次起播总耗时及各阶段耗时；扫码报告增加首个媒体响应、媒体就绪、播放事件、重试与编码信息。先播放视频，再返回设置打开诊断即可查看。
- C9 用户反馈 v2.2.2 仍需约 16–18 秒出画面，本版增加定位数据，尚未确认其等待原因或提速效果。详情见 [发布说明](docs/releases/v2.2.3.md)。

Fixes the compressed progress bar when recommendations expand and keeps remote focus visible. Startup timings now appear directly in diagnostics, with detailed media milestones in the QR report. The C9 startup delay remains under investigation.

## v2.2.2 — startup and danmaku / 起播与弹幕

- 起播时并行加载播放器与视频信息、续播位置与取流结果；同一分 P 复用元数据，切换分 P 后仍重新获取正确的流与字幕。
- 弹幕、推荐、缩略图等辅助内容等媒体数据就绪后加载，避免争抢起播资源。
- 弹幕仅查找当前时间附近的记录；密集时最多同时滚动 24 条。暂停时冻结弹幕，前后跳转清掉旧画面，翻译与字号设置保留。
- 网络诊断新增 `startup` 耗时，便于继续定位旧电视上的起播问题。C9 / webOS 4.x 的实际改善仍需社区设备复测。

Player loading overlaps independent requests and reuses resume metadata. Auxiliary content waits for media readiness. Danmaku lookup and concurrent animations are bounded; pause and seek keep the overlay in sync. See [release notes and validation limits](docs/releases/v2.2.2.md).

## v2.2.1 — playback end modes / 播放结束行为

设置 → 播放与显示 → **播放结束后**：

- **自动连播**：按收藏夹、稍后再看或分 P / 合集顺序继续播放；普通视频保留相关推荐倒计时。
- **播完停止**：当前视频结束后停留在播放器，可手动重播或选下一条。
- **单集循环**：从当前视频或当前分 P 的开头重新播放，不跳到列表下一条。

升级前关闭「播完自动播放下一个」的用户会继续使用「播完停止」，不会被自动改成循环播放。修复覆盖收藏夹跨页及失效视频跳转；网络失败和退出期间的迟到响应不会强行切换视频。

Settings → **When playback ends** now offers **Play next automatically**, **Stop after this video**, and **Repeat current video**. Existing autoplay-off preferences remain stopped after upgrade. Based on the report in [#41](https://github.com/asdf17128/bili-webos/issues/41) and the playlist gate identified by @SSSS-VIII in [PR #42](https://github.com/asdf17128/bili-webos/pull/42).

## v2.2.0 — playback, subscriptions and compatibility / 播放、订阅与兼容

- DASH video has **automatic CDN selection** and an HWO1 option. It measures small media ranges while paused or with at least 15 seconds buffered, caches host health, and applies the choice to subsequent requests without restarting playback. Manual choices take priority; native Akamai signatures remain intact. Overseas performance still needs testing on the affected networks.
- Fixed focus loss after fast feed retries and the ranking request context that caused partitions to return `-352`. Anonymous network checks from Hong Kong and Japan now cover all six partitions, video metadata fallback, stream URLs and actual media ranges; these do not replace TV testing on an affected home connection.
- Live playback prefers the faster-starting fMP4 HLS source at the saved quality, with TS fallback. Stream and quality metadata share one request; loading remains visible until playback starts, with bounded retries and a manual retry button on failure.
- Playback recovery and diagnostics now account for exhausted buffers and the selected CDN route. Reports include the last playback node and stall count.
- Favorites has a **Subscriptions** tab for followed folders and creator collections, with pagination and playback across pages.
- webOS 4.x compatibility includes Chromium 53 layout fallbacks and a Node 0.12 service compatibility layer. Community patch: [#34](https://github.com/asdf17128/bili-webos/issues/34).
- Dolby initialization metadata and supported E-AC-3 / FLAC audio tracks are selected independently. Decoder failures during loading fall back; E-AC-3 alone is not a guarantee of Atmos output. Selection/parsing adapted from [PR #17](https://github.com/asdf17128/bili-webos/pull/17). In v2.2.0, the source-specific 4K120 frame transform from that PR was not included; sources above 60 fps or with an unknown frame rate retain their original base-layer signaling.

v2.2.0 补充缓冲耗尽恢复、按所选 CDN 测速和最近播放节点记录；收藏页增加 **订阅**，支持别人的收藏夹、UP 主合集及跨页连播。webOS 4.x 的布局和旧服务运行时兼容基于社区 [#34](https://github.com/asdf17128/bili-webos/issues/34) 补丁。

点播新增 **CDN 自动择优**及 **华为云 HWO1** 选项：暂停或缓冲达到 15 秒后，用小块媒体测速并缓存节点健康状态，后续分片自动采用较快的可用线路，无需重载视频。手动选择优先，保留原始签名地址与失败回退。首次无缓存播放仍立即使用原线路；已在 C4 验证实际分片选路，并在香港、日本出口实测 API 和媒体传输；海外家庭电视的实播仍待当地验证，见 [CDN 验证记录](docs/TESTCASES.md#点播-cdn-自动择优2026-10-06)。直播不套用点播域名替换策略。

已修复快速重试后焦点丢失，以及排行榜请求上下文导致的分区 `-352`。香港、日本匿名出口均通过六个分区、视频信息兜底、取流和实际媒体分片检查，自动选择了各自较快的线路；这仍不代替问题用户家庭网络上的电视实播。详见 [焦点与网络复验](docs/TESTCASES.md#焦点分区与海外网络补验2026-10-06)。

直播保留所选画质，优先使用本机实测起播更快的 fMP4 HLS 源，不兼容或启动超时则回退 TS；取流与画质列表合并为一次请求，真正播放后才结束加载提示，失败可按确认重试。LG C4 三个直播间的播放进度开始推进由约 7.5–9.3 秒缩短至 2.0–3.3 秒；这是本机、本次网络的小样本结果，详见 [直播实测记录](docs/TESTCASES.md#直播起播优化与回归2026-10-06)。

杜比源会读取初始化段中的实际格式，并按设备能力选择 E-AC-3、FLAC 或 AAC；加载阶段解码失败会回退。显示 E-AC-3 只代表所选音轨，全景声是否输出还取决于片源、电视、音响连接和系统设置。部分实现来自 [PR #17](https://github.com/asdf17128/bili-webos/pull/17)，v2.2.0 未包含其中针对特定 4K120 片源的帧变换；超过 60fps 或帧率未知时保留原有基础层信令，避免直接开启杜比信令的已知黑屏风险。webOS 4.x 整机兼容及杜比／全景声输出仍需对应设备实测。

完整更新说明与已知问题见 [v2.2.0 release notes](docs/releases/v2.2.0.md)。#41 在后续 v2.2.1 中修复，见上方播放结束行为说明。
