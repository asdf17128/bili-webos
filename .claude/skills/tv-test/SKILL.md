---
name: tv-test
description: bili_webos 的测试与验证方法论 — 发版前验证管线、真机 CDP 测试、旧设备(webOS 5/Node 8)兼容、修 bug 的验证纪律。改动 service/ 或 app/、修 bug、发版前都应使用。
---

# bili_webos 测试与验证

## 一键管线(发版前必跑)

```bash
bash tools/verify.sh          # 全链路:语法 → 真Node8 → 构建 → 部署 → 真机DOM检查
bash tools/verify.sh --no-tv  # 只跑本地层(电视不在时)
bash tools/verify.sh --full   # 额外跑真机 UI smoke(test-ui.mjs,~3分钟)
```

五层,逐层 fail-fast:
1. **syntax** — service 全部文件用 acorn 按 ES2017 解析(webOS 5 = Node 8)
2. **node8** — docker `node:8`(x86)跑**真实 service.js**:stub webos-service、驱动 fetch handler 真连 api.bilibili.com、调 getDiagnostics。见 `tools/test-node8/`
3. **build** — vite 生产构建
4. **deploy** — build.sh 部署 + `tools/launch.mjs` 重启 app
5. **device** — CDP 断言:卡片>5、侧栏存在、0 张裂图,并存截图

## 验证纪律(血泪教训,违反必翻车)

1. **正对照原则:先证明测试方法能复现 bug,再声称修复已验证。**
   做法:`git checkout <旧commit> -- <文件>` → 部署坏版 → 同一操作复现 bug → 恢复新版 → 同一操作确认消失。边缘滚动 bug 连续两个版本"修好了"都是假的,就是因为没做正对照。
2. **失败路径必须测。** 诊断页/错误处理类功能,happy path 全绿毫无意义 —— 用 Playwright `route.abort()` 掐断 API,确认错误文本上屏、进报告。
3. **测试结果反常时,先验证测试工具本身。** 在页面挂原生事件计数器(`document.addEventListener('mousemove',...,true)`)再注入 CDP 事件 —— 曾经 CDP 鼠标注入静默失效,把"工具坏了"误判成"产品坏了"浪费了一整轮。
4. **交互语义用受信输入管线验证**:`npm run dev` + Playwright(`page.mouse`/`page.keyboard` 走真实 Chromium 输入管线),`addInitScript` 干掉 `window.webOS` 强制走 proxy,`page.route` mock 数据流(mock 端点注意 wbi 路径:`**/top/feed/rcmd**`)。TV 的 CDP `Input.dispatchMouseEvent` 不可靠,不要依赖它测 hover。

## 旧设备(webOS 5/6)兼容

- **service 层 = Node 8**:没有 `URL`/`URLSearchParams`/`globalThis` 全局、没有 `?.`/`??`/optional catch binding。`new URL` 要写 `require('url').URL`(曾导致 webOS 5 全部请求失败,#10/#13)。`ws` 必须 v7(v8 要 Node 14)。
- **app 层 = Chromium 68(webOS 5)/ 79(webOS 6)**:vite legacy 插件管语法;要防的是缺失的全局(globalThis 已 polyfill)和新 Web API。
- **官方模拟器**:VirtualBox Emulator 只到 webOS 6.0 且 x86-only(Apple Silicon 跑不了);Simulator 只覆盖 webOS 22+。→ 所以用 docker node:8 测 service,这是最接近真机的手段。
- 新增 service 依赖/语法时:`npx acorn --ecma2017 --silent <file>` 快速把关。

## 真机工具箱(tools/)

| 工具 | 用途 | 坑 |
|---|---|---|
| `launch.mjs <appId>` | 启动/切换 app | **必须 luna-send-pub**(公共总线);私有 luna-send 对 prisoner 永远 Permission denied |
| `wake.mjs` | WoL 唤醒电视 (MAC 14:7f:67:a1:6b:56) | |
| `drive.mjs "keys"` | 遥控按键 + STATE | 从未知焦点开始导航不可靠,先 `left,left` 回侧栏 |
| `point.mjs "move:x:y,wheel:d,click"` | 指针模拟 + focus/underPointer/match | 注入可能静默失效(见纪律3);端口已改 ephemeral |
| `eval.mjs "<expr>"` | 页内执行 JS | 验证 UI 状态首选(截图对 GPU 层是白的) |
| `screenshot.mjs` | 真机截图 | 视频/GPU合成层截不到 |
| `test-ui.mjs` | 真机 UI smoke 全家桶 | app 须在前台 |
| `test-e2e.mjs` | API 集成测试 | 需先 `node proxy/server.js` |

## 专项验证清单

- **QR 码功能**:报告体必须纯 ASCII(CJK percent-encode 后 1 字变 9 字,QR 密到扫不出);用 jsQR 从**真机截图**解码验证,再开解码出的 URL 确认 GitHub 表单预填(body 在第 3 个 textarea,前两个是 GitHub 反馈组件)。
- **诊断页**:真机 happy path 全绿 + dev 掐断 API 全红,两头都要。
- **播放器改动**:`ended` 决策逻辑(收藏连播 vs 分P)可用真实数据在本地 node 里跑决策函数做确定性验证,比 flaky 的真机播放可靠。

## 丰富本 skill

每次踩到新坑/建立新方法,追加到对应小节。宁可啰嗦,不可失传。
