# 长按「不感兴趣」— 调研沉淀(2026-09-20,未实现)

对齐手机客户端:卡片长按 → 不感兴趣 → 卡片消失、推荐流少推同类。owner 定的下一项体验功能。

## 接口(web 端,已从三个成熟项目源码交叉确认:Bilibili-Gate / BewlyCat / BiliKit-Web)

```
POST https://api.bilibili.com/x/web-interface/feedback/dislike
Content-Type: application/x-www-form-urlencoded
app_id=100&platform=5&from_spmid=&spmid=333.1007.0.0&feedback_page=1
&goto=av&id=<aid>&mid=<owner.mid>&track_id=<item.track_id>&reason_id=<n>&csrf=<bili_jct>
```

撤销:同参数 `POST /x/web-interface/feedback/dislike/cancel`。

- 走 **web cookie**(SESSDATA + bili_jct),不需要 app access_key —— 我们的 `biliWrite()` 直接能用
  (它已经自动带 csrf 表单字段,见 client.js `addToView`)。
- 手机端走的是 `app.bilibili.com/x/feed/dislike`(GET,要 appkey 签名 + access_key),**不走这条**。
- `reason_id` 已确认的:`1` 内容不感兴趣 · `4` 不想看此 UP 主 · `12` 此类内容过多 · `13` 推荐过。
  web 推荐流的 item **不带** three_point/dislike_reasons(那是 app 接口才有),所以只能用固定清单。
- 推荐流 item 自带 `dislike_switch` / `dislike_switch_pc`(实测都是 1)、`track_id`、`id`(=aid)、`goto`、
  `owner.mid` —— 发请求需要的字段**卡片数据里都有**,不用再查 view。
- 响应码、频控、撤销窗口、是否真的从后续 rcmd 里过滤:**没人文档化,要实测**。

## 设计要点

1. **菜单**:现有 CardMenu(长按 OK)在「加入稍后再看」下面加「不感兴趣」;OK 后二级选一个原因
   (不感兴趣 / 不想看此 UP 主 / 此类内容过多),对齐手机端的两步。原因少给 3 个就够,电视上不适合长列表。
2. **哪些列表可用**:只有推荐流(首页)的卡片有 `track_id`,才有意义;分区/搜索/收藏/稍后再看的卡片
   没有 track_id → 菜单不显示这一项(或只做本地隐藏)。
3. **未登录**:接口要 csrf,未登录只能本地隐藏 —— 存 storage 一个 `hiddenAids`(封顶几百条),
   推荐流渲染时过滤。登录用户也可以同时本地隐藏,保证"立刻消失"不依赖服务端。
4. **反馈**:卡片原位淡出 + 一条 toast「已减少此类推荐 · 按 OK 撤销」(5 秒内可撤销 → cancel 接口)。
   撤销比确认对话框友好,也符合手机端。
5. **网格焦点**:卡片消失后焦点落到同位置的下一张;是最后一张就落前一张。要写用例。

## 测试纪律(写操作!)

- 遵守写操作安全线(memory: feedback_test_safety):**只对夹具视频**做 dislike,**同一用例内立刻 cancel**,
  每步断言目标 aid;仿真里 mock 接口验 UI/焦点,真机只跑一次带撤销的真实链路。
- 不感兴趣会真的改 owner 账号的推荐,别在真实推荐卡上试。

## 待实测清单(开工第一步)

- [ ] dislike 成功响应体;错误码(未登录 -101、参数缺失、频控)
- [ ] cancel 是否有时间窗口
- [ ] dislike 后下一次 rcmd 是否还出现该 aid / 该 UP
- [ ] 分区列表(`newlist`/`dynamic/region` 已 -404/空)之外还有哪些列表带 track_id
