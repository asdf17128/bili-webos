# 2.4.0 发布验证证据

- `nerd-before.json`：旧播放器对照；无法展示开关对应面板，失败保留。
- `nerd-browser.json` / `nerd-live-browser.json` / `nerd-browser.png`：受控浏览器的开关、记忆、数据及未知字段测试。截图不代表真实视频解码。
- `nerd-tv-runtime.json`：电视运行时读取到实际尺寸、codec、媒体请求字节和隐藏行为；不包含 GPU 视频画面认证。
- `membership.json`：会员标识、最高画质、手动/自动切换与 E-AC-3 正向样本。
- `premium-first-failure.json`：首次 25 秒切换超时，原样保留。
- `premium-recheck.json`：同包完整杜比专项复测。
- `premium-six-rounds.json`：6 轮切换的 30 项检查；网络观察中的 16 条 aborted 均为主动取消。
- `lifecycle.json`：20 轮解码退出和 5 次提前退出，含资源清理、焦点与堆采样。

长播、直播耐久按用户要求延期；最终安装包哈希另附。用户手动打开电视并确认能看到 BiliTV，自动唤醒未经验证；运行时计数不能证明 HDR 标识、色彩或音响 Atmos 输出。原始账号截图、媒体地址和完整浏览器堆不公开。

`nerd-wheel-before/after.json`：未登录滚轮焦点回归，修前失败、修后通过。

`soak-interrupted.json`：用户要求延期长播，SIGTERM 主动终止，不代表 25 分钟验收通过。
