import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityPreference, requestedQuality } from './qualityPreference.js';
import { membership } from './membership.js';
import { selectVideoRepresentation } from '../player/mediaSelection.js';
test('new installs and unmarked legacy default request the full ladder',()=>{
 for(const settings of [{},{quality:80},{quality:'auto'},{quality:null},{quality:'bad'}])assert.equal(requestedQuality(qualityPreference(settings)),127);
});
test('explicit new 1080p and old nondefault preferences remain manual',()=>{
 assert.equal(qualityPreference({quality:80,qualityMode:'manual'}),80);
 assert.equal(qualityPreference({quality:64}),64);assert.equal(qualityPreference({quality:126}),126);
 assert.equal(qualityPreference({quality:80,qualityMode:'auto'}),'auto');
});
test('automatic highest respects device resolution and offered account tiers',()=>{
 const rep=(id,width,height)=>({id,width,height,codecs:'hvc1.1.6.L153.90',baseUrl:'https://fixture/video'});
 const options={allowFallback:true,maxResolution:{width:4096,height:2160},isTypeSupported:()=>true};
 assert.equal(selectVideoRepresentation({video:[rep(127,7680,4320),rep(126,3840,2160),rep(120,3840,2160)]},undefined,options).actualQn,126);
 assert.equal(selectVideoRepresentation({video:[rep(80,1920,1080)]},undefined,options).actualQn,80);
});
test('membership uses current active status, type, expiry and login',()=>{
 assert.equal(membership({isLogin:true,vipStatus:1,vipType:1}),'active');
 assert.equal(membership({isLogin:true,vip:{status:1,type:2,due_date:200}},100),'annual');
 for(const data of [{isLogin:false,vipStatus:1,vipType:2},{isLogin:true,vipStatus:0,vipType:2},{isLogin:true,vipStatus:1,vipType:0},{isLogin:true,vip:{status:1,type:2,due_date:50}}])assert.equal(membership(data,100),null);
});
