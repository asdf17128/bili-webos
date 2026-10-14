# 海外与家庭网络验证

## 先取故障发生地的证据

2026-10-13 核对现有报告，只有 [#35](https://github.com/asdf17128/bili-webos/issues/35)
明确提到菲律宾、PLDT 转 Converge ICT、电视使用 5GHz Wi-Fi。#29、#48 的所在地
与 ISP 尚未确认，不能把其他国家的云主机测试算作报告者当地验证。

优先在故障电视上播放原片，然后打开「设置 → 网络诊断」，保存扫码报告和发生时间，
尽量在重启 App 前完成。电视报告能反映实际登录态、签名地址和播放器；电脑匿名测试
不能代替这层证据。本轮测试包已修复诊断丢失原生备用路径/签名的问题。

给用户的完整步骤见 [家庭检测快速指南](NETWORK-CHECK-QUICKSTART.md)。工具不修改
网络配置，也不会自动上传报告。维护者可生成便携包：

```sh
python3 tools/package-network-check.py --output /tmp/bili-network-check.zip
node tools/test-region-network.mjs --local --bvid BV1sapi6qE72 --output /tmp/bili-home-report
```

无需 npm install。Node.js 18+ 与 Python 3 运行生产 CDN 候选和排序代码，检查系统 DNS、
六分区、匿名取流、候选地址首部/中部两段各 256 KiB、选中线路额外 64 KiB。所有请求
均有期限。API 的 HTTP 状态与 B 站业务 code 分开保存。报告排除账号 Cookie、匿名
指纹、用户出口 IP 和带签名媒体 URL；BVID、目的地址和时间保留用于关联问题。

同网络分别保存三轮，正常/故障时各一组更有价值。`-101` 是匿名 nav 的正常业务结果；
`-352`、HTTP 403、DNS 失败、连接拒绝、响应体超时需要分别排查。CDN 域名首页的
403 不代表带有效签名的媒体 Range 请求失败。小片段速率包含延迟，不能据此承诺持续
4K 吞吐。匿名源可能只有 qn 32，会员与硬件解码仍须电视验证。

电脑若显示 `proxyConfigured: true`，须确认与电视出口一致；系统 DNS 和代理实际
解析也可能不同。本机工具验证出口为 HK 且使用已配置代理，不是菲律宾家庭实测。

## 菲律宾公共 ISP 探针

使用 [Globalping 官方 API](https://globalping.io/docs/api.globalping.io) 和
[探针选择说明](https://github.com/jsdelivr/globalping/blob/master/README.md)，按
`country=PH`、ASN 和 `eyeball-network` 标签严格筛选。AS17639 为 Converge、AS9299
为 PLDT，各取两个探针；结果另检查国家、ASN、标签，缺少探针会明确报出，不改用
其他地区云主机。

```sh
ISP_OUTPUT=/tmp/bili-ph node tools/test-isp-network.mjs
# 用上一轮 HTTP measurement id 复用相同探针，三轮公共站/B站/指定 DNS 对照：
ISP_PROBES_FROM=<measurement-id> ISP_HTTP_COMPARE=1 ISP_OUTPUT=/tmp/bili-ph-compare \
  node tools/test-isp-network.mjs
```

这里只向公共服务提交固定的匿名 API、DNS 域名和公共连通性对照；不提交电视信息、
Cookie 或媒体签名。Globalping 使用自己的 HTTP User-Agent，且探针不是报告者的
设备。官方 [HTTP 测量说明](https://blog.globalping.io/get-performance-metrics-website-or-app/)
及 [API schema](https://api.globalping.io/v1/spec.yaml) 描述了耗时和 resolver 参数。
工具完成测量不表示目标网络全部成功，必须检查每个 result。

2026-10-13 同四个探针、三轮结果：

| 网络 / 城市 | 公共站 HTTPS | B站 nav，默认 DNS | B站 nav，指定 1.1.1.1 |
| --- | --- | --- | --- |
| Converge / Calamba | 3/3 HTTP 200 | 3/3 HTTP 200，234–237ms | 3/3 HTTP 200，201–250ms |
| Converge / Quezon City | 3/3 HTTP 200 | 3/3 ECONNREFUSED | 3/3 ECONNREFUSED |
| PLDT / Taguig | 3/3 HTTP 200 | 3/3 HTTP 200，131–168ms | 3/3 ECONNREFUSED |
| PLDT / Quezon City | 3/3 HTTP 200 | 3/3 ECONNREFUSED | 3/3 ECONNREFUSED |

成功的 B 站响应均为匿名 `code=-101`，证明传输可达。失败的 Quezon City 初次原始
响应指向 `103.151.151.4:443` 连接拒绝。两个 Quezon 探针带有相同运营者标签，不能
算成四个完全独立家庭；同 ASN 其他探针成功，也不能据此认定整个 ISP 故障。可能涉及
节点分配、路由或探针环境，尚不能区分。统一换 1.1.1.1 未见改善，不能作为默认建议。

五组 DNS 查询在四个探针上均 NOERROR；HWO1 在两个 Quezon 探针耗时约 2611ms，
另两个为 410ms、759ms。DNS 成功不能证明 HTTPS 或视频可达，也不能由单次慢解析
断言它造成播放卡顿。

脱敏结果见 [初次测量](ux-evidence/2026-10-13-regional-performance/globalping.json) 和
[三轮对照](ux-evidence/2026-10-13-regional-performance/globalping-http-compare.json)。
每条记录保留 measurement id，可通过官方 API 回查。本轮未测菲律宾签名媒体吞吐，
尚需报告者在家庭网络执行上述脚本并提供电视诊断。

## 验证工具本身

`node tools/test-region-probe.mjs` 用本机 HTTP fixture 验证真实 Python Range 读取、
403、错误范围、响应体停滞期限、HTTP 412 / code -352、IP 脱敏和系统 DNS。已加入
`verify.sh --ux`，缺少 Python 3 时明确跳过。便携 ZIP 另在无 node_modules 的独立目录
解压运行；缺少 Python 时应退出并保留失败报告，不能悬挂或输出成功。
