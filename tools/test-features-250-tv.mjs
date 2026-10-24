// Real TV navigation and read-only feature checks. Never submits feedback,
// repairs identity, or changes login/settings. Screenshots remain local.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';

const output = process.env.TV_OUTPUT || '/tmp/bili-features-250-tv';
mkdirSync(output, { recursive: true });
const results = [];
const tv = await connectTv();
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  assert.ok(pass, name); console.log('PASS', name);
};
const screenshot = async name => {
  const shot = await tv.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${output}/${name}.png`, Buffer.from(shot.data, 'base64'));
};
async function navigate(label) {
  await tv.back();
  if (!await tv.evaluate("window.__focusState().current?.startsWith('sidebar-')")) await tv.key('GoBack');
  for (let i = 0; i < 20; i++) {
    if (await tv.evaluate(`document.querySelector('.sidebar-item.focused .sidebar-label')?.textContent===${JSON.stringify(label)}`)) {
      await tv.key('Enter'); return;
    }
    await tv.key('ArrowDown');
  }
  throw new Error('Sidebar target not reached');
}
async function choose(selector, label) {
  for (let i = 0; i < 18; i++) {
    if (await tv.evaluate(`document.querySelector(${JSON.stringify(selector + '.focused')})?.textContent.trim()===${JSON.stringify(label)}`)) {
      await tv.key('Enter'); return;
    }
    await tv.key('ArrowDown');
  }
  throw new Error('Action not reached');
}
try {
  // Refuse accidental account writes even if an assertion or key sequence is
  // wrong. Only the method/path classification is retained, never payloads.
  await tv.evaluate(`(() => {
    if (window.__feature250Guard) throw Error('Feature guard already installed');
    const original=webOS.service.request;
    const guard={blocked:0,original};
    guard.wrapper=function(uri,options){
      const p=options?.parameters||{};
      if (/repairDeviceIdentity|resetDeviceIdentity|setCookies|clearCookies/.test(options?.method||'') ||
          String(p.url||'').includes('/feedback/dislike')) {
        guard.blocked++; throw Error('Read-only TV test blocked a write');
      }
      return original.apply(this,arguments);
    };
    webOS.service.request=guard.wrapper;window.__feature250Guard=guard;
  })()`);
  await navigate('设置');
  await tv.wait("document.querySelectorAll('.settings-row').length>10");
  for (let i = 0; i < 18 && !await tv.evaluate("document.querySelector('.settings-row.focused span')?.textContent==='账号修复'"); i++) await tv.key('ArrowDown');
  check('account repair reachable by remote', await tv.evaluate("document.querySelector('.settings-row.focused span')?.textContent==='账号修复'"));
  await tv.key('Enter'); await tv.wait("!!document.querySelector('.account-repair-dialog')");
  await tv.key('Enter');
  await tv.wait("document.querySelector('.account-repair-result')?.textContent.includes('账号检查完成')", 20000);
  check('real service account check completes', await tv.evaluate("document.querySelector('.account-repair-result')?.textContent.includes('登录状态：有效')"));
  await choose('.account-repair-action', '重建设备标识');
  check('repair confirmation defaults to Cancel and states five-minute cooldown', await tv.evaluate("document.querySelector('.account-repair-action.focused')?.textContent==='取消' && document.querySelector('.account-repair-dialog').textContent.includes('五分钟')"));
  await screenshot('repair-confirmation');
  await tv.key('GoBack'); await tv.key('GoBack');
  await tv.wait("!document.querySelector('.account-repair-dialog')");
  await navigate('推荐');
  await tv.wait("document.querySelectorAll('.video-grid .video-card').length>0");
  for (let i = 0; i < 5 && !await tv.evaluate("!!document.querySelector('.video-grid .video-card.focused')"); i++) await tv.key('ArrowDown');
  check('recommendation card focused', await tv.evaluate("!!document.querySelector('.video-grid .video-card.focused')"));
  await tv.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(1100);
  await tv.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await tv.wait("!!document.querySelector('.cardmenu-mask')");
  const menu = await tv.evaluate("[...document.querySelectorAll('.cardmenu-item')].map(e=>e.textContent.trim())");
  check('recommendation exposes video and creator feedback', ['不感兴趣：当前视频', '不感兴趣：UP'].every(x => menu.includes(x)));
  await choose('.cardmenu-item', '不感兴趣：当前视频');
  check('video feedback waits for fresh confirmation', await tv.evaluate("document.querySelector('.cardmenu-item.focused')?.textContent.trim()==='返回'"));
  await screenshot('feedback-confirmation');
  await tv.key('Enter'); // The asserted default is Return, never Submit.
  await choose('.cardmenu-item', '不感兴趣：UP');
  check('creator feedback also defaults to Return', await tv.evaluate("document.querySelector('.cardmenu-item.focused')?.textContent.trim()==='返回'"));
  await screenshot('creator-feedback-confirmation');
  for (let i = 0; i < 3 && await tv.evaluate("!!document.querySelector('.cardmenu-mask')"); i++) await tv.key('GoBack');
  await tv.evaluate("window.__openVideo({bvid:'BV1sapi6qE72',resumeMode:'none'})");
  await tv.wait("document.querySelector('video')?.currentTime>2 && document.querySelector('video').videoWidth>0", 60000);
  if (await tv.evaluate("document.querySelector('.player-controls')?.classList.contains('hidden')")) await tv.key('ArrowUp');
  await tv.wait("!!document.querySelector('.player-author-followers')", 15000);
  check('public follower count visible on TV', await tv.evaluate("document.querySelector('.player-author-followers').textContent.includes('粉丝')"));
  const geometry = await tv.evaluate(`(() => {const p=document.querySelector('.player-controls'), r=p.getBoundingClientRect();return {width:r.width,bottom:r.bottom,height:innerHeight,background:getComputedStyle(p).backgroundColor,progress:document.querySelector('.player-progress-bar')?.getBoundingClientRect().height};})()`);
  check('controls fit screen and retain transparent base', geometry.progress >= 4 && geometry.width > 1000 && geometry.bottom <= geometry.height + 2 && geometry.background === 'rgba(0, 0, 0, 0)', geometry);
  await screenshot('controls-followers');
  await tv.evaluate(`(() => {
    const el=document.querySelector('.player-controls-vod');
    window.__shelfTvFrames=[];
    const start=performance.now();
    const sample=()=>{window.__shelfTvFrames.push(el.getBoundingClientRect().top);if(performance.now()-start<900)requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
  })()`);
  await tv.key('ArrowDown');
  await sleep(1000);
  const shelf=await tv.evaluate(`(() => {
    const el=document.querySelector('.player-controls-vod'), frames=window.__shelfTvFrames;
    delete window.__shelfTvFrames;
    const first=frames[0],last=frames[frames.length-1];
    return {expanded:el.classList.contains('recommendations-open'),height:el.getBoundingClientRect().height,viewport:innerHeight,travel:first-last,intermediate:frames.filter(y=>y<first-5&&y>last+5).length};
  })()`);
  check('remote expands half-screen shelf with intermediate animation frames', shelf.expanded && shelf.height>=shelf.viewport*.45 && shelf.travel>100 && shelf.intermediate>=3, shelf);
  await screenshot('expanded-controls');
  await tv.key('GoBack'); await sleep(350);
  check('Back collapses shelf without exiting playback', await tv.evaluate("!!document.querySelector('video') && !document.querySelector('.player-controls-vod').classList.contains('recommendations-open')"));
  check('read-only guard intercepted no attempted writes', await tv.evaluate('window.__feature250Guard.blocked===0'));
  check('no uncaught page exceptions', tv.errors.length === 0, { count: tv.errors.length });
} catch (error) {
  results.push({ name: 'suite completion', pass: false, error: error.message });
  try { await screenshot('failure'); } catch {}
  process.exitCode = 1;
} finally {
  try {
    for (let i=0;i<4 && await tv.evaluate("!!document.querySelector('.cardmenu-mask,.account-repair-dialog')");i++) await tv.key('GoBack');
    await tv.back();
  } finally {
    try { await tv.evaluate(`(() => {const g=window.__feature250Guard;if(g){if(webOS.service.request===g.wrapper)webOS.service.request=g.original;delete window.__feature250Guard;}})()`); }
    finally { tv.close(); writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2)); }
  }
}
