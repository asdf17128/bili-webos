# bili_webos 设计规范(10-foot UI)

依据 [Apple tvOS HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos) 与
[LG webOS TV Design Principles](https://webostv.developer.lge.com/develop/guides/design-principles),
结合本 app 的信息密度(B站内容比 Netflix 密)取的工程化标准。**所有 UI 改动对照本文件。**

## 1. 字号(1080p 全屏)

沙发距离 ≈3m。tvOS 正文下限 29pt、webOS 建议 ≥20px;我们取:

| 层级 | 字号 | 用途 |
|---|---|---|
| Display | 30–32 | 页面大标题(设置、播放器标题 28–30) |
| Title | 22–24 | 卡片标题、结束页视频标题 |
| Body | 20 | 按钮、菜单项、tab、提示行、时间读数 |
| Caption | **18(用户必读文字的绝对下限)** | 次要说明、meta 信息 |
| Badge | 16(仅限"扫一眼"元素) | 时长角标、播放中角标;**禁止用于需要阅读的句子** |

**禁止出现 <16px 的任何可见文字。** 12–15px 一律清除。

## 2. 颜色

- 背景:`#0a0d1a` / 卡片 `#101425` / 浮层 `#0d1020`
- 文字:主 `#f0f0f0` · 次 `#9aa0a8` · 弱 `#8a8f98`(仅 Caption,不用于关键信息)
- 强调:`#00a1d6`(B站蓝,焦点/选中/链接)· 警示 `#ff7a7a`
- 次要文字与背景对比度 ≥ 4.5:1;避免大面积纯白(刺眼)。

## 3. 焦点态(必须无可争议地醒目)

- 标准:`outline: 4px solid #00a1d6`(+ 需要时 box-shadow 光晕)
- 焦点元素与非焦点的区分必须一眼可辨;每屏幕**永远存在**一个焦点。
- 动画只允许 `transform` / `opacity`(GPU),150–250ms。

## 4. 布局与安全区

- 安全区:上下 ≥60px、左右 ≥80px 内不放关键内容(tvOS 标准;老电视 overscan)。
  侧栏 200px 已覆盖左侧;右侧注意时间读数等贴边元素留 ≥40px。
- 间距 8px 基准网格;卡片圆角 8–12px;网格 gap 24px。
- 悬浮层(气泡/卡片)一律挂**根节点**,防父容器 overflow 裁剪(见 tv-test skill)。

## 5. 克制原则(webOS 官方:宁简勿繁)

- 每屏一个主要动作;chrome(边框/徽章/发光)能省则省。
- 倒计时/进度类:用**细线、缓动**表达,不用大数字大色块。
- 弹层文案格式:`主信息 · 次要操作 · 次要操作`(20px,#9aa0a8)。

## 6. 兼容底线

- CSS 只用 Chromium 68 支持的特性:**禁 aspect-ratio**(用 padding-top 比例)、
  禁 gap-in-flex 之外的新布局特性时先查 caniuse chrome 68。
- 图片一律走本地代理;封面用 `@672w` 缩略,**雪碧图/大图原图直出**。

## 7. 平台手册对照审计(2026-07-26,原文重查)

重查了 [webOS TV Design Principles](https://webostv.developer.lge.com/develop/guides/design-principles) 与
[tvOS HIG(Focus & Selection / Color / Motion)](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos)。
上面 1–6 节已覆盖大部分;本次补录的原则与达标状态:

**新补录的原则**
- 【tvOS·焦点】聚焦要**缩放**(1.05–1.1x)+ 平滑过渡,失焦要**平滑还原**(base 类上挂 transition,
  不是只在 .focused 上)。现状:video-card 1.03+0.15s ✅ · player-btn 1.1+0.15s ✅ · search-chip 1.06 ✅ ·
  列表行(quality-option/comment-card)用背景+描边切换,列表行不缩放是 tvOS 惯例 ✅。
- 【tvOS·动效】动画必须**跟随用户操作**,禁 gratuitous/弹跳;例外:操作成功的庆祝反馈(triple-pop)。
- 【tvOS·色彩】**偏灰调、忌高饱和大面积**;sRGB;在真机测多种亮度档。现状:#00a1d6 焦点态属遗留,
  v1.6.0 方向 C(白色焦点环+粉强调点缀)落地时一并解决,不做中间态。
- 【tvOS·文字】按钮文案 1–2 个词;禁细体小字(压缩+运动模糊下消失)。
- 【webOS·简单】一屏≤2 个意图;层级扁平;远距观看优先大对象少数量。
- 【webOS·一致】遵循平台惯例:Back=上一层(我们已做分层 Back)、无 app 内返回按钮 ✅、无光标 ✅。

**本次审计修掉的违规**(违反本文件第 1 节自家规矩)
- `.sidebar-logo span` 14px、`.search-chips-label` 15px、`.search-chip .chip-ico` 13px、
  `.search-hint` 15px、`.vip-tag` 13px、楼中楼提示行 15px → 全部提到 16px。

**明确不改的(有依据)**
- 网格边距维持 `24px 40px`:ROW_HEIGHT=620/cols+110 滚动常数按此标定,改边距=滚动漂移;
  且现代 LG 面板(含 owner C4)Just Scan 下无 overscan。老电视风险接受,v1.6.0 phase 2
  重排版时连滚动模型一起按 60/80px 安全区重标定。
