# Candidate 4：直播弹幕持续交付与资源回收

本地专项 **22/22 通过**，相同新断言对 [保存的旧源码](../relay-before/danmaku-baseline.js) 为 **0/22**。证据分别为 [旧结果](../relay-before/results.json)、[旧日志](../relay-before/run.log)、[新结果](results.json)、[新日志](run.log)。这里包含新增诊断合约，不代表发现了 22 个互相独立的产品缺陷。

旧源码 SHA256：`b2c1d057f7b0dfa4b0e5c70fe8b7e5513ce72d2587730491af24f8a737863506`。

新 `danmaku.js` SHA256：`0d2acd8c32e34abe50258d4e0a580437682882c0a23c8e9439ee2b73e4ef31a4`。在 candidate 4 打包前已冻结；补充真实 socket 测试期间未再修改生产源码。

## 现场事实与结论边界

Candidate 3 直播 15 分钟现场中，接收计数在第 4 分钟之后停在 216 条弹幕、956 个识别事件。独立历史接口两次返回该房间刚产生的新聊天，证明房间仍活跃，而当前 relay 已停止向 App 交付新消息。视频、主站/直播 API 仍可用；某次视频重试恢复与 relay 交付分别记录。

没有取得当时的内部 WebSocket/重试历史，所以**不能断言现场就是累计预算耗尽，也不能将此归为历史“约 20 分钟后所有请求失败”的根因**。本次修复覆盖的是源码中可独立复现的停止/无期限机制；candidate 4 真机持续交付验收由主任务另行记录。

## 已复现机制与新行为

| 范围 | 旧实现 | 新实现与专项 |
| --- | --- | --- |
| 健康连接后重试预算 | `gotData` 只在整个 relay 生命周期第一次原始 message 时重置，之后累计 4 次重连关闭即永久不再连接 | 连续失败按 3/6/12/30/60 秒退避；认证成功、连接持续至少 30 秒并收到有效心跳/消息后恢复预算。7 段健康连接/重连仍交付，短暂 auth 成功不洗掉失败预算 |
| 持续故障 | 旧 4 次停止没有通知，服务仍持有 stop 函数 | 一次一个连接和重试，退避最大 60 秒，持续故障低频探测；状态明确为 backoff，并给出下一次时间。12 次连续故障后仍可继续，不做忙循环 |
| 认证 | 任意首包算 gotData，未检查 op8 code | 仅数字 code=0 认证成功；拒绝记录 auth-rejected/code，并至少等待 60 秒。不刷新 token、不替代凭据，不宣称修复 token 过期 |
| 超时与安静房间 | 无握手/auth 期限；只发心跳，不检查回应 | 连接/auth 各 10 秒；认证后立即发送心跳，之后每 30 秒，回复期限 20 秒。虚拟 10 分钟无人聊天但心跳正常不重连；19 秒延迟回应仍通过；半开超时后终止并恢复 |
| 迟到回调与退出 | 旧 socket 回调引用全局 ws；stop 不立即清已排队 retry，晚消息仍可能交付 | 每连接代际/身份检查，所有 deadline/interval/retry 清理，旧 open/message/error/close/send callback 不影响新连接或退出页 |
| 实际状态 | `danmakuActive` 仅代表 stop 函数存在 | `stop.getState()` 返回脱敏快照；服务 `danmakuState` 包含 phase/connected、连接/失败/收包计数、最后收到 packet/message/event/heartbeat 的时间、close/auth code、错误类别和 retryAt。`danmakuActive` 反映已认证连接状态 |
| 旧 ws 真实底层资源 | ws@1 的 CONNECTING close/terminate 未结束内部 HTTP 请求；OPEN close 等待对端回应 | 每连接独占 Agent 捕获自己的 request/socket，失败或退出时 abort/destroy；无需修改 vendor。真实本机实验见下一节 |

消息解析处理合并包、压缩嵌套包、认证和心跳控制包，校验包头/包长，并限制递归深度。认证前聊天/心跳不能冒充认证。诊断不包含 Cookie、token、房间正文或用户资料。

## 真实 ws-legacy 资源实验

使用仓库实际 ws@1.1.5，在当前宿主 Node 运行；通过隔离加载强制选择 legacy 分支。真实 TCP/TLS/HTTP/WebSocket 生命周期，没有电视或公网请求。临时 localhost 自签证书由本机 OpenSSL 生成，用后删除。

| 本机故障点 | 旧实现结果 | 新实现结果 |
| --- | --- | --- |
| TCP 已连接，TLS 握手停滞，调用 stop | 1 个客户端 socket 仍存活，0 个 socket close | 1 请求 close、1 socket close，客户端和 fixture peer 均归零 |
| TLS 已完成，服务端收到 Upgrade 但不返回 HTTP 101，调用 stop | 1 个客户端 socket 仍存活，HTTP 请求未结束 | 1 请求 close、1 socket close，双方归零 |
| HTTP 101 已完成，OPEN 后服务端不回应 WebSocket close | 客户端仍处于 CLOSING，150ms 后仍有存活 socket；旧库可继续等待约 30 秒 | 客户端 socket close，双方归零；升级后的 HTTP 请求按 upgrade+socket close 验收，不错误要求请求再次产生 close |
| TLS 停滞超过真实 10 秒期限，再观察自动恢复并 stop | 10.5 秒仍有原客户端 socket，无恢复期限 | 原 socket 关闭，约第 13 秒新建唯一重试连接；最终 2 请求/2 socket/2 socket close，双方归零 |

所有 stop 用例同时确认退出后没有迟到重连。真实资源判据观察请求的 close/upgrade 和客户端 socket 的 destroyed/close；不能只凭 fake WebSocket.close 调用次数或 `readyState=CLOSED` 通过。

首轮真实夹具故意设置 server `allowHalfOpen=true`，导致客户端已销毁时远端仍自行保留半开 socket，四项误判失败。该 [首次夹具结果](initial-harness-failure.json) 保留。纠正远端 FIN 行为并追加真实客户端资源配对后，新通过、旧失败；此更正没有改动生产代码，不能宣传为又发现四个生产泄漏。

## 复跑与限制

```sh
RELAY_STABILITY_OUTPUT=/tmp/bili-relay-after node tools/test-live-relay-reconnect.mjs
RELAY_SOURCE=docs/ux-evidence/2026-10-13-stability/relay-before/danmaku-baseline.js \
  RELAY_STABILITY_OUTPUT=/tmp/bili-relay-before node tools/test-live-relay-reconnect.mjs
```

旧源码复跑故意退出 1。工具需要当前仓库依赖和本机 OpenSSL，默认包含约 13 秒的真实超时/恢复实验；其余 18 个用例使用虚拟时间，不能把“虚拟 10 分钟”写成真机耐久。服务订阅取消另外 [5/5](service-subscriptions/results.json)，两份生产文件 ES5 解析通过。

这是现代宿主运行真实旧 ws 库，不是旧 Node 0.12/8 二进制内的完整 TLS 弹幕验证。旧运行时完整门禁、candidate 4 真实认证/心跳/15 分钟连续交付及最终 60 分钟结果仍由对应测试记录。以前只检查“错误后最终停止”的 relay 6/6 不包含持续交付要求，不能继续沿用为本轮新版验收结论。
