<div align="center">

<img src="docs/screenshots/icon.png" width="96" alt="BiliTV icon" />

# BiliTV for webOS

**Watch Bilibili (哔哩哔哩) natively on your LG webOS TV — up to 8K/HDR, danmaku, live & bangumi, search, in-video comments, even EN/ES subtitle translation — all driven by the remote.**

LG webOS 智能电视的第三方哔哩哔哩客户端 · 弹幕 · 番剧 · 直播 · 搜索 · 评论 · 分区 · 字幕翻译,全程遥控器操作。

![Platform](https://img.shields.io/badge/platform-LG%20webOS%20TV-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Release](https://img.shields.io/github/v/release/asdf17128/bili-webos)
![Stars](https://img.shields.io/github/stars/asdf17128/bili-webos?style=social)

<img src="docs/screenshots/demo.gif" width="600" alt="BiliTV demo" />

</div>

---

## English

A free, open-source Bilibili client for LG webOS TVs. It runs entirely on the TV — a React app talking to a built-in JS service that proxies Bilibili's API and media (no external server or PC required). Everything is operated with the TV remote (D-pad focus navigation built from scratch).

> ⚠️ **Region notice:** Bilibili's APIs and especially its **video CDN are geo-restricted to mainland China**. Outside mainland China the content feed may be empty and playback will likely fail — you need a network route into mainland China. The app talks to Bilibili directly and has **no built-in proxy/VPN** for this.

### Features

**Playback**
- DASH adaptive streaming up to **4K / 8K**, with **HDR & Dolby Vision** — picks the real quality tier, not just the top bitrate
- Real-time **danmaku** (弹幕) overlay and **CC subtitles**, both with adjustable size
- **Chapters** marked on the progress bar, a **thumbnail scrub preview**, YouTube-style timeline seek, and an autoplay **"Up Next"** end screen
- **In-video comments** — avatars, likes and reply counts, right inside the player

**Browse**
- Feeds for **recommendations, trending, live, following, and favorites** (favorites play through in order)
- **6 one-tap category shortcuts** in the sidebar (Games · Anime · Music · Knowledge · Entertainment · Kichiku), each showing that category's *current* hot ranking
- **Search** with the on-screen keyboard: trending searches, autocomplete suggestions, and search history
- **Bangumi (番剧)** with full episode lists, and **live streams** with real-time danmaku
- **Watch history & resume**, with a progress bar on every thumbnail

**And more**
- On-the-fly **machine translation** of subtitles, titles, chapters and danmaku when the UI language is English/Español
- Trilingual UI — **English · Español · 中文**
- **DLNA cast receiver** — send a video from the Huya / Bilibili phone app straight to the TV
- Full **Magic Remote pointer** support (hover + click) alongside the D-pad
- **QR-code login**, **auto-updates** via Homebrew Channel, and it runs **entirely on the TV** — no PC or external server

## 中文

免费、开源的 LG webOS 电视哔哩哔哩客户端。**完全在电视上运行**——React 前端 + 内置 JS 服务代理 B站 接口与媒体，不需要额外的代理服务器或电脑常开。全程遥控器操作（从零实现的 D-pad 焦点导航）。

> ⚠️ **地区限制：** B站 接口、尤其是**视频 CDN 仅对中国大陆开放**。在大陆以外内容可能为空、播放大概率失败，需要走大陆网络。本 app 直连 B站，**不内置代理/VPN**。

### 特色

**播放**
- DASH 自适应,最高 **4K / 8K**,支持 **HDR / 杜比视界** —— 按真实清晰度选流,不是只挑最高码率
- 实时**弹幕**与 **CC 字幕**,均可调字号
- 进度条**章节刻痕** + 拖动**缩略图预览** + YouTube 式时间线快进 + **「接下来播放」**结束页
- **播放中看评论** —— 头像、点赞、回复数,就在播放器里

**浏览**
- **推荐 / 热门 / 直播 / 关注 / 收藏** 多种内容流(收藏夹可顺序连播)
- 侧栏 **6 个一键分区**(游戏 · 动画 · 音乐 · 知识 · 娱乐 · 鬼畜),各自进入该区**当前**热门榜
- **搜索**(屏幕键盘):热门搜索 + 输入联想 + 搜索历史
- **番剧**(整季剧集列表)与**直播**(带实时弹幕)
- **观看历史与续播**,每张封面都带进度条

**更多**
- 界面为英/西语时,**字幕 / 标题 / 章节 / 弹幕自动机翻**
- 三语界面 —— **English · Español · 中文**
- **DLNA 投屏接收** —— 从虎牙 / B站手机端直接投到电视
- **Magic Remote 指针**全面支持(悬停 + 点击),与方向键并存
- **扫码登录**、Homebrew **自动更新**,且**完全在电视上运行** —— 无需电脑或外部服务器

## Screenshots / 截图

| Home / 首页 | Player + Danmaku / 播放+弹幕 |
|---|---|
| ![home](docs/screenshots/home.png) | ![player](docs/screenshots/player.png) |
| Search / 搜索 | Following / 关注 |
| ![search](docs/screenshots/search.png) | ![following](docs/screenshots/following.png) |

## Install / 安装

### Option A — Homebrew Channel (recommended / 推荐)

Requires the [webOS Homebrew Channel](https://www.webosbrew.org/) on your TV (see [rootmy.tv](https://rootmy.tv/)). Then:

1. Open **Homebrew Channel** on the TV.
2. Search for **BiliTV** and install.

需要电视已装 [webOS Homebrew Channel](https://www.webosbrew.org/)；打开后搜索 **BiliTV** 安装即可。
（新版本上架后，商店索引刷新有几小时延迟。）

### Option B — Build from source (developers / 开发者)

**Prerequisites / 前置：** LG webOS TV (2020+)；TV [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) on；Node.js 18+.

```bash
# 1. clone
git clone https://github.com/asdf17128/bili-webos.git
cd bili-webos

# 2. install deps
npm install
cd app && npm install && cd ..

# 3. webOS CLI (if needed)
npm install -g @webosose/ares-cli

# 4. set your TV's IP/passphrase in tools/deploy.mjs

# 5. build + deploy
bash build.sh
```

Dev mode (browser preview):

```bash
cd proxy && node server.js &   # Mac proxy for browser dev
cd app && npm run dev          # http://localhost:5173
```

## Architecture / 架构

```
┌──────────────────────────────────────────┐
│               LG webOS TV                 │
│   Web App (React)  ◀──Luna──▶  JS Service │
│        │                Bus     Node.js    │
│        └──── HTTP :7654 ──────────┘        │
└───────────────────────┬───────────────────┘
                         │ HTTPS
                         ▼          Bilibili API / CDN
```

- **Web App** — React + Shaka Player (DASH). Build target Chromium 68 for older-webOS compatibility.
- **JS Service** — on-TV Node.js service: API requests (bypasses CORS), cookie management, video/image proxy.
- **Self-contained** — one ipk, no external proxy server.

## Remote controls / 遥控器操作

| Key / 按键 | Home / 首页 | Player / 播放器 |
|---|---|---|
| D-pad / 方向键 | move focus / 移动焦点 | ←→ seek 10s / 快进退 · ↑↓ controls / 控制栏 |
| Enter / 确认 | open / select / 选择 | play-pause / 暂停播放 |
| Back / 返回 | sidebar → home / 回侧栏→首页 | exit / close panel / 退出·关面板 |

## Project structure / 项目结构

```
bili-webos/
├── app/        # React frontend + webos-meta (appinfo, icons)
├── service/    # on-TV JS service (API + local HTTP proxy)
├── proxy/      # dev-only Mac proxy
├── tools/      # deploy / debug / screenshot / test
├── build.sh    # one-command build + deploy
└── CLAUDE.md   # developer guide
```

## Tech stack / 技术栈

React 18 · Vite 6 · Shaka Player (DASH) · native HLS (live) · webOS JS Service (Node.js v16) · CDP-over-SSH tooling.

## Privacy / 隐私

The app makes exactly one non-Bilibili request: an update check against this
repo's GitHub Releases (once per day, and when you press "Check for Updates"
in Settings). It carries no identifier of any kind. The maintainer reads the
release asset's public download counter as an approximate active-device count.
Subtitle/title machine translation (only when the UI language is not Chinese)
sends the text being translated to Google's public translate endpoint — also
without any identifier.

应用只有一类非 B 站请求:对本仓库 GitHub Releases 的更新检查(每日一次 +
设置页手动触发),不携带任何标识;维护者以该资产的公开下载计数估算活跃设备量。
界面为非中文时,字幕/标题机翻会把待翻译文本发送到 Google 公共翻译端点,同样不含任何标识。

## License

MIT. Unofficial, fan-made client for personal use; not affiliated with or endorsed by Bilibili.
