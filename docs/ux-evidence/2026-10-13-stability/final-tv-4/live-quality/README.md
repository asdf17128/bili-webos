# Candidate 4：直播多画质补测

在 60 分钟长播及清理结束后，串行执行 `TV_TEST_FILTER='^testLiveQuality$' TV_LIVE_ROOM=34348 node tools/test-ui.mjs`。固定房间提供原画/蓝光/超清三档，**3/3 通过、无跳过、exit 0**：打开选择器，原画 qn10000→蓝光 qn400 实际播放，再切回 qn10000 实际播放。原始 [结果](results.json) 和 [日志](run.log) 保留。

该结果补足全量 smoke 当时房间仅一档的覆盖缺口，不改写原 skip。结束后独立 [首页/设置/订阅核对](../idle-after-quality.json) 通过：无 video/播放器/测试标记，cast=1、直播订阅=0、relay inactive，设置摘要与补测前一致。没有真实账号列表写入。
