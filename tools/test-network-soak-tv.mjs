// Bounded real TV playback/API endurance test. Restores original settings;
// no account list writes, ordinary playback history still updates.
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { connectTv, sleep } from './_tv-stability.mjs';

const minutes = Number(process.env.SOAK_MINUTES || 25);
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error('SOAK_MINUTES must be 1..120');
const minWidth = Number(process.env.SOAK_MIN_WIDTH || 1), minHeight = Number(process.env.SOAK_MIN_HEIGHT || 1);
if (![minWidth,minHeight].every(n=>Number.isInteger(n)&&n>0)) throw new Error('Invalid minimum dimensions');
const codec = process.env.SOAK_CODEC || '';
if (!['', 'hevc', 'avc', 'av1'].includes(codec)) throw new Error('SOAK_CODEC must be hevc, avc or av1');
const codecPattern = {hevc:/^(hvc1|hev1)/i,avc:/^avc/i,av1:/^av01/i}[codec];
const minFps=Number(process.env.SOAK_MIN_FPS||0);
if(!Number.isFinite(minFps)||minFps<0)throw new Error('Invalid minimum frame rate');
const sampleVideo = { bvid: process.env.SOAK_BVID || 'BV1xx411c7Xg', resumeMode: 'none' };
if (!/^BV[a-zA-Z0-9]+$/.test(sampleVideo.bvid)) throw new Error('Invalid SOAK_BVID');
if (process.env.SOAK_CID) {
  sampleVideo.cid = Number(process.env.SOAK_CID);
  if (!Number.isSafeInteger(sampleVideo.cid) || sampleVideo.cid < 1) throw new Error('Invalid SOAK_CID');
}
const output = process.env.UX_OUTPUT || '/tmp/bili-network-soak-tv';

// Decode only inside the page. The returned body stays local; exported
// metadata contains status, length and a fixed format/category, never text.
function inspectServiceResponse(result) {
  const status = Number.isInteger(result?.status) ? result.status : null;
  let text;
  try {
    text = result?.body == null ? atob(result?.bodyBase64 || '') : result.body;
  } catch {
    return { meta: { failed: true, status, bodyLength: null, bodyFormat: 'invalid-base64', errorCategory: 'response_encoding' } };
  }
  if (typeof text !== 'string') return { meta: { failed: true, status, bodyLength: null, bodyFormat: 'non-text', errorCategory: 'response_type' } };
  // bodyLength counts decoded JavaScript string code units, not wire bytes.
  const meta = { status, bodyLength: text.length, bodyFormat: 'json' };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { meta: { ...meta, failed: true, errorCategory: 'json_shape' } };
    return { body, meta };
  } catch {
    return { meta: { ...meta, failed: true, bodyFormat: text.trim() ? 'non-json' : 'empty', errorCategory: 'json_parse' } };
  }
}

function safeServiceFailure(result) {
  const text = [result?.errorText, result?.error, result?.message].filter(value => typeof value === 'string').join(' ');
  const errorCategory = /EAI_AGAIN|ENOTFOUND/.test(text) ? 'dns'
    : /timeout|timed out/i.test(text) ? 'timeout'
    : /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i.test(text) ? 'connection'
    : /certificate|CERT_|\bTLS\b|\bSSL\b/i.test(text) ? 'tls'
    : /abort|cancel/i.test(text) ? 'cancelled' : 'service_error';
  return { failed: true, status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: Number.isFinite(result?.errorCode) ? result.errorCode : null, errorCategory };
}

// Numeric observations only. Closures own every listener, timer and observer.
// This exact page function can be extracted for offline fault-path tests.
function installSoakMonitor(marker) {
  if (window.__soak) throw new Error('A soak monitor already exists');
  const video = document.querySelector('video');
  if (!video) throw new Error('No video to monitor');
  const start = Date.now(), finite = value => Number.isFinite(value) && value >= 0 ? value : null;
  const state = { marker, lastTime: video.currentTime, lastAdvance: start, lastTick: start, longestGap: 0,
    ends: 0, longTasks: 0, longTaskMs: 0, maxTaskMs: 0, longTasksSupported: false,
    gaps: [], gapsTruncated: 0, events: [], segments: [], counterResets: 0, openGap: null };
  let timer, observer, previousCounters, previousEnds = 0;
  const snapshot = () => {
    const stats = window.__shakaPlayer?.getStats();
    let buffer = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) buffer = video.buffered.end(i) - video.currentTime;
    return { atMs: Date.now() - start, mediaTime: video.currentTime, ready: video.readyState, paused: video.paused,
      seeking: video.seeking, error: video.error?.code || null, bufferSec: buffer,
      decoded: finite(stats?.decodedFrames), dropped: finite(stats?.droppedFrames) };
  };
  const recordGap = (now, gapMs, tickMs, current, advancing) => {
    if (!state.openGap) {
      const gap = { startedAtMs: state.lastAdvance - start, durationMs: gapMs, timerIntervalMs: tickMs,
        start: current, end: null, completed: false, events: state.events.slice(-8) };
      if (state.gaps.length < 2000) state.gaps.push(gap); else state.gapsTruncated++;
      state.openGap = gap;
    }
    Object.assign(state.openGap, { durationMs: gapMs, timerIntervalMs: Math.max(state.openGap.timerIntervalMs, tickMs), end: current, completed: advancing });
    if (advancing) state.openGap = null;
  };
  const poll = () => {
    const now = Date.now(), current = snapshot(), tickMs = now - state.lastTick;
    const advancing = current.mediaTime !== state.lastTime, gapMs = now - state.lastAdvance;
    state.longestGap = Math.max(state.longestGap, gapMs);
    if (gapMs > 3000 || state.openGap) recordGap(now, gapMs, tickMs, current, advancing);
    const reset = previousCounters && ['decoded', 'dropped'].some(key => current[key] !== null && previousCounters[key] !== null && current[key] < previousCounters[key]);
    const loop = advancing && current.mediaTime + 0.25 < state.lastTime && state.ends > previousEnds;
    if (!state.segments.length || reset || loop) {
      state.segments.push({ index: state.segments.length, reason: reset ? 'counter-reset' : loop ? 'natural-loop' : 'start',
        startedAtMs: current.atMs, startMediaTime: current.mediaTime, decodedDelta: current.decoded === null ? null : 0,
        droppedDelta: current.dropped === null ? null : 0, counterUnavailable: current.decoded === null || current.dropped === null });
      if (reset) state.counterResets++;
    }
    const segment = state.segments[state.segments.length - 1];
    if (previousCounters) for (const key of ['decoded', 'dropped']) {
      const deltaKey = key + 'Delta';
      if (current[key] === null || previousCounters[key] === null) { segment.counterUnavailable = true; continue; }
      // Sum differences, not raw cumulative counters. After an actual reset,
      // the observed new count belongs to the newly opened segment.
      const delta = current[key] >= previousCounters[key] ? current[key] - previousCounters[key] : current[key];
      segment[deltaKey] = (segment[deltaKey] ?? 0) + delta;
    }
    Object.assign(segment, { endedAtMs: current.atMs, endMediaTime: current.mediaTime, decodedRaw: current.decoded, droppedRaw: current.dropped });
    previousCounters = current; if (reset || loop) previousEnds = state.ends;
    if (advancing) { state.lastTime = current.mediaTime; state.lastAdvance = now; }
    state.lastTick = now;
  };
  const onEvent = event => {
    if (event.type === 'ended') state.ends++;
    state.events.push({ type: event.type, ...snapshot() });
    if (state.events.length > 20) state.events.shift();
  };
  const names = ['ended', 'waiting', 'stalled', 'error', 'seeking', 'seeked', 'playing', 'pause'];
  for (const name of names) video.addEventListener(name, onEvent);
  try {
    if (window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver(list => list.getEntries().forEach(entry => {
        state.longTasks++; state.longTaskMs += entry.duration; state.maxTaskMs = Math.max(state.maxTaskMs, entry.duration);
      }));
      observer.observe({ entryTypes: ['longtask'] }); state.longTasksSupported = true;
    }
  } catch { observer?.disconnect(); observer = null; }
  state.read = () => {
    poll();
    return { ends: state.ends, longestGap: state.longestGap, gaps: state.gaps, gapsTruncated: state.gapsTruncated,
      segments: state.segments, counterResets: state.counterResets, longTasksSupported: state.longTasksSupported,
      longTasks: state.longTasksSupported ? state.longTasks : null, longTaskMs: state.longTasksSupported ? state.longTaskMs : null,
      maxTaskMs: state.longTasksSupported ? state.maxTaskMs : null };
  };
  state.clean = () => {
    clearInterval(timer); observer?.disconnect();
    for (const name of names) video.removeEventListener(name, onEvent);
    if (window.__soak === state) delete window.__soak;
    return { removed: window.__soak !== state, listenersRemoved: names.length };
  };
  window.__soak = state; poll(); timer = setInterval(poll, 1000);
  return true;
}

mkdirSync(output, { recursive: true });
const results = [];
const run = { startedAt: new Date().toISOString(), requestedMinutes: minutes, expectedSamples: minutes + 1,
  config: { sampleVideo, minWidth, minHeight, codec, minFps }, completedSamples: 0,
  limits: ['Progress gaps include JS timer scheduling; >3s intervals require inspection.',
    'Frame counters are per playback segment and exclude physical panel/audio validation.',
    'Unavailable counters remain null; this test does not measure GPU/process memory.'] };
const save = () => {
  writeFileSync(`${output}/device.json`, JSON.stringify(results, null, 2) + '\n');
  writeFileSync(`${output}/run.json`, JSON.stringify(run, null, 2) + '\n');
};
let tv, originalSettings, stopReason = null, documentMarker, monitorRequested = false;
const stop = reason => { if (!stopReason) { stopReason = reason; run.stopReason = reason; save(); } };
const onInterrupt = () => stop('SIGINT'), onTerminate = () => stop('SIGTERM');
process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
// Cancellation is cooperative: every CDP command is bounded, and every exit
// still reaches independent monitor/settings/player cleanup below.
const overall = setTimeout(() => stop('suite watchdog expired'), (minutes + 2) * 60000);
const ensureRunning = () => { if (stopReason) throw new Error('Incomplete soak: ' + stopReason); };
const sleepUntil = async deadline => {
  while (Date.now() < deadline) { ensureRunning(); await sleep(Math.min(1000, deadline - Date.now())); }
  ensureRunning();
};
const check = (name, condition, detail, fatal = true) => {
  results.push({ name, pass: !!condition, detail }); console.log(condition ? 'PASS' : 'FAIL', name, detail || ''); save();
  if (fatal) assert.ok(condition, name);
};
try {
  tv = await connectTv();
  const { call, evaluate, wait } = tv;
  ensureRunning();
  originalSettings = await evaluate('localStorage.getItem("bili_settings")');
  try {
    await evaluate(`localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),playbackMode:'repeat',quality:120,qualityMode:'manual'}))`);
    await evaluate('window.__soakOldDocument=true');
    await call('Page.reload'); await wait('!window.__soakOldDocument && !!window.__openVideo');
    documentMarker = 'stability-soak-' + Date.now();
    await evaluate(`window.__soakDocument=${JSON.stringify(documentMarker)}`);
    await evaluate('window.__openVideo('+JSON.stringify(sampleVideo)+')');
    await wait("document.querySelector('video')?.currentTime>0.5 && document.querySelector('video').readyState>=2",40000);
    monitorRequested = true;
    await evaluate(`(${installSoakMonitor.toString()})(${JSON.stringify(documentMarker)})`);
    const started=Date.now();run.observationStartedAt=new Date(started).toISOString();let previousUptime=0,initialService=null;
    for(let n=0;n<=minutes;n++){
      if(n)await sleepUntil(started+n*60000);
      ensureRunning();
      const sample=await evaluate(`(async () => {
        const inspectResponse=${inspectServiceResponse.toString()},sanitizeFailure=${safeServiceFailure.toString()};
        const request=(method,parameters)=>new Promise(resolve=>{
          const start=Date.now();let handle,done=false;
          const finish=r=>{if(done)return;done=true;clearTimeout(timer);resolve({...r,ms:Date.now()-start});};
          const timer=setTimeout(()=>{let cancelFailed=false;try{handle?.cancel?.()}catch{cancelFailed=true}finish({timeout:true,errorCategory:'probe_timeout',cancelFailed});},15000);
          try{handle=window.webOS.service.request('luna://com.biliwebos.app.service/',{method,parameters,
            onFailure:r=>finish(sanitizeFailure(r)),onSuccess:r=>{
              if(method==='getDiagnostics')return finish({uptime:r.uptimeSec,observedAt:Date.now(),node:r.nodeVersion,dnsErrors:(r.recentErrors||[]).filter(e=>/EAI_AGAIN|ENOTFOUND/.test(e.d||'')).length,readRetries:(r.recentErrors||[]).filter(e=>/^retry:/.test(e.tag||'')).length,requestErrors:(r.recentErrors||[]).filter(e=>/^req:/.test(e.tag||'')).length});
              const {body:b,meta}=inspectResponse(r);if(!b)return finish(meta);
              finish({...meta,code:b.code,version:b.version,...(parameters?.url==='https://api.bilibili.com/x/web-interface/nav'?{account:{loggedIn:b.data?.isLogin===true,vip:b.data?.vipStatus===1||b.data?.vip?.status===1}}:{})});
            }});}catch(error){finish(sanitizeFailure(error));}
        });
        const apis=await Promise.all([
          request('fetch',{url:'https://api.bilibili.com/x/web-interface/nav'}),
          request('fetch',{url:'https://api.live.bilibili.com/room/v1/Area/getList'}),
          request('fetch',{url:'https://github.com/asdf17128/bili-webos/releases/latest/download/version.json'})
        ]);
        const service=await request('getDiagnostics',{}),v=document.querySelector('video'),s=window.__soak.read();
        const stats=window.__shakaPlayer?.getStats(),track=window.__shakaPlayer?.getVariantTracks()?.find(t=>t.active);
        let buffer=0;for(let i=0;v&&i<v.buffered.length;i++)if(v.currentTime>=v.buffered.start(i)&&v.currentTime<=v.buffered.end(i))buffer=v.buffered.end(i)-v.currentTime;
        const performanceSample={heapBytes:performance.memory?.usedJSHeapSize??null,decodedFrames:Number.isFinite(stats?.decodedFrames)?stats.decodedFrames:null,droppedFrames:Number.isFinite(stats?.droppedFrames)?stats.droppedFrames:null,frameSegments:s.segments,counterResets:s.counterResets,gapsOver3s:s.gaps,gapsTruncated:s.gapsTruncated,bufferSec:buffer,codec:track?.videoCodec,frameRate:track?.frameRate,bandwidth:track?.bandwidth,longTasksSupported:s.longTasksSupported,longTasks:s.longTasks,longTaskMs:s.longTaskMs,maxTaskMs:s.maxTaskMs};
        return {document:window.__soakDocument,apis,service,performance:performanceSample,t:v?.currentTime,duration:v?.duration,mediaError:v?.error?.code||null,ready:v?.readyState,paused:v?.paused,width:v?.videoWidth,height:v?.videoHeight,
          ends:s.ends,longestGap:s.longestGap};
      })()`,35000);
      try { const heap = await call('Runtime.getHeapUsage'); sample.performance.cdpHeapBytes = heap.usedSize; } catch (error) { sample.performance.cdpHeapBytes = null; sample.performance.cdpHeapError = error.message; }
      sample.minute=n; sample.elapsedMs=Date.now()-started; sample.targetElapsedMs=n*60000; sample.samplingDelayMs=sample.elapsedMs-n*60000;
      sample.uncaughtErrors=tv.errors.length;
      sample.playbackHealthy = !tv.errors.length && sample.document===documentMarker && sample.width>=minWidth && sample.height>=minHeight && (!minFps||sample.performance.frameRate>=minFps) && (!codecPattern || codecPattern.test(sample.performance.codec||'')) && !sample.mediaError && sample.ready>=2 && !sample.paused && sample.longestGap<15000;
      if (!initialService && Number.isFinite(sample.service.uptime)) initialService=sample.service;
      sample.serviceEpochDriftMs=initialService&&Number.isFinite(sample.service.uptime)?
        Math.abs((sample.service.observedAt-sample.service.uptime*1000)-(initialService.observedAt-initialService.uptime*1000)):null;
      const uptimeToleranceMs=Math.max(2000,(sample.service.ms||0)+(initialService?.ms||0)+1000);
      sample.serviceHealthy=sample.service.uptime>previousUptime&&sample.serviceEpochDriftMs!==null&&sample.serviceEpochDriftMs<=uptimeToleranceMs;
      sample.uptimeToleranceMs=uptimeToleranceMs;
      sample.biliHealthy = sample.apis.slice(0,2).every(a=>a.status===200 && a.code===0);
      sample.updateHealthy = sample.apis[2].status===200 && !!sample.apis[2].version;
      check('continuous playback and APIs minute '+n,sample.playbackHealthy &&
        sample.apis.every((a,i)=>a.status===200 && (i===2?!!a.version:a.code===0)) && sample.serviceHealthy,sample,false);
      previousUptime=sample.service.uptime || previousUptime;
      run.completedSamples++; run.elapsedMs=sample.elapsedMs; save();
    }
    ensureRunning();
    const finalMonitor=await evaluate('window.__soak.read()');
    run.monitor=finalMonitor;
    run.gapsRequiringReview=finalMonitor.gaps.length;
    run.frameCountersComplete=finalMonitor.segments.length>0&&finalMonitor.segments.every(segment=>!segment.counterUnavailable);
    run.newDroppedFrames=run.frameCountersComplete?finalMonitor.segments.reduce((sum,segment)=>sum+segment.droppedDelta,0):null;
    run.newDecodedFrames=run.frameCountersComplete?finalMonitor.segments.reduce((sum,segment)=>sum+segment.decodedDelta,0):null;
    // These are investigation triggers agreed by the plan, not an assertion
    // that every scheduling gap represents a physical frame freeze.
    run.investigationRequired=[];
    if(finalMonitor.gaps.length)run.investigationRequired.push('progress gaps over 3 seconds; inspect timer delays, buffer and media events');
    if(!run.frameCountersComplete)run.investigationRequired.push('frame counters unavailable for at least one segment');
    else {
      if(run.newDroppedFrames>0)run.investigationRequired.push('new dropped frames; inspect individual playback segments');
      if(run.newDecodedFrames===0)run.investigationRequired.push('decode counter did not advance; time progression alone cannot establish decoded frames');
    }
    check('all progress gap evidence retained',finalMonitor.gapsTruncated===0,{gaps:finalMonitor.gaps.length,truncated:finalMonitor.gapsTruncated},false);
    check('requested wall-clock duration and every minute sample completed', run.completedSamples === minutes + 1 &&
      Date.now() - started >= minutes * 60000, { expectedSamples: minutes + 1, completedSamples: run.completedSamples,
        expectedMs: minutes * 60000, elapsedMs: Date.now() - started });
  } finally {
    // Each cleanup is independent: a failed observation cannot skip settings
    // restoration or the normal Back path. No page reload hides resource state.
    if (monitorRequested) {
      try {
        const cleaned = await evaluate(`window.__soak?.marker===${JSON.stringify(documentMarker)} ? window.__soak.clean() : {notOwned:true}`);
        check('soak monitor listeners timers and globals removed', cleaned?.removed === true, cleaned, false);
      } catch (error) { check('soak monitor cleanup', false, error.message, false); }
    }
    if (originalSettings !== undefined) {
      try {
        await evaluate(originalSettings == null ? 'localStorage.removeItem("bili_settings")' : `localStorage.setItem('bili_settings',${JSON.stringify(originalSettings)})`);
        check('original settings restored', await evaluate('localStorage.getItem("bili_settings")') === originalSettings, null, false);
      } catch (error) { check('original settings restored', false, error.message, false); }
    }
    try {
      await tv.back();
      const idle=await evaluate(`({video:!!document.querySelector('video'),sameDocument:window.__soakDocument===${JSON.stringify(documentMarker)}})`);
      check('player closed without reloading document', !idle.video&&idle.sameDocument, idle, false);
    } catch (error) { check('player closed without reloading document', false, error.message, false); }
    try {
      const removed=await evaluate(`(()=>{if(window.__soakDocument===${JSON.stringify(documentMarker)})delete window.__soakDocument;delete window.__soakOldDocument;return !window.__soakDocument&&!window.__soakOldDocument})()`);
      check('owned document markers removed',removed,null,false);
    } catch (error) { check('owned document markers removed',false,error.message,false); }
  }
} catch (error) {
  check('completion', false, error.message, false);
} finally {
  clearTimeout(overall);
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
  tv?.close();
  run.finishedAt = new Date().toISOString(); run.stopReason = stopReason;
  run.gatesPassed = !stopReason && run.completedSamples === minutes + 1 && results.length > 0 && results.every(row => row.pass);
  run.pass=run.gatesPassed&&!(run.investigationRequired?.length);
  run.status=run.pass?'PASS':run.gatesPassed?'NEEDS_REVIEW':'FAIL';
  if(run.investigationRequired?.length)console.log('NEEDS_REVIEW',JSON.stringify(run.investigationRequired));
  save();
  if (!run.pass) process.exitCode = 1;
}
