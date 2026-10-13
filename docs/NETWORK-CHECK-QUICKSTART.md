# BiliTV home network check / 家庭网络检测

Run this on a computer connected to the same home network as your TV, preferably
while the TV problem is happening. This checks anonymous Bilibili API requests,
DNS and small video byte ranges through the app's CDN selection code.

1. Install **Node.js 18 or newer** and **Python 3** if needed.
2. Extract the ZIP and open a terminal in the `bili-network-check` folder.
3. Run:

   ```sh
   node tools/test-region-network.mjs --local --bvid BV1sapi6qE72 --output report-1
   ```

4. Repeat with `--output report-2` and `--output report-3`. You can replace the
   BVID with the video that fails on your TV.
5. Review and attach the three `results.json` files to your existing issue. Add
   your country, ISP, approximate failure time, TV model and app build. Also
   attach the TV's **Settings → Network diagnostics** QR report after a failed
   playback attempt, ideally before restarting the app.

No `npm install` or Bilibili login is required. The tool does not read your app
cookies or browser account. It keeps fresh anonymous fingerprints and signed
media URLs in memory, excludes them from the report, and never uploads a report
automatically. The report contains the tested BVID, country, CDN/DNS destination
addresses, timings and error codes, but not your public source IP.

Allow a few minutes. `FAIL` or a nonzero exit can be useful evidence: keep the
report. `nav.code: -101` is expected for an anonymous session. The video quality
may be lower than 4K; this tool does not test VIP permissions or TV decoding.
Small-range transfer rates are not a sustained bandwidth test.

Check `location.loc` and `location.proxyConfigured`. Python can use your
computer's configured HTTP proxy, while the TV may take a different route.
System DNS results may also differ from a proxy's resolver. A report from a
different route cannot prove the TV connection works. Do not change router or
DNS settings solely to make this test pass.

If Python is missing, install it first. If your executable has another name,
select it with `REGION_PYTHON` (for example `python3` on macOS/Linux or `python`
on Windows). On Windows PowerShell: `$env:REGION_PYTHON = 'python'`.

## 中文

在电视出问题时，用同一个家庭网络下的电脑解压运行上述命令，分别保存三次报告。
可将 BV 号换成无法播放的视频。无需登录或安装 npm 依赖；需要 Node.js 18+ 和
Python 3。报告不会自动上传，也不包含账号 Cookie、媒体签名地址或你的公网 IP。

反馈时附上 `results.json`、国家/运营商、故障时间、电视型号和 App 版本；最好在
重启 App 前，另存一份电视「设置 → 网络诊断」的扫码报告。电脑测试只能检查匿名
API 和小块媒体传输，不能代替电视上的大会员、4K 或硬件解码验证。报告出现 FAIL
仍请保留。若显示代理已配置或出口国家不符，需要说明电脑与电视是否使用相同线路。
