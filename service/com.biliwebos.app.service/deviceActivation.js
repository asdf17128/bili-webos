'use strict';
var crypto = require('crypto');
function profile(p) {
  if (!p || typeof p !== 'object') return null;
  var out = {}, strings = {ua:512,platform:80,language:40,timezone:80};
  for (var k in strings) { if (typeof p[k] !== 'string' || !p[k] || p[k].length > strings[k] || /[\r\n\x00]/.test(p[k])) return null; out[k]=p[k]; }
  var limits={width:[1,16384],height:[1,16384],availWidth:[1,16384],availHeight:[1,16384],depth:[1,64],cores:[1,256],offset:[-840,840]};
  for (k in limits) { if(typeof p[k]!=='number'||!isFinite(p[k])||Math.floor(p[k])!==p[k]||p[k]<limits[k][0]||p[k]>limits[k][1])return null;out[k]=p[k]; }
  return out;
}
function atomic(fs,file,value) {
  var tmp=file+'.activation-tmp',fd;
  try { fd=fs.openSync(tmp,'wx',384);var bytes=Buffer.from(JSON.stringify(value)),offset=0;while(offset<bytes.length){var written=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(!written)throw new Error('Short write');offset+=written;}fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file); }
  catch(e){if(fd!=null)try{fs.closeSync(fd)}catch(ignore){};try{fs.unlinkSync(tmp)}catch(ignore){};throw e;}
}
exports.profile=profile;
exports.create=function(o){
  var busy=false,listeners=[],attempt=0,state='idle';
  try{attempt=Number(JSON.parse(o.fs.readFileSync(o.stateFile,'utf8')).attempt)||0;}catch(ignore){}
  var now=o.now||Date.now;
  function cooldown(){return Math.max(0,Math.min(300,Math.ceil((attempt+300000-now())/1000)));}
  function status(){return {busy:busy,state:state,cooldownSec:cooldown()};}
  return {status:status,run:function(raw,done){
    var p=profile(raw);if(!p){done(new Error('Activation profile unavailable'));return;}
    if(busy){listeners.push(done);return;}
    if(o.blocked()){done(new Error('Device identity repair in progress'));return;}
    if(cooldown()){done(new Error('Activation cooldown'));return;}
    var current=o.getCookies(),generation=o.generation(),identity=o.identity();
    if(!current.buvid3||!current.buvid4){done(new Error('Activation identity unavailable'));return;}
    var uuid=typeof current._uuid==='string'&&/^[A-Za-z0-9-]{20,100}$/.test(current._uuid)?current._uuid:
      crypto.randomBytes(4).toString('hex')+'-'+crypto.randomBytes(2).toString('hex')+'-'+crypto.randomBytes(2).toString('hex')+'-'+crypto.randomBytes(2).toString('hex')+'-'+crypto.randomBytes(6).toString('hex')+('00000'+String(now()%100000)).slice(-5)+'infoc';
    attempt=now();try{atomic(o.fs,o.stateFile,{attempt:attempt});}catch(e){state='persistence';done(new Error('Activation persistence failed'));return;}
    busy=true;state='pending';listeners=[done];
    var payload={df35:uuid,'39c8':'333.1007.fp.risk','5062':now(),'3c43':{b8ce:p.ua,adca:p.platform,'07a4':p.language,'5766':p.depth,'748e':[p.height,p.width],d61f:[p.availHeight,p.availWidth],fc9d:p.offset,'6aa9':p.timezone,'0bd0':p.cores}};
    // No login cookie, fabricated buvid_fp/b_nut or fixed desktop fingerprint.
    var cookies={buvid3:current.buvid3,buvid4:current.buvid4,_uuid:uuid};
    var settled=false,cancel=null;
    var timer=setTimeout(function(){finish(new Error('Activation timeout'));if(cancel)cancel();},o.timeoutMs||9000);
    function finish(err,code){
      if(settled)return;settled=true;clearTimeout(timer);
      if(generation!==o.generation()||identity!==o.identity())err=new Error('Account session changed');
      if(!err&&code!==0)err=new Error('Activation rejected');
      if(!err){
        var next={},latest=o.getCookies();Object.keys(latest).forEach(function(k){next[k]=latest[k]});next._uuid=uuid;
        try{atomic(o.fs,o.cookieFile,next);o.commit(next);state='accepted';}catch(e){err=new Error('Activation persistence failed');}
      }
      if(err)state=/session changed/.test(err.message)?'session_changed':/persist/.test(err.message)?'persistence':/timeout/.test(err.message)?'timeout':'failed';
      busy=false;var callbacks=listeners;listeners=[];callbacks.forEach(function(cb){try{cb(err)}catch(ignore){}});
    }
    try{cancel=o.send(cookies,p,payload,finish);}catch(e){finish(new Error('Activation request failed'));}
  }};
};
