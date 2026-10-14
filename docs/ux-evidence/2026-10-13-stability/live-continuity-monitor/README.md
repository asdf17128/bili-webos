# 直播连续交付判据与工具自测

`tools/test-live-stability-monitor.mjs` 执行实际真机工具中的监测、历史探针和判定函数，**21/21 通过**。结果见 [results.json](results.json)，完整输出见 [run.log](run.log)。本地验证覆盖正常/异常退出清理、停交付与安静房间区分、时钟差、请求期间恢复、非聊天事件不能掩盖聊天停止、安全诊断字段、未验证不得全绿，以及历史请求超时取消一次并忽略迟到响应。它不替代电视耐久。

```sh
LIVE_MONITOR_OUTPUT=docs/ux-evidence/2026-10-13-stability/live-continuity-monitor \
  node tools/test-live-stability-monitor.mjs
```

## 候选 3 实际数据复核：FAIL

[candidate3-reassessment.json](candidate3-reassessment.json) 将实际真机数据送入相同 `assessDelivery` 判据，结果为 `active_room_relay_stale`。原工具 45 项通过但只检查累计帧，漏掉中途停止；[原始结果与两次独立探针](../live-candidate3-stalled/) 完整保留，SHA256 与复核引用一致。

第 5–15 分钟 frames/events 固定为 **216/956**。两次只读房间历史分别观测到北京时间 **15:02:00**、**15:08:12** 的新聊天，说明房间仍活跃。旧工具未记录精确 `lastFrameAt`，复核保守地将首次探针观测时间当作最后交付的上界：至少 **371,927ms（6 分 12 秒）** 没有新交付；这不是伪造精确最后帧时间。探针只保存数量和时间，不包含聊天正文。

同轮视频发生 **1 次自动恢复**，最大进度采样间隔 **13.103 秒**，另属 `needs_review`，不能描述为全程流畅。后续候选包必须重新完成真机直播耐久，本目录不宣称修复包已通过。

新工具将安静房间/独立探针失败记为未验证，短暂 relay 退避记为待复核；只有独立新聊天证据与持续停交付同时存在才判该类产品失败。`gatesPassed` 与最终 `pass` 分开，待复核不会返回全绿。
