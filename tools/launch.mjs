// Launch an app on the TV via the PUBLIC luna bus (prisoner has no private-bus
// access; luna-send is denied, luna-send-pub works). Usage: node tools/launch.mjs <appId>
import { Client } from 'ssh2'; import { readFileSync } from 'fs';
const appId = process.argv[2] || 'com.biliwebos.app';
const c = new Client();
c.on('ready', () => {
  c.exec(`luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{"id":"${appId}"}'`, (e, s) => {
    if (e) { console.error('exec err'); process.exit(1); }
    let o = ''; s.on('data', d => o += d); s.stderr.on('data', d => o += d);
    s.on('close', () => { console.log(o.trim()); c.end(); process.exit(0); });
  });
});
c.connect({ host: '192.168.50.94', port: 9922, username: 'prisoner', privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'), passphrase: '4E7082', algorithms: { serverHostKey: ['ssh-rsa'] } });
