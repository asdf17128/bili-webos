# 取流风控恢复验证

- `service-before.json` / `service-after.json`：旧版失败对照与生产服务修复验证；隔离 HTTP 和磁盘，不是报告者现场。
- `node012.log` / `node8.log`：官方旧 Node macOS 二进制运行生产服务的结果；不替代旧电视 TLS。
- `diagnostics.json` / `voucher-diagnostic.png`：受控网络诊断与实际二维码解码。
- `tv-ui.json` / `tv-identity.json`：C4 UI 冒烟与真实设备标识重置后 4K 播放。
- `package.json`：候选源码、发布 IPK 与电视安装文件哈希、实际加载入口。

覆盖范围与失败/跳过项见 [验收记录](../../RELEASE-2.4.1.md)。
