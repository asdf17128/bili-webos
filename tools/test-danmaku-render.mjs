// The real React/CSS layer under a 6x CPU throttle; media decoding is separate.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output=process.env.DANMAKU_OUTPUT||'/tmp/bili-danmaku';
const baseURL=process.env.DANMAKU_BASE_URL||'http://127.0.0.1:5173';
const viteOrigin=new URL(baseURL).origin;
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1920,height:1080},serviceWorkers:'block'});
await page.routeWebSocket('**/*',socket=>socket.close());
await page.route('**/*',route=>new URL(route.request().url()).origin===viteOrigin?route.continue():route.abort());
await page.goto(baseURL);
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
await test('fixed, reverse and colored types respect filters and area bounds',async()=>{
 await page.evaluate(()=>window.__draw({fontScale:1.6,mtRef:null,settings:{danmakuArea:.25,danmakuOpacity:.5,danmakuOutline:0,danmakuWeight:700},danmakus:[{time:2,mode:5,text:'top'},{time:2,mode:4,text:'bottom'},{time:2,mode:6,text:'reverse'}],currentTime:2}));
 assert.equal(await page.locator('.danmaku-fixed').count(),2);
 const rows=await page.locator('.danmaku-item').evaluateAll(es=>es.map(e=>({top:parseFloat(e.style.top),height:e.offsetHeight,opacity:e.style.opacity,weight:e.style.fontWeight,shadow:e.style.textShadow})));
 assert.ok(rows.every(r=>r.top+r.height<=255 && r.opacity==='0.5' && r.weight==='700' && r.shadow==='none'),JSON.stringify(rows));
 await page.evaluate(()=>window.__draw({fontScale:1,settings:{danmakuTop:false,danmakuBottom:false,danmakuColor:false},danmakus:[{time:2,mode:5,text:'top'},{time:2,mode:4,text:'bottom'},{time:2,mode:1,color:'#ff0000',text:'color'},{time:2,mode:6,text:'reverse'},{time:2,mode:7,text:'advanced'}]}));
 assert.deepEqual(await page.locator('.danmaku-item').allTextContents(),['reverse']);
 assert.equal(await page.locator('.danmaku-reverse').count(),1);
});
await test('density caps and speed are applied; invalid options fall back safely',async()=>{
 const counts=[];
 for(const density of [12,24,48]){
  counts.push(await page.evaluate(async density=>{
   const list=Array.from({length:300},(_,i)=>({time:i/100,text:'短'}));
   await window.__draw({settings:{danmakuDensity:density},danmakus:list,currentTime:0});
   for(let t=.5;t<3;t+=.5){await new Promise(r=>setTimeout(r,500));await window.__draw({currentTime:t});}
   return document.querySelectorAll('.danmaku-item').length;
  },density));
 }
 assert.deepEqual(counts,[12,24,48]);
 const durations=[];
 for(const speed of [.75,1.5]){
  await page.evaluate(speed=>window.__draw({settings:{danmakuSpeed:speed},danmakus:[{time:1,text:'same'}],currentTime:1}),speed);
  durations.push(await page.locator('.danmaku-item').evaluate(e=>parseFloat(e.style.animationDuration)));
 }
 assert.ok(Math.abs(durations[0]/durations[1]-2)<.001);
 await page.evaluate(()=>window.__draw({fontScale:Infinity,settings:{danmakuArea:-2,danmakuDensity:99999},danmakus:[{time:1,text:'safe'}],currentTime:1}));
 assert.equal(await page.locator('.danmaku-item').evaluate(e=>e.style.fontSize),'28px');
});
await test('lane spacing uses animation time rather than accelerated media time',async()=>{
 await page.evaluate(()=>window.__draw({fontScale:1,settings:{danmakuDensity:48},danmakus:[...Array.from({length:15},()=>({time:0,text:'long enough to occupy lane'})),...Array.from({length:15},()=>({time:1,text:'next'}))],currentTime:0}));
 const first=await page.locator('.danmaku-item').count();assert.equal(first,15);
 await page.evaluate(()=>window.__draw({currentTime:1}));
 assert.equal(await page.locator('.danmaku-item').count(),first,'a media-time jump must not free lanes before the text has moved');
});
await test('live overlay shares appearance and clears lanes on toggle',async()=>{
 await page.evaluate(async()=>{
  const {default:React}=await import('/node_modules/.vite/deps/react.js');
  const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {default:Live}=await import('/src/player/LiveDanmakuLayer.jsx');
  const host=document.createElement('div');host.id='live-fixture';document.body.appendChild(host);
  const root=createRoot(host),ref=React.createRef();
  window.__liveDraw=async enabled=>{root.render(React.createElement(Live,{ref,enabled,settings:{danmakuScale:1.6,danmakuArea:.25,danmakuOpacity:.25,danmakuDensity:12}}));await new Promise(r=>setTimeout(r,100));};
  window.__liveRef=ref;await window.__liveDraw(true);
  for(let i=0;i<100;i++)ref.current.push('live '+i);
 });
 const nodes=await page.locator('#live-fixture .danmaku-item').evaluateAll(es=>es.map(e=>({size:e.style.fontSize,opacity:e.style.opacity,top:parseFloat(e.style.top),height:e.offsetHeight})));
 assert.ok(nodes.length>0 && nodes.length<=12);assert.ok(nodes.every(n=>n.size==='45px'&&n.opacity==='0.25'&&n.top+n.height<=255));
 await page.evaluate(async()=>{await window.__liveDraw(false);await window.__liveDraw(true);window.__liveRef.current.push('fresh');});
 assert.deepEqual(await page.locator('#live-fixture .danmaku-item').allTextContents(),['fresh']);
});
await test('segment boundary updates preserve active nodes and stable IDs',async()=>{
 await page.evaluate(()=>window.__draw({fontScale:1,preserveOnAppend:true,settings:{},danmakus:[{id:'previous',time:359.8,text:'keep me'}],currentTime:359.8}));
 await page.evaluate(()=>{window.__kept=document.querySelector('.danmaku-item');});
 await page.evaluate(()=>window.__draw({danmakus:[{id:'previous',time:359.8,text:'keep me'},{id:'next',time:360.1,text:'next'}],currentTime:360.1}));
 assert.ok(await page.evaluate(()=>window.__kept.isConnected));
 assert.equal((await page.locator('.danmaku-item').allTextContents()).filter(x=>x==='keep me').length,1);
 await page.evaluate(()=>window.__draw({preserveOnAppend:false,enabled:false}));
});
await writeFile(output+'/results.json',JSON.stringify({cpuThrottle:6,results},null,2));
await browser.close();if(results.some(x=>x.pass===false))process.exitCode=1;
