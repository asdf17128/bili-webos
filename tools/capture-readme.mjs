// Capture the real UI with public sample videos and a fictional demo account.
// Start Vite on 5173 and the image proxy on 9527 first, then run from the repo root.
// No TV, account credentials or account writes are used.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const output = 'docs/screenshots/v2';
const videos = JSON.parse(readFileSync(`${output}/demo-content.json`, 'utf8'));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    delete window.webOS;
    localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
    localStorage.setItem('bili_settings', JSON.stringify({ language: 'zh', gridCols: 4, uiScale: 1 }));
    localStorage.setItem('bili_auth', JSON.stringify({ SESSDATA: 'readme-demo', DedeUserID: '123' }));
    localStorage.setItem('bili_perfopt', JSON.stringify({ warmPlayer: false, prefetchPage: false }));
    localStorage.setItem('bili_searchHistory', JSON.stringify(['现场音乐', '旅行纪录片', '周末做饭', '摄影入门']));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.port === '5173') return route.continue();
    // Thumbnails are public cover artwork, fetched through the image proxy.
    if (url.pathname.includes('hdslb.com/') || url.hostname.endsWith('hdslb.com')) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await route.fetch({ timeout: 12000 });
          if (response.ok()) return route.fulfill({ response });
        } catch { /* Retry an intermittent cover CDN failure. */ }
      }
      return route.abort();
    }
    if (url.port === '9528') return route.abort();
    if (url.pathname.endsWith('/version.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '2.0.0' }) });
    if (url.hostname === 'api.github.com' && url.pathname.endsWith('/releases/latest')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v2.0.0' }) });
    let data = {};
    if (url.pathname.endsWith('/nav')) data = { isLogin: true, mid: 123, uname: 'BiliTV', wbi_img: { img_url: 'https://example.com/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://example.com/abcdefghijklmnopqrstuvwxyz123456.png' } };
    else if (url.pathname.includes('/top/feed/rcmd')) data = { item: videos };
    else if (url.pathname.endsWith('/history/cursor')) data = { list: videos.slice(0, 3).map((v, i) => ({ history: { business: 'archive', bvid: v.bvid, cid: i + 1 }, title: v.title, cover: v.pic, duration: v.duration, progress: Math.min(125 + i * 60, v.duration / 2), author_name: v.owner.name })) };
    else if (url.pathname.endsWith('/search/square')) data = { trending: { list: ['周末去哪里', '现场音乐', '城市漫游', '电影配乐', '数码新品', '一人食'].map(keyword => ({ keyword })) } };
    else if (url.pathname.endsWith('/popular')) data = { list: videos, no_more: true };
    else if (url.pathname.endsWith('/ranking/v2')) data = { list: videos };
    else if (url.pathname.endsWith('/search/type')) data = { result: videos, numResults: videos.length };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('.resume-card');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.video-card-thumb img')).slice(0, 8).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
  assert.equal(await page.locator('.video-card.focused').count(), 1);
  await page.screenshot({ path: `${output}/home.jpg`, type: 'jpeg', quality: 88 });
  await page.keyboard.press('Backspace'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/navigation.jpg`, type: 'jpeg', quality: 88 });
  await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
  await page.waitForSelector('.search-rec-item'); await page.mouse.move(1850, 1060); await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/search.png` });
  await page.locator('.sidebar-item').filter({ hasText: '设置' }).click();
  await page.waitForSelector('.config-options'); await page.mouse.move(1850, 1060); await page.waitForTimeout(500);
  assert.ok(!(await page.locator('.config-options').innerText()).includes('检查失败'));
  await page.screenshot({ path: `${output}/settings.png` });
  assert.deepEqual(errors, []);
  console.log('Captured four 2.0.0 UI screenshots with demo content; no browser errors.');
} finally { await browser.close(); }
