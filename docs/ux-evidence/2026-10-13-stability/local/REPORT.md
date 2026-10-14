# 本地全量稳定性回归（2026-10-13）

基线 `4eb77e0c14ee04c51ba07739d92dd6bd9a650e73`。执行 `bash tools/verify.sh --no-tv --ux`，2026-10-13 13:15:41（Asia/Shanghai）开始，退出码 **0**。保留完整输出 `verify.log`，结构化结果见 `summary.json` 与各套件 JSON。

| 范围 | 结果 |
| --- | --- |
| Service ES5、TV CSS 兼容、版本一致性、生产 ES2016 构建 | 通过 |
| Service 单测 | 41 通过，0 失败 |
| 真实 Node 0.12.2 / 8.17.0 | 均通过，含排队总期限、GET 重试、退出持久化、代理握手、碎片边界及真实匿名 API/排行榜 |
| Live 选源 / 自动 CDN / 起播统计单测 | 5 / 12 / 7 通过 |
| 媒体选择及杜比单测 | 45 通过，1 明确跳过 |
| 播放意图、三连、错误提示、画质阶梯、i18n、字幕及翻译、弹幕翻译、合集分页等逻辑 | 全部通过，逐项见原始日志 |
| 浏览器遥控/UI、2/3/4 列×字号、慢请求、重试、侧栏位置 | 68/68 |
| 隔离会话与真实 service/HTTP 代理 | 9/9；独立代理退出 3/3 |
| 播放加载、失败恢复、取消、错误重试预算、编码回退 | 44/44 |
| 弹幕渲染/清理 | 6/6 断言，另有 2 条测量记录 |
| 片尾停止/循环/下一条及异步退出 | 26/26 |
| 直播加载、HLS 回退、超时及退出 | 9/9 |
| 播放健康、真实 HTTP Range、错误/短体/超时/取消 | 通过 |
| 浏览器自动 CDN / 原生签名诊断 | 7/7、4/4 |
| 本地网络探针合约（含停滞/403/错范围/隐私） | 通过 |
| 补跑音量均衡 `node tools/test-loudness.mjs` | 7/7 组 |

唯一跳过的是 `BILI_DOLBY_120_CORPUS` 未提供时的完整版权流 35 分片校验；仓库未包含这份媒体。它没有计入通过数。真实 Blob MIME 正对照使用空 MPD 的同一最终解析错误验证多余 HEAD 探测消除，并不是播放失败。

本轮没有产品代码修改、账号写入或电视操作。verify 自行启动的 Vite PID 48381 已退出，5173 端口不再监听。浏览器媒体事件/播放器替身只能证明应用逻辑，不能代替真机解码、长时网络或其他电视型号验收。Node 25 关于未配置 localStorage 文件的警告没有使测试失败。

## 全量基线之后发现并修复的长订阅泄漏

上面的全量回归结果对应 `4eb77e0` 基线。随后资源审计发现 `client.js` 的弹幕/投屏 TV 订阅退出只有 `cancelled=true`，没有执行 webOSTV.js 请求句柄的 cancel。

新增 `tools/test-subscription-cleanup.mjs` 使用完整生产 client bundle 和仓库原版 webOSTV.js 1.2.13，只 stub 平台桥。旧版弹幕和投屏各 20 次退出均为 **created=20 / cancelled=0**；原始失败见 `subscription-before.log` 与 `subscription-before/results.json`。保存句柄并幂等 cancel 后，两条路径均 **20/20**，新套件 **6/6**，见 `subscription-after.log` 与 `subscription-after/results.json`。cancel 异常与无句柄分支只证明容错，不代表该异常环境的桥已关闭。已接入 verify 门禁。

`tools/test-live-stability-tv.mjs` 已新增句柄 cancel、服务 stop、迟到 DOM 的独立观测。它的精确 monitor 函数先通过离线 8 项夹具，见 `live-monitor-offline.json`；此记录明确不是电视执行结果。最终生产修复集的全量回归/真机数据需使用随后单独保存的记录，不能复用前面的基线全绿作为已验证结论。
