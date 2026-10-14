# 安装与实际执行核对

最终 `stability-test.2` 的 IPK SHA256 是 `f3c53563d051313e2cfb61c2b30da57602b7378a8e647075a5a1900e3f162a6c`。`environment.json` 对比了六个前端 JS 文件和服务文件的已安装字节哈希，全部一致；也用 CDP `Debugger.scriptParsed` 确认实际执行的是候选包的 `index-legacy-DwzW6dmt.js`，验证后立即禁用 Debugger。

第一次尝试用 `performance.getEntriesByType('resource')` 获取文件协议下 SystemJS 加载的入口，结果为空。`installation-resource-probe.json` 保留这次观测不足：文件已匹配，但没有入口执行证据。改用运行时脚本解析事件后取得证据，没有修改产品或放宽比对。

复测命令：`node tools/verify-stability-package-tv.mjs <environment.json>`。清单只记录设备型号、运行时和登录布尔值；不记录 Cookie、用户信息或 SSH 凭据。
