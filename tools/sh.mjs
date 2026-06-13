// Run an arbitrary shell command on the TV over SSH and print its output.
// Usage: node tools/sh.mjs "<command>" [passphrase]
import { Client } from 'ssh2';
import { readFileSync } from 'fs';

const TV = { host: '192.168.50.94', port: 9922, user: 'prisoner' };
const KEY = process.env.HOME + '/.ssh/tv_webos';
const CMD = process.argv[2] || 'echo no-command';
const PASSPHRASE = process.argv[3] || '4E7082';

const conn = new Client();
conn.on('ready', () => {
  conn.exec(CMD, (err, stream) => {
    if (err) { console.error(err.message); process.exit(1); }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => { conn.end(); process.exit(0); });
  });
}).on('error', e => { console.error('SSH error:', e.message); process.exit(1); })
  .connect({
    host: TV.host, port: TV.port, username: TV.user,
    privateKey: readFileSync(KEY), passphrase: PASSPHRASE,
    algorithms: { serverHostKey: ['ssh-rsa'] },
  });
