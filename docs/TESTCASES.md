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
| C-SUB-01 | 字幕纯函数:parse 容忍脏数据(零长/NaN/乱序)、pickCueIndex 边界/间隙/重叠/1000条扫描=线性对照;**轨道名枚举映射 + 动态键字典覆盖**(t(subtitleLanName) 是动态调用,coverage 门禁的字面扫描看不见,由本测试兜底) | 🤖 verify.sh L2 (`tools/test-subtitle.mjs`, 9 组) | 正对照 2026-07-10 ×2:去掉重叠回溯 → 'overlapping' 组失败;从 en.js 删「日语(自动生成)」→ 字典覆盖组失败(均 exit 1) |
| C-SUB-02 | CC 端到端:有轨视频才出「字幕」键;OK 循环 关→轨→关;cue 上屏/间隙隐藏;开关持久化→下一视频自动开;控制条打开字幕上移(-190px);无轨视频无键 | 📜 真机 CDP 全流程 + 👁 截图(sub_cc.png:34px 白字深底居中贴底;sub_cc_en.png:英文界面 'CC Chinese (auto)' + 字幕避让控制条同框) | 2026-07-10 真机:'♪ Love wu nothing ♪'/台风视频 cue 实渲、连播自动启用、无轨视频键消失全验;en 界面按钮/避让/零溢出截图过目;**教训复用**:跨工具调用控制条会自动隐藏,按键序列必须单次 drive 完成 |
| C-SUB-03 | 字幕 MT 管线(subTranslate.js):批量上限、**并行池(4路)+ 逐批渐进(onPartial)+ 播放头批次优先**、瞬时失败重试一轮、错位/永久失败必 throw(半翻半中挂着 translated 标签比回退更糟)、LRU 缓存、坏 store 容忍 | 🤖 verify.sh L2 (`tools/test-subtranslate.mjs`, 12 组) | owner 报"翻译要很长时间":旧串行整轨 ≈5-6s 才见译文;并行+渐进+播放头优先后真机实测(台风视频、无缓存):**中文 1.09s 先行、962ms 后英文换入**;面板打开即预取字幕体 |
| C-SUB-04 | 字幕/标题/章节机翻(非中文界面):虚拟轨自动选中、原文先显译文换入、英文 cue 实渲、标题翻成英文;引擎失败→回退原文轨并**改回诚实标签**;凭据隔离:Cookie/Referer/Origin 只发B站域 | 📜 真机(subtr_tv_en.png:英文字幕+英文标题+'CC English (translated)' 同框;subtr_chapters_en.png:scrub 气泡 'King of the Huns'+时间行英文章节+预览图同框)+ dev 浏览器 E2E + 真实端点形态验证(多q数组/单q裸串) | 2026-07-10:真机 owner 网络直连 gtx 571ms;章节翻译真机像素验证(BV1DTMN6HE8m 十章节:匈奴王→King of the Huns,9 刻痕),素材经 `__openVideo` 深链直达;服务白名单曾把翻译域拦下('Host not allowed' 5ms)——新第三方域必须同时进 service.js 和 proxy/server.js 白名单 |
| 教训 | dev 浏览器里 webOSTV.js 也会定义 window.webOS.service,`hasLunaService` 必须查 **PalmServiceBridge**,否则 dev 全部请求死在 Luna 路径不回退代理 | —(client.js 已修) | 2026-07-10 dev E2E 时 cards=0 定位到此;修后 dev 20 卡、真机冒烟不受影响 |

## 焦点 / 输入(Magic Remote)

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-FOCUS-01 | 指针停在**半截边缘卡**上:高亮但**零滚动**,10s 焦点零漂移 | 📜 point.mjs park 测试(含**正对照**:坏版同操作焦点 0→4→8 漂移) | 六轮拉锯的 #11 边缘滚动;正对照是本仓库验证纪律的起点;报告人确认修复 |
| C-FOCUS-02 | 滚轮方向=视图方向,**与指针位置无关**:指针在底部1/4向上滚→scrollY 减;顶部向下滚→增;不卡不反向 | 📜 `node tools/cases/c-focus-02-wheel-direction.mjs`(需 app 在首页网格;2026-07-09 固化脚本并复跑 PASS) | ZMonsterror"几乎必现"反向/卡死;根因=焦点行锚定模型 vs 指针起算(v1.2.6) |
| C-FOCUS-03 | hover 跟随指针(高亮=指针=点击目标);滚轮/D-pad 滚动不受 hover 影响 | 📜 **必须 dev+Playwright 受信输入**(page.mouse),TV 端 CDP 鼠标注入会静默失效 | hover 曾被 hoverAllowed 误杀;"注入失效当产品坏"浪费一轮(挂 DOM 计数器定位);Playwright 3/3+滚动矩阵 |

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
| C-DM-01 | 弹幕机翻(非中文界面+弹幕开,自动):滚动窗口(播放头前 40s,8s/tick+seek 触发)、批内去重+全局文本缓存(梗全场翻一次)、未译不上屏(不闪中文)、引擎失败下 tick 重试、批上限 100 | 🤖 verify.sh L2 (`tools/test-dmtranslate.mjs`, 4 组) + 📜 真机(dm_mt_en.png:6 条英文弹幕滚动) | 2026-07-11 真机 en 界面 25s 36 条上屏、纯中文泄漏 0;样本 'Xinxiang is New York' 梗可译 |
| 教训 | CDP 按键/鼠标注入会**静默死亡**(keydown 计数=0),重启 app 恢复 —— 判"app 坏"前先挂计数器验通道 | —(纪律#3 的按键版) | 2026-07-09 语言行测试中复现并用计数器定位 |

## 投屏

| ID | Case | 门禁 | 佐证 |
|---|---|---|---|
| C-CAST-01 | 国内版哔哩哔哩 → 我的小电视(NirvanaCast)投屏播放正常 | 👁 需手机实测 | **用户实证**:Cristinading v1.2.0 "casting…smooth with no problems"(#10);此代码约定不动(PR #3) |
| C-CAST-02 | 接收端可发现:9958 LISTEN、SSDP 广播、手机设备列表出现"我的小电视 (Supports 4K)" | 📜 netstat + 手机截图 | 投屏调查期间多次验证 |
| 已知空白 | 国际版(bstar)走 DLNA,SetAVTransportURI 是空壳→不播 | — 待做特性,非回归 | 2026-07-08 抓包(SetAVTransportURI 完整样本在案) |

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
契约**(导航索引、选择器、持久化设置),"时序脆弱"是最后的解释,不是第一个。
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
