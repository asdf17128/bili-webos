// List CDP page titles on the TV (tells us which app is in the foreground).
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import http from 'http';
import net from 'net';
const c = new Client();
c.on('ready', () => {
  const srv = net.createServer(s => c.forwardOut('127.0.0.1', 0, '127.0.0.1', 9998, (e, rs) => {
    if (e) { s.end(); return; } s.pipe(rs).pipe(s);
  }));
  srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    http.get(`http://127.0.0.1:${port}/json`, r => {
      let d = ''; r.on('data', x => d += x);
      r.on('end', () => {
        try { console.log(JSON.stringify(JSON.parse(d).map(p => p.title))); }
        catch (e) { console.log('[]'); }
        srv.close(); c.end(); process.exit(0);
      });
    }).on('error', () => { console.log('[]'); process.exit(0); });
  });
}).on('error', () => { console.log('ERR'); process.exit(0); })
  .connect({ host: '192.168.50.94', port: 9922, username: 'prisoner',
    privateKey: readFileSync(process.env.HOME + '/.ssh/tv_webos'), passphrase: '4E7082' });
