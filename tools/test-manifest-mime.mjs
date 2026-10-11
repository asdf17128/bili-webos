// Real Shaka networking + browser Blob handling, no fake decoder or CDN.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<video></video>');
  await page.addScriptTag({ path: 'app/node_modules/shaka-player/dist/shaka-player.compiled.js' });
  const rows = await page.evaluate(async () => {
    shaka.polyfill.installAll();
    const rows = [];
    for (const explicit of [false, true]) {
      const player = new shaka.Player();
      await player.attach(document.querySelector('video'));
      player.configure({ manifest: { retryParameters: { maxAttempts: 4, baseDelay: 150, backoffFactor: 1, fuzzFactor: 0, timeout: 3000 } } });
      const row = { explicit, requests: [], retries: [] }, start = performance.now();
      const ne = player.getNetworkingEngine();
      ne.registerRequestFilter((type, request) => row.requests.push({type,method:request.method,scheme:request.uris[0].split(':')[0]}));
      ne.addEventListener('retry', e => row.retries.push({code:e.error.code,scheme:String(e.error.data[0]).split(':')[0]}));
      const url = URL.createObjectURL(new Blob(['<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period/></MPD>'], {type:'application/dash+xml'}));
      // Empty period is intentional: parsing gets an identical terminal error
      // in both arms, so only the preceding MIME discovery differs.
      try { await player.load(url, undefined, explicit ? 'application/dash+xml' : undefined); }
      catch (e) { row.error = e.code; }
      row.ms = Math.round(performance.now()-start);
      URL.revokeObjectURL(url); await player.destroy(); rows.push(row);
    }
    return rows;
  });
  console.log(JSON.stringify(rows,null,2));
  if(process.env.MIME_OUTPUT)await writeFile(process.env.MIME_OUTPUT,JSON.stringify(rows,null,2)+'\n');
  assert.equal(rows[0].retries.length,4);
  assert.ok(rows[0].retries.every(x=>x.scheme==='blob'));
  assert.ok(rows[0].requests.some(x=>x.method==='HEAD'));
  assert.equal(rows[1].retries.length,0);
  assert.ok(!rows[1].requests.some(x=>x.method==='HEAD'));
  assert.ok(rows[0].error && rows[0].error===rows[1].error,'both paths reach the same manifest parser');
  console.log('PASS real Blob MIME detection: 4 failed HEAD attempts -> 0 with explicit DASH type');
} finally { await browser.close(); }
