// @ts-nocheck
// Take a screenshot from the TV app via CDP over SSH tunnel
import { Client } from 'ssh2';
import { readFileSync, writeFileSync } from 'fs';
import http from 'http';
import net from 'net';
import { WebSocket } from 'ws';

const TV_HOST = process.env.TV_HOST;
const TV_PORT = process.env.TV_PORT;
const TV_USER = process.env.TV_USER;
const TV_PASS = process.env.TV_PASS;
const SSH_KEY_PATH = process.env.SSH_KEY_PATH;

const OUT = process.argv[3] || 'screenshot.png';

const conn = new Client();
conn.on('ready', () => {
  const server = net.createServer((s) => {
    conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (err, rs) => {
      if (err) {
        s.end();
        return;
      }
      s.pipe(rs).pipe(s);
    });
  });
  server.listen(19998, '127.0.0.1', () => {
    http.get('http://127.0.0.1:19998/json', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        const app = JSON.parse(d).find((p) => p.title?.includes('哔哩'));
        if (!app) {
          console.log('App not running');
          process.exit(1);
        }
        const ws = new WebSocket(
          app.webSocketDebuggerUrl.replace(
            /127\.0\.0\.1:\d+/,
            '127.0.0.1:19998',
          ),
        );
        ws.on('open', () => {
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                id: 1,
                method: 'Page.captureScreenshot',
                params: { format: 'png' },
              }),
            );
          }, 500);
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.id === 1 && msg.result?.data) {
            writeFileSync(OUT, Buffer.from(msg.result.data, 'base64'));
            console.log(`Screenshot saved: ${OUT}`);
            ws.close();
            server.close();
            conn.end();
          }
        });
      });
    });
  });
});
conn.connect({
  host: TV_HOST,
  port: TV_PORT,
  username: TV_USER,
  privateKey: readFileSync(SSH_KEY_PATH),
  passphrase: TV_PASS,
  algorithms: { serverHostKey: ['ssh-rsa'] },
});
setTimeout(() => process.exit(0), 10000);
