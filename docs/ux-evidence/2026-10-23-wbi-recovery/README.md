# WBI 异常密钥缓存修复（本地，未发布）

在 v2.4.0 / `2af1277` 及诊断分支 `d5576e3` 的 `getWbiKeys` 中，nav 返回 HTML/503 元数据或缺少 `wbi_img` 时，两个空串被缓存十分钟。下一次独立请求不会重新获取密钥，真实 `signWbi` 生成的签名缺少 mixin。隔离正对照可稳定复现；这不证明它就是 #50/#51/#52 报告的现场根因。

修复仅允许两个完整 32 位字母数字密钥进入缓存，保留匿名 `code=-101` 提供有效密钥的情况。失败不缓存，下一次独立请求可恢复；TTL 从成功响应时开始，时钟回退使缓存失效。不自动重试风控接口、重置身份或扩展数据采集。

最终验证：

| 检查 | 旧源 | 最终源码 |
| --- | --- | --- |
| 同一 WBI 单测 | 5 通过 / 13 失败 | 18/18 |
| 真实客户端三传输与代际 | 7 通过 / 6 失败 | 13/13 |
| 默认 npm test | — | 133 通过 / 0 失败 / 1 跳过 |
| 诊断隐私及 QR 解码 | — | 9/9 |
| 最终播放器定向回归 | — | 5/5 |
| 生产构建、7 个包 ES2016 解析 | — | 通过 |

跳过项是已有外部 Dolby 35 分片 corpus 缺失。较早完整播放器回归 76/76 发生在移除初稿 pending 合并之前，保留 `player-intermediate.json`，不冒充最终源码完整重跑。最终只复跑相关五项，以减少重复资源占用。没有重新跑整个 `verify.sh`。

独立复审在未发布初稿中发现 pending 合并会跨越 auth generation，使退出后的首个新请求继承旧请求的错误。真实 `client/storage/wbi` 与 `api.logout()` 内存夹具复现后，已移除合并，保留原来的独立请求行为。最终老请求拒绝、新请求成功，见 `session-audit.json`；没有真实账号或设备操作。

浏览器从空白 fixture 页面导入实际 `client.js`/`wbi.js`，mock 仅位于 proxy、bridge、Luna 边界，所有非应用网络均拦截。初跑代理夹具漏配 loopback 地址而被拦截；修正后全部重跑。默认测试初跑被沙箱拒绝临时 TCP 监听，获准本机运行后重跑通过。这些工具失败不计产品失败。

复跑命令（已有依赖，另行启动隔离 Vite）：

```sh
node --test app/src/api/wbi.test.js
WBI_BASE_URL=http://127.0.0.1:5197 node tools/test-wbi-recovery.mjs
git show d5576e3:app/src/api/wbi.js > /tmp/bili-wbi-baseline.js
WBI_SOURCE=/tmp/bili-wbi-baseline.js WBI_BASE_URL=http://127.0.0.1:5197 node tools/test-wbi-recovery.mjs
npm test
DIAG_BASE_URL=http://127.0.0.1:5197 node tools/test-diagnostic-privacy.mjs
LOADING_BASE_URL=http://127.0.0.1:5197 LOADING_FILTER='video information|startup report|Luna requests|member default|diagnostics without' node tools/test-player-loading.mjs
```

原始结果、源码哈希、已测与未测范围见 `summary.json` 及相邻文件。现代 Chromium、传输夹具与语法解析不代替真实旧浏览器。服务代码未变，之前真实 Darwin Node 0.12/8 的通过记录保留，本轮未重复执行。电视空闲未知，未查询、安装或启动；真机 UI/二维码与完整 smoke 仍待验收，未获豁免。未提升版本、推送或发布。
