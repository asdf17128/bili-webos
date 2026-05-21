// Deploy ipk to LG webOS TV directly via SSH
// Bypasses ares-cli Node.js compatibility issues
import { Client } from 'ssh2';
import { readFileSync, readdirSync } from 'fs';
import { basename } from 'path';
import type { ClientChannel, ConnectConfig } from 'ssh2';

const TV_HOST = process.env.TV_HOST;
const TV_PORT = process.env.TV_PORT;
const TV_USER = process.env.TV_USER;
const TV_PASS = process.env.TV_PASS;
const SSH_KEY_PATH = process.env.SSH_KEY_PATH;
// Find latest ipk in dist
const distFiles = readdirSync('dist')
  .filter((f) => f.endsWith('.ipk'))
  .sort();
const IPK_PATH =
  'dist/' +
  (distFiles[distFiles.length - 1] || 'com.biliwebos.app_1.0.0_all.ipk');
const APP_ID = 'com.biliwebos.app';
const REMOTE_DIR = '/media/developer/temp/';

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

function ssh(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect(config);
  });
}

function exec(conn: Client, cmd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '',
        stderr = '';
      const clientStream = stream as ClientChannel;
      clientStream.on('data', (d) => (stdout += d));
      clientStream.stderr.on('data', (d) => (stderr += d));
      stream.on('close', (code) => resolve({ stdout, stderr, code }));
    });
  });
}

function sftp(conn: Client): Promise<any> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function upload(
  sftpConn: any,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftpConn.fastPut(localPath, remotePath, (err) => {
      err ? reject(err) : resolve();
    });
  });
}

async function main() {
  const privateKey = readFileSync(SSH_KEY_PATH);
  const ipkFile = basename(IPK_PATH);

  console.log(`\n  Deploying ${APP_ID} to ${TV_HOST}...\n`);

  // Step 1: Connect
  console.log('  [1/4] Connecting to TV...');
  const conn = await ssh({
    host: TV_HOST,
    port: TV_PORT,
    username: TV_USER,
    privateKey,
    passphrase: TV_PASS,
    algorithms: {
      serverHostKey: ['ssh-rsa'],
    },
  });
  console.log('  Connected!');

  // Step 2: Upload IPK
  console.log('  [2/4] Uploading IPK...');
  const sftpConn = await sftp(conn);

  // Ensure temp dir exists
  try {
    await exec(conn, `mkdir -p ${REMOTE_DIR}`);
  } catch {}

  const remotePath = REMOTE_DIR + ipkFile;
  await upload(sftpConn, IPK_PATH, remotePath);
  console.log(`  Uploaded to ${remotePath}`);
  sftpConn.end();

  // Step 3: Install via luna-send
  console.log('  [3/4] Installing app...');
  const installCmd = `luna-send-pub -n 6 -f luna://com.webos.appInstallService/dev/install '{"id":"${APP_ID}","ipkUrl":"${remotePath}","subscribe":true}'`;
  const installResult = await exec(conn, installCmd);
  console.log(
    '  Install output:',
    installResult.stdout || installResult.stderr,
  );

  // Wait a moment for installation to complete
  await new Promise((r) => setTimeout(r, 3000));

  // Step 4: Launch
  console.log('  [4/4] Launching app...');
  const launchCmd = `luna-send-pub -n 1 -f luna://com.webos.service.applicationmanager/launch '{"id":"${APP_ID}"}'`;
  const launchResult = await exec(conn, launchCmd);
  console.log('  Launch output:', launchResult.stdout || launchResult.stderr);

  conn.end();
  console.log('\n  Done!\n');
}

main().catch((err) => {
  console.error('\n  Error:', err.message);
  if (err.message.includes('authentication')) {
    console.error(
      '  Key might be invalid. Re-fetch with: ares-novacom --device tv --getkey',
    );
  }
  process.exit(1);
});
