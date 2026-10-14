# Candidate 2 真机补充调查

本目录两条本地门禁的原始通过记录保留不变；它们不能代替最终真机验收。

随后新增的真机暂停倍速往返检查曾在 `blob` 源、`readyState=4` 时记录 `paused=true`、时间 0，而原位置约 14.95 秒。该工具当时没有等待应用 `loading` 结束，可能观察到了恢复过程的中间状态。当前为 **待调查**，不能据此认定产品缺陷或认定恢复成功。主任务正在同一测试包记录完整时间线，并以实际加载完成为门槛重新检查。

本地 66 项播放器夹具中的恢复位置断言证明应用向 Shaka `load` 传入已捕获的位置；受控解码器不能证明电视硬件最终已完成 seek。Shaka 本地源码 `lib/media/video_wrapper.js` 在 metadata 后启动 playhead 定位并处理异步重试，应用则在 `await loadDash` 之后才结束切换 loading。完整真机时间线决定是否需要生产修改；本说明写入时未因该观察修改生产代码。

## 后续结论

同包增加完整时间线并在 loading 结束后再等待定位 15 秒，仍保持 time=0；因此确认真实故障。见 [真机时间线](../../regression/speed-paused-candidate2-timeline/README.md)。Candidate 2 已由 candidate 3 替代；本目录的本地通过记录仍有效地描述当时覆盖，但不作为最终发布候选的完整验收。


后续同包时间线已排除过早观测：等待 15 秒后仍处于 time=0 且没有 seek，确认候选 2 的原生暂停模式返回 DASH 缺陷。见 [真机时间线与分类](../../regression/speed-paused-candidate2-timeline/README.md)。本目录本地通过记录仍然真实，但候选 2 已被后续生产修复替代，不作为最终验收；最终候选 3 的门禁另存 `../final-3/`。
