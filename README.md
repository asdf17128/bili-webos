<div align="center">

<img src="docs/screenshots/icon.png" width="80" alt="BiliTV" />

# BiliTV for webOS

### 把喜欢的 B 站，搬到客厅。

在 LG 电视上看视频、直播和弹幕，追喜欢的 UP 主。

**中文** · [English](README.en.md)

[**下载安装**](https://github.com/asdf17128/bili-webos/releases/latest) · [**Homebrew Channel**](https://repo.webosbrew.org/apps/com.biliwebos.app/) · [更新日志](CHANGELOG.md)

![最新版本](https://img.shields.io/github/v/release/asdf17128/bili-webos?color=fb7299) ![支持平台](https://img.shields.io/badge/LG%20webOS-5.0%2B-34363e) ![许可证](https://img.shields.io/badge/license-MIT-34363e)

<img src="docs/screenshots/v2/home.jpg" width="1200" alt="BiliTV 首页：继续观看与紧凑的四列视频列表" />

**更大的内容空间，更顺手的遥控体验。**

</div>

BiliTV 是为 LG webOS 电视打造的免费、开源哔哩哔哩客户端。从一场现场演出，到一集番剧，再到喜欢的 UP 主更新，拿起遥控器就能接着看。安装后直接在电视上运行，不需要电脑常开。

## 为遥控器和大屏设计

- **打开就能接着看。** 首页「继续观看」带你回到上次进度；想留到周末看的视频，长按卡片加入稍后再看。
- **来回切换，不丢位置。** 精简侧栏按需展开，顶部和卡片更紧凑。返回侧栏、退出播放后，继续浏览刚才那张卡片。
- **按你的习惯排版。** 每行 **2／3／4 个视频**自由选择；界面、字幕、弹幕分别调字号，让沙发上的距离也刚刚好。
- **总能找到想看的。** 推荐、热门、关注、收藏，搭配游戏、动画、音乐、知识、娱乐、鬼畜六个分区；搜索支持热搜、联想和历史记录。
- **好好享受一段视频。** 最高支持 **4K／8K、HDR／杜比视界**，配有倍速、章节和快进缩略图预览；番剧选集、收藏夹与稍后再看支持连续观看。
- **大屏也有一起看的热闹。** 弹幕和字幕照常显示，播放时能展开评论与回复；看直播，也能打开聊天栏。

还有 **扫码登录、Magic Remote 指针与滚轮、兼容手机应用的 DLNA 投屏**。界面支持中、英、西三语，英／西语界面可自动翻译标题、字幕、章节和弹幕。

*可用画质和内容以视频源、账号权限、电视能力及所在地区为准。*

## 2.5.0 新功能

新增 **透明播放控制栏、UP 粉丝数、推荐视频／UP「不感兴趣」**，以及设置里的分级账号修复。播放推荐区支持两排紧凑卡片、连续展开收起和逐排平滑浏览。推荐卡片长按后分别选择视频或 UP；支持本机恢复，官方反馈与撤销会明确确认。完整范围与限制见 [功能清单](docs/FEATURES.md)。正式安装包仍以发布页为准。

## 界面预览

| 找到想看的内容 | 按你的习惯排版 |
|---|---|
| ![支持热搜和历史记录的搜索页](docs/screenshots/v2/search.png) | ![分别设置每行视频数与字号](docs/screenshots/v2/settings.png) |

<details>
<summary><strong>按需展开的侧栏，把空间留给视频</strong></summary>

![展开后的导航侧栏](docs/screenshots/v2/navigation.jpg)

按 **返回** 打开侧栏，列表位置保持不变；按 **右** 回到原卡片。在当前栏目上按 **OK**，才会主动刷新列表。

</details>

*截图为 2.0.0 实际界面，使用公开示例视频与演示账号。*

## 安装与更新

**电视已装 Homebrew Channel：** 打开商店，搜索 **BiliTV**，选择安装或更新。[查看商店页面 →](https://repo.webosbrew.org/apps/com.biliwebos.app/)

**直接安装最新版：** 在 [发布页](https://github.com/asdf17128/bili-webos/releases/latest) 下载 `.ipk`，按照 [Developer Mode 指南](https://www.webosbrew.org/devmode/)连接电视，再用 [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) 安装，无需编译。

Homebrew 目录更新可能晚于 GitHub 发布；想立即体验新版，可以直接下载发布页的安装包。支持 **webOS 5.0 及更新版本**，并提供已由社区验证的 **C9 / webOS 4.x** 兼容；具体解码能力取决于电视。登录后可同步关注、收藏与观看历史。

## 遥控器操作

| 操作 | 会发生什么 |
|---|---|
| 方向键／指针／滚轮 | 选择内容、浏览列表 |
| 卡片上短按 OK | 开始播放 |
| 卡片上长按 OK | 打开关注 UP 主、稍后再看等操作菜单 |
| 列表里按返回 | 回侧栏，保留列表位置；按右回到原卡片 |
| 当前栏目侧栏按 OK | 主动刷新，看看新内容 |
| 播放时按左右 | 预览快进／快退位置；OK 确认，返回取消 |
| 播放时按上下 | 呼出控制栏；返回逐层关闭弹层、控件，再退出播放 |

## 隐私

登录信息保存在电视上，用于访问你的 B 站账号。更新检查访问 GitHub，不携带应用自建的设备标识；公开下载计数用于粗略了解使用量。使用翻译时，待翻译文字会发送到 Google 翻译服务。

## 反馈与开发

[反馈问题](https://github.com/asdf17128/bili-webos/issues) · [更新日志](CHANGELOG.md) · [开发文档](docs/DEVELOPMENT.md) · [测试登记](docs/TESTCASES.md)

会员画质与设备限制见 [会员播放说明](docs/DOLBY_VISION.md)；网络问题可参考 [家庭网络检测方案](docs/NETWORK-TESTING.md)。版本更新统一记录在 [更新日志](CHANGELOG.md)，本版验证见 [2.4.0 发布记录](docs/RELEASE-2.4.0.md)。

[会员身份与自动最高画质](docs/MEMBER-EXPERIENCE.md) · [完整功能清单](docs/FEATURES.md)。

## 许可证

[MIT 开源项目](LICENSE)，再发布源码或修改后的安装包时请保留版权与许可声明。第三方依赖和随附资源保留各自许可；代码许可不授予哔哩哔哩、LG 等第三方商标的使用权，也不代表官方认可。本项目由社区独立开发，与哔哩哔哩及 LG 无隶属关系。

## 播放风控排查

遇到「B站风控校验未通过」时，2.4.1 会尝试一次设备标识恢复。2.5.0 中，仍失败可进入 **设置 → 账号修复 → 重建设备标识**，保留登录后重试播放；同类操作有 5 分钟冷却。随后运行网络诊断，预览后生成反馈二维码。此操作不能保证解除账号或地区限制。

新诊断报告会附上当前服务进程内最近一次取流失败的 HTTP/API 错误码、耗时、请求画质和自动恢复前后结果。请尽量在重启前运行诊断并扫码提交；不会自动上传，也不会附带 Cookie、voucher 值或完整签名地址。
