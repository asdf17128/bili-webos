import assert from 'node:assert/strict';
import {serviceFixture} from './fixtures/service-session.mjs';
const profile={ua:'Mozilla/5.0 Web0S',platform:'Linux x86_64',language:'zh-Hans-CN',timezone:'Asia/Shanghai',width:1920,height:1080,availWidth:1920,availHeight:1080,depth:24,cores:4,offset:-480};
for(const mode of ['success','reject','logout','diagnostic','concurrent','disk','switch']){
 let activations=0,plays=0,accepted=false;
 const f=await serviceFixture({upstreamReply(req,res){
  if(req.url.includes('ExClimbWuzhi')){activations++;assert.ok(!req.headers.cookie.includes('SESSDATA'));assert.equal(req.headers['user-agent'],profile.ua);let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.equal(JSON.parse(JSON.parse(body).payload)['3c43'].adca,profile.platform);accepted=mode!=='reject';res.end(JSON.stringify({code:accepted?0:-1}))});return true;}
  if(req.url.includes('playurl')){plays++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:0,data:accepted?{dash:{video:[{baseUrl:'https://fixture.invalid'}]}}:{v_voucher:'secret'}}));return true;}
 }});
 try{
  await f.call('setCookies',{cookies:{buvid4:'fixture-four'}});
  const fetch=()=>f.call('fetch',{url:'https://api.bilibili.com/x/player/wbi/playurl?cid=1',deviceEnvironment:profile,diagnostic:mode==='diagnostic'});
  if(mode==='disk')f.state.failSave=true;
  if(mode==='logout'||mode==='switch')f.state.hold='ExClimbWuzhi';
  const pending=mode==='concurrent'?Promise.all([fetch(),fetch(),fetch()]):fetch();
  if(mode==='logout'||mode==='switch'){for(let i=0;i<100&&!f.state.held.length;i++)await new Promise(r=>setTimeout(r,10));assert.equal(f.state.held.length,1);if(mode==='logout')await f.call('clearCookies');else await f.call('setCookies',{cookies:{SESSDATA:'new-account'}});f.release();}
  await pending;
  const cookies=(await f.call('getCookies')).cookies,status=(await f.call('getDiagnostics')).activation;
  if(mode==='success'||mode==='concurrent'){assert.equal(activations,1);assert.ok(cookies._uuid);assert.equal(cookies.SESSDATA,'fixture-session');assert.equal(status.state,'accepted');}
  else {assert.equal(cookies._uuid,undefined);assert.equal(plays,1);}
  if(mode==='diagnostic')assert.equal(activations,0);
  if(mode==='switch')assert.equal(cookies.SESSDATA,'new-account');
  if(mode==='logout')assert.equal(cookies.SESSDATA,undefined);
  if(mode==='reject'){await fetch();assert.equal(activations,1);}
  console.log('PASS activation '+mode);
 }finally{f.release();await f.close()}
}
