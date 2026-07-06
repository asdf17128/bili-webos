import React, { useState, useEffect } from 'react';
import qrcode from 'qrcode-generator';
import { apiFetch, getRecommend, getServiceDiagnostics } from '../api/client';
import { getErrors } from '../utils/errlog';
import { APP_VERSION } from '../version';

// 网络诊断 (#10/#13): one screen that tells us WHY the app fails on a TV we
// can't touch. Runs the full chain (Luna service → api → wbi/risk-control →
// playurl → image proxy), shows each step's real error text, and renders a QR
// that opens a PREFILLED GitHub issue with the report — the user just scans
// with a phone and taps submit. Zero servers, nothing uploads by itself.

const REPO_ISSUE_URL = 'https://github.com/asdf17128/bili-webos/issues/new';

// A well-known stable video for the playurl probe (B站 first video, av2).
const PROBE_BVID = 'BV1xx411c7mD';

function ago(t) { return Math.round((Date.now() - t) / 1000) + 's前'; }

export default function DiagPanel() {
  const [rows, setRows] = useState([]);   // {name, status: 'run'|'ok'|'fail'|'skip', detail}
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
          `Node ${svc.nodeVersion || '?'} · buvid ${svc.buvid ? '✓' : '✗'} · 弹幕模块 ${svc.danmakuModule ? '✓' : '✗'} · 运行 ${svc.uptimeSec != null ? svc.uptimeSec + 's' : '?'}`);
      } catch (e) {
        push('后台服务', 'fail', e.message);
      }

      // 2. Plain API connectivity (nav: -101 when logged out still means the
      // network path is fine).
      push('API 连通', 'run', '');
      try {
        const j = await apiFetch('/x/web-interface/nav');
        const code = j && j.code;
        if (code === 0) push('API 连通', 'ok', `已登录 ${j.data && j.data.uname ? j.data.uname : ''}`);
        else if (code === -101) push('API 连通', 'ok', 'code=-101 (未登录,链路正常)');
        else push('API 连通', 'fail', 'code=' + code);
      } catch (e) { push('API 连通', 'fail', e.message); }

      // 3. WBI-signed feed — the risk-control (-352) probe.
      push('推荐流(风控)', 'run', '');
      try {
        const j = await getRecommend(4, 3);
        const code = j && j.code;
        const n = j && j.data && j.data.item ? j.data.item.length : 0;
        if (code === 0 && n > 0) push('推荐流(风控)', 'ok', `返回 ${n} 条`);
        else if (code === -352) push('推荐流(风控)', 'fail', 'code=-352 风控拦截(常见于海外 IP)');
        else push('推荐流(风控)', 'fail', `code=${code} items=${n}`);
      } catch (e) { push('推荐流(风控)', 'fail', e.message); }

      // 4. view + playurl — can we actually get a stream?
      push('取流 playurl', 'run', '');
      try {
        const v = await apiFetch('/x/web-interface/view', { bvid: PROBE_BVID });
        if (!v || v.code !== 0) throw new Error('view code=' + (v && v.code));
        const cid = v.data.cid;
        const p = await apiFetch('/x/player/playurl', { bvid: PROBE_BVID, cid, qn: 16, fnval: 16 });
        if (p && p.code === 0) push('取流 playurl', 'ok', 'code=0');
        else push('取流 playurl', 'fail', 'playurl code=' + (p && p.code));
      } catch (e) { push('取流 playurl', 'fail', e.message); }

      // 5. Local image proxy (:7654) — thumbnails/segments path.
      push('图片代理', 'run', '');
      const port = (svc && svc.localProxyPort) || 7654;
      await new Promise((resolve) => {
        if (typeof window.webOS === 'undefined') { push('图片代理', 'skip', '浏览器模式跳过'); resolve(); return; }
        const img = new Image();
        const timer = setTimeout(() => { push('图片代理', 'fail', '超时(8s)'); resolve(); }, 8000);
        img.onload = () => { clearTimeout(timer); push('图片代理', 'ok', ':' + port); resolve(); };
        img.onerror = () => { clearTimeout(timer); push('图片代理', 'fail', ':' + port + ' 加载失败'); resolve(); };
        img.src = 'http://127.0.0.1:' + port + '/proxy/i0.hdslb.com/bfs/face/member/noface.jpg?_t=' + Date.now();
      });

      // Build the scan-to-report issue URL. The body must be ASCII-ONLY: a
      // percent-encoded CJK char is 9 chars, which balloons the URL and makes
      // the QR too dense to scan off a TV screen. Error strings from Node /
      // Luna / HTTP are ASCII anyway; anything else gets stripped.
      const ascii = s => String(s).replace(/[^\x20-\x7e]/g, '').trim();
      const KEY = { '后台服务': 'svc', 'API 连通': 'api', '推荐流(风控)': 'rcmd', '取流 playurl': 'playurl', '图片代理': 'imgproxy' };
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

  const ICON = { ok: '✅', fail: '❌', run: '⏳', skip: '⏭️' };
  return (
    <div style={{ marginTop: 18, padding: '16px 20px', background: 'rgba(255,255,255,0.05)', borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {rows.map(r => (
            <div key={r.name} style={{ fontSize: 16, lineHeight: 1.9, color: r.status === 'fail' ? '#ff7a7a' : '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ICON[r.status] || ''} {r.name}{r.detail ? ` — ${r.detail}` : ''}
            </div>
          ))}
          {svcInfo && svcInfo.recentErrors && svcInfo.recentErrors.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#c96' }}>
              服务近期错误:
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
            <div style={{ fontSize: 13, color: '#999', marginTop: 6, lineHeight: 1.5 }}>
              手机扫码 → 自动生成 GitHub 反馈(内容可先检查,提交前不会发送任何数据)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
