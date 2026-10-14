# 同页循环工具：暂停位置断言修正

旧表达式只判断 `after.time - before.time < 0.15`。从 37 秒倒退到 0 秒是负值，会被错判为暂停位置稳定；仍在播放但两次采样只相差 0.04 秒也会通过。

工具现在同时要求 `after.paused` 和绝对时间差小于 0.15 秒。这是**测试工具假通过**，不是声称真机播放器发生了上述两个合成故障。

`recheck.mjs` 执行保存的旧表达式和当前工具中提取的实际函数；[结果](results.json) 为旧 2/4 正确、新 4/4 正确。正常暂停仍通过，倒退、未暂停和明显前进均拒绝。工具 `node --check` 通过。

```sh
node docs/ux-evidence/2026-10-13-stability/lifecycle-predicate/recheck.mjs
node --check tools/test-playback-lifecycle-tv.mjs
```

没有连接电视、修改生产代码或重新构建包。最终 candidate 4 同页循环使用此修正后的工具；旧候选记录不重写。
