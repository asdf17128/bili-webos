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

## 全量回归记录

| 日期 | 范围 | 结果 |
|---|---|---|
| 2026-07-11 | verify.sh --full(六层+UI smoke 26/26)+ 📜 真机:C-FOCUS-02(1268↔317)、C-PLAY-03(t=2503 续播)、C-SUB-02(面板全流程+联动隐藏+字幕层保留)、C-PTR-01(悬停/点击/进度条 1265/2526≈50%)、C-SUB-04+C-I18N-07(en 字幕 26 样本 0 中文)、C-DM-01(35 条 0 纯中文)、C-UI-05(我的页 刚刚/1分钟前)、C-UI-06(行当次翻转)、C-I18N-02(弹层开/勾/Back 取消零刷新) | **全部 PASS**;过程中两次踩跨调用超时假阴(单会话重跑即过,纪律再次生效);电视终态=用户原设(zh/弹幕关/字幕关) |

## 追加规范

新 case 必须包含:**做什么、怎么跑(命令/脚本)、佐证(抓过什么真 bug 或正对照记录)**。
只写"应该没问题"的 case 不收。定期把 📜 升级为 🤖(进 verify.sh)。
