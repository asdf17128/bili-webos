// Wake the TV via Wake-on-LAN magic packet. Usage: node tools/wake.mjs
import dgram from 'dgram';
const mac = '14:7f:67:a1:6b:56';
const b = mac.split(':').map(h => parseInt(h, 16));
const m = Buffer.alloc(102);
for (let i = 0; i < 6; i++) m[i] = 0xff;
for (let i = 0; i < 16; i++) for (let j = 0; j < 6; j++) m[6 + i * 6 + j] = b[j];
const s = dgram.createSocket('udp4');
s.bind(() => {
  s.setBroadcast(true);
  let n = 0;
  for (const t of ['255.255.255.255', '192.168.50.255'])
    for (const p of [9, 7])
      s.send(m, 0, m.length, p, t, () => { if (++n === 4) { console.log('magic packets sent'); s.close(); } });
});
