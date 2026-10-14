# 首次全量失败：测试过早读取 replacement load

候选 3 首次 `verify --no-tv --ux` 的播放器为 69/70，唯一失败是 `critical runtime error while paused: media`：`undefined !== 47`。原始退出码 1、完整日志、结果和本次失败截图分别保存在 `verify-ux-first-failure.log`、`first-failure/`，没有覆盖。

原因是受控 decoder 的 `load()` 先递增 `__probe.loads`，随后异步读取 Blob MPD，完成后才写 `positions`。用例仅等待 `loads===2` 就断言第二个位置；它观测到的是 replacement load 已调用，不能证明 MPD 读取或恢复完成。

为证实这一点，仅对 `runtime-media` 第二次受控 `load()` 加入可显式释放的等待，不改产品源码。保留旧等待条件时稳定为 0/1，仍是 `undefined !== 47`（`observer-before/`）。修正用例先证明第二次读取仍 pending、释放等待，再等待 `positions.length===2` 且 loading 消失后，媒体/网络两种路径 2/2 通过（`observer-after/`）。位置仍必须等于 47，未放宽产品结果断言，也未以任意延长 sleep 代替完成条件。

该可控等待保留在测试中，防止以后再次用调用计数冒充恢复完成。随后完整两门禁的最终结果由 `source.json`、`REPORT.md` 记录。该测试问题与候选 2 真机暂停回退到 0 的产品缺陷分开记录；后者已有独立真机时间线和生产修复。
