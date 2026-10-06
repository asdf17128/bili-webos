# 回归测试 Case 登记簿(发布门禁)

**规则**(见 docs/DEVELOPMENT.md):每个 case 必须有**事实佐证** —— 要么它抓过真实 bug
(写明 issue/事故),要么做过正对照(证明它能在坏版本上失败)。没有佐证的 case 不收录。
每次开发完成必须把新验证的场景**追加到这里**;每次发布前按"门禁"列回归。

图例:🤖 AUTO=verify.sh 自动跑 · 📜 SCRIPT=有现成脚本/命令 · 👁 MANUAL=需人工/截图/手机

---

## 服务 / 旧设备兼容

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-SVC-01 | 真 Node 8 跑真实 service.js:fetch→api 200、getDiagnostics、buvid、ws@7 加载 | 🤖 verify.sh L3 (`tools/test-node8/test.sh`) | **抓过 P0 事故**:webOS 5 `new URL` 全局缺失导致所有请求失败(#10/#13,SaviorJK 照片);真 Node 8 v8.17.0 复验 2026-07-07 |
| C-SVC-02 | service 全部文件 ES2017 可解析(无 `?.`/`??`/URL 全局假设) | 🤖 verify.sh L1 (acorn) | 同上事故;`ws@8` 需 Node 14 是同类教训(v1.1.x) |

## 播放器

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-PLAY-01 | 播放入口策略:feed卡(带cid)→auto 续播;历史→at;选集/连播→none;cast→at | 🤖 verify.sh L2 (`tools/test-playintent.mjs`, 7 断言) | **续播连坏两版**:旧启发式"无 cid 才续播"使推荐/收藏入口全不续播(用户报告,v1.2.1 修);这些场景在旧逻辑上必失败 |
| C-PLAY-02 | 收藏连播优先于分P:收藏夹中段的多P项播完→下一个收藏,直接打开多P→连播分P | 📜 决策函数确定性验证(真实收藏夹数据,2026-07-07) | #11 ZMonsterror 明确需求;v1.1.24 换序修复,决策逻辑三分支全验 |
| C-PLAY-03 | 从任意入口重开看过的视频→跳到上次位置(±心跳15s);退出时补报最终进度 | 📜 真机:播到34s→退出→重开 currentTime=53(重头播只会≈12) | 用户报告"重进从头播"(v1.2.1);对照数值明确 |
| C-PLAY-04 | 播放结束:无模态弹框;控制栏+推荐/选集面板嵌入且**方向键全可达**(格↕tab↕控制栏);播放键=↻重播 | 📜 单会话 CDP:seek 到结尾→断言无'播放结束'文本、重播/相关推荐在;up,up,OK 重播 t=7 | 旧 endscreen 把 D-pad 困死在浮层(用户报告,v1.2.2);重播/可达性都实测过 |
| C-PLAY-05 | 结束页"接下来播放":10s 细线倒计时递减→自动连播;OK 立即播;任意键取消;**合集/分P/收藏连播优先,不出结束页** | 📜 真机:countdown 7→4 递减、超时自动切换(title 变)、arrow 取消;多P视频直接连播(测试时误采样合集视频反向证实) | v1.2.7;倒计时圆圈丑/字小两轮返工(用户审美反馈)→ 最终形态截图 qa_end_final |
| C-PLAY-06 | Scrub(快进快退):影子游标动、视频不跳;停手1s 精确落点(t0+30=258 实测);OK 立即;Back 丢弃;连按加速 10/30/60(算术单测 570s) | 📜 单会话 CDP 场景脚本(v1.2.3 记录) + 加速纯函数单测 | 旧行为盲跳±10s;**教训**:跨连接读取延迟>1s 自动提交窗口会假阴(写入 tv-test skill) |
| C-PLAY-07 | Scrub 预览图:**视觉完整**(不被 controls overflow 裁剪)、紧贴进度条(~104px)、帧对正清晰(**雪碧图必须原图直出,禁 @672w 缩略后缀**) | 👁 截图逐像素看(rect 测不出裁剪!) | ZMonsterror 抓到裁剪+距离;帧错位/糊 = proxyImg 的 @672w_1c 裁剪(抓包定位);thumb 320x180 复验 |
| C-PLAY-08 | 章节:进度条分段刻痕(N-1 个)、scrub 气泡显示目标章节名、时间行显当前章节;**预览帧尺寸自适应**(160/480 宽都=320px 显示) | 📜 真机对真实 7 章节视频(BV1n8M86CEUy):6 刻痕、跨章气泡'10-20(4款)' | v1.2.4;480 帧雪碧图曾撑成 960px 宽(实测抓到) |
| C-CMT-01 | 播放中看评论:底部面板新增「评论」tab(在 相关推荐/UP主投稿/选集 之后),标题带总数;单列列表(头像+用户名+时间+正文+👍赞数+回复数);焦点单列上下走、到底翻页 loadComments(false);空/加载态区分;评论走 api.bilibili.com `/x/v2/reply`(sort=1 热门,免 WBI,host 本已在白名单) | 📜 dev+Playwright(BV1xx411c7Xg/aid271):tab 显示「评论 · 2.6万」、20 张卡渲染(三师公张良/碧诗真实评论,含赞 4.0万·3072 条回复)、方向键入列表翻页 20→40、focus 单列跟随;👁 comments_panel.png | 2026-07-16 YouTube-TV 对标 P1「播放中看评论」;沿用现有 panelTab 架构(comments 为单列 list,RCOLS=1,Enter 不可播);评论接口对反爬敏感,失败(-412)静默显示暂无评论 |
| C-CMT-02 | 楼中楼(评论的回复):一级评论下直显 ≤3 条预览(root 响应自带,零请求);OK/点击循环 展开(reply/reply 分页 10/页)→ 加载更多 → 到底「收起回复」→ 收回预览;提示行 展开 {n} 条回复/加载更多回复/收起回复(i18n en/es 已同步);展开后 scrollIntoView 保持卡片可见 | 📜 dev+Playwright(BV1xx411c7Xg):20 卡全带预览+计数;点击 3→10(加载更多)→20;9 条小楼到底显收起→点击回预览;纯键盘自适应导航 Enter 3→10 同样通过 | 2026-07-26 owner 报"评论下面的评论丢失":此前只拉一级评论,rcount 显示但楼中楼完全没实现。**测试工具坑**:合成 mouseenter 不经 React 委托(React 挂 mouseover),hover 断言必须用真实指针或改按导航探测焦点 |
| C-QLT-01 | 非会员选 VIP 画质(1080P+/4K/HDR≥112):服务端只回 ≤1080P 流(quality 字段=实际授予档),播放/标签按实际档校正,toast「该画质需要大会员,已按 {q} 播放」,不虚标不黑屏;画质菜单 VIP 档带「大会员」角标;load 路径本来就按 meta.quality 诚实显示 | 📜 数据层实测(非会员账号):qn=112 请求 → served=80、dash 仅 [80,64,32,16];菜单角标 dev 渲染验证「1080P+大会员」;toast 路径逻辑依赖 served≠qn(数据已实锤),真机播放链路待 TV 回归顺带确认 | 2026-07-26 owner 无会员实测切了 1080P+ 问会怎样:旧代码 changeQuality 直接 setCurrentQuality(请求档),1080P 流挂着 1080P+ 标签(虚标)。**同类根因二号**:loadVideo 重试阶梯 [null,126,125,120,80,16] 强制 Dolby/HDR 档时也把请求档当当前档——普通视频 rung0 一失败就标「杜比视界」;正对照:dev 破 CDN 环境修复前按钮=杜比视界(截图),修复后=1080P(按 dash 实际可用档就近落) |
| C-SPD-01 | 倍速(webOS 破解):速≠1 → html5 合流 MP4 切**原生管线**(video.mediaId ~1s 出现;MSE 下恒空)→ `luna://com.webos.media/setPlayRate {playRate, audioOutput:true}`;速=1 → 回 DASH(位置保留);**换视频必重置 1.0×**(无持久化);seek/replay 后 canplay/seeked 重申速率;倍速中画质固定(toast);元素 .playbackRate 在原生管线不可靠,**只走 luna** | 📜 真机:实测 1.25→1.25 / 1.5→1.51 / 2.0→2.01(带声,≤2x);换视频回 1.0× 断言过(2026-07-25 回归) | MSE 管线封 playbackRate 是 LG 官方行为("That's the TV app spec"),曾误判死路;owner"必须解决"后由 luna 总线破解 —— **教训:先探底层总线再下"系统限制"结论**(reference_playbackrate_wall);owner 反馈后去掉倍速持久化 |
| C-POP-01 | 二级面板锚定:倍速/字幕/画质弹窗渲染在**页面根节点**,按各自按钮 rect 定位到正上方(`.player-controls` overflow-y:auto 会裁剪 — 同 C-PLAY-07 教训);打开时焦点落**当前选中项**(三面板一致;画质 2026-07-26 补齐,曾写死顶部) | 📜 真机回归 popup 锚定断言 + dev 断言 focused===active(1080P 档) | owner 照片实锤"这个展示都不全"(弹窗被裁)+"选项离按钮太远"+"1080 选中焦点在最上面" |
| C-NAV-02 | 播放器返回分层:二级面板开 → Back 只关面板、焦点回该按钮、控制条保留;再 Back 收控制条;控制条没了才退播放器 | 📜 真机回归 back1(popup only)/back2(controls hidden) + dev 套件 5/5 | owner:"先关闭二级选项 而不是直接关闭控制区";Back 在控制条隐藏时直接退播放器(投币事故链一环) |
| C-TRI-01 | 三连语义(对齐 B站 PC-web):赞/币/藏三按钮带实时计数+我的状态(lit 粉);单击(<300ms)=点赞切换;按住 0.3–2s 中途松手=**无操作**;满 2s=一键三连+药丸描边进度圈(沿按钮圆角轮廓,非圆圈);已全三连 → 守卫 toast「已经三连过啦」;币上限 2 不可逆;relation 拉取失败重试一轮+三连后 true-up(守卫依赖它) | 📜 真机回归:tap 5472→5471→5472、800ms abort=noop、full-hold 守卫 toast;dev 套件 6/6;**写操作测试铁律见 feedback_test_safety(只用夹具 BV1MTKp6bExe)** | owner 五连需求(三按钮/展示数据/可取消/2 秒对齐电脑端/圈形贴按钮);2026-07-23 真币事故(−2 币)催生安全线 |
| C-AUD-01 | 音量均衡(YouTube 同款):**BS.1770 K 加权 + 400ms 块门控 LUFS**,解析 sidx 在全片 10%/40%/70% 三点对齐采样(~1.2MB Range;无索引回退头块);基准 **-14 LUFS 只衰减不增益**(下限 0.3),`video.volume` 执行;倍速原生管线补 luna setVolume;换视频重置+token 防陈旧;失败静默 1.0;设置「音量均衡」开关默认开 | 🤖 `tools/test-loudness.mjs` 7 组(ITU 基准音 997Hz 0dBFS=-3.01 LUFS 校验/K曲线频率响应/门控/sidx 解析/真值案例)+ 📜 **ffmpeg ebur128 真值标定**:owner 历史 12 视频谱 -9.2~-28.9 LUFS(差20dB);JS vs ffmpeg 误差 0.3~1dB;dev E2E:响咖啡机 -9.5→0.60、轻的 -27.9→1.00 | owner 报"响度不一样"+"效果不佳,看看 YouTube 怎么做":v1 用头 64s 无加权均方+错基准;**中段天真 Range 采样解出 -70 静音**(fMP4 需 sidx 对齐,ffmpeg 标定抓出)。执行器排除记录:WebAudio 全零、luna setVolume 对 MSE 管线播放中仍 false(ps 可挖管线 ID 但不放行)、getActivePipelines Denied → **仅剩 video.volume,可听性由 owner 耳测裁决**(若无效→唯一剩主音量方案,需 owner 拍板) |
| C-FOCUS-04 | 侧栏上下循环:顶部(搜索)按上 → 最底 icon(设置),底部按下 → 顶部;只 wrap sidebar 组,内容网格到边即停 | 📜 dev+真机 CDP 双验:搜索+↑→⚙️设置、设置+↓→搜索 | 2026-07-26 owner 需求;实现在 navigateGrid 兜底分支,行号不连续(分隔线)也扫 registry 取 min/max |
| 教训 | **proxyImgRaw 及所有"选代理地址"的环境判断必须查 `PalmServiceBridge`**,不是 window.webOS —— webOSTV.js 在 dev 浏览器也定义后者,把请求指到不存在的 127.0.0.1:7654:dev 封面全黑多时 + 音量均衡测量静默失败(Failed to fetch → null → 特性无声 no-op)。2026-07-26 一次修掉 6 处(VideoCard/PlayerPage×3/SettingsPage/LivePlayerPage + onWebOS) | —(已统一) | 与 C-SUB 教训"hasLunaService 必须查 PalmServiceBridge"同根;修后 dev 21 图只 1 裂 |
| C-SUB-01 | 字幕纯函数:parse 容忍脏数据(零长/NaN/乱序)、pickCueIndex 边界/间隙/重叠/1000条扫描=线性对照;**轨道名枚举映射 + 动态键字典覆盖**(t(subtitleLanName) 是动态调用,coverage 门禁的字面扫描看不见,由本测试兜底);lanFamily/matchTrackByLan 记忆语言匹配(精确/语族/人工优先/无匹配→null) | 🤖 verify.sh L2 (`tools/test-subtitle.mjs`, 12 组) | 正对照 2026-07-10 ×2:去掉重叠回溯 → 'overlapping' 组失败;从 en.js 删「日语(自动生成)」→ 字典覆盖组失败(均 exit 1);匹配逻辑佐证见 C-SUB-06 |
| C-SUB-02 | CC 端到端:有轨视频才出「字幕」键;OK 循环 关→轨→关;cue 上屏/间隙隐藏;开关持久化→下一视频自动开;控制条打开字幕上移(-190px);无轨视频无键 | 📜 真机 CDP 全流程 + 👁 截图(sub_cc.png:34px 白字深底居中贴底;sub_cc_en.png:英文界面 'CC Chinese (auto)' + 字幕避让控制条同框) | 2026-07-10 真机:'♪ Love wu nothing ♪'/台风视频 cue 实渲、连播自动启用、无轨视频键消失全验;en 界面按钮/避让/零溢出截图过目;**教训复用**:跨工具调用控制条会自动隐藏,按键序列必须单次 drive 完成 |
| C-SUB-03 | 字幕 MT 管线(subTranslate.js):批量上限、**并行池(4路)+ 逐批渐进(onPartial)+ 播放头批次优先**、瞬时失败重试一轮、错位/永久失败必 throw(半翻半中挂着 translated 标签比回退更糟)、LRU 缓存、坏 store 容忍 | 🤖 verify.sh L2 (`tools/test-subtranslate.mjs`, 12 组) | owner 报"翻译要很长时间":旧串行整轨 ≈5-6s 才见译文;并行+渐进+播放头优先后真机实测(台风视频、无缓存):**中文 1.09s 先行、962ms 后英文换入**;面板打开即预取字幕体 |
| C-SUB-04 | 字幕/标题/章节机翻(非中文界面):虚拟轨自动选中、原文先显译文换入、英文 cue 实渲、标题翻成英文;引擎失败→回退原文轨并**改回诚实标签**;凭据隔离:Cookie/Referer/Origin 只发B站域 | 📜 真机(subtr_tv_en.png:英文字幕+英文标题+'CC English (translated)' 同框;subtr_chapters_en.png:scrub 气泡 'King of the Huns'+时间行英文章节+预览图同框)+ dev 浏览器 E2E + 真实端点形态验证(多q数组/单q裸串) | 2026-07-10:真机 owner 网络直连 gtx 571ms;章节翻译真机像素验证(BV1DTMN6HE8m 十章节:匈奴王→King of the Huns,9 刻痕),素材经 `__openVideo` 深链直达;服务白名单曾把翻译域拦下('Host not allowed' 5ms)——新第三方域必须同时进 service.js 和 proxy/server.js 白名单 |
| 教训 | dev 浏览器里 webOSTV.js 也会定义 window.webOS.service,`hasLunaService` 必须查 **PalmServiceBridge**,否则 dev 全部请求死在 Luna 路径不回退代理 | —(client.js 已修) | 2026-07-10 dev E2E 时 cards=0 定位到此;修后 dev 20 卡、真机冒烟不受影响 |
| 教训 | **LG 滚轮速度敏感**:慢拨单格 deltaY=120、快拨 200(官方文档不写)——像素积累模型对"一格一行"必然失真(阈值 140:慢拨死;200:慢拨死;100:快拨蹦两行)。正确模型:**\|dy\|≥100 的事件=一次真实拨动=恰一行**(限速丢弃不结转),小 delta 才是边缘区自动流走积累。诊断靠常驻 `__wheelDiag`(每事件记录决策原因) | —(useFocus.js 已按此实现) | 2026-07-11 owner 三轮手感反馈 + 真机实测两种 delta 定案 |

## 焦点 / 输入(Magic Remote)

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-FOCUS-01 | 指针停在**半截边缘卡**上:高亮但**零滚动**,10s 焦点零漂移 | 📜 point.mjs park 测试(含**正对照**:坏版同操作焦点 0→4→8 漂移) | 六轮拉锯的 #11 边缘滚动;正对照是本仓库验证纪律的起点;报告人确认修复 |
| C-FOCUS-02 | 滚轮方向=视图方向,**与指针位置无关**:指针在底部1/4向上滚→scrollY 减;顶部向下滚→增;不卡不反向 | 📜 `node tools/cases/c-focus-02-wheel-direction.mjs`(需 app 在首页网格;2026-07-09 固化脚本并复跑 PASS) | ZMonsterror"几乎必现"反向/卡死;根因=焦点行锚定模型 vs 指针起算(v1.2.6) |
| C-FOCUS-03 | hover 跟随指针(高亮=指针=点击目标);滚轮/D-pad 滚动不受 hover 影响 | 📜 **必须 dev+Playwright 受信输入**(page.mouse),TV 端 CDP 鼠标注入会静默失效 | hover 曾被 hoverAllowed 误杀;"注入失效当产品坏"浪费一轮(挂 DOM 计数器定位);Playwright 3/3+滚动矩阵 |
| C-FOCUS-05 | 网格滚动几何:焦点行钉在视口顶部,快按(120ms 连击)+ 慢按稳定后焦点卡都必须完整可见。三处根因(PR #16 @zachitect 报的)—— ①`content-visibility:auto` 让离屏卡塌成 0 高,浏览器 `scrollIntoView` 因此去滚 `overflow:hidden` 外层(实测 wrapper scrollTop **608px**),叠加在 translateY 上把焦点卡顶出屏幕;②行高是硬编码公式 `620/cols+110`=265px 而实测 pitch **342px**(每行差 77px,所以不同列数在不同深度出问题),改为从 DOM 量两行 offsetTop 之差(**必须先去掉 content-visibility,否则量到塌陷后的 155px**);③`.video-grid` 内的焦点变化一律不调 scrollIntoView 并清零祖先 scrollTop | 📜 真机数学断言(不是"看起来对"):焦点行5 → offsetTop 1732 / translateY −1710 / rect top **17px** / wrapper scrollTop **0**,慢按与 120ms 快按各一轮;🤖 verify.sh --full 26/0/1 | **两个方法论教训**:①`transition: transform 0.2s` 期间取 rect 量到的是中间态,我最初"复现"的 −427px 全是采样假象 —— 必须等稳定后再判定;②按 id 前缀 `content-` 屏蔽 scrollIntoView 会连坐设置/搜索/我的(它们同前缀但在真滚动容器里),4 条冒烟断言当场变红,改按 DOM 祖先判定 |
| 教训 | **测试不能依赖"到边会停"**:test-ui 的 `goto()` 原本用"上按满 N 次靠钳制对齐顶部 + 下按 idx 次"定位侧栏,2026-07-30 侧栏加了上下循环后overshoot 会绕回去,4 条断言静默落到错误页面(搜索热门 0 行、更新检查空、最近观看 20 卡)。改成**每按一次读一次焦点行**直到命中目标 | —(tools/test-ui.mjs 已改) | 同类风险:任何"多按几下总会到头"的脚本在加了 wrap/循环的界面上都会失效 |
| C-NAV-01 | 侧栏:搜索置顶但**非默认**(默认落推荐);Back 从内容→**当前页按钮**、再 Back→**推荐**(不落搜索);左键回推荐;选中框=实心蓝圆角+白描边,**上下切换时不被预览重渲染冲掉**(SidebarItem 渲染时按 `getCurrentFocusId()` 自带 focused class) | 📜 dev+Playwright:顺序[搜索,推荐,…]、默认推荐20卡、Back 从游戏内容→游戏按钮→推荐、左键落推荐、上下连切 5 项焦点框 bg 恒为 rgb(0,161,214) | 2026-07-18 owner:①搜索置顶但推荐默认②Back回推荐③选中框看不清;**根因**:预览 setPage→active 变→React 重渲染重写 className 把 DOM 加的 .focused 冲掉(框一闪即没) |

## 分区

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-PART-01 | 6 个分区做左侧导航(游戏/动画/音乐/知识/娱乐/鬼畜),各进各自**当前热门榜**;用**新版 pid_v2**(1008/1005/1003/1010/1002/1007)喂 `ranking/v2`——**旧 rid(3/4/…)的分区榜已被 B站 2024 改版冻结在 ~2025-03**,查出来全是去年视频 | 🤖 verify.sh L6 test-ui(goto 游戏→出内容) + 📜 dev+Playwright:音乐区 96 卡(17M/10M 播放·当天)、游戏区「寻找卢本伟 786万·2天前」;旧 rid 实测返回 2025-03 冻结榜 | 2026-07-18 owner:①原「分区」tab 随机 rid 混内容太乱→拆 6 个固定分区②"怎么全是去年的"→旧分区榜冻结,换 pid_v2 拿当前榜。**坑**:老 rid 分区榜不报错但数据冻结,必须用 pid_v2 |

## 搜索

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-SRCH-02 | 搜索历史:去重+置顶+上限 12,空串忽略;chips 一点即搜;"清除历史"清空 | 🤖 verify.sh L2 (`tools/test-searchhistory.mjs`) + 📜 dev+Playwright:历史 chips + Clear 渲染,点 chip 触发搜索并写入历史 | 2026-07-14 搜索优化;遥控器打字是电视最痛交互,一点复搜价值最高 |
| 教训 | **语音搜索放弃**(2026-07-18 owner 决定):webOS 对第三方 app **完全隔离麦克风**——实测 `getUserMedia`=NotFoundError/`audioInputs`=0、系统 `voiceinput/startStreaming` 与 `getDevices` 均 Denied;`voiceconductor/recordVoice` 卡 "precondition not satisfied";连 YouTube 自己也 `audioInputs`=0(它走私有 `RequestCrowNativeApi` + LG 未公开合作合同)。LG 官方原话"no APIs are provided for system-level voice control"。**唯一可行是"手机当话筒"**,owner 不做。故搜索只保留联想+历史 | — | 别再重开这个坑:麦克风源头就拿不到,不是权限弹窗问题 |
| C-SRCH-03 | 搜索联想:输入 debounce 250ms 拉 `s.search.bilibili.com/main/suggest`,取 `result.tag[].value`;拼音/汉字均有结果,空输入→[];搜索后不再回弹已搜词的联想 | 📜 dev+Playwright:`yuan`→10 联想(圆桌动漫/原神/…),`原神`→汉字联想,`'   '`→[];搜索后抑制 | 2026-07-14;host 需加入服务+dev 代理白名单(`s.search.bilibili.com`);best-effort,失败不阻塞打字 |
| C-SRCH-04 | 搜索页 = 原生 `<input>`(点框→**系统键盘**含话筒,LG 唯一语音路径)+ 下方推荐列表:**打字→联想**、**空闲→搜索历史+热门搜索**(热门走 `search/square` `data.trending.list`,host 已白名单);选任一推荐项即搜;无自绘键盘 | 🤖 verify.sh L6 test-ui(goto search→推荐列表 recItems>0→选首行→出结果) + 📜 dev+Playwright:原生 input、无 .osk-key、历史+热门两段、打字换联想、点项出结果;👁 search_yt_recs.png | 2026-07-18 owner 要"点框出系统键盘+下面搜索推荐 跟YouTube一样";联想曾被系统键盘遮挡故改推荐列表 |

## UI / 设计规范

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-UI-01 | 无 <16px 可见文字(10-foot 规范 docs/DESIGN.md) | 🤖 verify.sh L2 (grep) | 用户:"字这么小怎么给沙发用户看";20+ 处整改(2026-07-08) |
| C-UI-02 | 禁 aspect-ratio CSS(Chrome 88+,webOS 5/6 塌陷) | 🤖 verify.sh L2 (grep) | padding-top 替换时**引入黑封面回归**并发布(v1.2.7)——本 case 防再犯 |
| C-UI-03 | 面板/结束页封面图**真实加载**(naturalWidth>0),不是黑块 | 📜 QA 断言 imgs loaded(12/12);verify.sh L6 查全局 brokenImgs | v1.2.7 黑封面回归:img 在 padding-top 容器里需 absolute;**我自己截图里可见却没看出来**(教训:截图当用户视角逐像素看) |
| C-UI-04 | 首页网格渲染:卡片>5、侧栏在、0 裂图 | 🤖 verify.sh L6 | 基础烟测;曾多次做变更后的第一道岗 |

## 诊断 / 反馈通道

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-DIAG-01 | 健康 TV 上诊断页 5 项全绿(服务/API/风控/取流/图片代理) | 📜 真机脚本(v1.2.0 记录) | 为 #10/#13"远程失明"而建;上线当天定位到 webOS 5 根因 |
| C-DIAG-02 | **失败路径**:掐断 API(Playwright route.abort)→每项 ❌ 且带**真实错误文本** | 📜 dev+Playwright | 诊断页只看全绿=没测(验证纪律#2);实测全红含 PalmServiceBridge 文本 |
| C-DIAG-03 | 上报 QR:**纯 ASCII 报告**、从真机截图可解码(jsQR)、解码 URL 打开 GitHub 预填(标题+正文,正文在第3个 textarea) | 📜 jsQR 解码脚本 | 中文报告曾密到扫不出(9x percent-encode);395 字符 URL 全链路验证 |

## i18n(多语言)

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-I18N-01 | 每个字典覆盖源码全部 `t('…')` 字面 key(缺失=中文回退泄漏) | 🤖 verify.sh L2 (`tools/test-i18n-coverage.mjs`) | 建设期即抓到 OSK「删除」键漏包;123 键 + 6 动态键全覆盖(2026-07-09) |
| C-I18N-02 | 语言切换:设置行 OK 循环 自动→中文→English,持久化+reload 生效;auto 跟随 navigator.language | 📜 真机:en→auto(TV 系统 en-US 解析为 en)→zh 全循环,localStorage 持久、侧栏文案逐一验证 | 2026-07-09 真机;注意本 TV 系统语言是 en-US,auto≠中文 |
| C-I18N-03 | en 布局零溢出(英文串更长) | 📜 eval 断言 hOverflow=false、逐行 scrollWidth 检查 + 截图过目 | 2026-07-09:settings/home 双页零溢出(i18n_home_en/i18n_settings_en.png) |
| C-I18N-04 | 格式化本地化:zh 1.2万/1.3亿/5分钟前 ↔ en 12.3K/130.0M/5 min ago ↔ es hace 5 min | 🤖 verify.sh L2 (`tools/test-i18n-format.mjs`,子进程隔离逐 locale) | 卡片每次渲染都走这两个函数;zh/en 各 6 断言,es 4 断言 |
| C-I18N-05 | 加语言按 DEVELOPMENT.md 五步清单走通:es 全字典 125+15 键、切换生效、布局零溢出、字幕/标题/章节机翻自动跟随(tl=es) | 📜 真机(subtr_tv_es.png:'♪ Despierta en un sueño ♪'+西语标题+'CC Español (traducido)'+章节 'perro salvaje' 同框)+ 🤖 覆盖率/轨道名/格式化门禁 | 2026-07-10 以 es 实测;sidebar clipped=0、hOverflow=false;素材经 __openVideo 深链 |
| C-I18N-06 | 列表标题机翻(utils/titlemt.js):非中文界面 feed/搜索/历史/收藏/相关推荐/结束页卡片标题批量翻译(200ms 合批、缓存 800、失败留原文);zh 界面零开销直通 | 📜 真机截图 feed_titles_en.png(整页英文标题+英文元信息) | 2026-07-11;引擎复用 gtx(C-SUB-04 已验) |
| C-UI-05 | 有标题处必有时间:feed(pubdate)/搜索(pubdate)/历史·我的(view_at 观看时间)/收藏(pubtime)/播放器标题行(view 回填 owner·日期,深链也有)/结束页卡片(owner·发布时间) | 📜 真机:我的页 '3分钟前/24分钟前',深链标题行 '山南有樛木 · 2026/7/4' | 2026-07-11 owner 指出历史/收藏/标题行缺时间(映射缺失+入口依赖) |
| C-UI-06 | 弹幕开关单一状态源:播放器(点播/直播)切换均落盘,设置页行按 OK 当次翻转显示;三方(播放器↔存储↔设置页)任意方向改动一致 | 📜 真机:播放器切开→stored=true→设置页显示'开'→行上 OK→显示'关'+stored=false | 2026-07-11 owner 报"设置里关了播放器里是开"——点播切换不落盘 + 设置行写存储不刷显示,双 bug |
| C-PTR-01 | Magic Remote 指针全覆盖:移动唤出控制条;控制键/字幕面板/画质面板/标签行/推荐卡悬停=高亮、点击=确认;进度条点击定位;结束页卡片点击=立即播;语言弹层悬停/点击/点背景取消;直播页移动=显信息、点击=切弹幕 | 📜 真机 point.mjs:悬停弹幕键高亮、点击切换落盘;点 CC 键开面板→点轨道选中;进度条点中点 t=39→156(预期153);设置行悬停'字幕字号标准'高亮、双击循环到特大 | 2026-07-11 owner 报"指针控制不了很多按钮"——播放器控制区完全没接指针事件,连唤出控制条都只有按键路径 |
| C-I18N-07 | 非中文界面无"先中文后切换"闪现:列表/播放器标题、章节名待译期间留白(titleMT pending=''),5s 兜底回原文;字幕机翻轨只显已译 cue(onPartial 过滤),不显原文 | 📜 真机 en 界面:字幕 15s×60ms 轮询 cjkLeak=[]、首条即英文;🤖 test-subtranslate 'translated-only' 断言 | 2026-07-11 owner 报闪现;字幕/标题双路径治理 |
| C-SUB-05 | 字幕字号:设置行 小/标准/大/特大(0.85/1/1.2/1.4),下个视频生效 | 📜 真机:特大档 .subtitle-text fontSize=48(34×1.4) | 2026-07-11 owner 需求;与弹幕字号同构 |
| C-SUB-06 | 换视频保留**字幕语言**(不只开关):选英语→换任意视频仍是英语。匹配链:精确 lan → 记忆'x-mt'→机翻轨 → 同语族(人工优先,en-US↔ai-en 互通)→ 兜底 机翻→中文轨→tracks[0];「关」不清已记语言,重开恢复 | 🤖 匹配逻辑 verify.sh L2(test-subtitle 'match' 3 组)+ 📜 dev+Playwright E2E:A(BV1hiLAzJEuw)键盘选英语→settings.subtitleLan='ai-en'→__openVideo B(BV1TmKC6QExR 多语轨)→按钮显「字幕 英语(自动生成)」 | **真 bug 2026-07-26 owner 报告**:选英文换视频变阿拉伯语。根因:只存开/关,恢复取 tracks[0],而 player/v2 **轨序每次请求都变**(同一视频三抓分别 ai-ar/ai-es/ai-pt 打头)。正对照:同偏好同视频,老逻辑显「字幕 Español」复现,新逻辑显英语 |
| C-DM-01 | 弹幕机翻(非中文界面+弹幕开,自动):滚动窗口(播放头前 40s,8s/tick+seek 触发)、批内去重+全局文本缓存(梗全场翻一次)、未译不上屏(不闪中文)、引擎失败下 tick 重试、批上限 100 | 🤖 verify.sh L2 (`tools/test-dmtranslate.mjs`, 4 组) + 📜 真机(dm_mt_en.png:6 条英文弹幕滚动) | 2026-07-11 真机 en 界面 25s 36 条上屏、纯中文泄漏 0;样本 'Xinxiang is New York' 梗可译 |
| 教训 | CDP 按键/鼠标注入会**静默死亡**(keydown 计数=0),重启 app 恢复 —— 判"app 坏"前先挂计数器验通道 | —(纪律#3 的按键版) | 2026-07-09 语言行测试中复现并用计数器定位 |

## 投屏

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-CAST-01 | 国内版哔哩哔哩 → 我的小电视(NirvanaCast)投屏播放正常 | 👁 需手机实测 | **用户实证**:Cristinading v1.2.0 "casting…smooth with no problems"(#10);此代码约定不动(PR #3) |
| C-CAST-02 | 接收端可发现:9958 LISTEN、SSDP 广播、手机设备列表出现"我的小电视 (Supports 4K)" | 📜 netstat + 手机截图 | 投屏调查期间多次验证 |
| 已知空白 | 国际版(bstar)走 DLNA,SetAVTransportURI 是空壳→不播 | — 待做特性,非回归 | 2026-07-08 抓包(SetAVTransportURI 完整样本在案) |

| C-CAST-02 | DLNA 投屏(虎牙/通用发送端):SETUP 之外的 SOAP 全流程 —— SetAVTransportURI(XML 反转义+DIDL 标题)→ Play(URI+Play 双触发去重 5s)→ App 直链播放(LivePlayerPage directUrl,原生 HLS/MP4/**FLV**——虎牙超清 FLV 流真机实播验证,webOS 管线原生解 FLV);GetTransportInfo/GetPositionInfo 轮询应答;Stop 收播;NirvanaCast 路径零改动共存 | 📜 Mac curl 模拟发送端全流程:SetURI/Play 合法 SOAP 应答、Apple 测试流真机实播 t=39 ready=4、TransportState=PLAYING、Stop 回首页 | 2026-07-11 owner 虎牙投屏失败:/AVTransport/action 原是空 200(连 SOAP 应答都没有);服务器原本不读 POST body,一并补齐;owner 虎牙复测成功(含超清):castGetStatus 记录到 tx.flv.huya.com 超清流 playState=playing、进度推进 |

| C-CAST-03 | 虎牙投屏画质阶梯(casturl.js):attempt0=HLS+ratio=8000(蓝光)→ attempt1=HLS+原档 → attempt2+=原 FLV;超上限 404/403 触发重试自然降档;非虎牙 URL 任何 attempt 都不动 | 🤖 verify.sh L2 (`tools/test-casturl.mjs`, 17 断言) + 📜 真机 E2E(重放真实投屏:attempt0 实际以 ratio=8000 HLS 起播,失败自动降 2000) | 2026-07-12 owner"画质跟不上":实测 **ratio 不在 wsSecret 签名内**(同签名 2000→8000 分片码率 3 倍,10000→404/20000→403);另 webOS FLV demux 流级不可靠(MEDIA_ERR 4)故 HLS 优先;虎牙官方收端协议无公开逆向资料,DIDL 元数据仅标题(全量捕获过),不追 |
| C-CMT-03 | 评论竖栏(与直播聊天同构):入口从底部 tab 移到**控制栏「评论 · N」按钮**(底部 tab 只留 相关推荐/UP主投稿/选集 三个网格);打开时视频缩到 1500×844 靠上、右侧 420px 栏、下方 236px 放标题/UP主/赞币藏(不留黑边);栏内 ↑↓ 换焦点(蓝框)、OK 展开楼中楼、返回先关栏并把焦点还给评论按钮、视频回 1920 | 📜 dev+Playwright(BV1xx411c7Xg):按钮出现在控制栏、开栏后 videoW=1500/railLeft=1500/header「评论 · 2.6万」/20 卡、↑↓ 焦点 0→1→2、OK 楼中楼 3→10、Esc 关栏 videoW=1920 且焦点回按钮;信息条 top=844 h=236 | owner: "为什么聊天设计成竖着的区域,而评论不这么做" —— 一致性 + 1920 宽单列行太长难读;**踩坑**:pressControl 在 loadComments 之前定义→TDZ 白屏(与 applySpeed 同类,用 ref 解);批量改 JSX 缩进后 focusArea 样式替换静默失配→焦点框不渲染,必须逐项断言 |
| C-DEV-02 | **模拟器全量功能套件** `tools/test-sim.mjs`(27 断言):首页网格/滚动几何(留边)/侧栏循环/分区/搜索/设置行/点播(播放·控制栏·评论竖栏·楼中楼·分层返回)/直播(播放·控制栏·画质阶梯·聊天栏默认关·分层返回)/运行时零异常。接入 `verify.sh --sim`:自动拉起 dev-service + vite,跑完**自动停掉**(dev-service 会以「我的小电视」广播 SSDP,留着会和真电视重名) | 🤖 `bash tools/verify.sh --no-tv --sim` → 27 passed / 0 failed | owner 2026-08-02 "可以开始模拟器全量测试了吧"。**首次跑直播全红是测试串台**:没先退出点播播放器就开直播,两个播放器同时挂载,`.player-btn` 查到的是点播那条(640×480 正是老测试视频的分辨率)—— 套件现已先断言"已离开点播播放器" |
| C-DEV-01 | **模拟器 = 真机同一条代码路径**:`tools/dev-service.mjs` 用 Node-8 测试架的同一个 webos-service stub 加载**真实的 service.js**,把它注册的 14 个 Luna 方法经 HTTP(`/luna/<method>`)与 WS(`/luna-sub/<method>`)桥给 dev 浏览器;client.js 在无 PalmServiceBridge 时优先走桥(不可用则回退旧代理)。媒体地址统一为 `mediaProxyBase()`:真机与 dev 都走服务的本地代理 :7654 | 📜 dev 实测流量分布:**:9528 API 41 次(真服务)+ :7654 媒体 44 次(服务本地代理)**,旧代理仅 1 次;getDiagnostics 返回 loggedIn/buvid/danmakuModule 全真;视频正常播放 | owner 2026-08-02 "可以实现模拟器和真机一个效果吗"。**收益**:API/cookie/WBI/风控指纹/弹幕/投屏全部与真机同码;dev-service 还会起 SSDP+DLNA 接收端,手机可直接投屏到 Mac 调试。**仍不可消除**:老 Chromium 运行时怪癖、硬件解码与性能、倍速的 luna 通路 |
| 注意 | dev-service 在 Mac 上会以「我的小电视」名义广播 SSDP —— **和真电视同名**,手机投屏列表会出现两个。调试完请停掉该进程 | — | 2026-08-02 |
| C-LIVE-04 | **直播可在模拟器里全链路验证**(不必抢真机):dev 浏览器不支持原生 HLS → 仅 DEV 分支挂 hls.js(生产构建不含该依赖,电视仍原生管线);弹幕/互动 → Mac 代理复用**电视服务同一份** `danmaku.js` 中继经 WebSocket 桥给浏览器;dev 的 buvid3 指纹写进代理 cookie 罐(否则 getDanmuInfo 恒 -352 拿不到聊天 token) | 📜 dev 实测(真实房间 3683436):视频 1920×1080 播放中、token code=0、互动事件 online×6/watched/enter 到达、聊天栏显示「👀 2028 · 在线 27」 | owner 2026-08-02 "直播为什么测不了,解决一下";**关键设计**:dev 与真机跑同一份解包/解析代码,避免"模拟器过、真机挂" |
| C-LIVE-05 | 聊天栏可关且在返回链上:控制栏「聊天 开/关」OK 切换并持久化(默认关);返回键三层 —— 控制栏 → 聊天栏 → 退出直播间 | 📜 dev 实测:切换后 rail 消失/videoW 回 1920/liveInteract=false;返回三下依次为 收控制栏(栏还在)→ 只关聊天栏(仍在房内)→ 退出 | owner 问"聊天栏可以关闭吗"时发现返回链漏了聊天栏:原来第二下直接退房,与点播评论竖栏不一致 |
| C-LIVE-02 | 直播控制栏 + 画质切换(#18):↑ 唤出控制栏(弹幕/画质/互动),画质按钮显示**当前档位名**(原画/蓝光/超清,取自 getRoomPlayInfo 的 accept_qn + g_qn_desc);选档=带 qn 重连(直播地址按画质签发)并落盘 liveQn,下次进直播间自动用;返回分层 画质面板→控制栏→退出;投屏(directUrl)无档位不显示 | 📜 dev+Playwright(真实房间 3683436):↑ 出栏 btns=["弹幕 开","蓝光","互动 关"]、右移聚焦画质、OK 弹出["原画","蓝光","超清"]、Esc×3 逐层退出;真机验证挂 verify_when_free 守望 | 2026-07-25 issue #18(JackZhan233)"直播加个切换画质";owner 追加"直播没有控制台" |
| C-LIVE-03 | 直播互动展示 + **默认关**:服务端中继扩展转发 SEND_GIFT/SUPER_CHAT/GUARD_BUY/INTERACT_WORD/WATCHED_CHANGE/LIKE_INFO_V3/ONLINE_RANK(danmaku 字符串保持旧契约,新事件走 `event` 字段=老 app 自动忽略);礼物/SC/上舰/新关注右下角滚动(≤8 条),观看/点赞/在线数进信息栏;**互动浮层默认关闭**,控制栏「互动」键开关并持久化 liveInteract | 📜 dev:干净配置首开=「互动 关」且无浮层;OK 切开→liveInteract=true;再 OK 关→false;🤖 danmaku.js/service.js acorn ES2017 门禁(Node 8) | owner: "影响观看体验的部分就不要了,或者可以开关" —— 浮层默认不打扰,想看时一键开 |
| C-LIVE-01 | 直播/投屏断流自愈(LivePlayerPage):media-error/意外 ended/8s 停滞 watchdog → 自动重连 ≤5 次(1-4s 递增退避,B站直播每次**重取新签名地址**),恢复后重试预算归零;极限后诚实上报 error;全程 __liveDiag 痕迹 | 📜 dev Playwright(Chrome 不能原生 HLS → 必触发):connect:0→media-error→…→connect:5→gave-up 完整链路 | 2026-07-11 owner 报虎牙投屏"有断的情况…黑屏":直播路径原本零恢复零日志,断=永久黑屏 |

## API 存活(B站接口会下线!)

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-API-01 | 分区页有内容(newlist 接口) | 🤖 test-ui(分区 loads content) | **门禁抓到真事故**:dynamic/region 被 B站 下线(-404 全 rid),线上分区页空了一段时间(v1.2.8 修) |
| C-API-02 | 核心 API 集成(登录态/推荐/播放/直播/搜索/番剧) | 📜 `node tools/test-e2e.mjs`(需 proxy) | 长期使用的 API 回归 |

## 已知 flaky(不作为发布阻塞,但每次都要人工判断)

**2026-07-10 大翻案**:上面沉淀过的"flaky 四件套"(update-check ×2、我的徽标、
danmaku layer)根因找到了,根本不是时序——**test-ui 的侧栏索引表 NAV 是硬编码的,
收藏加入侧栏后全体漂移**:goto('settings') 落在搜索页(cards=0)、goto('config')
落在我的页(找不到"检查更新"行);连 Search 的 ✅ 都是假阳性(goto('search') 落在
收藏页,恰好也有卡片)。修复:侧栏按图标(🏠🔥📡…)运行时动态定位,永不再漂;
danmaku 断言改为设置感知(测试前强开、测后还原用户偏好);徽标断言直接 waitFor
徽标本体(20s)。修后 **26/26 全绿 0 warn**(历史首次)。

**教训(比 case 本身值钱)**:harness 断言失败先怀疑 harness 与被测系统的**结构
契约**(导航索引、选择器、持久化设置、**界面语言**——2026-07-11 owner 把电视切到
西语,4 条中文文案断言集体假阴;修法:套件开跑强制 zh、跑完恢复用户语言),
"时序脆弱"是最后的解释,不是第一个。
连续多次"人工复核为假阴"本身就是根因未除的信号 —— flaky 清单里的条目每再触发一次,
必须往根因多挖一层,而不是再盖一个"人工复核通过"章。

当前仍在观察名单:(空 —— 修复后首轮全绿,出现新失败先按上面教训挖根因)

---

| C-UI-07 | 设置页交互规范:>2 选项的行(每行视频/弹幕字号/字幕字号/CDN/语言)= 弹层列表(✓ 当前、悬停/点击、背景取消),布尔行(弹幕)= 开关控件;创作声明(argue_info:AI/剧情演绎/个人观点)显示在播放器元信息行,非中文界面走 titleMT | 📜 真机(owner 西语界面实际使用中开出 'Ruta CDN/Auto✓' 弹层)+ dev 浏览器('桃姐恋爱 · 2026/7/9 ⚠️ 个人观点,仅供参考') | 2026-07-11 owner 两项需求;argue_msg 字段经真实 API 探测确认(3 视频中 2 个带) |

| C-LATER-01 | **稍后再看端到端**:播放器控制栏「稍后再看」OK 加入(按钮翻成「已稍后再看」)→「我的」页 tab 行出现「观看历史 / 稍后再看」→ 切过去能看到刚加的视频 → 长按 OK 从列表移除。写操作**净零**:测什么加什么、加完自己删掉,跑完审计账号只剩 owner 原有条目 | 🤖 `bash tools/verify.sh --no-tv --sim`(35 断言里 6 条) | issue #19(coolyzp 2026-07-29)。移除前**必须断言卡片身份含夹具标题**再长按 —— 写操作安全线,别把 owner 真存的东西按掉 |
| C-LATER-02 | 长按是焦点系统的**通用能力**而非卡片私有:`useFocusable({onLongPress})` 传了才启用(OK 改为松开触发 + 800ms 阈值 + `.holding` 进度条),没传的项时序一个字节不变(仍 keydown 即触发)。焦点被移走要中断长按,否则松手会误触到别的卡片 | 🤖 同上;回归看点:首页/搜索/设置/播放器控制栏的 OK 全部照旧(35/35 全绿) | 播放器三连的长按是按钮私有实现,卡片要长按只能重做一遍 —— 与其复制不如上提到焦点层 |
| C-SIM-01 | **直播夹具不许写死房间号**:套件运行时从推荐列表挑一个 `live_status===1` 的房间;一个都挑不到就 warn 跳过直播段,不记失败 | 🤖 `tools/test-sim.mjs` 的 `pickLiveRoom()` | 2026-08-06:写死的 3683436 下播(live_status=0),直播段连挂 4 条,全是环境不是代码。**没有直播源可测是环境事实,不该记成代码缺陷**;顺带把画质阶梯断言从 `>=2` 放宽到 `>=1`(单档「原画」房间合法) |

| C-LATER-03 | **写操作的身份断言必须读"被聚焦的那个元素"**,不是列表第 0 个。真机套件加了 `focusedCard` 字段,长按前先把焦点走到目标卡上、回读焦点卡再断言;焦点走不到就直接放弃长按 | 🤖 `node tools/test-ui.mjs` 的 [稍后再看] 段(7 条);模拟器套件同步改成回读 `.video-card.focused` | **2026-08-06 真删了 owner 的收藏**:焦点在第 2 个 chip 上按「下」落到第 2 张卡(owner 的 UFC),而断言读的是第 1 张(测试刚加的),于是"身份核对通过"→ 长按打在别人身上。安全线写着"同步骤断言视频身份",漏的是"同一个元素"这半句 —— 已按 API 恢复原状并复核 |

| C-TRI-02 | **三连后三项都要点亮**:三连接口返回的 `data.{like,coin,fav}` 是"这次做了什么",不是"最终什么状态"。之前已赞已投的视频只回 `fav:true`,老代码 OR 进去就只有收藏变色。纯函数 `app/src/player/tripleState.js` + 校准只许**往上合并**(不许把刚写成功的按回去) | 🤖 `node tools/test-triplestate.mjs`(10 条,已进 verify.sh)。**正对照**:旧逻辑跑同一场景得 `{liked:false,coined:0,faved:true}`,与 owner 描述逐字吻合 | owner 2026-08-09「一键三连之后,只有收藏的数字的颜色变了」。顺带实测排除了两个假设:relation 读写**立即一致**(不是服务端延迟);字段名是 `favorite`/`coin`(枚数)不是 `fav` |
| C-MENU-01 | **卡片长按 = 弹菜单,不是直接执行**:任意列表页(首页/分区/搜索/收藏/稍后再看)+ 播放器底部相关推荐,长按 OK 都弹同一个菜单;菜单只打开不改数据;选「移除」才真删。菜单键盘走 **window 捕获阶段**,不抢 `setCustomKeyHandler`(单槽,播放器占着) | 🤖 test-sim.mjs:「Long-press opens the card menu (not an instant delete)」「Nothing is deleted just by opening the menu」「首页卡片长按也弹菜单」「长按不会误触发播放」 | owner 2026-08-09「长按有菜单 可以添加稍后」+「在稍后观看里,长按列表里视频不要删除,而是弹出菜单然后选择删除」 |
| C-LATER-04 | **tab 不许被返回键顺手切走**:「我的」页进稍后再看 → 下进网格 → 上回来,tab 仍是稍后再看,且焦点落在**当前 tab 的 chip** 上;chip 选中态用粉底+左粉条,离焦也一眼可辨 | 🤖 test-sim.mjs 两条:no tab reset / focus lands on the active chip | owner 2026-08-09 报的 bug:网格第 0 列往上落到 `content-0-0` = 观看历史,"选中即切换"把 tab 切走了 |
| C-LATER-05 | **稍后再看按列表连播**(对齐官方):从列表点开哪个就从哪个起播,播完自动下一个;设置项「看完移出稍后再看」默认关,只对**从稍后再看点开**的视频生效 | 🤖 test-sim.mjs:设置行存在;连播复用收藏夹 playlist 机制(C-PLAY 系列已覆盖) | owner 2026-08-09「官方app行为里,稍后观看会按照列表来一个一个播放吗?可以对齐」——查证官方确实连播 |
| C-UI-08 | **禁 `inset` 简写**(Chrome 87+,电视是 68/79):写了它固定定位的遮罩会塌成 0 尺寸,看着像"菜单没有背景遮罩" | 🤖 verify.sh 静态门禁 `no inset shorthand` | 2026-08-09 卡片菜单遮罩就是这么写的,进真机前被门禁拦下;`App.jsx` 里原有的一处同样问题一并修 |

| C-MENU-02 | **删掉焦点所在的卡之后,焦点必须有着落**:菜单移除的正是被聚焦那张,卡一卸载 `currentFocusId` 就指向不存在的元素,电视上表现为"遥控器突然没反应"。移完把焦点安置到下一张卡;列表空了就退回当前 tab 的 chip | 🤖 `node tools/test-ui.mjs`:「返回时焦点落在当前 tab 的 chip 上」——这条真机跑出来是红的,才发现焦点丢了 | 2026-08-09 真机回归抓到。模拟器那轮没抓到:sim 里删完还剩别的卡,焦点恰好有地方落 |

| C-MENU-03 | **长按弹出的菜单必须先"解除保险"**:菜单是按住 OK 800ms 弹出来的,弹出时手还按着,遥控器连发 keydown 会立刻把第一项确认掉。必须先收到一次 **keyup** 才接受确认;松手本身也不算确认,要再按一次 | 🤖 test-sim.mjs 两条:「按住不放:菜单弹出但不会自己确认」「松手本身也不算确认」;三段式实测(按住2s→弹出未确认 / 松手→无事 / 再按→执行) | owner 2026-08-09「不能一直长按就可以点击吧,得再按一次」。**修之前实测按住 2 秒就真把视频加进了列表**(误加那条已按 API 清掉) |
| C-UI-09 | **不许把 v1.6.0 的设计色提前混进来**:方向 C 的粉 `#fb7299` 属于 v1.6.0 设计三期,当前版本一律用现有主色 `#00a1d6`。新增控件(长按进度条/chip 选中态/菜单焦点行)都必须跟现有配色一致 | 📜 `grep -n fb7299 app/src/styles.css` 只应剩 4 处历史用法:已赞已投已藏、三连进度环、大会员标、直播中角标 | owner 2026-08-09「没说现在就换成粉色啊。先颜色统一啊」—— 我在做稍后再看时顺手用了新方向的粉,属于夹带 |

| C-UI-10 | **焦点态必须写进 className**:焦点系统是直接改 `classList` 加 `.focused` 的(零重渲染),组件一旦因别的原因重渲染,React 就会用新的 className 字符串把 `.focused` 覆盖掉。凡是"会随状态重渲染 + 又要显示焦点"的元素(TabChip / FolderChip),都要把 `useFocusable` 返回的 `isFocused` 拼进 className | 🤖 test-sim.mjs:「选中的 tab 是实心蓝,且焦点态没被重渲染擦掉」(断计算样式 `rgb(0, 161, 214)`) | owner 2026-08-09「点我的 按右,再按右 怎么按钮的颜色不一致呢」。实测:按右两下后第二个 chip 只剩 `fav-chip-active`,`focused` 被切 tab 的重渲染擦掉,于是显示半透明底 |
| C-SIM-02 | **起播断言不许用固定 sleep**:改轮询(最多 25s)。固定 9s 在 2026-08-09 连挂两轮,查下来视频其实在播,只是要 10-12s 才起来 —— 定时假设随网速漂移,和写死直播房间号是同一类夹具缺陷 | 🤖 test-sim.mjs 的 `Video plays` 轮询实现 | 排查记录:playurl 接口返回 code=0 且有 dash,浏览器里 +12s 时 t=20.2s 正常播放 |

| C-DIAG-01 | **诊断探针必须走和生产完全相同的链路**:playurl 探针原来用不签名的 `apiFetch`,而播放器用 `wbiFetch`(带 WBI 签名)。在被风控盯上的网络里,不签名的请求比真实取流更容易被拦 → 诊断报红但视频其实能放。另外风控码要翻成人话(-351/-352 → "常见于海外 IP:试试登录或换 CDN 线路") | 📜 真机诊断面板五项全绿(`取流 playurl — code=0`);排查记录:同一 URL 在无 cookie / 只带 buvid / 已登录三种状态下均返回 code=0,证明签名与登录都不是分歧点,分歧在探针自身 | issue #20(123david372,2026-08-09)贴的诊断只有 playurl 一条红。**"探针比生产链路脆弱 = 假警报",和"测试夹具必须贴合生产"是同一条原则** |

| C-UI-11 | **界面字号**(issue #22):设置页「界面字号」标准/大/特大 → `--ui-scale` 全局倍数,所有 font-size 走 `calc(基准 * var(--ui-scale))`;重启后仍生效(App 挂载时回写)。弹幕/字幕不受影响(它们的字号是组件内联设的,且各有独立选项)。**风险点不是字变大,是放大后网格滚动会不会裁切** | 🤖 test-sim.mjs 5 条:设置行存在 / 字号确实放大(27.5px)/ 侧栏不溢出 / **特大档深行卡片完整可见** / **特大档回顶不裁切** | issue #22(lesswest,2026-08-10)。卡片变高后仍正常,靠的是网格滚动读真实 `offsetTop`(2026-07 那次修复) |
| C-SIM-03 | **真机套件必须能从"app 已退出"中自愈**:套件的 Back 链有时会退出 app,之后每个 `goto()` 都报 `icon not in sidebar []` —— 一轮 10 条全红,看着像功能全挂,其实只是没 app 了。现在侧栏空时先 reload,还空就用 luna 重新拉起 | 🤖 `tools/test-ui.mjs` 的 `goto()` 自愈;实测日志出现「(app 已退出,重新拉起…)」后继续跑完 36 条 | 2026-08-16 连续三轮结果 37/32/21,排查后确认是 app 退出的连锁误报,不是回归 |
| C-SIM-04 | **单个直播间打不开不算功能回归**:直播列表里混着轮播/刚下播/付费房间。真机套件改为最多试 3 个房间,全都起不来才判失败 | 🤖 test-ui.mjs 直播段(输出会标明"第几个房间") | 与 C-SIM-01(模拟器不许写死房间号)同源 |

| C-ERR-01 | **接口错误码必须翻成用户能照做的话**,且播放器与诊断面板**共用一份映射**(`app/src/utils/apiHint.js`):-351/-352 → 「风控拦截 · **登录后通常可解决**;海外可换 CDN 线路」;-10403 地区;-404 失效;-403 权限。取流被拒时播放器直接显示这句,不再只给「视频加载失败」 | 🤖 `node tools/test-apihint.mjs`(8 条,已进 verify.sh) | issue #20 与 #23 两位用户贴的诊断都只有 `playurl code=-351`,而播放器只说"加载失败"——不知道是风控,更不知道登录能解决。**排查中实测排除了两个假设**:未登录 vs 已登录、buvid 未激活 vs 已激活(ExClimbWuzhi),在未被标记的 IP 上全部返回 code=0,说明触发点在网络侧 |

| C-ERR-02 | **取流失败要给"说得清的原因 + 能按下去的出路"**:① 提示按登录状态分流 —— 已登录还被拦 = 多半是**账号**被风控(建议换账号验证),未登录才劝登录;② 错误页放「去网络诊断」按钮,OK 直达设置页并**自动展开**诊断面板。该分支必须放在播放器按键处理器**最前面**(放后面会被 `focusArea==='none'` 的"OK 呼出控制条"吃掉) | 🤖 test-sim.mjs 4 条:拦截 dev 桥把 playurl 强制成 -351 → 断言提示文案/按钮存在/OK 后退出播放器且诊断展开 | issue #23:用户回复「换了其他账号就可以正常播放」——**账号级风控**。而当时的提示在劝他"登录一下试试",正好指反方向 |
| C-ERR-03 | **view 被风控拦(-412)时 pagelist 兜底**:B站 对海外匿名把 `/x/web-interface/view` 整个拦了(HTTP 412/code=-412),但 pagelist/playurl 都通。view 只是取 cid 的路径,被拦时用 pagelist 补 cid+分P,标题/UP 用卡片数据顶上,播放照常;兜底也失败才报 -412 对症提示 | 🤖 test-sim.mjs:置 `bili_test_view412` 强制走兜底分支,断言视频照样播且无错误屏 | issue #25(v1.7.0 · webOS 6 · 海外未登录)。诊断原文案 `playurl view code=-412` 有误导:挂的是 view,取流根本没跑 —— 探针已拆成独立的「视频信息 view」行 |
| C-SIM-05 | 真机套件总超时从 5 分钟提到 10 分钟:直播段重试 3 个房间 + 稍后再看端到端之后跑不完,会在中途把整轮判失败 | 🤖 `tools/test-ui.mjs` 末尾常量 | 2026-08-21 一轮跑到第 9 条就 "overall timeout" |

| C-LIVE-06 | **直播解码失败必须降档**:B站 房间原本**完全没有降档** —— variant 阶梯只对投屏 `directUrl` 生效,B站 房间每次重试都用同一个 qn 重取,解不了就永久黑屏。现在 `media-error code 3`(MEDIA_ERR_DECODE)按 accept_qn 从高到低退一档;网络错(2)/格式错(4)不降档,交回重试;退让不写进用户设置 | 🤖 `node tools/test-liveqn.mjs`(11 条,已进 verify.sh)。**现场证据**:CDP 抓到 `connect → media-error{code:3} → retry → media-error{code:3}` 死循环 | owner 2026-08-22「直播黑屏了」。排查顺序值得记:先怀疑取流(m3u8 200、分片 200 均正常)→ 再看播放器日志才定位到解码。**纯函数覆盖是因为这条路没法按需复现** —— 要正好碰上一个本机解不了的档位 |
| C-LIVE-07 | **直播的上/下键与点播一致**:无浮层时上、下**都**呼出控制条(原来只有上键,按下去像没反应);**聊天栏打开即有历史**(进房先拉 `dM/gethistory` 铺最近 20 条,再接实时流;只在栏为空时铺,避免与实时消息重复) | 🤖 test-sim.mjs 两条:「直播:按「下」也能呼出控制栏」「聊天栏打开即有历史消息」(实测 16 行) | owner 2026-08-22「按上来呼出控制区?但是按下为什么不会出?跟普通视频体验不一样」「每次都是实时清屏相当于」 |

| C-SIM-06 | **焦点为 null 时 `goto()` 要能重新锚定**:页面切换时焦点元素随之卸载,`currentFocusId` 变 null;而方向键在没有焦点时被按键处理器直接 return —— 按左键永远救不回来,表现为 `stuck at sidebar row null`。现在先按 Back(App 会把焦点送回侧栏),仍不行就直接点第一个侧栏项 | 🤖 `tools/test-ui.mjs` 的 `goto()`;2026-08-23 发版门禁上连挂两条,加了锚定后 37/0 | 与 C-SIM-03(app 退出自愈)同源:**套件必须能从"焦点/进程丢失"里自己爬起来**,否则一次环境抖动就报一片假回归 |

| C-UI-12 | **「已关注」标不能漏**:关注列表要拉到拉完为止(原来只拉 5 页 = 250 个就停,并错误注释成"web 接口上限 250";实测本人账号 pn=6/7/8 都正常返回,共 370 个),并把 mid 统一成数字后再查表(类型失配会静默漏标)。冷启动先用本地缓存显示、后台再刷新 | 🤖 test-sim.mjs:**判据必然为真** —— 「关注」页里的 UP 按定义全部已关注,所以每张卡都该有标(实测 20/20,本地缓存 370 个) | owner 2026-08-31「有些关注了的 up 主在列表页上没有关注标,有的有 有的没有」——第 251 个之后的 UP 永远没标 |
| C-UI-13 | **评论数在打开评论之前就要显示**:视频信息里本来就带 `stat.reply`,用它给评论按钮打底,不要等用户点开评论、加载完第一页才有数字 | 🤖 test-sim.mjs:呼出控制条(未点开评论)后断言按钮文案匹配 `/评论\s*·/`,实测「评论 · 2.7万」 | owner 2026-08-31「评论 在没有打开之前 评论的数量不会展示 这样不够友好」。第一版把赋值写在了番剧/UGC 合流之后的作用域外(`d is not defined`),整个播放器崩到错误页 —— 改动播放器后必须先跑 sim 再上真机 |
| C-UI-14 | **控制栏首尾循环**:焦点在第一个(暂停)按左 → 跳到最后一个(评论);在最后一个按右 → 回到第一个。和侧栏的上下循环一致 | 🤖 test-sim.mjs:暂停 →(左)评论 →(右)暂停;真机同样通过 | owner 2026-08-31「光标在 暂停 上时 按左 也可以来到最后一个 评论按钮上」——一行十个按钮,不循环要按九下 |
| C-CDN-01 | **MPD 末尾无条件带兜底镜像**(cosov + estgoss 的换 host 副本):B站 给海外用户的主备常常全是同一家(Akamai),全挂 Shaka 就没得滑。签名 `upsig` 不含 host,换到任何 `*.bilivideo.com` 镜像都有效(LA/国内直连都验过) | 🤖 test-sim.mjs:读 `window.__lastMpd` 断言 BaseURL 含 mirrorcosov 与 estgoss | issue #29:接口全通、Akamai 节点 socket hang up。同时查出「海外 Akamai」线路选项从上线起就是 403(Akamai 要自己的 hdnts token,换 host 必挂)→ 已下架,换成腾讯云海外/阿里云海外 |
| C-CDN-02 | **主 CDN 挂了自愈**:请求过滤器改写**每一个** URI 走代理(以前只改 uris[0],备用 URL 被浏览器直连 = 失败转移形同虚设);同一 host 60s 内两次失败拉黑 5 分钟,过滤器直接跳过;代理 502 带 CORS 头让 Shaka 看得到真实状态 | 🤖 test-sim.mjs:钩子 `bili_test_badcdn` 把必挂 host 塞到 BaseURL 最前,断言视频照样往前走且 `__cdnBanned()` 含该 host(实测 4.9s 拉黑起播) | 第一版断言"15s 内 currentTime>1"误报:前一条用例把进度存在片尾,续播落在结尾。**播放类断言要先把进度拨到确定位置** |
| C-DIAG-02 | **诊断「CDN 测速」**:探针视频用推荐流里的热门长视频(≥5 分钟)而不是 av2 —— av2 在边缘节点是冷的,首次触碰要回源,8s 都不够,真机上把通的镜像报成「超时」;文件又小得只剩 64KB 的并发块,比值全是噪声。热门视频边缘有缓存、文件够大,测的才是线路本身。可达探针预算 15s。在能连上的镜像上,先单连接拉一块(≤2MB,10s 预算),再在另一偏移拆 4 个子块并发拉,报两个吞吐和比值。目的:替我们在真实海外线路上验证"分块并发拉流"(线程撕裂者那套)有没有用 —— LA 观测点是负收益(单连接 ≥ 4 并发),但欧洲/东南亚家庭宽带可能按连接限速,没观测点就让用户的诊断报告来测;比值 ≥3 的报告多了再做代理层分块拉取 | 🤖 test-sim.mjs:重跑一轮真实网络诊断,轮询「CDN 测速」行匹配 `单连接(1x) x MB/s · 4 并发(4x) y MB/s`(带 ASCII 标记是因为扫码报告体会剥掉 CJK,只留 `(1x) … (4x) … (xR)` 也能读) | 首版断言放在 playurl 被 mock 失败的那轮诊断后面,永远拿不到测速行 —— **依赖真实网络的行要在 unroute 之后重跑一轮再断言**。代理 502/206 都要带 `Access-Control-Expose-Headers: Content-Range`,否则页面拿不到文件总长选不了偏移 |
| C-UI-15 | **「播完自动播放下一个」可关**(设置 → 播放与显示,默认开):关掉后片尾不启动 10 秒倒计时,停在推荐列表等手动选;开着时倒计时照常 | 🤖 test-sim.mjs:置 `bili_settings.autoplayNext=false`,把进度拨到片尾,断言 ended 且页面无「秒后自动播放」;真机双向验证(关→无倒计时截图,恢复默认→倒计时回来) | issue #27(@ydawei):人不在电视前,回来已经被带去别的视频。实现即 issue 里建议的三件套:storage 默认值 + 设置行开关 + `setEndNextIn(10)` 前判断 |

## 全量回归记录

| 日期 | 范围 | 结果 |
|---|---|---|
| 2026-08-06 | verify.sh --full(六层 + 真机 UI smoke)+ 模拟器全量 test-sim.mjs | 真机 **33 passed / 0 failed / 1 warned**(warn=直播间没人发弹幕);模拟器 **35 passed / 0 failed**。过程中真机跑出一次**误删 owner 稍后再看条目**(见 C-LATER-03),已恢复并修根因,重跑净零 |
| 2026-08-23 | v1.6.3 发版门禁:verify.sh --full(六层)+ 模拟器 58 条 + 真机 37 条 | 模拟器 **58/58**,真机 **37/0/1 warn**。门禁首轮因焦点 null 挂 2 条,补 goto 重新锚定后全绿(C-SIM-06) |
| 2026-08-16 | verify.sh --full(六层)+ 模拟器 50 条 + 真机 37 条 | 模拟器 **50/50**,真机 **37/0/1 warn**。本轮修了三个夹具缺陷(app 退出自愈、直播间重试、起播轮询),避免把环境问题误判成回归 |
| 2026-08-09 | verify.sh --full(六层 + 真机 UI smoke 37 条)+ 模拟器全量 42 条 | 真机 **37 passed / 0 failed / 1 warned**(warn=直播间没人发弹幕);模拟器 **42/42**。真机抓到两个模拟器没抓到的:① 真机套件里长按断言还是旧的(直接删),暴露我改了 sim 忘了改真机;② **移除后焦点丢失**(sim 里删完还剩卡,焦点恰好有处可落)。测后审计稍后再看净零 |
| 2026-07-11 | verify.sh --full(六层+UI smoke 26/26)+ 📜 真机:C-FOCUS-02(1268↔317)、C-PLAY-03(t=2503 续播)、C-SUB-02(面板全流程+联动隐藏+字幕层保留)、C-PTR-01(悬停/点击/进度条 1265/2526≈50%)、C-SUB-04+C-I18N-07(en 字幕 26 样本 0 中文)、C-DM-01(35 条 0 纯中文)、C-UI-05(我的页 刚刚/1分钟前)、C-UI-06(行当次翻转)、C-I18N-02(弹层开/勾/Back 取消零刷新) | **全部 PASS**;过程中两次踩跨调用超时假阴(单会话重跑即过,纪律再次生效);电视终态=用户原设(zh/弹幕关/字幕关) |

## 追加规范

新 case 必须包含:**做什么、怎么跑(命令/脚本)、佐证(抓过什么真 bug 或正对照记录)**。
只写"应该没问题"的 case 不收。定期把 📜 升级为 🤖(进 verify.sh)。

## 2026-09-06 电视 UX 回归

浏览器命令：`bash tools/verify.sh --no-tv --ux`；单独运行：`npm run test:ux`（Vite 已启动）。
真机命令：`npm run test:ux:tv`。旧版从 `0ee48bd` 独立导出，使用同一 Playwright 输入管线和夹具；不覆盖工作区。

| Case | 行为 | 验证与事实佐证 |
| --- | --- | --- |
| C-UX-01 | Back / 左键回侧栏不改变列表偏移；右键恢复原卡片；OK 保留主动刷新功能 | 浏览器旧版右键回首卡、新版恢复原卡；旧版 OK 刷新本来就通过。真机返回侧栏前后均 `translateY(-999px)`，右键回 `content-3-1`；确认刷新回 `content-0-0` |
| C-UX-02 | 初始和慢请求期间有可操作焦点；过期请求不抢走新页面焦点 | 延迟首屏 1.7s，旧版 700ms 无焦点，方向键无效；新版侧栏可继续操作。真机首轮还抓到刷新后焦点被旧卡片卸载带走，刷新版本重建后复验通过 |
| C-UX-03 | 悬停不滚动；滚轮按浏览位置移动，包括目标卡片已被悬停高亮时 | 旧版将指针移至底部导致 transform 变化；新版保持不变。增加轮动已高亮行及底边向上滚动的受信输入测试 |
| C-UX-04 | 搜索保留退格/光标编辑，最新查询胜出，失败可重试 | 旧版 `abc` 按 Backspace 无法删除；新旧请求乱序时旧版结果被旧关键词覆盖，新版保留新搜索。`route.abort()` 验证独立错误状态 |
| C-UX-05 | 经过未登录栏目不弹登录；登录弹层隔离方向键及滚轮，能取消/重试 | 旧版侧栏经过关注直接打开登录；旧版登录层按键会改变背景焦点。相同夹具中新版不再触发，扫码接口失败可重试、Back 可关闭 |
| C-UX-06 | 收藏夹空响应停止加载；旧文件夹响应不覆盖新文件夹；上移保持选中的收藏夹 | 旧版空收藏夹接口后一直 loading，旧请求返回后覆盖当前内容，上移会切换收藏夹；新版对应场景通过 |
| C-UX-07 | 收藏页最后一排完整可见，滚动上限扣除选择器高度 | 4 列、1.25 字号、30 条数据：旧版末卡 y=795.41、height=349.69，底部=1145.09，超出 1080 约 65px；新版相同脚本末卡完全可见 |
| C-UX-08 | 从深列表进入播放再退出，恢复同一卡片与偏移 | 真机单 CDP 会话：从 `content-10-0` 启播达到 `readyState=4`，退出后回相同卡片及偏移；作为 C-UX-01/02 焦点生命周期变更的回归保护 |

浏览器套件另覆盖模块加载取消、失败重试恢复、快速侧栏经过和三语大字号截图。截图不能用 DOM rect 代替，已检查实际电视首页与深网格截图。

## 2026-09-06 内容画廊重设计

命令：`npm run test:ux`（Vite 启动后）；`npm run test:ux:tv`。设计与截图见 [TV-REDESIGN.md](TV-REDESIGN.md)。

| Case | 行为 | 验证与事实佐证 |
| --- | --- | --- |
| C-DS-01 | 图标侧栏覆盖展开，内容区与原卡片位置不变 | 改前快照没有展开状态；新版相同受信输入检查主内容与卡片中心位置，真机展开前后 mainX 相等。Back 保持 `translateY(-1452px)`，Right 回 `content-3-2` |
| C-DS-02 | 侧栏展开后底部焦点仍可见 | 开发中实测特大字号：设置按钮 bottom=982，导航 viewport.bottom=896，遮住 86px；展开后再次按新视口校准滚动，浏览器与电视均通过 |
| C-DS-03 | 继续观看过滤已结束内容，正确连接推荐和原始进度 | 改前快照无入口；新版 5 条历史中仅保留 3 条未结束记录。真机 103 秒记录实际从 103.0 秒启动，退出后恢复 `content--1-0` |
| C-DS-04 | 迟到或失败的历史不打断推荐；大字号双列仍完整显示焦点卡片 | 延迟历史 1.8s，先下移到深行，再收到历史，焦点与屏幕 Y 保持；`route.abort()` 后推荐仍可操作。两列 1.25 字号检查首卡、深卡与续播/侧栏之间恢复 |
| C-DS-05 | 搜索热榜和历史用左右键连通，确认执行正确搜索 | 改前相同右键停在 `content-1-0`；新版到 `content-1-1`，确认返回所选历史关键词的结果。真机两栏与原生输入同时显示 |
| C-DS-06 | 卡片文本不溢出，设置三语大字号可读 | 固定标题槽位与元信息底边检查；zh/en/es 下 1.25 字号，设置没有横向溢出，最后焦点行在可见范围内；截图逐一检查 |
| C-DS-07 | 新播放器控件保持实际播放和退出语义 | 真机从 `content-10-0` 开始播放达到 readyState 4，控件使用共享 SVG，退出后原卡片与偏移一致；播放图像由硬件层合成，CDP 黑背景不作为解码失败依据 |

### 顶部精简与设置字号顺序

- 列表页顶部只保留栏目名，去掉刷新按钮、品牌副标、标语和续播重复说明。LG C4 标准字号实际测量：标题区 179.8px → 62px，内容视口 835.2px → 953px；标题区无按钮。既有 35 个浏览器交互与几何场景通过，包括侧栏确认刷新、返回位置、加载失败重试和三语大字号。
- **C-SET-ORDER**：设置页向下/向上必须严格遵循可见顺序。用户实报跳过字号项再跳回来，发现字幕字号注册为第 5 行、界面字号注册为第 4 行，与 DOM 相反。修复前同一真实键盘测试失败；修复后依次经过弹幕字号、字幕字号、界面字号，反向也一致。
- **C-SET-PICKER**：三个字号入口的选择器标题对应当前行；选择“大”只更新对应设置；再次打开、移动后取消不改变值；关闭后焦点保持原行，向下进入下一行。修复前失败，修复后通过。

运行：`UX_FILTER='settings font rows|font pickers update' npm run test:ux`。真机仅导航检查：`node tools/test-tv-ux-device.mjs --navigation-only`，使用原有 CDP 输入管线，字号选择器只检查取消，不改用户设置。证据见 [compact/browser.json](ux-evidence/2026-09-06-compact/browser.json) 与 [修复前](ux-evidence/2026-09-06-compact/settings-before.json)。


### 紧凑卡片与基线对齐

- **C-CARD-ALIGN**：一行、两行标题混排时，视频卡片的标题顶线、元信息基线及卡片底边一致；继续观看的标题与进度行也必须对齐。第一版取消标题高度后，标准四列元信息相差 27.5px，用户指出不齐。相同浏览器输入和混合标题夹具：改前失败，改后通过。现在统一两行标题槽位、24px 元信息行和 12px 内边距，四列文字区从 164px 收至约 111px，保留原字号。
- **C-CARD-LATE-TITLE**：深行浏览时，前面卡片的异步翻译从一行变两行，当前卡片位置不能被推移。对照版实测向下移动 86.25px；统一标题槽位后，DOM 行位置与焦点屏幕位置保持不变。
- 全套浏览器 **39/39** 通过，包括侧栏 OK 刷新、侧栏往返位置、字号选项顺序、三语大字号和接口失败路径。对齐及迟到标题的修复前对照 **0/2**，见 [browser.json](ux-evidence/2026-09-06-density/browser.json) 与 [alignment-before.json](ux-evidence/2026-09-06-density/alignment-before.json)。

运行：`UX_FILTER='mixed title|late title height|compact cards' npm run test:ux`。

真机导航 **13/13** 通过，前 12 张卡片文字区全部 111px、元信息相对偏移全部 75px，三张续播进度 Y 均为 191.84375；首页可见 8 张封面均正常加载。见 真机截图（本地截图 `ux-evidence/2026-09-06-density/tv-home.png`）、[几何记录](ux-evidence/2026-09-06-density/geometry.json) 和 [device.json](ux-evidence/2026-09-06-density/device.json)。


## 2.0.0 全量回归与新增保护

最终结果、环境与未覆盖边界见 [RELEASE-2.0.0.md](RELEASE-2.0.0.md)。

| Case | 行为与运行方式 | 本轮抓到的真实问题 / 对照 |
| --- | --- | --- |
| C-SET-MATRIX | `npm run test:ux`：通过设置选择器逐一验证 2/3/4 列 × 1/1.12/1.25 字号；刷新后保存；推荐、收藏、我的、搜索均使用对应列数 | 搜索原来写死 4 列，2/3 列对照 0/2；修复后 9 种组合全部通过。真机 `npm run test:settings:tv` 也从选择器设置并重启验证 |
| C-FOCUS-MODALITY | 方向键滚动期间，静止鼠标下方新出现的卡片不能抢走焦点；真正移动鼠标后恢复悬停 | 字号矩阵抓到 6/9 失败：focus=第 8 行而列表滚到第 9 行，焦点卡 top=-488px。修改输入方式切换后 9/9 通过，悬停和滚轮专项仍通过 |
| C-LIBRARY-SCROLL | 我的页两列大字号连续下移到末卡，整张焦点卡应可见；`UX_FILTER='library native' npm run test:ux` | 原来误把原生网格识别成 transform 网格并清零祖先 scrollTop，末卡 top=1427.7px。只识别 `.video-grid-viewport`，原生卡片居中滚动并为放大保留空间；同一测试修复后通过 |
| C-LOAD-CANCEL | `npm run test:loading`：离开等待中的播放器后，load 取消及迟到详情均不能再请求取流或重试 | 修复前这两个场景都失败；Shaka 7000 被当成普通失败反复重试。增加生命周期检查、取消识别后通过 |
| C-LOAD-RETRY | 普通网络失败最多两次外层尝试，第二次恢复仍能起播；解码类错误保留原有降档 | 修复前永久网络失败走整个画质阶梯，测试失败；修复后失败路径与瞬时故障恢复均通过。Shaka 自身分片重试仍保留 |
| C-LUNA-DEADLINE | 20 秒无回调即结束等待，取消 bridge；迟到成功不能更新 cookie；`npm run test:loading` | 原来 Luna 无截止时间，同一测试 0/1；加入 timer 与 settle-once 后通过 |
| C-BODY-ABORT | `npm test`：普通、gzip、deflate、raw-deflate；error/aborted/提前 close；损坏 gzip | 原函数正常回调 1 次、半途断开回调 0 次。新响应读取器 8/8 通过，断流只回调一次并报错；真实 Docker Node 8 服务取流检查通过 |
| C-FONT-RENDER | 弹幕和字幕四档字体读取真实 DOM 的 computed font-size；`npm run test:loading` | 检查实际渲染字号，而不只检查 storage 值；四档全部通过，界面字号另由设置矩阵覆盖 |
| C-MENU-INPUT | 长按弹出后重复 keydown 与松手均不确认；关闭后可再次打开；`UX_FILTER='long-press menu' npm run test:ux` | 旧测试直接向 window 派发事件，capture 与 bubble 同在 target 导致错误穿透，假报菜单消失。改用 Playwright 真实按键后通过，真实接口完整套件 62/62 |

新增播放器失败路径和服务单测已接入 `tools/verify.sh --ux`。本轮构建与门禁脚本使用 `pipefail`，避免工具失败被末尾的 tail/grep 掩盖。


最终真机播放器专项 29/29 通过，包括 C-PLAY-03/04/06/07 与 C-POP-01：续播 28 秒实际起播 28.0 秒，取消快进保留当前位置，确认快进 2.3→12.4 秒；结束后两次上键到重播，实际从 0.1 秒开始；画质和倍速弹层从当前选项打开，Back 仅关闭弹层。预览截图独立于 1 秒自动提交窗口采集，避免截图编码延迟被误算为取消失效。见 [结果](ux-evidence/2026-09-06-release-2.0.0/tv-player-ux.json)。

## 2026-10-06 Issue 修复验证（开发版，未发布）

基线 `5d77949`，分支 `fix/issues-playback-compat-library`。本轮覆盖 #29/#35/#37/#38 的卡顿恢复与诊断、#30 订阅、#34 旧运行时兼容，以及 #33 的杜比初始化段和独立音轨选择。MIT 文件补充对应 #39，不构成第三方素材授权核验。

| Case | 行为与运行方式 | 事实佐证 |
| --- | --- | --- |
| C-STALL-01 | `npm run test:loading`：缓冲耗尽、`readyState=1` 且时间不动时显示缓冲、有限重试；暂停停止重试，不向前跳帧 | 相同 Playwright 时钟与夹具运行基线 PlayerPage：缓冲标记断言失败；恢复新实现通过。见 [改前](ux-evidence/2026-10-06-issues/stall-before.json)、[改后](ux-evidence/2026-10-06-issues/stall-after.json)。时钟必须在播放器创建计时器前安装 |
| C-CDN-03 | `node tools/test-playback-health.mjs`：所选线路排第一，已耗尽缓冲也计时，30 秒终止；真实 HTTP 验证 Range/超时/取消 | 本地服务分别返回正确 206、忽略 Range 的 200、错误区间、响应体停传；新 XHR 探针均正确结束，避免只给响应头计时或下载整个视频 |
| C-DIAG-03 | `node tools/test-cdn-tv.mjs`：真机注入不可达主节点、验证回退与拉黑，再选择阿里云运行诊断并解码电视截图 | 真机实际起播；报告首先测 `ali`，显示 1x/4x 吞吐，扫码载荷保留最近播放节点及选路且无签名流 URL。首轮抓到二维码缩放过密不能解码；改为整数模块并去重错误后 [6/6](ux-evidence/2026-10-06-issues/device-cdn.json)。测试恢复设置与注入标记 |
| C-DIAG-04 | `UX_FILTER='diagnostic network' node tools/test-tv-ux.mjs`：打开设置后用 `route.abort()` 断开代理，诊断必须结束、失败上屏并可扫码 | 服务、API、推荐、详情、取流、CDN、图片代理七项明确失败，无等待行；从渲染像素解码二维码，逐项核对失败及 ASCII 报告。[结果](ux-evidence/2026-10-06-issues/diagnostics-offline.json) |
| C-LIBRARY-02 | `node tools/test-library.mjs` 与 `UX_FILTER='subscriptions|subscription request' node tools/test-tv-ux.mjs`：订阅收藏夹/合集、分页、方向键、空/失败重试、跨页连播 | 浏览器验证三项订阅场景；纯逻辑验证两种响应映射、连续翻页去重、末页结束与请求失败传播。通过真实电视服务只读核对订阅及合集端点响应；没有修改用户订阅 |
| C-MEDIA-01 | `node --test app/src/player/mediaSelection.test.js` 与 `npm run test:loading`：实际生成 MPD 的格式选择、初始化段、杜比信令和音轨回退 | 解析/选择 13/13；播放器夹具验证 E-AC-3 优先、E-AC-3/FLAC 加载失败后 AAC、杜比加载失败后同 qn 基础层；坏长度、超限区间及伪装 box 拒绝。没有把夹具通过写成 Atmos 实际输出成功 |
| C-LEGACY-01 | `bash tools/test-node8/test.sh` 与 `UX_LEGACY_LAYOUT=1 node tools/test-tv-ux.mjs`：真实 0.12.2/8 运行服务，强制旧布局 | 两种 Node 均启动、真实 B 站 API 返回 HTTP 200、诊断报告弹幕模块加载成功；服务 ES5、前端产物 ES2016 解析通过。旧布局定向 [11/11](ux-evidence/2026-10-06-issues/legacy-layout.json)，仅为现代浏览器模拟，不替代旧电视整机验证 |

本地门禁 `bash tools/verify.sh --no-tv --ux` 通过：服务单测 22/22、媒体选择 13/13、浏览器 [53/53](ux-evidence/2026-10-06-issues/browser.json)、播放器失败路径 [14/14](ux-evidence/2026-10-06-issues/player-loading.json)，另有真实 HTTP 探针测试。二维码最终调整后追加断网场景 1/1 与真机诊断 6/6。门禁日志见 [verify.log](ux-evidence/2026-10-06-issues/verify.log)。

现有 LG C4 开发版已部署，播放/遥控器 [26/26](ux-evidence/2026-10-06-issues/device.json)，设置 [12/12](ux-evidence/2026-10-06-issues/device-settings.json)。保留侧栏确认主动刷新，Back/右键往返保持位置；浏览器覆盖 2/3/4 列 × 三档界面字号。此轮发现 #27 加入自动播放行后旧测试行号过时，已修正夹具后重跑。已查看电视播放及诊断截图、订阅页截图。

边界：未执行会改动账号稍后再看的旧模拟器全套，不是新版本发布验收；未在海外问题用户的网络、webOS 4 实机、杜比/Atmos 音响链路上验收。旧服务只验证启动、API 和模块加载，直播弹幕实收与 DLNA 仍需旧硬件验证。未包含 PR #17 的特定 4K120 片源帧变换，不关闭这些仍需现场验证的 issue。

### PR #40 补充模拟与真机回归（同日，尚未全量验收通过）

用户要求复核后，对 `45d2b6e` 及随后发现的评论栏修复重新验证。这里的模拟环境为 **Chromium + 真实 service.js 桥 + 真实 B 站网络**，不是 LG 官方模拟器；确定性浏览器用例另使用隔离夹具。真机为现有 LG C4，本轮 UA 为 Chromium 120。构建身份见 [build.json](ux-evidence/2026-10-06-pr40-validation/build.json)。

| 层级 / 命令 | 本轮结果 | 证据与边界 |
| --- | --- | --- |
| `bash tools/verify.sh --no-tv --ux` 的静态、单元、旧 Node 与构建层 | 通过 | 服务 22/22、媒体选择 13/13；真实 Node 0.12.2/8 完成 API 请求与弹幕模块加载；生产 6 个 JS bundle 均按 ES2016 解析。首轮整体在浏览器焦点断言失败处停止，不能把这份日志称为整条门禁全绿 |
| `node tools/test-tv-ux.mjs` | **54/54** | [结果](ux-evidence/2026-10-06-pr40-validation/browser.json)。首轮重试恢复的固定 100ms 焦点断言偶发失败，单独连续 12 次通过；改为最长 2 秒的状态等待后整套复验通过 |
| `node tools/test-player-loading.mjs` | **15/15** | [结果](ux-evidence/2026-10-06-pr40-validation/player.json)，含新评论栏复现。真实 HTTP Range/超时/取消另通过 [探针测试](ux-evidence/2026-10-06-pr40-validation/http-probes.log) |
| `SIM_STRICT=1 node tools/test-sim.mjs` | **55 通过 / 0 失败 / 2 跳过** | [结果](ux-evidence/2026-10-06-pr40-validation/simulator.json)、[日志](ux-evidence/2026-10-06-pr40-validation/simulator.log)。实际点播、直播、评论/楼中楼、风控错误入口、坏 CDN 回退、诊断测速、字号均执行；关注及稍后再看因 API 登录失效跳过 |
| `node tools/test-tv-ux-device.mjs` | **26/26** | [结果](ux-evidence/2026-10-06-pr40-validation/device-navigation.json)：实际播放、暂停/恢复、快进确认/取消、重播、弹层与列表返回 |
| `node tools/test-tv-settings.mjs` | **12/12** | [结果](ux-evidence/2026-10-06-pr40-validation/device-settings.json)：2/3/4 列、大字号、重启持久化及深列表可见。首轮 CDP 重载曾停在 `document.readyState=loading` 的空文档，重新启动 app 后复验通过；保留 [首轮日志](ux-evidence/2026-10-06-pr40-validation/settings-first-run.log)，未断言其根因 |
| `node tools/test-cdn-tv.mjs` | **6/6** | [结果](ux-evidence/2026-10-06-pr40-validation/device-cdn.json)：不可达节点回退后实际起播、坏节点拉黑、所选线路单连接/并发测速，以及从真机截图解码二维码。已查看 [诊断截图](ux-evidence/2026-10-06-pr40-validation/tv-diagnostics.png)，测试结束恢复设置及注入标记 |
| `node tools/test-ui.mjs` 真机广覆盖 | **26 通过 / 1 失败 / 3 跳过** | [结果](ux-evidence/2026-10-06-pr40-validation/device-smoke.json)、[日志](ux-evidence/2026-10-06-pr40-validation/device-smoke.log)。UP 主投稿列表失败；定向复测捕获真实 API `code=-352`，见 [复测](ux-evidence/2026-10-06-pr40-validation/device-uploader-recheck.json)。关注、稍后再看因未登录跳过，直播期间未观察到实时弹幕，不能算通过 |

**C-COMMENT-RENDER**：实际截图发现评论栏把 `comments.length === 0 ? (` 显示为文本，并把“暂无评论”与已加载评论同时显示；底部视频信息与控制条重叠。基线代码也存在。恢复 JSX 条件表达式，控制条限制在视频一侧，控制条显示时去掉重复信息。新增相同场景改前失败、改后通过：[正对照](ux-evidence/2026-10-06-pr40-validation/comments-before.json)、[修复后](ux-evidence/2026-10-06-pr40-validation/comments-after.json)；查看 [改前截图](ux-evidence/2026-10-06-pr40-validation/comments-before.png)、[模拟实播截图](ux-evidence/2026-10-06-pr40-validation/comments-after.png)、[真机截图](ux-evidence/2026-10-06-pr40-validation/tv-comments.png)。视频黑色区域可能属于截图无法读取的媒体合成层，播放进度另有断言。

模拟套件原来用“评论数 > 5”判断成功；本轮真实接口只返回 3 条，但全部已渲染。现在读取同一次 API 响应核对数量，并检查错误代码文本、空态及控件布局。仅看 DOM 数量不足以代替截图检查。

账号状态必须调用 `/x/web-interface/nav` 确认，不能以本地还保存 SESSDATA 就当作已登录。两套广覆盖测试现在默认不执行稍后再看增删，只有独立测试账号可显式启用 `SIM_ACCOUNT_WRITES=1` / `TV_ACCOUNT_WRITES=1`；跳过项不会算通过。真机广覆盖测试结束恢复原始设置。

**发布阻断项仍在**：UP 主投稿真机风控失败、有效登录下的账号功能、未实收的直播弹幕，以及先前列出的旧电视整机/海外网络/杜比输出验证。PR 保持草稿，未合并、未发版。

### PR #40 登录恢复后的真机补验（2026-10-06）

用户重新扫码后，电视 `/x/web-interface/nav` 返回 `code=0, isLogin=true`。沿用 `60b6469` 的同一已部署 app，本轮只修改测试工具和报告，没有修改产品代码。构建身份见 [environment.json](ux-evidence/2026-10-06-pr40-login/environment.json)。

| 场景 | 结果与事实佐证 |
| --- | --- |
| 登录态综合回归 `TV_ACCOUNT_WRITES=1 node tools/test-ui.mjs` | **45 通过、0 失败、1 未观测**：[结果](ux-evidence/2026-10-06-pr40-login/device-full.json)、[日志](ux-evidence/2026-10-06-pr40-login/device-full.log)。未观测项为首个直播间 9 秒内没有实时弹幕，后续另选房间完成专项 |
| UP 主投稿、收藏、订阅、稍后再看读取 | 定向 **12/12**：[结果](ux-evidence/2026-10-06-pr40-login/account-library.json)。UP 接口 `code=0` 且显示 25 条，综合复验为 30 条；收藏 2 个、订阅 18 个均与 API 一致；稍后再看原列表为空且正确显示空态 |
| 关注分页 | 综合回归中从 **20 → 60** 张卡片，已补上原来因登录失效跳过的场景 |
| 稍后再看增删 | 定向 **10/10**，综合回归再次通过：[结果](ux-evidence/2026-10-06-pr40-login/watchlater.json)。播放器加入固定测试视频 → 页面出现 → 长按进度及菜单 → 核对菜单 aid → 确认移除 → API/UI 都恢复原列表。请求层记录仅 1 次 add、1 次 del，最后原列表顺序与成员一致 |
| 直播实时弹幕 | `TV_TEST_FILTER=testLiveRelay node tools/test-ui.mjs` **4/4**：[结果](ux-evidence/2026-10-06-pr40-login/live-realtime.json)、[截图](ux-evidence/2026-10-06-pr40-login/live-realtime.png)。动态选取当前在播的推荐房间，验证实际播放、弹幕 token `code=0`、Luna 订阅、真实收到 1 条弹幕且形成 1 个 DOM 元素；不是注入假弹幕或历史聊天。已查看截图，视频黑色区域属于不可截取的媒体层，不以此截图证明画面输出 |

**修正测试误报**：有选集/合集时播放器初始标签会变化。旧脚本固定右移一次，把相关推荐当成 UP 主投稿通过，且观测到的 UP 接口为 `null`；保留 [误报记录](ux-evidence/2026-10-06-pr40-login/initial-tab-check-invalid.json)，不能作为 UP 投稿通过的依据。现改为核对活动标签与对应 API 响应后再断言；上表中的 25/30 条来自修正后的实际 UP 请求。

**账号测试保护**：原列表、测试视频身份与 API 返回均先核对，原列表已有该视频或列表满时不写；请求层拒绝其他 aid 及 `viewed` 批量清除，异常也进入 finally 清理。账号页面与菜单截图已在本地逐张查看，未上传公共仓库。

这轮补齐了 LG C4 上的有效登录账号场景和实时弹幕，登录后 UP 投稿复测成功；不据此宣称所有网络环境下的 `-352` 已永久解决。前一轮重载空文档的根因仍未确定，旧硬件、海外网络、杜比实际输出及旧硬件 DLNA 的验证边界不变。番剧测试仅验证 API 片源和画质元数据，不代表 HDR/Atmos 实际输出。本轮未重新运行桌面模拟套件，账号补验使用实际电视。PR 继续为草稿，未合并、未发版。

### 直播起播优化与回归（2026-10-06）

基线 `732ab4e`，LG C4 / Chromium 120，开发版 2.1.1，已部署。用户报告直播画面出现慢；实际 `getRoomPlayInfo` 约 70–220ms，主要等待发生在原生 HLS 启动。旧逻辑按接口排列取第一个 AVC HLS，通常选 TS；画质列表另发一次默认画质请求，而且设置 src 后就撤掉加载提示。现在优先 fMP4 AVC，沿用用户保存的原画；选源、当前画质和可选画质共用一次响应。不支持格式或启动超时回退 TS，显示真实加载状态，有限重试后允许遥控确认重试。解码降档不改写用户长期画质偏好，退出清理计时器并拒绝迟到响应。

**真机同画质对照**：下表耗时从打开播放器算起，到元数据后 `currentTime` 增加至少 0.25 秒且 `readyState >= 3`，每 250ms 采样。不是逐帧像素测量：这台电视虽然暴露 `requestVideoFrameCallback`，原生 HLS 测试期间没有回调；视频媒体合成层也无法通过页面截图可靠读取。

| 直播间 | 旧 TS 首次进入，进度开始推进 | 已部署新版默认选源，进度开始推进 | 实际画质 / 解码尺寸 |
| --- | --- | --- | --- |
| 13171605 | 9.291 秒 | 3.274 秒 | qn=10000，1216×2160 |
| 1832043360 | 7.530 秒 | 2.260 秒 | qn=10000，1080×1920 |
| 32137671 | 7.574 秒 | 2.009 秒 | qn=10000，1600×1280 |

新版三个房间各只有 1 次取流请求，首次 `playing` 分别为 1.420 / 1.205 / 1.145 秒；启动早期仍各有一次短暂 `waiting`，所以采用更保守的时间推进指标。每间起播后继续观察 30 秒：均 `readyState=4`、播放时间持续增长，起播后 0 次 `waiting`、0 媒体错误；现场诊断未见 retry/stall/gave-up。见 [新版原始采样](ux-evidence/2026-10-06-live-startup/production.json)、[首次旧版采样](ux-evidence/2026-10-06-live-startup/initial-timing.json)、[同房间交替对照](ux-evidence/2026-10-06-live-startup/same-room-ab.json)、[另两个房间对照](ux-evidence/2026-10-06-live-startup/other-rooms-ab.json)。

对照阶段仅重排真实接口的格式顺序，不注入媒体或伪造播放成功；最终新版测量没有格式覆盖。TS 与 fMP4 返回的 CDN 主机也不同，因此收益属于所选 HLS 源/线路，不能单独归因于容器格式。相同房间重复进入时 TS 也曾降到约 3.5 秒；必须区分首次和热启动。这是三个房间、本次网络的小样本与短时观察，不是所有网络或长时间稳定性保证。

收录的 `tools/probe-live-startup.js` 为适配新版显式格式优先级，将指定格式模式改为筛选真实响应；`default` 仍不覆盖。追加 [工具自检](ux-evidence/2026-10-06-live-startup/probe-tool-check.json) 确认 TS/fMP4 实际源匹配请求，均保持 qn=10000、1216×2160，进度分别在 9.788/3.012 秒推进；该次仅各追加 1 秒观察，不混入上表的 30 秒稳定性结果。

| Case / 验证层 | 结果与事实佐证 |
| --- | --- |
| C-LIVE-START-01：单次取流、真实加载提示、格式回退 | 相同受控媒体事件与接口夹具下旧实现 **0/3**，新实现对应场景通过。旧实现实测两次请求、src 后加载提示过早消失、先选 TS。[改前](ux-evidence/2026-10-06-live-startup/before.json) |
| C-LIVE-START-02：启动/解码失败及退出清理 | `node tools/test-live-loading.mjs` **9/9**，包括格式不支持同 qn 回退 TS、启动超时最终错误及手动重试、五档解码阶梯、偏好不变、退出取消待执行重试、迟到响应拒绝附着、空响应最终错误。[结果](ux-evidence/2026-10-06-live-startup/after.json) |
| 加载与错误画面 | 追加截图专项 **2/2**，已逐张查看 [加载中](ux-evidence/2026-10-06-live-startup/live-loading.png)、[可重试错误](ux-evidence/2026-10-06-live-startup/live-retry.png)；[截图专项结果](ux-evidence/2026-10-06-live-startup/visual.json) |
| 纯逻辑及点播回归 | 选源 **5/5**、既有直播画质 **11/11**、投屏 URL **17 个断言**、点播加载 **15/15**；[选源](ux-evidence/2026-10-06-live-startup/selection.log)、[画质](ux-evidence/2026-10-06-live-startup/ladder.log)、[投屏 URL](ux-evidence/2026-10-06-live-startup/cast.log)、[点播](ux-evidence/2026-10-06-live-startup/vod.json)。投屏 URL 单测不等同于 DLNA 真机全流程 |
| LG C4 画质实际切换 | `TV_LIVE_ROOM=13171605 TV_TEST_FILTER=testLiveQuality node tools/test-ui.mjs` **3/3**：原画 10000 → 超清 250 → 原画 10000，各等待实际播放，结束恢复设置。[结果](ux-evidence/2026-10-06-live-startup/tv-quality.json) |
| LG C4 实时弹幕 | 本轮再次 **4/4**，取流、弹幕订阅、真实帧和 DOM 均通过，见 [原始结果前四项](ux-evidence/2026-10-06-live-startup/tv-live-and-first-quality.json) |
| Chromium + 真实服务桥 + B 站网络 | 本轮整套 **54 通过 / 1 失败 / 2 跳过**。直播实播、控制、画质弹层、弹幕、返回通过；游戏分区无卡片失败，实际 `getRanking(1008, 'all')` 复核返回 **-352**。桌面桥登录过期，关注/稍后再看跳过；不能以之前电视登录成功抵消桌面跳过。[结果](ux-evidence/2026-10-06-live-startup/simulator.json)、[日志](ux-evidence/2026-10-06-live-startup/simulator.log)、[接口复核](ux-evidence/2026-10-06-live-startup/simulator-ranking-recheck.json) |
| 构建与部署 | i18n en/es 242 keys 通过，生产 6 个 JS bundle 按 ES2016 解析通过，构建安装成功。[构建身份与 SHA256](ux-evidence/2026-10-06-live-startup/build.json)、[部署日志](ux-evidence/2026-10-06-live-startup/deploy.log)、[i18n](ux-evidence/2026-10-06-live-startup/i18n.log) |

保留测试工具首次失败：先前按固定“画质”文案找按钮，实际按钮显示“原画”，导致 [两项失败](ux-evidence/2026-10-06-live-startup/tv-live-and-first-quality.json)；修正导航后又选到仅提供一档的房间，[两项失败](ux-evidence/2026-10-06-live-startup/tv-single-quality.json)。最终使用实际提供两档的房间并确认真实播放才得到 3/3，工具现将单档房间的切换覆盖记为跳过。

新增确定性直播用例已接入 `tools/verify.sh --ux`；本轮分别运行相关层，未把此前的整条门禁日志当作当前全部通过。保留 DLNA 原有重连预算；没有改变服务代码，没有把现有 C4 测试当作旧硬件验收。完整模拟仍有上述 -352 失败，旧电视/海外/杜比输出边界同前，PR 保持草稿，未发版。
### 点播 CDN 自动择优（2026-10-06）

基线 `13f7b72`，开发版 2.1.1，已部署 LG C4 / Chromium 120。新增 HWO1 镜像候选与手动选项；自动模式在暂停或缓冲不少于 15 秒时，逐节点测两块 256KiB 的真实媒体，以较慢样本排序，15% 门槛避免频繁切换。后续媒体请求应用结果，不重载播放器或清空已缓冲内容。成功缓存 4 小时、失败 15 分钟，首选超过 15 分钟复测，网络重连清空缓存；仅保存主机、时间与健康/速度，不保存媒体地址或签名。

**行为边界**：首次无缓存立即使用原线路，不等待测速；持续低缓冲时需暂停才有测速窗口，不能保证第一次起播就加速。手动选线优先，原始主备 URL 保留。仅普通 `.bilivideo.com/upgcxcode/` 片源合成固定镜像候选；Akamai-only 片源保留原生签名，不沿用此前盲目跨域改写。`.bilivideo.cn` 可测原生地址但不改写，直播选源不使用这套策略。

研究参考：[chrisliu298 的美国 HWO1 样本](https://github.com/chrisliu298/bilibili-cdn-fix)、[realzza v0.4.0 的海外重定向修正](https://github.com/realzza/bilibili-accelerator/releases/tag/v0.4.0)、[stabruriss 的双 Range 测速与缓存策略](https://github.com/stabruriss/bilibili-accelerator/blob/main/README.en.md)。这些社区结果用于确定候选与方法，不代表本应用的海外实测结论。

| Case / 本轮验证 | 结果与事实佐证 |
| --- | --- |
| C-CDN-AUTO-01：缓存结果改变实际请求 | 相同 React 场景下，恢复旧 `PlayerPage.jsx` 后 **0/1**：仍请求 Ali；新过滤器 **1/1**：请求 HWO1，播放器 load 次数仍为 1。[改前](ux-evidence/2026-10-06-cdn-auto/before.json)、[改后](ux-evidence/2026-10-06-cdn-auto/after-control.json) |
| C-CDN-AUTO-02：冷启动、门控与取消 | 生产 React 请求过滤器 + 最小 Shaka 测试替身 **7/7**：冷启动沿原路线、测完影响后续真实 fetch；加载/低缓冲不测、暂停可测；手动不覆盖；全失败仍有原路；online 清缓存；退出中止不污染缓存。[结果](ux-evidence/2026-10-06-cdn-auto/browser.json)。该层不证明真实 Shaka 解码 |
| C-CDN-AUTO-03：缓存、签名与样本有效性 | 纯逻辑 **11/11**，包括原生 Akamai/直播不改写、两次采样取较慢值、15% 门槛、TTL/损坏缓存、拒绝任意缓存域名插入、取消/迟到响应、超时与坏节点。[结果](ux-evidence/2026-10-06-cdn-auto/unit.log)。真实 HTTP Range 测试覆盖忽略/错位/短 Range、短 body、合法 EOF、超时和取消：[结果](ux-evidence/2026-10-06-cdn-auto/probes.log) |
| C-CDN-AUTO-04：候选不会饿死其他节点 | 复查发现 `.bilivideo.cn` 候选不能写入缓存，会重复占据队列。正对照 10 次 tick 产生 **20 次**请求，修复后仅 **2 次**，其他节点也测到。未知主机保留为播放回退，但不进入无法缓存的测速队列。[修复前失败](ux-evidence/2026-10-06-cdn-auto/cache-host-before.log)，修复后见 11 项单测 |
| C-CDN-AUTO-05：真实媒体与失败回退 | C4 首轮 **10/10**，队列边界修复并重新部署后再次 **10/10**：注入不存在主机，实际播放成功且坏节点拉黑；候选真实测速；持久化无 URL/凭据；seek 到缓冲区外后实际 Shaka 响应来自所选节点，播放推进且实例不变；诊断手选 Ali、1x/4x 吞吐与截图 QR 解码均通过。[首轮](ux-evidence/2026-10-06-cdn-auto/device-cdn.json)、[最终部署复验](ux-evidence/2026-10-06-cdn-auto/device-cdn-final.json) |
| C-CDN-AUTO-06：遥控选线和持久化 | C4 **5/5**：方向键到 CDN 行、打开选项、选择 HWO1、重载后保持、切回自动并恢复焦点。结束恢复测试前设置。[结果](ux-evidence/2026-10-06-cdn-auto/device-settings.json)、[已目视检查的弹窗](ux-evidence/2026-10-06-cdn-auto/tv-cdn-picker.png) |
| 播放与导航回归 | 点播加载/画质/评论 **15/15**，直播加载失败路径 **9/9**，C4 导航/实际播放/拖动/续播/设置焦点 **29/29**。[点播](ux-evidence/2026-10-06-cdn-auto/vod.json)、[直播](ux-evidence/2026-10-06-cdn-auto/live.json)、[真机导航](ux-evidence/2026-10-06-cdn-auto/device-navigation.json) |
| 广覆盖浏览器门禁 | `verify.sh --no-tv --ux` 前置静态、服务 **22/22**、媒体选择 **13/13**、真实 Node 0.12.2/8、244 项 en/es 翻译与 ES2016 构建通过；浏览器 **53/54**，首页失败后重试的焦点等待超时。定向复测 **1/1**，未确定间歇失败根因，不能宣称完整门禁通过。[完整首轮日志](ux-evidence/2026-10-06-cdn-auto/verify-first.log)、[浏览器首轮](ux-evidence/2026-10-06-cdn-auto/browser-full-first.json)、[定向复验](ux-evidence/2026-10-06-cdn-auto/focus-recheck.json)。脚本在此退出，后续点播/直播/Range/自动选路层已独立运行，结果见上 |
| Chromium + 真实服务桥和 B 站网络 | **54 通过 / 1 失败 / 2 跳过**。游戏分区没有卡片，真实 API 复核 **-352**；模拟环境认证失效，关注与稍后再看跳过。直播、点播、主节点失败回退通过。[结果](ux-evidence/2026-10-06-cdn-auto/simulator.json)、[日志](ux-evidence/2026-10-06-cdn-auto/simulator.log)、[接口复核](ux-evidence/2026-10-06-cdn-auto/simulator-ranking-recheck.json)。这是浏览器模拟，不是 LG 官方模拟器 |

**本机测量，不能外推海外**：首轮 8 个候选中 cosov 约 0.55Mbps、aliov 1.06Mbps、HWO1 6.34Mbps、Ali 9.66Mbps，原生节点约 10.54Mbps；实际后续选中 Ali（有 15% 门槛，且音视频可用候选不一定相同）。最终复验 HWO1 约 13.80Mbps、Ali 13.03Mbps，cosov/aliov 未在单块 4 秒期限内完成；实际分片来自 HWO1。这种变化说明固定“海外线路”不能代替测量，也不能把小块测速当作长期吞吐承诺。

构建与验证身份见 [environment.json](ux-evidence/2026-10-06-cdn-auto/environment.json)，记录首轮和最终 6 个 bundle SHA256、最终相关源码 SHA256；[最终部署](ux-evidence/2026-10-06-cdn-auto/deploy-final.log)、[最终语法检查](ux-evidence/2026-10-06-cdn-auto/build-syntax.log)。队列边界修复后重跑 11 项逻辑、7 项 React 和 10 项真机 CDN，其余回归为本轮首个部署版本。诊断截图已查看并用 jsQR 解码，含账号信息，只留本地；公开截图仅保留选项弹窗。测试结束确认电视回到 `auto`、坏节点注入关闭，原设置及缓存已恢复。

**仍待验收**：海外报告者实际网络、首页重试间歇焦点失败、游戏接口风控；旧硬件与杜比输出边界沿用前述报告。本轮不声称“海外直播已解决”或“全量全绿”，PR 保持草稿，未合并、未发版。


### 焦点、分区与海外网络补验（2026-10-06）

基线 `679eef6`，开发版 2.1.1。本轮处理前节的首页重试焦点、游戏分区 `-352` 和海外网络验证缺口。最终安装在 LG C4 上的 6 个 JS bundle 与本地产物 SHA256 全部一致，见 [构建身份](ux-evidence/2026-10-06-feed-network-fixes/environment.json) 和 [部署](ux-evidence/2026-10-06-feed-network-fixes/deploy-complete.log)。

| Case | 修复与事实佐证 |
| --- | --- |
| C-FOCUS-RETRY-01：立即返回也恢复可操作焦点 | 重试时在输入事件中提交 loading，再开始请求，避免 React 把快速请求的 loading=true/false 合并而漏掉恢复逻辑。旧实现立即 Promise 场景失败，网络 0ms/300ms 场景成功，见 [改前](ux-evidence/2026-10-06-feed-network-fixes/focus-immediate-before.json)。新增慢返回、再次失败、主动退回侧栏、短列表+续播栏+预加载回归 |
| C-FOCUS-RETRY-02：高亮与实际注册目标一致 | 仅修 loading 后 C4 仍出现白框却无法向下导航。临时追踪确认旧重试按钮的 passive cleanup 在新卡片高亮后清空全局焦点：[中间失败](ux-evidence/2026-10-06-feed-network-fixes/device-focus-cleanup-race.json)。注册/注销改用 layout effect，与 DOM 同次提交；[真机专项 3/3](ux-evidence/2026-10-06-feed-network-fixes/device-focus-after.json)，同时断言注册目标、下一次 Down 和唯一白框，不只看截图 |
| C-FOCUS-SEARCH-01：搜索切到设置不漏第一行 | 最终导航回归进一步发现手动注册的搜索框仍用 passive cleanup，删掉设置页复用的 content-0-0；真实设置从第二行开始且无法回第一行。[电视改前](ux-evidence/2026-10-06-feed-network-fixes/device-search-cleanup-before.json)、[浏览器改前 0/1](ux-evidence/2026-10-06-feed-network-fixes/search-before.json)。同步手动注册的生命周期后 [1/1](ux-evidence/2026-10-06-feed-network-fixes/search-after.json)，最终电视导航 29/29；没有修改测试起点来掩盖回归 |
| C-RANK-REFERER-01：六个分区真实返回 | 同一匿名出口、同一游戏 API，仅交替 Referer：站点根页面两次 -352，排行榜页面两次 code=0/100 条，[A/B](ux-evidence/2026-10-06-feed-network-fixes/ranking-referer-ab.json)。生产服务与独立代理共用精确 host/path 策略，其他接口/媒体请求不变。C4 六分区各 code=0/100，真实 Node 0.12.2/8 也返回 100 条；[独立代理](ux-evidence/2026-10-06-feed-network-fixes/standalone-proxy.json)、[旧运行时](ux-evidence/2026-10-06-feed-network-fixes/legacy-runtime.log)。研究线索来自 [abcLiyew/BiliBili-API](https://github.com/abcLiyew/BiliBili-API)，结论以上述实测为准，不把所有 -352 都归为同一原因 |
| C-NET-REGION-01：海外真实传输与择优 | 使用已有 SSH 香港/日本节点匿名请求，不传电视 Cookie、不修改服务器配置。`REGION_SSH=hk` / `jp` 运行 `tools/test-region-network.mjs`，复用生产 WBI、Referer、候选与自动排序代码。两地分别 **11/11**：六分区、view 412 后 pagelist 兜底、DASH 取流、实际媒体 Range、胜出线路新分片、缓存无签名 URL；[香港](ux-evidence/2026-10-06-feed-network-fixes/hk.json)、[日本](ux-evidence/2026-10-06-feed-network-fixes/jp.json) |

香港选中 Ali 海外 **51.71 Mbps**，同次原生 cosov 22.57、Akamai 23.16，HWO1 第二块超过 4 秒被标记失败；日本选中 cosov **64.86 Mbps**，Akamai 14.03、HWO1 1.88。所选节点又成功取得新的 64KiB 分片，分别 143.8ms / 23.3ms。每节点串行两块 256KiB，取较慢样本；各区域同一位置成功分片的 SHA256 一致。这是匿名 480P 单片源、服务器出口、小块短时传输，不证明海外家庭网络中的电视解码、高码率长期稳定性或直播提速，也不固定认定某个节点永远最快。

海外工具首轮错误地把 view 的 HTTP 412 抛出，漏掉产品已有的 pagelist 回退；已修工具响应语义再测，保留 [香港首轮](ux-evidence/2026-10-06-feed-network-fixes/hk-worker-before.json)、[日本首轮](ux-evidence/2026-10-06-feed-network-fixes/jp-worker-before.json)。没有把工具失败掩饰成产品故障或直接跳过。

| 回归层 | 本轮结果与范围 |
| --- | --- |
| 最终完整本地门禁 `bash tools/verify.sh --no-tv --ux` | **通过**：浏览器 **61/61**、点播 **15/15**、直播 **9/9**、CDN React **7/7**；服务 **22/22**、媒体选择 **13/13**、真实 HTTP Range/超时/取消、CDN 逻辑 **11/11**、真实 Node 0.12.2/8、en/es **244 keys** 及 ES5/ES2016 语法均通过；[完整日志](ux-evidence/2026-10-06-feed-network-fixes/verify-complete.log)、[浏览器](ux-evidence/2026-10-06-feed-network-fixes/browser-complete.json)、[点播](ux-evidence/2026-10-06-feed-network-fixes/vod-complete.json)、[直播](ux-evidence/2026-10-06-feed-network-fixes/live-complete.json)、[CDN](ux-evidence/2026-10-06-feed-network-fixes/cdn-complete.json) |
| 最终 Chromium + 真实 service.js 桥 + B 站网络 | **55 通过 / 0 失败 / 2 跳过**；[结果](ux-evidence/2026-10-06-feed-network-fixes/simulator-complete.json)、[日志](ux-evidence/2026-10-06-feed-network-fixes/simulator-complete.log)。游戏分区已通过，关注/稍后再看因该桥的认证失效跳过；不是 LG 官方模拟器，未复制电视账号凭据 |
| 最终 LG C4 综合回归 `node tools/test-ui.mjs` | **53 通过 / 0 失败 / 3 跳过**；[结果](ux-evidence/2026-10-06-feed-network-fixes/device-complete.json)、[日志](ux-evidence/2026-10-06-feed-network-fixes/device-complete.log)。三个跳过分别是首个安静房间未观测到弹幕、单档直播间无法验证画质切换、未启用账号写入；独立实时弹幕场景在同套中 **4/4**，实际收到 1 帧并渲染。有效登录下 UP 投稿、关注分页、收藏/订阅/稍后再看读取通过；账号增删沿用此前已授权专项证据，本轮未重做 |
| 最终 LG C4 导航、播放、设置焦点 | **29/29**；[结果](ux-evidence/2026-10-06-feed-network-fixes/device-navigation-final.json)。Back/右键保持列表位置、侧栏确认主动刷新、实际点播/暂停/快进/续播/重播、搜索→设置第一行及字号弹层均通过 |
| LG C4 列数和大字号矩阵 | **12/12**；[结果](ux-evidence/2026-10-06-feed-network-fixes/device-settings.json)。2/3/4 列、大字号真实尺寸、深列表、重载持久化和历史页滚动；此专项运行在最终 SearchPage 两行生命周期调整前，调整后的字号导航由上面的 29 项再次覆盖 |

补充保留一次受开发热更新干扰的本地运行：当时 59/60，长按菜单断言失败，同秒 Vite 记录 `useFocus.js` 修改和 Fast Refresh invalidation；[运行结果](ux-evidence/2026-10-06-feed-network-fixes/browser-hmr-interrupted.json)、[HMR 时间记录](ux-evidence/2026-10-06-feed-network-fixes/hmr-interruption.log)。冻结产品源码后重跑整条门禁，最终结果见表；没有删掉失败或仅用定向通过宣称全套成功。

已目视检查最终设置第一行、2/3/4 列与大字号历史页、首页重试后的唯一焦点。含账号/历史的电视截图只留本地，公开 [重试截图](ux-evidence/2026-10-06-feed-network-fixes/retry-navigable.png) 使用隔离假数据；其中封面有意为空，测试只控制推荐失败/恢复时序。临时故障注入已撤销，测试恢复原设置。

首页焦点与分区失败已修复，海外验证已从仅本机推进到 HK/JP 实际出口。仍需相应设备/环境确认海外问题用户家庭电视、webOS 4 整机、杜比/Atmos 输出及旧硬件 DLNA；这些不由服务器探针或 C4 回归替代。PR #40 继续为草稿，未合并、未发布新版本。


### v2.2.0 发布验证（2026-10-06）

用户要求发布并通知相关 issue，之后明确要求不再操作电视；已确认无仍运行的电视测试进程，此后不连接、安装、重启或操作电视。基线为前节已完成验证的 `c0a0460`，发布准备增加版本号/文档与下述独立杜比保护。没有把“不要动电视”解释为放弃发布及 issue 通知，也没有把它解释为新一轮真机测试通过。

**C-MEDIA-120-GUARD**：复核 [PR #17](https://github.com/asdf17128/bili-webos/pull/17) 的完整说明，发现单独改用 DV 信令而遗漏专用 120fps 转换会引入已知黑屏风险。本版不移植该位流转换，超过 60fps 或帧率未知时保留原有基础层信令；明确帧率不超过 60fps 才继续原有 DV 探测。真实 PlayerPage 生成 MPD 的高帧率/未知帧率正对照 [改前 0/2](ux-evidence/2026-10-06-release-2.2.0/dolby-guard-before.json)，保护后这两项及原有 DV/音轨回退 [6/6](ux-evidence/2026-10-06-release-2.2.0/dolby-guard-after.json)。纯逻辑 [14/14](ux-evidence/2026-10-06-release-2.2.0/media-selection.log) 含整数/小数/分数字符串、非法和未知帧率。该测试证明信令选择，不证明 120fps 或 Atmos 实机解码。

| 验证层 | 当前证据 |
| --- | --- |
| 正式版本本地自动层 | 服务 **22/22**、媒体选择 **14/14**、CDN 逻辑 **11/11**、真实 Node 0.12.2/8、244 项翻译、ES5/ES2016 通过；浏览器 [61/61](ux-evidence/2026-10-06-release-2.2.0/browser.json)、点播 [17/17](ux-evidence/2026-10-06-release-2.2.0/player-loading.json)、直播 [9/9](ux-evidence/2026-10-06-release-2.2.0/live-loading.json)、CDN [7/7](ux-evidence/2026-10-06-release-2.2.0/cdn.json) 通过 |
| 本次 TV 尝试 | 初始安装后 DOM 检查为 cards=37、sidebar=true、brokenImgs=0，截图已查看；随后综合套件 **15 通过 / 13 失败 / 3 跳过**，[原始结果](ux-evidence/2026-10-06-release-2.2.0/device-attempt.json)。首页空、播放注入 Uncaught、导航状态不符及应用退出，原因尚未确认。完整管线因此退出 1，不能称为全量门禁通过；[完整日志](ux-evidence/2026-10-06-release-2.2.0/verify-with-tv-failures.log)。未将这些失败改写成用户干扰或产品已修复 |
| 电脑真实网络模拟 | **55 通过 / 0 失败 / 2 跳过**：[结果](ux-evidence/2026-10-06-release-2.2.0/simulator.json)、[日志](ux-evidence/2026-10-06-release-2.2.0/simulator.log)。在 Mac Chromium + 真实 service.js 桥 + B 站网络执行，没有访问电视；关注/稍后再看因本机认证失效跳过。实际点播、直播、评论、分区、故障回退及诊断通过 |
| 安装包一致性 | 内含 appinfo 2.2.0 与 biliReferer.js，检查包内敏感路径；[包大小与 SHA256](ux-evidence/2026-10-06-release-2.2.0/package.json)、[源码与本地产物身份](ux-evidence/2026-10-06-release-2.2.0/environment.json)。此记录不冒充禁止电视操作后的设备哈希校验 |

发布判断保留上述限制：此前 `c0a0460` 的 C4 综合 **53 通过/0 失败/3 跳过**、导航 **29/29**、列数字号 **12/12** 和 HK/JP 网络各 **11/11** 是已有证据；它们不覆盖本次真机复验的失败。相对该基线，播放器运行时代码只增加高/未知帧率的保守信令门控，其他产品变化为版本号；本机相关正对照和完整模拟独立验证。用户已要求发布且禁止继续操作电视，按已完成验证及公开限制交付，不声称硬件验收全绿。新 issue #41 的收藏夹自动连播开关与循环播放诉求未实现，列入本版已知问题；海外家庭电视、旧设备及杜比输出范围仍需对应环境确认。
