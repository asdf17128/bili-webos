# 会员画质、Dolby Vision 与高帧率播放

本文描述 **未发布的 2.3.0 premium-test.1 分支**，不是已发布 2.3.0 的能力承诺。相关报告：[issue #11](https://github.com/asdf17128/bili-webos/issues/11)、[#33](https://github.com/asdf17128/bili-webos/issues/33)、[#34](https://github.com/asdf17128/bili-webos/issues/34)，以及 [PR #17](https://github.com/asdf17128/bili-webos/pull/17)。

## 画质与设备边界

- 手动选择严格匹配 qn。接口未提供所选画质时，保留原播放、进度、暂停状态与设置，不误报“需要大会员”。真正加载失败后恢复原视频和音轨。
- 自动起播只向实际存在的较低档位回退。同一会员画质优先选择设备支持的 HEVC / Dolby，其次 AV1、AVC；不同编码之间不按码率大小判断质量。同编码内保留最高码率。
- 放开 Shaka 的面板宽度过滤，同时根据 webOS `PalmSystem.deviceInfo` 保留分辨率边界：3840×2160 电视允许 4096 宽影院片源，但不加载 7680×4320。8K 设备继续允许 8K。未知浏览器不套用电视限制。
- 该边界来自真机失败对照：C4 的 MSE 对 8K HEVC 返回支持，Shaka load 也成功，但播放长期停在 0 秒。单独设置 `ignoreHardwareResolution: true` 不足以证明解码兼容。

## 杜比与音轨

qn 126 的初始化段可能包含实际的 `dvcC`、`dvvC`、`dvwC`，即使 API codec 只写了 `hvc1`。播放器用有界 Range 请求读取初始化段，解析真实 codec，并检查 MSE 能力。Profile 5 不具有 HDR 兼容基础层，不会把原生 `dvh1` 字节冒充普通 HEVC；只有已确认兼容的通用 HEVC Profile 8 才尝试同档基础层。

音轨独立选择 E-AC-3 → FLAC → AAC；切视频画质仍保留可用的高级音轨。显示 E-AC-3 证明选择了该编码，不代表已确认音响实际输出 Atmos。

## PR #17 的特定 120 → 60fps 路径

`dolby120Transform.js`、`dolbyFrameReducer.js`、`dolbyTimingPatch.js` 及其测试移植自 @SSSS-VIII / linn 的 PR #17，提交 `0df9763aa7a1161a5237dff3f93f408c313f9868`。本分支按当前播放器生命周期重新集成，保留贡献者归属；移植不等于 GitHub 上该 PR 已正式合并。

转换仅限 `BV1dCNC6hEzE` / cid `39933052694` / qn 126 的一份已审计 3840×2160 120fps 表示层。它校验身份、编码、尺寸、帧率、完整 hvcC、完整 SIDX、初始化范围及全部 35 个分片范围，再在压缩域删除已证明可安全移除的时间层图片，同步修改 sample 表和 SPS VUI 时间信息。保留 qn、分辨率及每个留存图片的 Dolby RPU；不是重新编码，也不是通用 120fps 转换器。

GOP 依赖、RPU、时间戳、样本数、范围或输出条件任一不符，转换立即拒绝。加载阶段和播放中的转换/解码故障回退到同一 qn 126 的 HLG 基础层，并保留音轨、进度、暂停状态。请求绑定播放代次，旧流响应不能进入新流；转换时禁用分片预取。其他媒体字节不做转换。

其他超过 60fps 或帧率未知的源不启用未经验证的 Dolby 信令；支持的原有基础层仍可播放。

## 实测与复现

2026-10-13 使用有效大会员账号，在 LG C4 / Chromium 120 上进行了旧包与新包对照：Profile 5、Profile 8.4、3996/4096 宽片源、SDR 4K120、HDR 高帧率、PR #17 的 60fps 路径、issue #34 的 4K50。另覆盖 issue #11、遥控切画质、末尾快进、播放中故障回退。结果与限制见 [测试登记](TESTCASES.md#2026-10-13会员画质与-pr-17集成未发布) 和 [证据目录](ux-evidence/2026-10-13-premium-playback)。

本地单测没有提交版权媒体；可通过 `BILI_DOLBY_120_CORPUS` 指定本机完整文件补跑可选 corpus 测试。本轮另在电视中直接读取实际 CDN 的全部 35 个分片，调用生产转换实现逐一校验，媒体字节和签名 URL 不离开电视。

真机维度、codec、进度、解码帧数及原生事件是本轮证据；CDP 截图无法捕捉 GPU 视频层。因此不将它们表述为面板 Dolby 标志、肉眼画面或 Atmos 输出验收，也不外推为 C9 / C6 / 所有电视都已通过。
