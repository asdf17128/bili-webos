#!/bin/bash
# Full verification: build → deploy → screenshot → DOM check
# Usage: bash scripts/verify.sh
set -e

cd "$(dirname "$0")/.."
PASS="${1:-4E7082}"

echo "=== [1/4] Build ==="
bun run build 2>&1 | tail -3
cp webos/meta/* dist/
cd dist && ares-package --no-minify . ../webos/service/com.biliwebos.app.service 2>&1 | grep -E "Success|ERR"
cd ..

echo ""
echo "=== [2/4] Deploy ==="
bun tools/deploy.mjs 2>&1 | grep -E "Done|Error|Connected"

echo ""
echo "=== [3/4] Wait for app to load ==="
sleep 5

echo ""
echo "=== [4/4] Verify via CDP ==="
bun -e "
const { Client } = require('ssh2');
const { readFileSync, writeFileSync } = require('fs');
const http = require('http');
const net = require('net');
const { WebSocket } = require('ws');
const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer(s => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => { if(err){s.end();return;} s.pipe(rs).pipe(s); });
  });
  server.listen(19998, '127.0.0.1', () => {
    http.get('http://127.0.0.1:19998/json', res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        const app=JSON.parse(d).find(p=>p.title?.includes('哔哩'));
        if(!app){console.log('FAIL: App not found');process.exit(1);}
        const ws=new WebSocket(app.webSocketDebuggerUrl.replace(/127\\.0\\.0\\.1:\\d+/,'127.0.0.1:19998'));
        ws.on('open',()=>{
          ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:\\\`
            JSON.stringify({
              focus: document.querySelectorAll('[data-focus-id]').length,
              dom: document.querySelectorAll('*').length,
              imgs: document.querySelectorAll('img').length,
              animations: document.getAnimations?.()?.length || 0,
              hasGrid: !!document.querySelector('[style*=grid]'),
              hasPlayer: !!document.querySelector('.player-page'),
              hasSidebar: !!document.querySelector('.sidebar'),
            })
          \\\`}}));
          setTimeout(()=>{ws.send(JSON.stringify({id:2,method:'Page.captureScreenshot',params:{format:'png'}}));},1000);
        });
        ws.on('message',raw=>{
          const msg=JSON.parse(raw);
          if(msg.id===1){
            const info=JSON.parse(msg.result?.result?.value);
            console.log('DOM:', info.dom, '| Focus:', info.focus, '| Imgs:', info.imgs, '| Anims:', info.animations);
            console.log('Grid:', info.hasGrid, '| Sidebar:', info.hasSidebar, '| Player:', info.hasPlayer);
            if(info.focus>0 && info.hasSidebar) console.log('PASS: App rendered');
            else console.log('WARN: App may not have loaded fully');
          }
          if(msg.id===2&&msg.result?.data){
            writeFileSync('verify-screenshot.png',Buffer.from(msg.result.data,'base64'));
            console.log('Screenshot: verify-screenshot.png');
            ws.close();server.close();conn.end();
          }
        });
      });
    });
  });
});
conn.connect({host:'192.168.50.94',port:9922,username:'prisoner',
  privateKey:readFileSync(process.env.HOME+'/.ssh/tv_webos'),passphrase:'$PASS',
  algorithms:{serverHostKey:['ssh-rsa']}});
setTimeout(()=>process.exit(0),15000);
" 2>&1

echo ""
echo "=== Verification complete ==="
