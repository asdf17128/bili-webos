# 已完成视频从头播放（2026-11-07，未发布）

用户要求已看完的视频重新打开从头播放，未看完的视频继续原位置。已完成历史项保留原分 P／集，不擅自跳回整部视频的第一 P。

原实现先给解码器传入过滤后的续播点，却在加载后再次 seek 到原始片尾位置；历史 `progress=-1` 也被误当作普通自动续播。现在两处起播使用同一归一化位置，`-1` 直接从头播放。完成判断以实际选中分 P 的媒体时长为准，兼容历史整秒记录与媒体小数时长；不再以“最后 10 秒”笼统判断完成，因此 8 秒短片看到 2 秒、100 秒视频看到 95 秒仍保留续播。

播放结束时立即保存该 CID 的完成进度并上报心跳。最近两分钟、同账号且 CID 有效的本机记录可在普通自动续播中优先于尚未同步的服务器结果；旧格式、过期记录、其他账号或无效 CID 不覆盖服务端。显式历史位置、投屏位置及选 P 继续按各自启动意图处理。退出保存移到媒体元素被移除、解码器销毁之前，保证重新观看后的新进度能覆盖旧完成记录。原列表进度条数据格式保持兼容。

## 本地验证

[摘要](validation-summary.json)：

- `node tools/test-playintent.mjs`：15/15，通过完成标记、时长边界、短片、未知时长和无效进度。
- `node tools/test-player-resume.mjs`：[19/19](resume-results.json)，运行前后生产源码哈希一致。每例同时断言解码器起播参数、最终 `currentTime` 和后续 seek，覆盖分 P、番剧、本地记录隔离及“结束 → 立即重开 0 → 新观看 37 秒后退出 → 再开 37”。
- `node tools/test-playback-end.mjs`：[26/26](end-results.json)，覆盖播完停止、单集循环、下一集、收藏列表、稍后再看和异步退出。
- `LOADING_FILTER='failed resume metadata|startup overlaps|PGC result envelope' node tools/test-player-loading.mjs`：[6/6](startup-results.json)。
- `CONTROLS_FILTER='More closes and cancels' node tools/test-player-controls.mjs`：2/2。结束时允许上报观看心跳，仍断言未完成的长按不会触发点赞／投币／收藏操作。
- 生产构建通过，7 个 JavaScript 产物可按 ES2016 解析。构建保留现有的大 chunk 提示。

这些是本地真实 React 页面与受控媒体状态的测试，所有外部请求均截获，账号与视频均为合成数据；没有运行真实视频解码、操作电视、执行真实账号写操作或发布。
