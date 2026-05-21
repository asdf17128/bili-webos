// Remote debug: connect to TV's Chrome DevTools via SSH tunnel
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';
import type { RawData } from 'ws';

const TV_HOST = process.env.TV_HOST;
const TV_PORT = process.env.TV_PORT;
const TV_USER = process.env.TV_USER;
const TV_PASS = process.env.TV_PASS;
const SSH_KEY_PATH = process.env.SSH_KEY_PATH;

const TV = { host: TV_HOST, port: TV_PORT, user: TV_USER };
const REMOTE_DEBUG_PORT = 9998;
const LOCAL_PORT = 19998;

type DevtoolsPage = {
  title?: string;
  url?: string;
  webSocketDebuggerUrl: string;
};

async function main() {
  console.log('Connecting to TV...');
  const conn = new Client();

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: TV.host,
      port: TV.port,
      username: TV.user,
      privateKey: readFileSync(SSH_KEY_PATH),
      passphrase: TV_PASS,
      algorithms: { serverHostKey: ['ssh-rsa'] },
    });
  });
  console.log('SSH connected.');

  // Create local TCP server that tunnels to remote debug port
  const server = net.createServer((localSocket) => {
    conn.forwardOut(
      '127.0.0.1',
      LOCAL_PORT,
      '127.0.0.1',
      REMOTE_DEBUG_PORT,
      (err, remoteStream) => {
        if (err) {
          localSocket.end();
          return;
        }
        localSocket.pipe(remoteStream).pipe(localSocket);
      },
    );
  });

  await new Promise<void>((resolve) =>
    server.listen(LOCAL_PORT, '127.0.0.1', () => resolve()),
  );
  console.log(`Tunnel: localhost:${LOCAL_PORT} -> TV:${REMOTE_DEBUG_PORT}`);

  // Fetch DevTools JSON
  const pages = await fetchJSON<DevtoolsPage[]>(
    `http://127.0.0.1:${LOCAL_PORT}/json`,
  );
  console.log('\n=== Pages ===');
  pages.forEach((p, i) => {
    console.log(`[${i}] ${p.title}`);
    console.log(`    ${p.url}`);
    console.log(`    ws: ${p.webSocketDebuggerUrl}`);
  });

  // Connect to the app's WebSocket for console logs
  const appPage = pages.find(
    (p) => p.url?.includes('biliwebos') || p.title?.includes('哔哩'),
  );
  if (!appPage) {
    console.log('\nApp not found in pages. Listed all above.');
    await cleanup();
    return;
  }

  console.log(`\nConnecting to: ${appPage.title}`);
  // Replace remote host with local tunnel
  const wsUrl = appPage.webSocketDebuggerUrl.replace(
    /127\.0\.0\.1:\d+/,
    `127.0.0.1:${LOCAL_PORT}`,
  );

  const { WebSocket } = await import('ws').catch(() => {
    console.log('\nInstalling ws...');
    return import('child_process').then((cp) => {
      cp.execSync('bun add ws', { cwd: process.cwd(), stdio: 'pipe' });
      return import('ws');
    });
  });

  const ws = new WebSocket(wsUrl);
  let msgId = 1;

  ws.on('open', () => {
    console.log('WebSocket connected. Capturing console + performance...\n');

    // Enable console
    ws.send(JSON.stringify({ id: msgId++, method: 'Console.enable' }));
    // Enable runtime for errors
    ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable' }));
    // Get performance metrics
    ws.send(JSON.stringify({ id: msgId++, method: 'Performance.enable' }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({ id: msgId++, method: 'Performance.getMetrics' }),
      );
    }, 2000);

    // Also evaluate some diagnostics
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          id: 100,
          method: 'Runtime.evaluate',
          params: {
            expression: `JSON.stringify({
          focusRegistry: document.querySelectorAll('[data-focus-id]').length,
          domNodes: document.querySelectorAll('*').length,
          images: document.querySelectorAll('img').length,
          body: document.body?.children?.length,
        })`,
          },
        }),
      );
    }, 3000);
  });

  ws.on('message', (data: RawData) => {
    const msg = JSON.parse(data.toString());

    if (msg.method === 'Console.messageAdded') {
      const m = msg.params?.message;
      console.log(`[console.${m?.level}] ${m?.text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const ex = msg.params?.exceptionDetails;
      console.log(`[ERROR] ${ex?.text} ${ex?.exception?.description || ''}`);
    }
    if (msg.id === 100) {
      console.log('\n=== App Diagnostics ===');
      try {
        const info = JSON.parse(msg.result?.result?.value);
        console.log(`  Focus elements: ${info.focusRegistry}`);
        console.log(`  DOM nodes: ${info.domNodes}`);
        console.log(`  Images: ${info.images}`);
      } catch {
        console.log('  Raw:', msg.result?.result?.value);
      }
    }
    if (msg.result?.metrics) {
      console.log('\n=== Performance Metrics ===');
      msg.result.metrics.forEach((m) => {
        if (
          [
            'JSHeapUsedSize',
            'JSHeapTotalSize',
            'Nodes',
            'LayoutCount',
            'RecalcStyleCount',
            'TaskDuration',
          ].includes(m.name)
        ) {
          const val = m.name.includes('Heap')
            ? (m.value / 1048576).toFixed(1) + ' MB'
            : m.value;
          console.log(`  ${m.name}: ${val}`);
        }
      });
    }
  });

  // Run for 15 seconds
  console.log('Listening for 60 seconds...\n');
  await new Promise((r) => setTimeout(r, 60000));

  ws.close();
  await cleanup();

  async function cleanup() {
    server.close();
    conn.end();
    process.exit(0);
  }
}

function fetchJSON<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch {
            reject(new Error('Bad JSON: ' + d.slice(0, 200)));
          }
        });
      })
      .on('error', reject);
  });
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
