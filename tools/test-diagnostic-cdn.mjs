// Real React diagnostics and HTTP range requests, with signed CDN fixtures.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.DIAG_BASE_URL||'http://127.0.0.1:5173';
const output=process.env.DIAG_TEST_OUTPUT||'/tmp/bili-diagnostic-cdn';
await mkdir(output,{recursive:true});
const browser=await chromium.launch(),results=[];
for(const mode of ['backup-host','backup-signature','manual-native','all-fail']) {
 const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block'});
 await context.routeWebSocket('**/*',socket=>socket.close());
 const primary='upos-sz-mirrorcosov.bilivideo.com';
 const backup=mode==='backup-signature'?primary:'upos-sz-mirrorhwo1.bilivideo.com';
 const calls=[];
 await context.addInitScript(mode=>{
  delete window.webOS;
  localStorage.setItem('bili_settings',JSON.stringify({language:'zh',cdnRoute:mode==='manual-native'?'hwo1':'auto'}));
  localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
 },mode);
 const page=await context.newPage();page.setDefaultTimeout(7000);
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===base)return route.continue();
  if(u.port==='9528')return route.abort();
  if(u.pathname.includes('/upgcxcode/')) {
   const signed=u.pathname===`/proxy/${backup}/upgcxcode/backup.m4s`&&u.search==='?upsig=backup%2Bsignature&x=2&x=1';
   const [start,end]=(route.request().headers().range||'bytes=0-31').slice(6).split('-').map(Number);
   calls.push({signed,start,end});
   return route.fulfill({status:signed&&mode!=='all-fail'?206:403,body:Buffer.alloc(end-start+1),headers:{'content-range':`bytes ${start}-${end}/16000000`,'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range'}});
  }
  let data={};
  if(u.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(u.pathname.endsWith('/view'))data={cid:2};
  if(u.pathname.endsWith('/playurl'))data={dash:{video:[{baseUrl:`https://${primary}/upgcxcode/primary.m4s?upsig=primary-signature`,backupUrl:[`https://${backup}/upgcxcode/backup.m4s?upsig=backup%2Bsignature&x=2&x=1`]}]}};
  return route.fulfill({json:{code:0,data}});
 });
 try {
  await page.goto(base);await page.waitForFunction(()=>!!window.__openVideo);
  await page.locator('[data-focus-id="sidebar-13-0"]').click();
  await page.locator('[data-focus-id="content-9-0"]').click();
  await page.locator('.diagnostic-preview').waitFor();
  await page.locator('.diagnostic-export').click();
  await page.waitForFunction(()=>!!document.querySelector('.diagnostic-report svg'));
  const text=await page.locator('.diagnostic-panel').innerText();
  if(mode==='all-fail') {
   assert.match(text,/❌ 视频 CDN/);assert.ok(calls.length>=3);
   assert.ok(calls.every(c=>c.start===0),'failed candidates never trigger speed tests');
  } else {
   assert.match(text,mode==='manual-native'?/✅ 视频 CDN/:/⚠️ 视频 CDN/);
   assert.ok(calls.some(c=>c.signed&&c.start===0),'native backup must be probed unchanged');
   assert.equal(calls.filter(c=>c.signed&&c.start>0).length,5,'all speed requests reuse exact successful signature');
   if(mode==='manual-native')assert.ok(calls[0].signed,'manual route uses native signed URL first');
   else assert.match(text,/所选节点连不上/);
  }
  assert.doesNotMatch(text,/upsig|backup-signature|primary-signature/);
  await page.locator('.diagnostic-panel').screenshot({path:`${output}/${mode}.png`});
  results.push({name:mode,pass:true,requests:calls});console.log('PASS',mode);
 } catch(e) {results.push({name:mode,pass:false,error:e.message,requests:calls});console.log('FAIL',mode,e.message.split('\n')[0]);await page.screenshot({path:`${output}/${mode}-failed.png`});}
 finally {await context.close();}
}
await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
