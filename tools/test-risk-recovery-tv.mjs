// Physical panel visibility must be confirmed separately by the user. This
// checks TV runtime + real SPI/manual repair; it cannot manufacture Bili risk.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectTv} from './_tv-stability.mjs';
const out=process.env.RISK_TV_OUTPUT||'/tmp/bili-risk-tv';mkdirSync(out,{recursive:true});
const tv=await connectTv(),results=[];let saved;
const check=(name,pass,detail)=>{results.push({name,pass,detail});assert(pass,name)};
try{
 saved=await tv.evaluate("localStorage.getItem('bili_settings')");
 await tv.back();
 await tv.evaluate(`window.__identityTestBefore=new Promise((r,j)=>webOS.service.request('luna://com.biliwebos.app.service/',{method:'getCookies',onSuccess:x=>r(x.cookies),onFailure:j}))`);
 await tv.evaluate("document.querySelector('[data-focus-id=\"sidebar-13-0\"]').click()");
 await tv.wait("!!document.querySelector('.config-page')");await tv.key('ArrowRight');
 for(let i=0;i<18;i++){if(await tv.evaluate("document.querySelector('.settings-row.focused')?.textContent.includes('重置设备标识')"))break;await tv.key('ArrowDown')}
 check('remote reaches reset row',await tv.evaluate("!!document.querySelector('.settings-row.focused')?.textContent.includes('重置设备标识')"));
 await tv.key('Enter');await tv.wait("/已重置|操作过于频繁|重置失败/.test(document.querySelector('.settings-row.focused')?.textContent||'')",15000);
 const label=await tv.evaluate("document.querySelector('.settings-row.focused').innerText");
 check('real reset completes',label.includes('已重置'),label);
 const account=await tv.evaluate(`(async()=>{const before=await window.__identityTestBefore;const after=await new Promise((r,j)=>webOS.service.request('luna://com.biliwebos.app.service/',{method:'getCookies',onSuccess:x=>r(x.cookies),onFailure:j}));return {sessionPreserved:!!before.SESSDATA&&before.SESSDATA===after.SESSDATA,identityPresent:!!after.buvid3,identityChanged:before.buvid3!==after.buvid3,clientMatches:JSON.parse(localStorage.getItem('bili_auth')||'{}').buvid3===after.buvid3}})()`);
 check('reset preserves account and syncs frontend identity',account.sessionPreserved&&account.identityPresent&&account.clientMatches,account);
 await tv.key('Enter');await tv.wait("document.querySelector('.settings-row.focused')?.textContent.includes('5 分钟')",10000);check('manual repeat is rate limited',true);
 await tv.evaluate("window.__appStorage.setSettings({...window.__appStorage.getSettings(),quality:'auto',qualityMode:'auto',playbackMode:'stop'});window.__openVideo({bvid:'BV1SSQLBREVV',cid:37534502406,resumeMode:'none'})");
 await tv.wait("document.querySelector('video')?.currentTime>3&&document.querySelector('video')?.videoWidth===3840",60000);
 const media=await tv.evaluate("(()=>{const v=document.querySelector('video'),t=window.__shakaPlayer?.getVariantTracks().find(t=>t.active);return {time:v.currentTime,width:v.videoWidth,height:v.videoHeight,video:t?.videoCodec,audio:t?.audioCodec,error:v.error?.code||null}})()");
 check('premium 4K plays after real identity reset',media.width===3840&&!media.error,media);
 await tv.wait(`document.querySelector('video')?.currentTime>${media.time+4}`,15000);check('playback continues after reset',true);
}catch(e){results.push({name:'completion',pass:false,error:e.message});process.exitCode=1}
finally{
 try{await tv.back()}catch(e){results.push({name:'exit',pass:false,error:e.message});process.exitCode=1}
 try{if(saved!==undefined)await tv.evaluate(`${saved===null?"localStorage.removeItem('bili_settings')":`localStorage.setItem('bili_settings',${JSON.stringify(saved)})`};delete window.__identityTestBefore;`)}catch(e){results.push({name:'restore',pass:false,error:e.message});process.exitCode=1}
 tv.close();writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
