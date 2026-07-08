// C-FOCUS-02 (docs/TESTCASES.md): wheel direction == view direction, pointer
// position irrelevant. Reporter's near-100% repro (#11): pointer in the bottom
// quarter + wheel-up used to REVERSE-scroll / wedge (fixed v1.2.6).
// Precondition: app on the HOME grid (bash: node tools/launch.mjs then navigate).
// Run: node tools/cases/c-focus-02-wheel-direction.mjs   (exit 0 = pass)
import { Client } from 'ssh2'; import { readFileSync } from 'fs';
import http from 'http'; import net from 'net'; import { WebSocket } from 'ws';

const c = new Client();
c.on('ready', () => {
  const srv = net.createServer(s => c.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (e, rs) => { if (e) { s.end(); return; } s.pipe(rs).pipe(s); }));
  srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    http.get(`http://127.0.0.1:${port}/json`, r => {
      let d = ''; r.on('data', x => d += x);
      r.on('end', async () => {
        const app = JSON.parse(d).find(p => p.title && p.title.includes('哔哩'));
        if (!app) { console.log('FAIL: app not running'); process.exit(1); }
        const ws = new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${port}`));
        let id = 1;
        const call = (m, p) => new Promise(res => { const i = id++; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); const h = x => { const mm = JSON.parse(x); if (mm.id === i) { ws.off('message', h); res(mm.result); } }; ws.on('message', h); });
        const evalJs = async e => { const r2 = await call('Runtime.evaluate', { expression: e, returnByValue: true }); return r2 && r2.result && r2.result.value; };
        const sleep = ms => new Promise(r2 => setTimeout(r2, ms));
        const move = (x, y) => call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
        const wheel = (x, y, dy) => call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
        const state = () => evalJs("(function(){var g=document.querySelector('[data-focus-id^=content]').parentElement;var m=(g.style.transform||'').match(/-?([0-9.]+)px/);return m?+m[1]:0;})()");
        await new Promise(r2 => ws.on('open', r2));

        // setup: scroll down a few rows from mid-screen
        await move(960, 540); await sleep(300);
        for (let i = 0; i < 4; i++) { await wheel(960, 540, 200); await sleep(450); }
        const s0 = await state();
        if (!(s0 > 0)) { console.log('FAIL: setup did not scroll (scrollY=' + s0 + ') — is the app on the home grid?'); process.exit(1); }

        // repro 1: pointer bottom quarter, wheel UP — view must move UP
        await move(960, 1010); await sleep(400);
        const s1 = await state();
        for (let i = 0; i < 3; i++) { await wheel(960, 1010, -200); await sleep(450); }
        const s2 = await state();
        const up = s2 < s1;
        console.log(`bottom-pointer wheel-UP: scrollY ${s1} -> ${s2}  ${up ? 'PASS' : 'FAIL (reverse/wedge)'}`);

        // repro 2: pointer top, wheel DOWN — view must move DOWN
        await move(960, 120); await sleep(400);
        const s3 = await state();
        for (let i = 0; i < 3; i++) { await wheel(960, 120, 200); await sleep(450); }
        const s4 = await state();
        const down = s4 > s3;
        console.log(`top-pointer wheel-DOWN: scrollY ${s3} -> ${s4}  ${down ? 'PASS' : 'FAIL (reverse/wedge)'}`);

        ws.close(); srv.close(); c.end();
        process.exit(up && down ? 0 : 1);
      });
    }).on('error', e => { console.log('err', e.message); process.exit(1); });
  });
});
c.connect({ host: '192.168.50.94', port: 9922, username: 'prisoner', privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'), passphrase: '4E7082', algorithms: { serverHostKey: ['ssh-rsa'] } });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 90000);
