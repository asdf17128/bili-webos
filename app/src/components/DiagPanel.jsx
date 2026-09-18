import React, { useState, useEffect } from 'react';
import qrcode from 'qrcode-generator';
import { apiFetch, wbiFetch, getRecommend, getServiceDiagnostics, mediaProxyBase } from '../api/client';
import { FALLBACK_MIRRORS, cdnHostOf, withHost } from '../player/cdn';
import { getErrors } from '../utils/errlog';
import { apiErrorHint } from '../utils/apiHint';
import { storage } from '../utils/storage';
import { APP_VERSION } from '../version';
import { t } from '../i18n';

// 网络诊断 (#10/#13): one screen that tells us WHY the app fails on a TV we
// can't touch. Runs the full chain (Luna service → api → wbi/risk-control →
// playurl → image proxy), shows each step's real error text, and renders a QR
// that opens a PREFILLED GitHub issue with the report — the user just scans
// with a phone and taps submit. Zero servers, nothing uploads by itself.

const REPO_ISSUE_URL = 'https://github.com/asdf17128/bili-webos/issues/new';

// A well-known stable video for the playurl probe (B站 first video, av2).
const PROBE_BVID = 'BV1xx411c7mD';

function ago(ts) { return t('{n}s前', { n: Math.round((Date.now() - ts) / 1000) }); }

export default function DiagPanel() {
  const [rows, setRows] = useState([]);   // {name, status: 'run'|'ok'|'fail'|'skip'|'warn', detail}
  const [svcInfo, setSvcInfo] = useState(null);
  const [reportUrl, setReportUrl] = useState('');

  useEffect(() => {
    let dead = false;
    const results = [];
    const push = (name, status, detail) => {
      if (dead) return;
      const i = results.findIndex(r => r.name === name);
      const row = { name, status, detail: String(detail || '').slice(0, 140) };
      if (i >= 0) results[i] = row; else results.push(row);
      setRows(results.slice());
    };

    (async () => {
      let svc = null;

      // 1. Luna service reachable?
      push('后台服务', 'run', '');
      try {
        svc = await getServiceDiagnostics();
        if (!dead) setSvcInfo(svc);
        push('后台服务', 'ok',
          t('Node {v} · buvid {b} · 弹幕模块 {d} · 运行 {u}', { v: svc.nodeVersion || '?', b: svc.buvid ? '✓' : '✗', d: svc.danmakuModule ? '✓' : '✗', u: svc.uptimeSec != null ? svc.uptimeSec + 's' : '?' }));
      } catch (e) {
        push('后台服务', 'fail', e.message);
      }

      // 2. Plain API connectivity (nav: -101 when logged out still means the
      // network path is fine).
      push('API 连通', 'run', '');
      try {
        const j = await apiFetch('/x/web-interface/nav');
        const code = j && j.code;
        if (code === 0) push('API 连通', 'ok', t('已登录 {name}', { name: j.data && j.data.uname ? j.data.uname : '' }));
        else if (code === -101) push('API 连通', 'ok', t('code=-101 (未登录,链路正常)'));
        else push('API 连通', 'fail', 'code=' + code);
      } catch (e) { push('API 连通', 'fail', e.message); }

      // 3. WBI-signed feed — the risk-control (-352) probe.
      push('推荐流(风控)', 'run', '');
      try {
        const j = await getRecommend(4, 3);
        const code = j && j.code;
        const n = j && j.data && j.data.item ? j.data.item.length : 0;
        if (code === 0 && n > 0) push('推荐流(风控)', 'ok', t('返回 {n} 条', { n }));
        else if (code === -352) push('推荐流(风控)', 'fail', t('code=-352 风控拦截(常见于海外 IP)'));
        else push('推荐流(风控)', 'fail', `code=${code} items=${n}`);
      } catch (e) { push('推荐流(风控)', 'fail', e.message); }

      // 4. view + playurl — can we actually get a stream?
      // 探针必须走**和播放器完全一样**的路径:playurl 用 wbiFetch(带 WBI 签名)。
      // 之前这里用的是不签名的 apiFetch —— 在被风控盯上的网络里,不签名的请求
      // 比真实取流更容易被拦,于是诊断报红而视频其实能放(issue #20)。
      // 探针比生产链路脆弱 = 假警报,和测试夹具必须贴合生产是同一个道理。
      // view 单列一行 —— 以前它的失败被记成 `playurl view code=…`,看着像取流
      // 挂了,其实取流根本没跑(issue #25 就是这样误导了排查方向)。
      // 走 wbiFetch 和播放器同路径;失败时和播放器一样试 pagelist 兜底。
      push('视频信息 view', 'run', '');
      let probeCid = null;
      let probeStreamUrl = null;
      try {
        const v = await wbiFetch('/x/web-interface/view', { bvid: PROBE_BVID });
        if (v && v.code === 0) { probeCid = v.data.cid; push('视频信息 view', 'ok', 'code=0'); }
        else {
          const pl = await apiFetch('/x/player/pagelist', { bvid: PROBE_BVID });
          if (pl && pl.code === 0 && pl.data && pl.data.length) {
            probeCid = pl.data[0].cid;
            push('视频信息 view', 'warn', 'code=' + (v && v.code) + ' ' + t('(已用 pagelist 兜底,可正常播放)'));
          } else {
            push('视频信息 view', 'fail', apiErrorHint(v && v.code, { loggedIn: !!storage.getAuth()?.SESSDATA }) || ('view code=' + (v && v.code)));
          }
        }
      } catch (e) { push('视频信息 view', 'fail', e.message); }

      push('取流 playurl', 'run', '');
      try {
        if (!probeCid) throw new Error(t('前置 view/pagelist 都失败,拿不到 cid'));
        const p = await wbiFetch('/x/player/playurl', { bvid: PROBE_BVID, cid: probeCid, qn: 16, fnval: 16 });
        if (p && p.code === 0) push('取流 playurl', 'ok', 'code=0');
        else push('取流 playurl', 'fail', apiErrorHint(p && p.code, { loggedIn: !!storage.getAuth()?.SESSDATA }) || ('playurl code=' + (p && p.code)));
        // 探针用的流 URL:主+备里第一个**非 PCDN** 的(mcdn/带端口的 P2P 节点是播放器
        // 主动排到最后的,拿它测 CDN 没意义);全是 PCDN 才退回主 URL。
        const v0 = p && p.code === 0 && p.data && p.data.dash && p.data.dash.video && p.data.dash.video[0];
        if (v0) {
          const cands = [v0.baseUrl || v0.base_url].concat(v0.backupUrl || v0.backup_url || []).filter(Boolean);
          const isPcdn = (u) => /mcdn\.|szbdyd|\bxy[\dx]+xy\b|:\d{4,5}\//i.test(u);
          probeStreamUrl = cands.find(u => !isPcdn(u)) || cands[0] || null;
        }
      } catch (e) { push('取流 playurl', 'fail', e.message); }

      // 4b. 视频 CDN (#29):接口全通但拉不到流,以前只能对着一堆 E: 猜。
      // 用刚拿到的真实签名 URL,经本地代理向「B站 分配的节点 + 两个兜底镜像」
      // 各拉 200KB,报每家通不通、多快;分配的挂了就明说已自动切换。
      push('视频 CDN', 'run', '');
      try {
        if (!probeStreamUrl) throw new Error(t('前置 view/pagelist 都失败,拿不到 cid'));
        const assigned = cdnHostOf(probeStreamUrl);
        const hosts = [assigned].concat(FALLBACK_MIRRORS.filter(h => h !== assigned));
        const base = mediaProxyBase();
        const one = async (host) => {
          const u = withHost(probeStreamUrl, host);
          const x = new URL(u);
          const t0 = Date.now();
          try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl && setTimeout(() => ctrl.abort(), 8000);
            const r = await fetch(`${base}/proxy/${x.host}${x.pathname}${x.search}`, { headers: { Range: 'bytes=0-200000' }, signal: ctrl ? ctrl.signal : undefined });
            if (timer) clearTimeout(timer);
            if (r.status !== 206 && r.status !== 200) return { host, ok: false, why: 'HTTP ' + r.status };
            await r.arrayBuffer();
            const cr = r.headers.get('content-range') || '';
            return { host, ok: true, ms: Date.now() - t0, total: parseInt(cr.split('/')[1], 10) || 0 };
          } catch (e) { return { host, ok: false, why: (e && e.name === 'AbortError') ? t('超时(8s)') : t('连不上') }; }
        };
        const rs = [];
        for (const h of hosts) rs.push(await one(h));
        const short = h => h.replace(/^upos-(sz|hz)-(mirror)?/, '').replace(/\.(bilivideo\.com|akamaized\.net)$/, '');
        const text = rs.map(r => short(r.host) + (r.ok ? ' ' + (r.ms / 1000).toFixed(1) + 's' : ' ✗' + (r.why ? '(' + r.why + ')' : ''))).join(' · ');
        if (rs[0].ok) push('视频 CDN', 'ok', text);
        else if (rs.some(r => r.ok)) push('视频 CDN', 'warn', text + ' — ' + t('当前节点连不上,已自动切换到可用镜像'));
        else push('视频 CDN', 'fail', text + ' — ' + t('视频节点全部连不上,试试设置里换 CDN 线路'));

        // 4c. 单连接 vs 4 并发测速。在能连上的那家镜像上,先拉一块 2MB(单连接),
        // 再在另一个偏移拆成 4 个子块并发拉,看聚合吞吐是不是明显高于单连接。
        // 这是为了搞清楚"分块并发拉流"(线程撕裂者那套)对海外用户到底有没有用:
        // 从 LA 测是负收益,但欧洲/东南亚的家庭宽带可能被按连接限速 —— 没观测点,
        // 就让用户的诊断报告替我们测。比值 ≥3 的报告多了再做代理层分块拉取。
        const good = rs.find(r => r.ok);
        if (good) {
          push('CDN 测速', 'run', '');
          try {
            const gx = new URL(withHost(probeStreamUrl, good.host));
            const proxied = `${base}/proxy/${gx.host}${gx.pathname}${gx.search}`;
            const total = good.total || 0;
            const BLK = total ? Math.max(256 * 1024, Math.min(2 * 1024 * 1024, Math.floor(total / 8))) : 1024 * 1024;
            // 拉 [start,end],最多 budgetMs;超时就按已收到的字节算(慢线路也要出数)。
            const pull = async (start, end, budgetMs) => {
              const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
              const timer = ctrl && setTimeout(() => ctrl.abort(), budgetMs);
              const t0 = Date.now();
              let bytes = 0;
              try {
                const r = await fetch(proxied, { headers: { Range: `bytes=${start}-${end}` }, signal: ctrl ? ctrl.signal : undefined });
                if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
                if (r.body && r.body.getReader) {
                  const reader = r.body.getReader();
                  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; }
                } else { bytes = (await r.arrayBuffer()).byteLength; }
              } catch (e) { if (!(e && e.name === 'AbortError')) throw e; }
              if (timer) clearTimeout(timer);
              return { bytes, ms: Math.max(1, Date.now() - t0) };
            };
            const s0 = total ? Math.floor(total * 0.25) : BLK;
            const p0 = total ? Math.floor(total * 0.5) : BLK * 3;
            const single = await pull(s0, s0 + BLK - 1, 10000);
            const q = Math.floor(BLK / 4);
            const tp = Date.now();
            const parts = await Promise.all([0, 1, 2, 3].map(i => pull(p0 + i * q, p0 + (i + 1) * q - 1, 10000)));
            const parMs = Math.max(1, Date.now() - tp);
            const sMB = single.bytes / single.ms / 1000;           // bytes/ms = KB/s → /1000 = MB/s
            const pMB = parts.reduce((a, r) => a + r.bytes, 0) / parMs / 1000;
            const ratio = sMB > 0 ? (pMB / sMB) : 0;
            const detail = short(good.host) + ' ' + t('单连接(1x) {s} MB/s · 4 并发(4x) {p} MB/s (x{r})', { s: sMB.toFixed(2), p: pMB.toFixed(2), r: ratio.toFixed(1) });
            if (sMB < 0.4) push('CDN 测速', 'warn', detail + ' — ' + t('单连接偏慢,1080p 可能卡顿'));
            else push('CDN 测速', 'ok', detail);
          } catch (e) { push('CDN 测速', 'fail', e.message); }
        }
      } catch (e) { push('视频 CDN', 'fail', e.message); }

      // 5. Local image proxy (:7654) — thumbnails/segments path.
      push('图片代理', 'run', '');
      const port = (svc && svc.localProxyPort) || 7654;
      await new Promise((resolve) => {
        if (typeof window.webOS === 'undefined') { push('图片代理', 'skip', t('浏览器模式跳过')); resolve(); return; }
        const img = new Image();
        const timer = setTimeout(() => { push('图片代理', 'fail', t('超时(8s)')); resolve(); }, 8000);
        img.onload = () => { clearTimeout(timer); push('图片代理', 'ok', ':' + port); resolve(); };
        img.onerror = () => { clearTimeout(timer); push('图片代理', 'fail', ':' + port + ' ' + t('加载失败')); resolve(); };
        img.src = 'http://127.0.0.1:' + port + '/proxy/i0.hdslb.com/bfs/face/member/noface.jpg?_t=' + Date.now();
      });

      // Build the scan-to-report issue URL. The body must be ASCII-ONLY: a
      // percent-encoded CJK char is 9 chars, which balloons the URL and makes
      // the QR too dense to scan off a TV screen. Error strings from Node /
      // Luna / HTTP are ASCII anyway; anything else gets stripped.
      const ascii = s => String(s).replace(/[^\x20-\x7e]/g, '').trim();
      const KEY = { '后台服务': 'svc', 'API 连通': 'api', '推荐流(风控)': 'rcmd', '视频信息 view': 'view', '取流 playurl': 'playurl', '视频 CDN': 'cdn', 'CDN 测速': 'cdnspeed', '图片代理': 'imgproxy' };
      const lines = [];
      lines.push('app v' + APP_VERSION);
      const ua = navigator.userAgent.match(/Chrom\w+\/[\d.]+/);
      lines.push('ua ' + (ua ? ua[0] : ascii(navigator.userAgent).slice(0, 40)) + (window.webOS ? ' TV' : ' browser'));
      if (svc) lines.push('svc node=' + svc.nodeVersion + ' buvid=' + (svc.buvid ? 'Y' : 'N') + ' dm=' + (svc.danmakuModule ? 'Y' : 'N') + ' up=' + svc.uptimeSec + 's');
      results.forEach(r => lines.push('[' + r.status + '] ' + (KEY[r.name] || ascii(r.name)) + (r.detail ? ' ' + ascii(r.detail).slice(0, 60) : '')));
      const svcErrs = (svc && svc.recentErrors) || [];
      svcErrs.slice(-5).forEach(e => lines.push('E:' + ascii(e.tag) + ' ' + ascii(e.d).slice(0, 60)));
      getErrors().slice(-5).forEach(e => lines.push('A:' + ascii(e.tag) + ' ' + ascii(e.d).slice(0, 60)));
      const body = '```\n' + lines.join('\n').slice(0, 700) + '\n```';
      const url = REPO_ISSUE_URL + '?title=' + encodeURIComponent('[diag] v' + APP_VERSION) +
        '&body=' + encodeURIComponent(body);
      if (!dead) setReportUrl(url);
    })();

    return () => { dead = true; };
  }, []);

  // Render the QR as an SVG string (qrcode-generator is ES5-safe for old TVs).
  let qrSvg = '';
  if (reportUrl) {
    try {
      const qr = qrcode(0, 'L');
      qr.addData(reportUrl);
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 3, margin: 2 });
    } catch (e) { /* URL too long for QR — text fallback below */ }
  }

  const ICON = { ok: '✅', fail: '❌', run: '⏳', skip: '⏭️', warn: '⚠️' };
  return (
    <div style={{ marginTop: 18, padding: '16px 20px', background: 'rgba(255,255,255,0.05)', borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {rows.map(r => (
            <div key={r.name} style={{ fontSize: 'calc(18px * var(--ui-scale))', lineHeight: 1.9, color: r.status === 'fail' ? '#ff7a7a' : '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ICON[r.status] || ''} {t(r.name)}{r.detail ? ` — ${r.detail}` : ''}
            </div>
          ))}
          {svcInfo && svcInfo.recentErrors && svcInfo.recentErrors.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 'calc(16px * var(--ui-scale))', color: '#c96' }}>
              {t('服务近期错误:')}
              {svcInfo.recentErrors.slice(-4).map((e, i) => (
                <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ago(e.t)} [{e.tag}] {e.d}</div>
              ))}
            </div>
          )}
        </div>
        {qrSvg && (
          <div style={{ width: 190, flexShrink: 0, textAlign: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 6, display: 'inline-block' }}
              dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div style={{ fontSize: 'calc(16px * var(--ui-scale))', color: '#999', marginTop: 8, lineHeight: 1.5 }}>
              {t('手机扫码 → 自动生成 GitHub 反馈(内容可先检查,提交前不会发送任何数据)')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
