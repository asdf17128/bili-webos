// Actual production service, isolated disk/Luna/upstream. ES5 so this runs on
// official Node 0.12.2 and 8 binaries as well as a modern host.
var fs = require('fs'), path = require('path'), http = require('http'), Module = require('module');
var source = path.resolve(process.argv[2] || 'service/com.biliwebos.app.service/service.js');
var dir = path.dirname(source), svc, servers = [], sockets = [], timers = [], spi = 0, plays = 0;
var disk = {'/media/internal/bili_cookies.json': JSON.stringify({SESSDATA:'fixture-session',buvid3:'blocked'})};
var upstream = http.createServer(function(req,res) {
  res.setHeader('Content-Type','application/json');
  if (req.url.indexOf('/finger/spi') >= 0) { spi++; res.setHeader('Set-Cookie',['b_nut=server-value']); res.end(JSON.stringify({code:0,data:{b_3:'repaired',b_4:'four'}})); return; }
  plays++;
  res.end(JSON.stringify(req.headers.cookie.indexOf('buvid3=repaired') >= 0 ? {code:0,data:{dash:{video:[{id:80}]}}} : {code:-351}));
});
var watchdog = setTimeout(function(){console.error('FAIL runtime deadline');process.exit(1);},12000);
function track(server) {servers.push(server);server.on('connection',function(s){sockets.push(s);});return server;}
track(upstream).listen(0,'127.0.0.1',function(){
  var m = new Module(source,module);m.filename=source;m.paths=Module._nodeModulePaths(dir);
  var realRequire=m.require.bind(m);
  function Service(){svc=this;this.methods={};this.activityManager={create:function(){}};}
  Service.prototype.register=function(name,fn){this.methods[name]=fn;};
  m.require=function(name){
    if(name==='webos-service')return Service;
    if(name==='https')return {Agent:http.Agent,request:function(opts,cb){opts.hostname='127.0.0.1';opts.port=upstream.address().port;return http.request(opts,cb);}};
    if(name==='http'){var fake={};Object.keys(http).forEach(function(k){fake[k]=http[k];});fake.createServer=function(fn){var s=track(http.createServer(fn)),listen=s.listen;s.listen=function(){return listen.call(s,0,'127.0.0.1');};return s;};return fake;}
    if(name==='fs')return {existsSync:function(p){return !!disk[p];},readFileSync:function(p){if(!disk[p])throw Error('missing fixture');return disk[p];},writeFileSync:function(p,v){disk[p]=v;}};
    if(name==='./cast/ssdpServer')return {CastLanServer:function(){this.start=function(){};}};
    if(name==='./danmaku')return {};
    return realRequire(name);
  };
  m._compile(fs.readFileSync(source,'utf8'),source);
  function finish(err){clearTimeout(watchdog);sockets.forEach(function(s){s.destroy();});servers.forEach(function(s){s.close();});console.log(err?'FAIL '+err:'PASS risk recovery, cookie persistence and cooldown on '+process.version);process.exit(err?1:0);}
  svc.methods.fetch({payload:{url:'https://api.bilibili.com/x/player/playurl?cid=1'},respond:function(r){
    try {
      if(!r.returnValue||JSON.parse(r.body).code!==0||spi!==1||plays!==2)throw Error('recovery');
      var cookies=JSON.parse(disk['/media/internal/bili_cookies.json']);
      if(cookies.SESSDATA!=='fixture-session'||cookies.b_nut!=='server-value'||cookies.buvid3!=='repaired')throw Error('cookies');
      svc.methods.resetDeviceIdentity({respond:function(r){finish(r.returnValue?'cooldown bypassed':null);}});
    }catch(e){finish(e.message);}
  }});
});
