// Runs against an isolated Vite server. Every non-app request is intercepted;
// no real account, TV, GitHub issue, telemetry receiver or CDN is contacted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import qrcode from '../app/node_modules/qrcode-generator/qrcode.js';
import { diagnosticReportText, diagnosticIssueUrl, DIAGNOSTIC_STAGES } from '../app/src/utils/diagnosticReport.js';
const base = process.env.DIAG_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.DIAG_TEST_OUTPUT || '/tmp/bili-diagnostic-privacy';
await mkdir(output,{recursive:true});
const browser = await chromium.launch();
const results = [];
const secret = 'PRIVATE_USER_93 SESSDATA=cookie-secret token=signed-secret 192.168.7.18 2001:db8::12 BV1privateTitle';
const modes = (process.env.DIAG_FILTER || 'risk351,risk352,voucher,empty,offline,healthy,english,spanish').split(',');
for (const mode of modes) {
  const context = await browser.newContext({viewport:{width:1920,height:1080}});
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const requests = [];
  await context.addInitScript(mode=>{
    delete window.webOS;
    localStorage.setItem('bili_settings',JSON.stringify({language:mode==='english'?'en':mode==='spanish'?'es':'zh',cdnRoute:'auto'}));
    localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
  },mode);
  await page.route('**/*',async route=>{
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    requests.push({host:u.hostname,path:u.pathname,method:route.request().method(),containsReport:decodeURIComponent(route.request().url()).includes('diag=1') || (route.request().postData() || '').includes('diag=1')});
    if (u.port === '9528') return route.abort();
    if (mode === 'offline' && u.port === '9527') return route.abort();
    if (u.pathname.includes('/upgcxcode/')) {
      const [start,end] = (route.request().headers().range || 'bytes=0-31').slice(6).split('-').map(Number);
      return route.fulfill({status:206,body:Buffer.alloc(end-start+1),headers:{'content-range':`bytes ${start}-${end}/16000000`,'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range'}});
    }
    let code=0,data={};
    if (u.pathname.endsWith('/nav')) data={uname:secret,mid:123456789,isLogin:true,wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
    if (u.pathname.endsWith('/view')) data={cid:2,title:secret,bvid:'BV1privateTitle'};
    if (u.pathname.endsWith('/playurl')) {
      if (mode==='risk351'||mode==='risk352') code=mode==='risk351'?-351:-352;
      else if(mode==='voucher') data={v_voucher:secret};
      else if(mode==='empty') data={};
      else data={dash:{video:[{baseUrl:'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/private.m4s?token=signed-secret'}]}};
    }
    return route.fulfill({json:{code,data,message:secret}});
  });
  try {
    await page.goto(base); await page.waitForFunction(()=>!!window.__openVideo);
    // Inject an existing local error buffer and startup trace with deliberately
    // sensitive fields: the UI/report boundary, not a regex scrubber, must drop them.
    await page.evaluate(async secret=>{
      const errors=await import('/src/utils/errlog.js'); errors.logErr('api:'+secret,'HTTP 403 '+secret);
      const health=await import('/src/player/playbackHealth.js');
      health.startPlaybackReport('auto')({host:'192.168.7.18',title:secret,quality:80,startup:{state:'failed',elapsedMs:170,retries:1,stages:{url:{ms:80,count:2,errors:1,code:-351,hasStream:false,voucher:false,detail:secret}},points:{},hosts:{request:secret}}});
    },secret);
    await page.locator('[data-focus-id="sidebar-13-0"]').click();
    await page.locator('[data-focus-id="content-9-0"]').click();
    const preview=page.locator('.diagnostic-preview'); await preview.waitFor();
    assert.equal(await page.locator('.diagnostic-report svg').count(),0,'QR stays hidden until a user action');
    const text=await preview.innerText();
    assert.match(text,/stage url code=-351 hasStream=no voucher=no ms=80 attempts=2 errors=1/);
    assert.doesNotMatch(await page.locator('.diagnostic-panel').innerText(),/PRIVATE_USER|SESSDATA|cookie-secret|signed-secret|192\.168|2001:db8|BV1privateTitle/);
    if (mode.startsWith('risk')) {
      assert.match(text,new RegExp('\\[fail\\] playurl code=-'+mode.slice(4)));
      assert.match(text,/\[skip\] cdn reason=no_stream/);
      assert.doesNotMatch(text,/\[fail\] cdn|reason=no_cid/);
    } else if (mode==='voucher'||mode==='empty') {
      assert.match(text,/\[fail\] playurl code=0 hasStream=no/);
      assert.match(text,new RegExp('reason='+(mode==='voucher'?'verification_required':'no_stream')));
      assert.match(text,/\[skip\] cdn reason=no_stream/);
    } else if(mode==='offline') {
      assert.match(text,/\[fail\] api reason=network/);
      assert.match(text,/\[skip\] playurl reason=no_cid/);
      assert.match(text,/\[skip\] cdn reason=no_stream/);
    } else {
      assert.match(text,/\[ok\] playurl code=0 hasStream=yes/);
      assert.match(text,/\[ok\] cdn/);
    }
    // Trusted remote-style input reaches the new adjacent action from diagnostics.
    await page.locator('[data-focus-id="content-9-0"]').hover();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>window.__focusState().current==='content-9-1');
    await page.keyboard.press('Enter');
    await page.locator('.diagnostic-report svg').waitFor();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(()=>window.__focusState().current==='content-9-0');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>window.__focusState().current==='content-9-1');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.diagnostic-report svg').count(),0,'remote can hide the export');
    await page.keyboard.press('Enter');
    await page.locator('.diagnostic-report svg').waitFor();
    const png=PNG.sync.read(await page.locator('.diagnostic-report svg').screenshot());
    const qr=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
    assert.ok(qr,'QR decodes from browser pixels');
    const url=new URL(qr.data);
    assert.equal(url.origin,'https://github.com'); assert.equal(url.pathname,'/asdf17128/bili-webos/issues/new');
    assert.equal(url.searchParams.get('body'),text,'preview is exactly what scanning exports');
    assert.match(text,/^[\x20-\x7e\n]*$/);
    assert.ok(text.length<=1800);
    assert.equal(requests.filter(r=>r.host==='github.com' || r.containsReport || r.method!=='GET').length,0,'neither preview nor QR generation sends the report');
    await page.locator('.diagnostic-panel').screenshot({path:`${output}/${mode}-export.png`});
    await page.locator('.diagnostic-export').click();
    assert.equal(await page.locator('.diagnostic-report svg').count(),0,'pointer can hide the export');
    await page.locator('.diagnostic-panel').screenshot({path:`${output}/${mode}.png`});
    await writeFile(`${output}/${mode}.txt`,text+'\n');
    results.push({mode,pass:true,reportBytes:text.length,qrDecoded:true}); console.log('PASS',mode);
  } catch(error) {
    results.push({mode,pass:false,error:error.message}); console.log('FAIL',mode,error.message);
    await page.screenshot({path:`${output}/${mode}-failed.png`});
  } finally {await context.close();}
}
// Capacity regression: populate every permitted field, including the longest
// valid build label and all startup stages. Decode actual 3px/module SVG pixels
// exactly as DiagPanel renders them, not just the library's data matrix.
if (!process.env.DIAG_FILTER) {
  const page = await browser.newPage({viewport:{width:1920,height:1080}});
  try {
    const fields={code:'ECONNREFUSED',reason:'verification_required',hasStream:false,voucher:true,ms:3600000,retries:9999,attempts:9999,errors:9999};
    const input={version:'999.999.99999 abcdefghijklmnopqrstuvwx.9999',chromeMajor:999,nodeVersion:'999.999.99999',platform:'browser',route:'cosov',
      checks:DIAGNOSTIC_STAGES.map(stage=>({stage,status:'fail',...fields})),
      startup:{state:'cancelled',elapsedMs:3600000,retries:9999,stages:Object.fromEntries(['engine','attach','view','resume','url','probe','load'].map(stage=>[stage,{...fields,count:9999}]))},
      errors:[{code:'ECONNREFUSED',d:'network'},{code:'ETIMEDOUT',d:'timeout'},{code:403,d:'HTTP 403'},{code:-100000,d:'unknown'}]};
    const body=diagnosticReportText(input), url=diagnosticIssueUrl(input);
    assert.ok(body.length<=1800); assert.match(body,/truncated=1/);
    assert.match(body,/^[\x20-\x7e\n]*$/);
    const qr=qrcode(0,'L'); qr.addData(url); qr.make();
    await page.setContent(qr.createSvgTag({cellSize:3,margin:12}));
    const bytes=await page.locator('svg').screenshot({path:output+'/maximum-report-qr.png'});
    const png=PNG.sync.read(bytes), decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
    assert.equal(decoded?.data,url,'maximum allowed report decodes without overflow');
    assert.equal(new URL(decoded.data).searchParams.get('body'),body);
    results.push({mode:'maximum-report',pass:true,reportBytes:body.length,urlBytes:url.length,qrPixels:png.width,qrDecoded:true});
    console.log('PASS maximum-report',body.length,'body bytes,',url.length,'URL bytes');
  } catch(error) {
    results.push({mode:'maximum-report',pass:false,error:error.message}); console.log('FAIL maximum-report',error.message);
  } finally {await page.close();}
}
await browser.close(); await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
