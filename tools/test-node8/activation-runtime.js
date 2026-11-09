// Real old-runtime filesystem/crypto smoke; isolated temporary data, no network.
'use strict';
var fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert');
var root=path.join(os.tmpdir(),'bili-activation-'+process.pid+'-'+crypto.randomBytes(4).toString('hex'));
fs.mkdirSync(root);
var jar={buvid3:'fixture-three',buvid4:'fixture-four',SESSDATA:'fixture-only'},epoch=0;
var profile={ua:'fixture actual environment',platform:'Linux',language:'zh-CN',timezone:'Asia/Shanghai',width:1920,height:1080,availWidth:1920,availHeight:1080,depth:24,cores:4,offset:-480};
try {
 delete profile.timezone;delete profile.cores;
 var a=require('./deviceActivation').create({fs:fs,stateFile:path.join(root,'state'),cookieFile:path.join(root,'cookies'),getCookies:function(){return jar},generation:function(){return 0},identity:function(){return epoch},blocked:function(){return false},commit:function(next){jar=next;epoch++},send:function(c,p,body,done){assert.strictEqual(c.SESSDATA,undefined);assert.ok(body.df35);done(null,0)}});
 var complete=false;
 a.run(profile,function(err){assert.ifError(err);complete=true});
 assert.ok(complete);assert.strictEqual(a.status().state,'accepted');assert.ok(jar._uuid);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'cookies'),'utf8')),jar);
 a.run(profile,function(err){assert.ok(err);assert.ok(/cooldown/.test(err.message))});
 console.log('activation atomic persistence OK on '+process.version);
} finally {fs.readdirSync(root).forEach(function(name){fs.unlinkSync(path.join(root,name))});fs.rmdirSync(root)}
