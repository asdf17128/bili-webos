import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.MASK_VECTOR_OUTPUT||'/tmp/bili-mask-vector';mkdirSync(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
const record=(name,data={})=>{results.push({name,pass:true,...data});console.log('PASS',name);};
const uri=x=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><path fill="black" fill-rule="evenodd" d="M0 0H320V180H0Z M${x} 40H${x+40}V140H${x}Z"/></svg>`).toString('base64');
try{
 await page.routeWebSocket('**/*',s=>s.close());await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:5173'?r.continue():r.abort());await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async()=>{
  const {createDanmakuMaskVector}=await import('/src/player/danmakuMaskVector.js');
  const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;background:rgb(0,0,255);z-index:99999';document.body.appendChild(host);
  const layer=document.createElement('div');layer.style.cssText='position:absolute;left:0;top:0;width:1920px;height:1080px;background:rgb(255,0,0)';host.appendChild(layer);
  window.__vector=createDanmakuMaskVector(layer);window.__vectorLayer=layer;window.__vectorLayout={width:1920,height:1080,x:0,y:135,w:1920,h:810};
 });
 let reference=null;const observations=[];
 for(let i=0;i<12;i++){
  const result=await page.evaluate(uri=>{const source=window.__vector.prepare(uri);window.__vector.apply(source,window.__vectorLayout);const result={hasHole:source.sourceHasHole,reference:window.__vectorLayer.style.maskImage};source.dispose();return result;},uri(i%2?200:140));
  assert.equal(result.hasHole,true);if(reference===null)reference=result.reference;assert.equal(result.reference,reference);
  const png=PNG.sync.read(await page.screenshot({path:out+`/step-${i}.png`})),rgb=(x,y)=>Array.from(png.data.subarray((y*1920+x)*4,(y*1920+x)*4+3));
  assert.deepEqual(rgb(i%2?1320:960,540),[0,0,255]);assert.deepEqual(rgb(400,540),[255,0,0]);assert.deepEqual(rgb(960,50),[255,0,0]);assert.deepEqual(rgb(0,540),[255,0,0]);assert.deepEqual(rgb(i%2?1192:832,540),[0,0,255]);assert.deepEqual(rgb(i%2?1180:820,540),[255,0,0]);
  observations.push({i,reference:result.reference,hasHole:result.hasHole});
 }
 record('stable SVG reference updates continuously with alpha holes, bounded padding and intact viewport edges',{observations});
 const classifications=await page.evaluate(()=>{
  const make=s=>'data:image/svg+xml;base64,'+btoa(s);
  const inputs=[
   '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="black"/></svg>',
   '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><g transform="translate(0,180) scale(.1,-.1)" fill="black"><path d="M0 905 l0 -895 1600 0 1600 0 0 895 0 895 -1600 0 -1600 0 0 -895z"/></g></svg>',
   '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="black" fill-rule="evenodd" d="M0 0H320V180H0Z M8 8H9V9H8Z"/></svg>',
  ];
  return inputs.map(s=>{const p=window.__vector.prepare(make(s));const v={hasHole:p.sourceHasHole,ratio:p.sourceProtectedRatio};p.dispose();return v;});
 });
 assert.deepEqual(classifications,[{hasHole:false,ratio:0},{hasHole:false,ratio:0},{hasHole:null,ratio:null}]);record('opaque rect and real empty path are recognized; unsampled tiny holes remain unknown',{classifications});
 const defensive=await page.evaluate(()=>{
  const make=s=>'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">'+s+'</svg>');
  return ['<path fill="black" d="M0 0 H320 H0 V180 Z"/>','<rect width="320" height="180" fill="#0000"/>','<rect width="320" height="180" fill="#00000000"/>','<path fill="none" stroke="black" d="M0 0H320V180H0Z"/>','<polyline fill="black" points="0,0 320,0 320,180"/>','<path fill="black" d="M0 0H320V180"/>','<svg x="100" y="50" width="20" height="20" viewBox="0 0 20 20"><rect x="-500" y="-500" width="1000" height="1000" fill="black"/></svg>'].map(s=>{const p=window.__vector.prepare(make(s));const v={hasHole:p.sourceHasHole,padding:p.paddingSupported};p.dispose();return v;});
 });
 assert.ok(defensive.every(v=>v.hasHole!==false));assert.ok(defensive.slice(1).every(v=>v.padding===false));assert.equal(defensive[defensive.length-1].hasHole,null);record('degenerate paths and transparent colors cannot claim opaque protection; open or stroke-only geometry gets no padding',{defensive});
 const oldPointAPI=await page.evaluate(()=>{
  const descriptor=Object.getOwnPropertyDescriptor(SVGGeometryElement.prototype,'isPointInFill');
  try{
   Object.defineProperty(SVGGeometryElement.prototype,'isPointInFill',{configurable:true,value:undefined});
   const make=s=>'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">'+s+'</svg>');
   return ['<rect width="320" height="180" fill="black"/>','<path fill="black" fill-rule="evenodd" d="M0 0H320V180H0Z M140 40H180V140H140Z"/>'].map(s=>{const p=window.__vector.prepare(make(s));const value=p.sourceHasHole;p.dispose();return value;});
  }finally{Object.defineProperty(SVGGeometryElement.prototype,'isPointInFill',descriptor);}
 });assert.deepEqual(oldPointAPI,[false,null]);record('missing legacy point-in-fill API keeps empty-rectangle detection and classifies complex shapes as unknown',{oldPointAPI});
 const security=await page.evaluate(()=>{
  try{window.__vector.prepare('data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/a"/></svg>'));return false;}catch{return true;}
 });assert.equal(security,true);record('remote executable or external geometry remains rejected');
 if(process.env.MASK_VECTOR_FILE){
  const {maskHeader,maskIndex,decodeMaskSegment}=await import('../app/src/player/danmakuMask.js');const bytes=new Uint8Array(readFileSync(process.env.MASK_VECTOR_FILE)),index=maskIndex(bytes.subarray(0,maskHeader(bytes))),frames=decodeMaskSegment(bytes.subarray(index[0].offset,index[1]?.offset),index[0].time,index[1]?.time||Infinity).filter(f=>f.time>=3000&&f.time<4200);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  const timing=await page.evaluate(async frames=>{const times=[],intervals=[];let prior=null;for(let n=0;n<3;n++)for(const frame of frames){await new Promise(r=>requestAnimationFrame(t=>{if(prior!==null)intervals.push(t-prior);prior=t;r();}));const start=performance.now(),p=window.__vector.prepare(frame.uri);window.__vector.apply(p,window.__vectorLayout);p.dispose();window.__vectorLayer.getBoundingClientRect();times.push(performance.now()-start);}return {updates:times.length,mean:times.reduce((a,b)=>a+b)/times.length,max:Math.max(...times),frameMean:intervals.reduce((a,b)=>a+b)/intervals.length,frameMax:Math.max(...intervals)};},frames);
  assert.ok(timing.updates>20);record('real source geometry preparation and rendering under 6x CPU slowdown',{timing});
 }
 const cleanup=await page.evaluate(()=>{window.__vector.clear();const cleared=window.__vectorLayer.style.maskImage==='none';window.__vector.dispose();window.__vector.dispose();return {cleared,resources:document.querySelectorAll('[id^="bili-person-mask-"]').length};});assert.ok(cleanup.cleared);assert.equal(cleanup.resources,0);record('clear and repeated disposal release inline mask resources',{cleanup});
 assert.deepEqual(errors,[]);writeFileSync(out+'/results.json',JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
