# Candidate 3 点播：主动中止

15:08:26 开始、15:08:42 结束。直播复核失败后，通过 SIGINT 请求工具正常收尾，仅 minute 0。不是 60 分钟完成，也不是点播故障。清理监听器、恢复设置、正常 Back 同 document 退出均通过；原始 completion 为 Incomplete soak: SIGINT。
