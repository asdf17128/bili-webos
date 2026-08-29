// 真机性能观测:驱动电视做一遍典型操作,把 app 内打的点收回来算分位数。
//
// 为什么要有它:性能是"用户等了多久"的问题,而这台机器和开发机差着数量级
// (C4 = 4 核 / deviceMemory 2GB;用户里还有 webOS 5 的 Chrome 68)。桌面上跑
// 出来的数字对这里没有参考价值,必须在真机上量。
//
// 报告里**耗时和内存一起给** —— 优化很容易滑向"缓存一切",在 2GB 的机器上
// 那是拿卡顿换卡顿(owner 2026-08-29:要考虑硬件消耗的平衡)。
//
// Usage: node tools/perf.mjs [label]      结果追加到 tools/.perf-runs.jsonl
import { Client } from 'ssh2';
import { readFileSync, appendFileSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';
import { tvPassphrase } from './_tvpass.mjs';

const LABEL = process.argv[2] || 'baseline';
const TV = { host: '192.168.50.94', port: 9922 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (a) => a.length ? `p50 ${q(a, .5)}ms · p95 ${q(a, .95)}ms · n=${a.length}` : '(无样本)';

const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer(s => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => { if (err) { s.end(); return; } s.pipe(rs).pipe(s); });
  });
  server.listen(19994, '127.0.0.1', async () => {
    const pages = () => new Promise(res => {
      http.get('http://127.0.0.1:19994/json/list', r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res([]); } });
      }).on('error', () => res([]));
    });
    const app = (await pages()).find(p => p.url && p.url.includes('com.biliwebos.app'));
    if (!app) { console.error('app 不在前台,先 node tools/launch.mjs'); process.exit(1); }
    const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:19994'), { perMessageDeflate: false });
    let id = 1;
    const call = (method, params) => new Promise((resolve, reject) => {
      const myId = id++;
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
      const h = (raw) => { const m = JSON.parse(raw); if (m.id === myId) { ws.off('message', h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
      ws.on('message', h);
    });
    const evalJS = async (expr) => {
      const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r?.result?.value;
    };
    const key = async (k) => {
      const map = { down: { key: 'ArrowDown', vk: 40 }, up: { key: 'ArrowUp', vk: 38 }, right: { key: 'ArrowRight', vk: 39 }, left: { key: 'ArrowLeft', vk: 37 }, ok: { key: 'Enter', vk: 13 }, back: { key: 'Backspace', vk: 8 } }[k];
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: map.key, windowsVirtualKeyCode: map.vk, nativeVirtualKeyCode: map.vk });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: map.key, windowsVirtualKeyCode: map.vk, nativeVirtualKeyCode: map.vk });
    };

    await new Promise(r => ws.on('open', r));
    await call('Runtime.enable');

    if (process.env.FLAGS) {
      await evalJS(`localStorage.setItem('bili_perfopt', ${JSON.stringify(process.env.FLAGS)})`);
      await call('Page.reload', {});
      await sleep(12000);
    }
    // 每轮开始前清 HTTP 缓存。代理开始透传 max-age 之后,先跑的那一轮会把图
    // 缓存住,后跑的从零下载 —— 两档缩略图的对照就这么被串过一次(2026-08-31)。
    // 冷缓存也更贴近用户第一次进来的感受。
    try { await call('Network.enable'); await call('Network.clearBrowserCache'); } catch (e) { /* 老引擎可能没有 */ }
    console.log(`\n=== 性能观测 [${LABEL}] ===`);
    const memBefore = await evalJS('JSON.stringify(window.__perf.memory())');
    await evalJS('window.__perf.clear()');

    // 场景 1:首页快速下翻 20 行 —— 跟手 + 翻页 + 图片都在这条路径上
    await evalJS(`(function(){var it=[].slice.call(document.querySelectorAll('.sidebar-item')).filter(function(x){return x.textContent.indexOf('推荐')>=0})[0]; if(it) it.click(); return 1})()`);
    await sleep(2500);
    await key('right'); await sleep(600);
    for (let i = 0; i < 20; i++) { await key('down'); await sleep(260); }
    await sleep(2500);

    // 场景 2:左右横移 12 次(纯焦点移动,不触发加载)
    for (let i = 0; i < 12; i++) { await key(i % 2 ? 'left' : 'right'); await sleep(200); }
    await sleep(800);

    // 场景 3:页面切换(推荐 → 热门 → 游戏分区 → 回推荐)
    for (const label of ['热门', '游戏', '推荐']) {
      await evalJS(`(function(){var it=[].slice.call(document.querySelectorAll('.sidebar-item')).filter(function(x){return x.textContent.indexOf('${label}')>=0})[0]; if(it) it.click(); return 1})()`);
      await sleep(2600);
    }

    // 场景 4:播放器打开 → 首帧 → 评论竖栏 → 退出
    await evalJS(`(function(){window.__openVideo({bvid:'BV1xx411c7Xg'});return 1})()`);
    await sleep(12000);
    for (let i = 0; i < 3; i++) { await key('up'); await sleep(700); }   // 呼出控制条
    for (let i = 0; i < 8; i++) {                                        // 走到「评论」
      const f = await evalJS(`(document.querySelector('.player-btn.focused')||{}).textContent||''`);
      if (f.indexOf('评论') >= 0) break;
      await key('right'); await sleep(220);
    }
    await key('ok'); await sleep(4000);
    for (let i = 0; i < 4; i++) { await key('back'); await sleep(700); }
    await sleep(1000);

    const raw = await evalJS('JSON.stringify(window.__perf.dump())');
    const memAfter = await evalJS('JSON.stringify(window.__perf.memory())');
    const lt = await evalJS('window.__perf.longTasks ? JSON.stringify(window.__perf.longTasks()) : "null"');
    const entries = JSON.parse(raw || '[]');
    const by = (k) => entries.filter(e => e.k === k).map(e => e.ms);

    const focus = by('focus-move'), page = by('grid-page').concat(by('grid-page-prefetched')), img = by('img');
    const pre = by('grid-page-prefetched');
    const sw = by('page-switch'), first = by('player-first-frame'), cmt = by('comments-open');
    const longs = lt === 'null' ? null : JSON.parse(lt);
    const mb = JSON.parse(memBefore || 'null'), ma = JSON.parse(memAfter || 'null');

    console.log(`跟手(按键→焦点画出): ${fmt(focus)}`);
    console.log(`翻页(触发→新卡片画出): ${fmt(page)}  [其中命中预取 ${pre.length} 次]`);
    console.log(`图片(挂载→缩略图可见): ${fmt(img)}`);
    console.log(`长任务(>50ms 阻塞主线程): ${longs ? `${longs.length} 次 · 最长 ${Math.max(0, ...longs)}ms · 合计 ${longs.reduce((a, b) => a + b, 0)}ms` : '(该机型无法观测)'}`);
    console.log(`内存: ${mb ? mb.used : '?'}MB → ${ma ? ma.used : '?'}MB (堆总量 ${ma ? ma.total : '?'}MB)`);
    console.log(`页面切换(按下→内容画出): ${fmt(sw)}`);
    console.log(`播放器首帧(打开→出画面): ${fmt(first)}`);
    console.log(`评论竖栏(打开→列表画出): ${fmt(cmt)}`);
    const attr = await evalJS('window.__perf.longTaskAttribution ? JSON.stringify(window.__perf.longTaskAttribution()) : "null"');
    if (attr && attr !== 'null') console.log(`长任务归因: ${attr}`);
    console.log(`图片失败: ${by('img-fail').length} 次`);

    appendFileSync('tools/.perf-runs.jsonl', JSON.stringify({
      ts: new Date().toISOString(), label: LABEL,
      focus: { p50: q(focus, .5), p95: q(focus, .95), n: focus.length },
      page: { p50: q(page, .5), p95: q(page, .95), n: page.length },
      img: { p50: q(img, .5), p95: q(img, .95), n: img.length },
      pageSwitch: { p50: q(sw, .5), p95: q(sw, .95), n: sw.length },
      firstFrame: { p50: q(first, .5), p95: q(first, .95), n: first.length },
      comments: { p50: q(cmt, .5), p95: q(cmt, .95), n: cmt.length },
      longTasks: longs ? { count: longs.length, max: Math.max(0, ...longs), total: longs.reduce((a, b) => a + b, 0) } : null,
      mem: { before: mb && mb.used, after: ma && ma.used, total: ma && ma.total },
    }) + '\n');
    ws.close(); conn.end(); process.exit(0);
  });
}).on('error', e => { console.error('ssh:', e.message); process.exit(1); })
  .connect({ host: TV.host, port: TV.port, username: 'prisoner',
    privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'),
    passphrase: tvPassphrase(), algorithms: { serverHostKey: ['ssh-rsa'] } });
