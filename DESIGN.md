# Bilibili webOS TV App — 设计文档

## 概览

面向 LG webOS 智能电视的哔哩哔哩客户端，支持视频浏览、播放、直播、弹幕、搜索、历史记录等功能。目标设备：LG C4 65" (webOS 24, Chromium 108)。

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    LG webOS TV                       │
│                                                      │
│  ┌─────────────┐    Luna Bus    ┌─────────────────┐ │
│  │   Web App   │ ◀────────────▶ │   JS Service    │ │
│  │  (React)    │                │  (Node.js v16)  │ │
│  │  Chromium   │   HTTP :7654   │                 │ │
│  │    108      │ ──────────────▶│  Local Proxy    │ │
│  └─────────────┘                └────────┬────────┘ │
│                                          │           │
└──────────────────────────────────────────┼───────────┘
                                           │ HTTPS
                                           ▼
                                   ┌───────────────┐
                                   │  Bilibili API  │
                                   │  & CDN Servers │
                                   └───────────────┘
```

### 通信方式

| 请求类型 | 通信路径 | 原因 |
|---------|---------|------|
| API 请求（视频列表、搜索、登录等） | Web App → Luna bus → JS Service → HTTPS → B站 | 绕过 CORS，携带 Cookie/Referer |
| 视频流（DASH 段） | Shaka Player → HTTP → Local Proxy(:7654) → HTTPS → B站 CDN | 浏览器 `<video>` 只能用 HTTP URL |
| 图片（封面缩略图） | `<img>` → HTTP → Local Proxy(:7654) → HTTPS → B站图片 CDN | 需要 Referer 头 |
| 直播流（HLS） | `<video>` → HTTP → Local Proxy(:7654) → HTTPS → 直播 CDN | 同上 |

### 浏览器开发模式

浏览器开发不再依赖单独的 `proxy/` 进程。当前流程是：

| 请求类型 | 通信路径 | 原因 |
|---------|---------|------|
| 本地浏览器开发 API / 图片 / 流媒体请求 | Web App → Vite Dev Server `/proxy/*` → HTTPS → B站 API/CDN | 保持单进程开发，并复用与 TV 代理相同的头部与 HLS 重写策略 |

### 为什么需要两种通信

- **Luna bus**：适合 JSON 数据交换，支持异步回调，但无法直接给 `<video>` 或 `<img>` 标签提供数据
- **Local HTTP Proxy**：浏览器元素只能通过 URL 获取资源，本地 HTTP 代理提供了可访问的 URL

## 功能模块

### 1. 首页（推荐 / 热门 / 直播 / 分区 / 关注）
- 侧边栏导航，悬停即切换
- 2 列卡片网格，transform:translateY GPU 滚动
- 无限加载：预取 20 个视频到缓存，渐进渲染
- 去重机制（bvid Set）

### 2. 视频播放器
- Shaka Player + 动态生成 DASH MPD
- 弹幕层（DanmakuLayer），XML 解析，CSS animation 滚动
- 画质切换（360P - 8K）
- 播放心跳上报（每 15s）
- 历史续播（从上次位置继续）
- 播放结束推荐（相关视频 4 列网格，可加载更多）
- 控制栏交互：
  - 无 UI 时：左右快进退，上下呼出控制栏，Enter 暂停
  - 控制栏时：左右切按钮，下展示推荐，上关闭
  - Back：先关控制栏，再退出播放器

### 3. 直播播放器
- HLS m3u8 流，通过本地代理
- LIVE 标识，主播信息浮层
- 简化交互（无进度条、无弹幕）

### 4. 搜索
- 屏幕虚拟键盘（QWERTY 布局）
- WBI 签名搜索请求

### 5. 登录
- QR 扫码登录
- Cookie 持久化到 TV 文件系统（/media/internal/bili_cookies.json）

### 6. 设置（我的）
- 弹幕开关
- 退出登录
- 历史记录网格

## 性能优化策略

### 问题：电视硬件性能有限（Chromium 108, 有限 GPU/CPU）

| 优化项 | 做法 | 原因 |
|--------|------|------|
| 焦点系统 | 直接 DOM classList，零 React render | React 虚拟 DOM diff 在 TV 上太慢 |
| 滚动 | transform:translateY | 原生 overflow:scroll 触发 layout 重排 |
| 动画 | 只用 transform + opacity | 这两个属性走 GPU 合成，不触发 layout |
| 图片 | @672w webp 缩略图 | 减少下载量和解码时间 |
| 渲染 | content-visibility:auto + contain:content | 浏览器跳过屏幕外元素 |
| 组件 | React.memo 所有列表组件 | 防止父组件更新导致全部重渲染 |
| 页面 | display:none 而非卸载 | 避免返回时重新加载 API |
| 导航 | O(1) ID 计算 | 不遍历注册表 |

### 导航 ID 规则

```
{group}-{row}-{col}
sidebar-0-0   sidebar-1-0   ...   sidebar-6-0
content-0-0   content-0-1
content-1-0   content-1-1
...
```

上下：同 group 内 row ±1
左右：同 group 内 col ±1，到边界时跨 group（sidebar ↔ content）

## 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 前端框架 | React | 19.2 |
| 构建工具 | Vite | 8.x |
| 视频播放 | Shaka Player | 4.12 |
| QR码 | qrcode | 1.5 |
| TV Service | webos-service (Node.js) | v16.20.2 |
| Luna 通信 | webOSTV.js | 1.2.13 |
| 部署工具 | ssh2 + 自定义 deploy.mjs | — |
| 调试工具 | CDP over SSH tunnel | — |

## B站 API 列表

| 功能 | 端点 | 认证 |
|------|------|------|
| 推荐 | /x/web-interface/wbi/index/top/feed/rcmd | WBI |
| 热门 | /x/web-interface/popular | WBI |
| 排行 | /x/web-interface/ranking/v2 | WBI |
| 搜索 | /x/web-interface/search/type | WBI |
| 视频详情 | /x/web-interface/view | WBI |
| 播放地址 | /x/player/playurl | WBI |
| 相关推荐 | /x/web-interface/archive/related | WBI |
| 弹幕 | /x/v1/dm/list.so | 无 |
| QR 生成 | /x/passport-login/web/qrcode/generate | 无 |
| QR 轮询 | /x/passport-login/web/qrcode/poll | 无 |
| 用户信息 | /x/web-interface/nav | Cookie |
| 历史 | /x/web-interface/history/cursor | WBI + Cookie |
| 收藏夹 | /x/v3/fav/folder/created/list-all | WBI + Cookie |
| 心跳上报 | /x/click-interface/web/heartbeat | Cookie |
| 关注动态 | /x/polymer/web-dynamic/v1/feed/all | Cookie |
| 直播列表 | /xlive/web-ucenter/v1/xfetter/GetWebList | Cookie |
| 直播流 | /xlive/web-room/v2/index/getRoomPlayInfo | 无 |
| 分区热门 | /x/web-interface/dynamic/region | WBI |

## 文件说明

| 文件 | 职责 |
|------|------|
| src/api/client.js | 所有 API 封装，Luna/Proxy 双模式 |
| src/api/wbi.js | WBI 签名算法 + MD5 实现 |
| src/hooks/useFocus.js | 焦点管理（零渲染，纯 DOM） |
| webos/service/.../service.js | Luna 方法 + 本地 HTTP 代理 |
| tools/deploy.mjs | SSH 部署（绕过 ares-cli 兼容问题） |
| tools/debug.mjs | CDP 远程调试（SSH 隧道） |
