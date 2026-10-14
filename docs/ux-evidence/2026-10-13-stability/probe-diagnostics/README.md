# 分钟 API 探针诊断补强

只修改直播与长播测试工具，生产代码和门禁不变。解析失败现在保留 HTTP status、decoded bodyLength（JavaScript 字符串代码单元数，不是传输字节）和固定 bodyFormat/errorCategory；Luna onFailure 或同步异常只保留数值 errorCode 及白名单类别，不导出错误原文、响应体或 URL。

- [最终专项 34/34](results-final.json)：直接提取两工具的实际解析/分类函数与 request 通路，以 JSON、非 JSON、空、非法 base64、非文本及六类失败夹具运行，结果含最终工具 SHA256。
- [直播工具 21/21](live-monitor/results.json)：原有连续交付、历史探针及清理工具测试重跑。
- [长播监测 8/8](soak-monitor/results.json)：原有进度间隔、分段帧计数与清理工具测试重跑。
- [首次提取边界错误](live-monitor-first-attempt.txt)：新增 helper 位置与既有 sampleHistory 文本提取边界冲突，移动 helper 后重跑通过，没有降低断言。

这些诊断只作用于之后的运行。候选 4 直播 minute14/15 的原始 failed:true 无法据此追溯 HTTP 状态或解析原因；后续 HTTP200/version2.3.0 只证明后续请求恢复，不能改写原失败。
