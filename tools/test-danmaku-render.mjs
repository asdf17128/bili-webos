// The real React/CSS layer under a 6x CPU throttle; media decoding is separate.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output=process.env.DANMAKU_OUTPUT||'/tmp/bili-danmaku';
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1920,height:1080}});
await page.route('**/*',route=>new URL(route.request().url()).port==='5173'?route.continue():route.abort());
await page.goto('http://127.0.0.1:5173');
await page.waitForFunction(()=>!!window.__openVideo);
const cdp=await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
await page.evaluate(async()=>{
 const {default:React}=await import('/node_modules/.vite/deps/react.js');
 const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
 const {default:Layer}=await import('/src/player/DanmakuLayer.jsx');
 const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;background:#242424;z-index:99999';document.body.appendChild(host);
 const root=createRoot(host);window.__dmHost=host;window.__reads=0;
 window.__list=Array.from({length:100000},(_,i)=>({get time(){window.__reads++;return i/10},text:'弹幕 '+i,mode:1}));
 window.__props={danmakus:window.__list,currentTime:3500,enabled:true};
 window.__draw=async patch=>{Object.assign(window.__props,patch);root.render(React.createElement(Layer,window.__props));await new Promise(r=>setTimeout(r,120));};
});
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}}
await test('late-video lookup has bounded work',async()=>{
 await page.evaluate(()=>window.__draw({}));
 const reads=await page.evaluate(()=>window.__reads);results.push({measurement:'time field reads at 3500s / 100000 comments',value:reads});
 assert.ok(reads<200,'time reads='+reads);
});
await test('dense comments have a bounded number of animation layers',async()=>{
 const max=await page.evaluate(async()=>{
   const list=Array.from({length:10000},(_,i)=>({time:i/500,text:'密集弹幕 '+i,mode:1}));
   let max=0;
   for(let t=0;t<7;t+=.5){await window.__draw({danmakus:list,currentTime:t});max=Math.max(max,document.querySelectorAll('.danmaku-item').length);}
   return max;
 });results.push({measurement:'peak animated nodes',value:max});assert.ok(max<=24,'animated nodes='+max);
});
await test('forward seek clears the old screen and backward seek replays',async()=>{
 await page.evaluate(()=>window.__draw({danmakus:[{time:1,text:'开头'},{time:100,text:'后段'}],currentTime:1}));
 assert.equal(await page.locator('.danmaku-item').first().textContent(),'开头');
 await page.evaluate(()=>window.__draw({currentTime:100}));
 assert.deepEqual(await page.locator('.danmaku-item').allTextContents(),['后段']);
 await page.evaluate(()=>window.__draw({currentTime:1}));
 assert.deepEqual(await page.locator('.danmaku-item').allTextContents(),['开头']);
});
await test('paused animations freeze and resume; hidden layer resets',async()=>{
 await page.evaluate(()=>window.__draw({paused:true}));
 assert.equal(await page.locator('.danmaku-item').first().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
 await page.evaluate(()=>window.__draw({paused:false}));
 assert.equal(await page.locator('.danmaku-item').first().evaluate(el=>getComputedStyle(el).animationPlayState),'running');
 await page.evaluate(()=>window.__draw({enabled:false}));assert.equal(await page.locator('.danmaku-item').count(),0);
 await page.evaluate(()=>window.__draw({enabled:true}));assert.equal(await page.locator('.danmaku-item').count(),1);
});
await test('translation retries preserve original indices and do not flash Chinese',async()=>{
 await page.evaluate(()=>{window.__translated=false;return window.__draw({danmakus:[{time:0,text:'过去'},{time:1,text:'中文'}],currentTime:1,mtRef:{current:{get:i=>window.__translated?'Translated '+i:null}}});});
 assert.equal(await page.locator('.danmaku-item').count(),0);
 await page.evaluate(()=>{window.__translated=true;return window.__draw({currentTime:1.1});});
 assert.deepEqual(await page.locator('.danmaku-item').allTextContents(),['Translated 1']);
});
await test('font scales, animation cleanup and repeat render do not duplicate',async()=>{
 await page.evaluate(()=>window.__draw({fontScale:1.6,mtRef:null,danmakus:[{time:2,text:'大字号弹幕',size:28}],currentTime:2}));
 assert.equal(await page.locator('.danmaku-item').first().evaluate(el=>getComputedStyle(el).fontSize),'45px');
 await page.evaluate(()=>window.__draw({currentTime:2.1}));assert.equal(await page.locator('.danmaku-item').count(),1);
 await page.waitForTimeout(1600);
 await page.screenshot({path:output+'/danmaku.png'});
 await page.locator('.danmaku-item').evaluateAll(els=>els.forEach(el=>{el.style.animationDuration='0.02s';}));
 await page.waitForFunction(()=>document.querySelectorAll('.danmaku-item').length===0);
 assert.equal(await page.locator('.danmaku-item').count(),0);
});
await writeFile(output+'/results.json',JSON.stringify({cpuThrottle:6,results},null,2));
await browser.close();if(results.some(x=>x.pass===false))process.exitCode=1;
