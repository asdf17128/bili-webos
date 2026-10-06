// Deterministic TV interaction regressions. Real Chromium input; no account or TV needed.
// Start Vite first, then: node tools/test-tv-ux.mjs [--baseline]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const baseline = process.argv.includes('--baseline');
const baseUrl = process.env.UX_URL || 'http://127.0.0.1:5173';
const output = process.env.UX_OUTPUT || '/tmp/bili-tv-ux';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failed = 0;
const reports = [];
const items = (prefix, count = 30) => Array.from({ length: count }, (_, i) => ({
  bvid: `BV${prefix}${i}`, title: `${prefix} · ${['山海之间，寻找生活的另一种可能', '周末放映室：值得慢慢看的故事', '把平凡的日子拍成电影'][i % 3]}`,
  pic: `https://i0.hdslb.com/bfs/archive/ux-${i}.jpg`, duration: 680 + i * 17,
  owner: { name: '生活记录者', mid: i + 1 }, stat: { view: 18700 + i * 300 },
}));

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(options => {
    delete window.webOS;
    localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
    localStorage.setItem('bili_perfopt', JSON.stringify({ prefetchPage: !!options.prefetch, warmPlayer: false }));
    if (!localStorage.getItem('bili_settings')) localStorage.setItem('bili_settings', JSON.stringify({ language: options.language || 'zh', uiScale: options.scale || 1, gridCols: options.cols || 3 }));
    if (options.auth) localStorage.setItem('bili_auth', JSON.stringify({ SESSDATA: 'ux-test-only', DedeUserID: '123' }));
    if (options.searchHistory) localStorage.setItem('bili_searchHistory', JSON.stringify(['电影配乐', '山野徒步', '周末厨房']));
  }, options);
  const page = await context.newPage();
  page.setDefaultTimeout(6500);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const calls = { feed: 0, qr: 0, popular: 0, folders: [] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseUrl).origin) {
      if (options.immediateFeed && url.pathname === '/src/api/client.js') {
        const response = await route.fetch();
        const source = await response.text();
        assert.ok(source.includes('export async function getRecommend(freshType, ps) {'));
        return route.fulfill({ response, body: source.replace('export async function getRecommend(freshType, ps) {', 'export async function getRecommend(freshType, ps) { if (window.__instantFeed) return window.__instantFeed;') });
      }
      if (process.env.UX_LEGACY_LAYOUT && url.pathname.endsWith('/tv-design.css')) {
        const response = await route.fetch();
        return route.fulfill({ response, body: (await response.text()).replace('@supports not (display: grid)', '@supports (display: grid)') });
      }
      return route.continue();
    }
    if (url.pathname.includes('ux-')) {
      const n = Number((url.pathname.match(/ux-(\d+)/) || [0, 0])[1]);
      const colors = ['#254958', '#6d4e3e', '#365148', '#454563', '#4a5a66', '#695460'];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="378"><rect width="672" height="378" fill="${colors[n % 6]}"/><circle cx="470" cy="115" r="55" fill="#e6d4b1" opacity=".7"/><path d="M0 340L220 120L420 350L550 180L672 300V378H0" fill="#14222a" opacity=".7"/></svg>` });
    }
    if (url.port === '9528') return route.abort();
    let body = { code: 0, data: {} };
    if (url.pathname.endsWith('/nav')) body.data = { isLogin: !!options.auth, mid: 123, uname: 'UX Test', wbi_img: { img_url: 'https://example.com/abcdefghijklmnopqrstuvwxyz123456.png', sub_url: 'https://example.com/abcdefghijklmnopqrstuvwxyz123456.png' } };
    if (url.pathname.includes('/top/feed/rcmd')) {
      calls.feed++;
      if (options.feedDelay) await new Promise(r => setTimeout(r, options.feedDelay));
      if (options.feedError) return route.abort();
      body.data = { item: items('推荐') };
    }
    if (url.pathname.endsWith('/popular')) { calls.popular++; body.data = { list: items('热门'), no_more: true }; }
    if (url.pathname.endsWith('/history/cursor')) {
      if (options.historyDelay) await new Promise(r => setTimeout(r, options.historyDelay));
      if (options.historyError) return route.abort();
      body.data = { list: options.resume ? items('续播', 5).map((v, i) => ({
        history: { bvid: v.bvid, cid: 101 + i, business: 'archive' }, title: v.title,
        cover: v.pic, author_name: v.owner.name, duration: 700,
        progress: i === 3 ? -1 : i === 4 ? 695 : 125 + i * 75,
      })) : [] };
    }
    if (url.pathname.endsWith('/folder/created/list-all')) {
      if (options.folderError) return route.abort();
      body.data = { list: options.emptyFolders ? [] : [{ id: 1, title: '音乐收藏', media_count: 30 }, { id: 2, title: '旅行收藏', media_count: 30 }] };
    }
    if (url.pathname.endsWith('/folder/collected/list')) {
      if (options.subscriptionError) return route.abort();
      const pn = Number(url.searchParams.get('pn'));
      assert.equal(url.searchParams.get('platform'), 'web');
      body.data = { list: options.emptySubscriptions ? [] : pn === 1
        ? [{ id: 11, type: 11, title: '订阅收藏夹', media_count: 30 }, { id: 12, type: 21, title: '订阅合集', mid: 123, media_count: 30 }]
        : [{ id: 13, type: 11, title: '下一页订阅', media_count: 30 }], has_more: pn === 1 && !options.emptySubscriptions };
    }
    if (url.pathname.endsWith('/seasons_archives_list')) {
      assert.equal(url.searchParams.get('season_id'), '12');
      body.data = { archives: items('合集'), page: { total: 30 } };
    }
    if (url.pathname.endsWith('/resource/list')) {
      const folder = Number(url.searchParams.get('media_id')), pn = Number(url.searchParams.get('pn'));
      calls.folders.push({ folder, pn });
      if (options.slowFolder === folder) await new Promise(r => setTimeout(r, 1000));
      body.data = { medias: items(`收藏${folder}`).map(v => ({ ...v, cover: v.pic, upper: v.owner })), has_more: false };
    }
    if (url.pathname.endsWith('/ranking/v2')) body.data = { list: items('分区') };
    if (url.pathname.endsWith('/search/square')) body.data = { trending: { list: [{ keyword: '风景' }, { keyword: '音乐' }] } };
    if (url.pathname.endsWith('/search/type')) {
      const q = url.searchParams.get('keyword');
      if (q === '旧搜索') await new Promise(r => setTimeout(r, 1200));
      if (q === '网络失败') return route.abort();
      body.data = { result: items(q, 12), numResults: 12 };
    }
    if (url.pathname.endsWith('/qrcode/generate')) { calls.qr++; body = { code: -1 }; }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(baseUrl);
  return { context, page, calls, errors, options };
}
async function test(name, fn, options) {
  if (process.env.UX_FILTER && !new RegExp(process.env.UX_FILTER).test(name)) return;
  const f = await fixture(options);
  try { await fn(f); assert.deepEqual(f.errors, [], 'uncaught browser errors'); reports.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { failed++; reports.push({ name, pass: false, error: e.message }); console.log('FAIL', name, e.message.split('\n')[0]); await f.page.screenshot({ path: `${output}/${baseline ? 'before' : 'after'}-${reports.length}.png` }); }
  finally { await f.context.close(); }
}
const focused = page => page.evaluate(() => document.querySelector('[data-focus-id].focused')?.getAttribute('data-focus-id'));
const ready = page => page.waitForSelector('.video-card');

await test('long-press menu requires release then a new confirmation and can reopen', async ({ page }) => {
  await ready(page); await page.waitForTimeout(700);
  await page.keyboard.press('ArrowRight');
  const origin = await focused(page);
  for (let round = 0; round < 2; round++) {
    await page.keyboard.down('Enter');
    for (let i = 0; i < 22; i++) {
      await page.waitForTimeout(50); await page.keyboard.down('Enter');
    }
    assert.equal(await page.locator('.cardmenu').count(), 1);
    assert.equal(await page.locator('.cardmenu-msg').count(), 0);
    await page.keyboard.up('Enter');
    assert.equal(await page.locator('.cardmenu').count(), 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert.equal(await page.locator('.cardmenu').count(), 0);
    assert.equal(await focused(page), origin);
  }
});

await test('loading retains a usable sidebar focus', async ({ page }) => {
  await page.waitForTimeout(700);
  assert.match(await focused(page) || '', /^sidebar-/);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'sidebar-2-0');
}, { feedDelay: 1700 });
await test('pointer hover does not scroll the grid', async ({ page }) => {
  await ready(page); await page.waitForTimeout(700);
  const before = await page.locator('.video-grid').evaluate(el => el.style.transform);
  await page.mouse.move(470, 980); await page.waitForTimeout(800);
  assert.equal(await page.locator('.video-grid').evaluate(el => el.style.transform), before);
});
await test('wheel still moves a row that the pointer already highlights', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400);
  const card = await page.locator('[data-focus-id="content-1-0"]').boundingBox();
  await page.mouse.move(card.x + 80, card.y + 80);
  await page.waitForTimeout(150);
  assert.equal(await focused(page), 'content-1-0');
  const before = await page.locator('.video-grid').evaluate(el => el.style.transform);
  await page.mouse.wheel(0, 200); await page.waitForTimeout(350);
  const after = await page.locator('.video-grid').evaluate(el => el.style.transform);
  assert.notEqual(after, before, 'wheel must anchor the highlighted row');
  await page.mouse.move(500, 980); await page.mouse.wheel(0, -200); await page.waitForTimeout(350);
  assert.equal(await page.locator('.video-grid').evaluate(el => el.style.transform), 'translateY(0px)');
});
await test('sidebar keeps scroll; Right restores the same card', async ({ page, calls }) => {
  await ready(page); await page.waitForTimeout(700);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  const before = await focused(page);
  const scroll = await page.locator('.video-grid').evaluate(el => el.style.transform);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.video-grid').evaluate(el => el.style.transform), scroll, 'sidebar must preserve scroll');
  const requests = calls.feed;
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(450);
  assert.equal(calls.feed, requests, 'Right must not refresh');
  assert.equal(await focused(page), before, 'return to last card');
});
await test('OK intentionally refreshes the current sidebar section', async ({ page, calls }) => {
  await ready(page); await page.waitForTimeout(700);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Backspace');
  const requests = calls.feed;
  await page.keyboard.press('Enter'); await page.waitForTimeout(650);
  assert.equal(calls.feed, requests + 1);
  assert.equal(await focused(page), 'content-0-0');
  assert.equal(await page.locator('.video-grid').evaluate(el => el.style.transform), 'translateY(0px)');
});
await test('passing follow in sidebar never opens login', async ({ page }) => {
  await ready(page); await page.waitForTimeout(700);
  await page.keyboard.press('Backspace');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.login-page').count(), 0);
});
await test('native search editing keeps Backspace and caret arrows', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
  await page.locator('.search-input').click(); await page.keyboard.type('abc');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.search-input').inputValue(), 'ab');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.type('X');
  assert.equal(await page.locator('.search-input').inputValue(), 'aXb');
});
await test('feed failure offers a focusable retry', async ({ page }) => {
  await page.waitForTimeout(1100);
  assert.equal(await page.getByText('重试', { exact: true }).count(), 1);
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.getByText('重试', { exact: true }).evaluate(el => el.classList.contains('focused')));
}, { feedError: true });

await test('retry recovers a failed feed', async ({ page, options }) => {
  await page.getByText('重试', { exact: true }).waitFor();
  options.feedError = false;
  await page.getByText('重试', { exact: true }).click();
  await ready(page);
  assert.equal(await page.locator('.video-card').count(), 30);
  await page.waitForFunction(() => !!document.querySelector('.video-card.focused'), undefined, { timeout: 2000 });
  assert.match(await focused(page) || '', /^content-/);
}, { feedError: true });
for (const delay of ['immediate', 0, 300]) await test(`remote retry restores first card (${delay === 'immediate' ? delay : delay + 'ms'} response)`, async ({ page, options }) => {
  await page.getByText('重试', { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.tv-action.focused'));
  options.feedError = false; options.feedDelay = Number(delay) || 0;
  if (delay === 'immediate') await page.evaluate(item => { window.__instantFeed = { code: 0, data: { item } }; }, items('立即重试'));
  await page.keyboard.press('Enter');
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.video-card.focused')?.dataset.focusId === 'content-0-0', undefined, { timeout: 2000 });
  assert.equal(await page.evaluate(() => window.__focusState().current), 'content-0-0');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'content-1-0');
  assert.equal(await page.locator('[data-focus-id].focused').count(), 1);
}, { feedError: true, immediateFeed: delay === 'immediate' });

await test('retry does not steal focus after the user returns to sidebar', async ({ page, options }) => {
  await page.getByText('重试', { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.tv-action.focused'));
  options.feedError = false; options.feedDelay = 500;
  await page.keyboard.press('Enter');
  await page.locator('.grid-skeleton').waitFor();
  await page.keyboard.press('ArrowLeft');
  await ready(page);
  assert.match(await focused(page), /^sidebar-/);
}, { feedError: true });

await test('immediate short-feed retry remains navigable with resume shelf and prefetch', async ({ page, options }) => {
  await page.getByText('重试', { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.tv-action.focused'));
  options.feedError = false;
  await page.evaluate(item => { window.__instantFeed = { code: 0, data: { item } }; }, items('立即重试', 6));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.video-card.focused'));
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.video-card.focused')?.dataset.focusId === 'content-1-0');
  assert.equal(await page.locator('[data-focus-id].focused').count(), 1);
  await page.screenshot({path:`${output}/retry-navigable.png`});
}, { feedError: true, immediateFeed: true, auth: true, resume: true, cols: 4, prefetch: true });

await test('failed retry remains reachable and a later retry recovers', async ({ page, options }) => {
  await page.getByText('重试', { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.tv-action.focused'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.tv-action.focused'));
  options.feedError = false;
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.video-card.focused'));
}, { feedError: true, feedDelay: 100 });

await test('rapid sidebar traversal commits only the settled section', async ({ page, calls }) => {
  await ready(page); await page.waitForTimeout(400);
  await page.keyboard.press('Backspace');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350);
  assert.equal(calls.popular, 0);
  assert.equal(await focused(page), 'sidebar-4-0');
  assert.equal(await page.locator('.login-page').count(), 0);
});
await test('switching sections restores the cached feed and scroll', async ({ page, calls }) => {
  await ready(page); await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const previous = await focused(page);
  const scroll = await page.locator('.video-grid').evaluate(el => el.style.transform);
  await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(350);
  assert.equal(calls.feed, 1);
  assert.equal(await page.locator('.video-grid').evaluate(el => el.style.transform), scroll);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
  assert.equal(await focused(page), previous);
});
await test('slow content never steals focus after navigating away', async ({ page }) => {
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1600);
  assert.ok((await page.locator('.video-card').first().innerText()).includes('热门'));
  assert.equal(await focused(page), 'content-0-0');
}, { feedDelay: 1600 });
await test('latest search wins even if an older response arrives last', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
  const input = page.locator('.search-input');
  await input.fill('旧搜索'); await input.press('Enter');
  await page.waitForTimeout(100);
  await input.fill('新搜索'); await input.press('Enter');
  await ready(page); await page.waitForTimeout(1400);
  assert.ok((await page.locator('.video-card-title').first().innerText()).startsWith('新搜索'));
});
await test('search network failures have their own retry state', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
  await page.locator('.search-input').fill('网络失败'); await page.keyboard.press('Enter');
  await page.getByText('搜索暂时不可用', { exact: true }).waitFor();
  assert.equal(await focused(page), 'content-1-0');
  assert.equal(await page.getByText('未找到相关视频').count(), 0);
});
await test('login isolates navigation and provides retry / cancel', async ({ page, calls }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '关注' }).click();
  await page.locator('.login-page').waitFor(); await page.getByText('登录失败，请重试', { exact: true }).waitFor();
  const before = await focused(page), requests = calls.feed;
  await page.keyboard.press('ArrowDown'); await page.mouse.wheel(0, 200); await page.waitForTimeout(200);
  assert.equal(await focused(page), before);
  assert.equal(calls.feed, requests);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.login-page').count(), 0);
});
await test('favorites empty response resolves loading', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.getByText('暂无收藏夹', { exact: true }).waitFor();
  assert.equal(await page.locator('.loading-spinner, .grid-skeleton').count(), 0);
}, { auth: true, emptyFolders: true });
await test('favorites failures can be retried', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.getByText('重试', { exact: true }).waitFor();
}, { auth: true, folderError: true });
await test('favorites return to the selected folder and fit the viewport', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.locator('.folder-selector .fav-chip').nth(1).click(); await ready(page); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowLeft'); // first col -> sidebar; enter resumes
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  if ((await focused(page))?.startsWith('content-1-')) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'content-1-1');
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const bounds = await page.locator('.video-card.focused').boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 1080, JSON.stringify(bounds));
}, { auth: true, cols: 4, scale: 1.25 });
await test('late favorite-folder responses never replace the current folder', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.locator('.folder-selector .fav-chip').nth(1).click();
  await ready(page); await page.waitForTimeout(1300);
  const titles = await page.locator('.video-card-title').allTextContents();
  assert.ok(titles.length && titles.every(title => title.startsWith('收藏2')));
}, { auth: true, slowFolder: 1, prefetch: true });
await test('favorites last row accounts for the folder header height', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await ready(page); await page.waitForTimeout(350);
  for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350);
  const bounds = await page.locator('.video-card.focused').boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 1080, JSON.stringify(bounds));
}, { auth: true, cols: 4, scale: 1.25 });
await test('subscriptions show folders and collections, paginate and keep remote focus', async ({ page, calls }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.getByRole('tab', { name: '订阅', exact: true }).click();
  await page.locator('.folder-selector .fav-chip').nth(0).waitFor();
  await page.keyboard.press('ArrowDown');
  await ready(page); await page.waitForTimeout(300);
  assert.ok((await page.locator('.video-card-title').allTextContents()).every(t => t.startsWith('合集')));
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'content-1-1');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.getByText('下一页订阅', { exact: false }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await focused(page), 'content-1-2');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'content-0-1');
  await page.getByRole('tab', { name: '我的收藏' }).click();
  await page.locator('.folder-selector .fav-chip').first().waitFor();
  assert.equal(await page.getByText('下一页订阅', { exact: false }).count(), 0);
  await page.screenshot({ path: `${output}/library.png` });
}, { auth: true });
await test('empty subscriptions stop loading and keep tabs reachable', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.getByRole('tab', { name: '订阅', exact: true }).click();
  await page.getByText('暂无订阅，可先在 B 站订阅收藏夹或合集').waitFor();
  assert.equal(await page.locator('.grid-skeleton').count(), 0);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
  await page.locator('.folder-selector .fav-chip').first().waitFor();
}, { auth: true, emptySubscriptions: true });
await test('subscription request failure exposes retry and preserves the mode', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
  await page.getByRole('tab', { name: '订阅', exact: true }).click();
  await page.getByText('重试', { exact: true }).waitFor();
  await page.getByText('重试', { exact: true }).click();
  await page.getByText('重试', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '订阅', exact: true }).getAttribute('aria-selected'), 'true');
}, { auth: true, subscriptionError: true });
await test('loading player can be cancelled without moving background focus', async ({ page }) => {
  await ready(page); await page.waitForTimeout(350);
  await page.route('**/player/PlayerPage.jsx', async route => { await new Promise(r => setTimeout(r, 1600)); await route.continue(); });
  const before = await focused(page);
  await page.keyboard.press('Enter');
  await page.locator('.player-placeholder').waitFor();
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), before);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.player-placeholder').count(), 0);
  assert.equal(await focused(page), before);
});
for (const language of ['zh', 'en', 'es']) {
  await test(`visual / deep scrolling / large text (${language})`, async ({ page }) => {
    await ready(page); await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/home-${language}.png` });
    for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(350);
    const bounds = await page.locator('.video-card.focused').boundingBox();
    const viewport = await page.locator('.video-grid').evaluate(el => {
      const rect = el.parentElement.getBoundingClientRect();
      return { y: rect.y, height: rect.height };
    });
    assert.ok(bounds && bounds.y >= viewport.y && bounds.y + bounds.height <= viewport.y + viewport.height, JSON.stringify({ bounds, viewport }));
    await page.screenshot({ path: `${output}/last-row-${language}.png` });
  }, { language, scale: 1.25, cols: language === 'en' ? 2 : language === 'es' ? 4 : 3 });
}

await test('design: drawer overlays without shifting content or losing the card', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const origin = await page.locator('.video-card.focused').boundingBox();
  const id = await focused(page);
  assert.equal(await page.locator('.sidebar').getAttribute('data-expanded'), 'false');
  await page.keyboard.press('Backspace'); await page.waitForTimeout(220);
  assert.equal(await page.locator('.sidebar').getAttribute('data-expanded'), 'true');
  const still = await page.locator(`[data-focus-id="${id}"]`).boundingBox();
  assert.ok(Math.abs(still.x + still.width / 2 - origin.x - origin.width / 2) < 1);
  assert.ok(Math.abs(still.y + still.height / 2 - origin.y - origin.height / 2) < 1);
  await page.screenshot({ path: `${output}/design-drawer.png` });
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), id);
});
await test('design: reopening navigation keeps the bottom item visible', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400); await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300); await page.keyboard.press('ArrowRight');
  await page.locator('.config-page').waitFor(); await page.waitForTimeout(300);
  await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
  const geometry = await page.locator('.sidebar-item.focused').evaluate(el => {
    const rect = el.getBoundingClientRect(), vp = el.closest('nav').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, start: vp.top, end: vp.bottom };
  });
  assert.ok(geometry.top >= geometry.start && geometry.bottom <= geometry.end, JSON.stringify(geometry));
}, { language: 'en', scale: 1.25 });
await test('design: resume shelf uses unfinished history and supports remote navigation', async ({ page }) => {
  await ready(page); await page.locator('.resume-card').first().waitFor(); await page.waitForTimeout(400);
  assert.equal(await page.locator('.resume-card').count(), 3);
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'content--1-0');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), 'content--1-1');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'content-0-1');
  await page.screenshot({ path: `${output}/design-home.png` });
}, { auth: true, resume: true, cols: 4 });
await test('design: resume and a two-column large-text feed share a safe viewport', async ({ page }) => {
  await ready(page); await page.locator('.resume-card').first().waitFor(); await page.waitForTimeout(400);
  const checkCard = async () => {
    const card = await page.locator('.video-card.focused').boundingBox();
    const vp = await page.locator('.video-grid-viewport').boundingBox();
    assert.ok(card.y >= vp.y && card.y + card.height <= vp.y + vp.height, JSON.stringify({ card, vp }));
  };
  await checkCard(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300);
  assert.equal(await focused(page), 'content--1-0');
  const scroll = await page.locator('.video-grid').evaluate(el => el.style.transform);
  await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowRight');
  await page.waitForSelector('[data-focus-id="content--1-0"].focused');
  assert.equal(await focused(page), 'content--1-0');
  assert.equal(await page.locator('.video-grid').evaluate(el => el.style.transform), scroll);
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350); await checkCard();
}, { auth: true, resume: true, cols: 2, scale: 1.25 });
await test('design: late history preserves a deep card position', async ({ page }) => {
  await ready(page); await page.waitForTimeout(350);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const id = await focused(page), before = await page.locator('.video-card.focused').boundingBox();
  await page.locator('.resume-card').first().waitFor(); await page.waitForTimeout(350);
  assert.equal(await focused(page), id);
  const after = await page.locator('.video-card.focused').boundingBox();
  assert.ok(Math.abs(before.y - after.y) < 2, JSON.stringify({ before, after }));
}, { auth: true, resume: true, historyDelay: 1800 });
await test('design: history failure leaves discovery usable', async ({ page }) => {
  await ready(page); await page.waitForTimeout(450);
  assert.equal(await page.locator('.resume-card').count(), 0);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'content-1-0');
}, { auth: true, historyError: true });
await test('design: search has connected trending and recent columns', async ({ page }) => {
  await ready(page); await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
  await page.waitForTimeout(350);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'content-1-0');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), 'content-1-1');
  await page.screenshot({ path: `${output}/design-search.png` });
  await page.keyboard.press('Enter');
  await ready(page);
  assert.ok((await page.locator('.video-card-title').first().innerText()).includes('电影配乐'));
}, { searchHistory: true });
await test('late title height changes keep a deep focused card in place', async ({ page }) => {
  await ready(page); await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const before = await page.locator('.video-card.focused').boundingBox();
  const beforeLayout = await page.locator('.video-card.focused').evaluate(el => ({ offset: el.offsetTop, gridHeight: el.parentElement.offsetHeight, transform: el.parentElement.style.transform }));
  // Model delayed translated titles becoming longer above the current row.
  // DOM text changes only; navigation still goes through real remote input.
  await page.locator('.video-card-title').evaluateAll(nodes => nodes.slice(0, 9).forEach(el => {
    el.textContent = '更长的翻译标题，需要两行展示，内容更新后当前阅读位置应当保持稳定。';
  }));
  await page.waitForTimeout(350);
  const after = await page.locator('.video-card.focused').boundingBox();
  const afterLayout = await page.locator('.video-card.focused').evaluate(el => ({ offset: el.offsetTop, gridHeight: el.parentElement.offsetHeight, transform: el.parentElement.style.transform }));
  assert.equal(afterLayout.offset, beforeLayout.offset, 'translated titles must retain their reserved tracks');
  assert.ok(Math.abs(before.y - after.y) < 2, JSON.stringify({ before, after, beforeLayout, afterLayout }));
});
await test('design: mixed title lengths keep card and resume metadata aligned', async ({ page }) => {
  await ready(page); await page.locator('.resume-card').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const titles = ['短标题', '这是一条需要两行展示的长标题，长短不同也应该整齐对齐', '另一条短标题'];
  await page.locator('.video-card-title, .resume-title').evaluateAll((nodes, titles) => {
    nodes.forEach((el, i) => { el.textContent = titles[i % titles.length]; });
  }, titles);
  await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
  for (const [card, title, meta] of [
    ['.video-card', '.video-card-title', '.video-card-meta'],
    ['.resume-card', '.resume-title', '.resume-position'],
  ]) {
    const positions = await page.locator(card).evaluateAll((nodes, { title, meta }) => nodes.map(el => {
      const origin = el.getBoundingClientRect();
      return { title: el.querySelector(title).getBoundingClientRect().top - origin.top,
        meta: el.querySelector(meta).getBoundingClientRect().top - origin.top, height: origin.height };
    }), { title, meta });
    for (const key of ['title', 'meta', 'height']) {
      assert.ok(Math.max(...positions.map(p => p[key])) - Math.min(...positions.map(p => p[key])) < 1, `${card} ${key}: ${JSON.stringify(positions)}`);
    }
  }
  await page.screenshot({ path: `${output}/aligned-cards.png` });
}, { auth: true, resume: true, cols: 4 });
await test('design: card metadata stays inside compact cards', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400);
  const slots = await page.locator('.video-card-info').evaluateAll(nodes => nodes.map(el => ({
    height: el.offsetHeight, clipped: el.scrollHeight > el.clientHeight,
    stats: el.querySelector('.video-card-stats')?.getBoundingClientRect().bottom,
    bottom: el.getBoundingClientRect().bottom,
  })));
  assert.ok(slots.every(x => !x.clipped && x.stats <= x.bottom));
}, { scale: 1.25, cols: 4 });
for (const language of ['zh', 'en', 'es']) {
  await test(`design: settings remain readable with large text (${language})`, async ({ page }) => {
    await ready(page); await page.waitForTimeout(400); await page.keyboard.press('Backspace');
    // Sidebar wraps upward: recommend -> search -> config.
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300); await page.keyboard.press('ArrowRight');
    await page.locator('.config-page').waitFor();
    const overflow = await page.locator('.config-page').evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false);
    const rows = await page.locator('.config-options .settings-row').evaluateAll(nodes => nodes.map(el => ({
      clipped: el.scrollWidth > el.clientWidth, text: el.innerText,
    })));
    assert.ok(rows.every(x => !x.clipped), JSON.stringify(rows));
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
    const box = await page.locator('.settings-row.focused').boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 1080);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/design-settings-${language}.png` });
  }, { language, scale: 1.25 });
}

await test('leaving search preserves the next page first focus cell', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(350); await page.keyboard.press('ArrowRight');
  await page.locator('.search-input').waitFor();
  await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(350); await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.config-options .settings-row.focused');
  assert.equal(await focused(page), 'content-0-0');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'content-1-0');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'content-0-0');
  assert.equal(await page.locator('[data-focus-id].focused').count(), 1);
});

await test('settings font rows follow visual order in both directions', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300); await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.config-options .settings-row.focused');
  const label = () => page.locator('.config-options .settings-row.focused > span').first().innerText();
  const order = ['弹幕', '看完移出稍后再看', '播完自动播放下一个', '每行视频', '弹幕字号', '字幕字号', '界面字号', 'CDN 线路'];
  for (let i = 0; i < order.length; i++) {
    assert.equal(await label(), order[i], 'Down follows the displayed setting order');
    if (i < order.length - 1) await page.keyboard.press('ArrowDown');
  }
  for (let i = order.length - 2; i >= 0; i--) {
    await page.keyboard.press('ArrowUp');
    assert.equal(await label(), order[i], 'Up reverses the same setting order');
  }
});
await test('font pickers update their own setting and resume at the same row', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300); await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.config-options .settings-row.focused');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  for (const [name, key, value] of [['弹幕字号', 'danmakuScale', 1.3], ['字幕字号', 'subtitleScale', 1.2], ['界面字号', 'uiScale', 1.12]]) {
    assert.equal(await page.locator('.settings-row.focused > span').first().innerText(), name);
    await page.keyboard.press('Enter'); await page.locator('.settings-picker').waitFor();
    assert.equal(await page.locator('.settings-picker > div').first().innerText(), name);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.locator('.settings-picker').waitFor({ state: 'detached' });
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem('bili_settings'))[key], key);
    assert.equal(saved, value);
    assert.equal(await page.locator('.settings-row.focused > span').first().innerText(), name);
    assert.equal(await page.locator('.settings-row.focused .settings-row-value').innerText(), '大');
    await page.keyboard.press('Enter'); await page.locator('.settings-picker').waitFor();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Backspace');
    await page.locator('.settings-picker').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem('bili_settings'))[key], key), value, 'Back cancels the pending size');
    await page.keyboard.press('ArrowDown');
  }
  assert.equal(await page.locator('.settings-row.focused > span').first().innerText(), 'CDN 线路');
});



await test('library native scrolling keeps the last large card visible', async ({ page }) => {
  await ready(page); await page.waitForTimeout(400);
  await page.locator('.sidebar-item').filter({ hasText: '我的' }).click();
  await page.locator('.library-page .video-card').first().waitFor();
  for(let i=0;i<6;i++)await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const card=await page.locator('.video-card.focused').boundingBox();
  assert.ok(card&&card.y>=0&&card.y+card.height<=1080,JSON.stringify(card));
}, {auth:true,resume:true,cols:2,scale:1.25});

for (const cols of [2, 3, 4]) for (const [sizeIndex, scale] of [1, 1.12, 1.25].entries()) {
  await test(`settings matrix: ${cols} columns, scale ${scale}, applies and persists`, async ({ page }) => {
    await ready(page); await page.waitForTimeout(400);
    await page.locator('.sidebar-item').filter({ hasText: '设置' }).click();
    await page.waitForSelector('.settings-row.focused');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    const choose = async index => {
      await page.keyboard.press('Enter'); await page.locator('.settings-picker').waitFor();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
      for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter'); await page.locator('.settings-picker').waitFor({ state: 'detached' });
    };
    await choose(cols - 2);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await choose(sizeIndex);
    const checkGrid = async selector => {
      await page.locator(`${selector} .video-card`).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.locator(selector).evaluate(el => {
        const cards = Array.from(el.querySelectorAll('.video-card'));
        return { columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
          title: parseFloat(getComputedStyle(cards[0].querySelector('.video-card-title')).fontSize),
          meta: parseFloat(getComputedStyle(cards[0].querySelector('.video-card-meta')).fontSize),
          clipped: cards.some(c => c.querySelector('.video-card-info').scrollHeight > c.querySelector('.video-card-info').clientHeight) };
      });
      assert.equal(metrics.columns, cols, `${selector}: columns`);
      assert.ok(Math.abs(metrics.meta - 18 * scale) < .1, JSON.stringify(metrics));
      assert.equal(metrics.clipped, false, `${selector}: metadata clipped`);
      return metrics;
    };
    await page.locator('.sidebar-item').filter({ hasText: '推荐' }).click();
    const metrics = await checkGrid('.video-grid');
    assert.ok(Math.abs(metrics.title - (cols === 4 ? 22 : 23) * scale) < .1, JSON.stringify(metrics));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/matrix-${cols}-${scale}.png` });
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const rect = await page.locator('.video-card.focused').boundingBox();
    const vp = await page.locator('.video-grid-viewport').boundingBox();
    assert.ok(rect && rect.y >= vp.y && rect.y + rect.height <= vp.y + vp.height + 1, JSON.stringify({rect,vp, layout: await page.locator('.video-card.focused').evaluate(el => { const ancestors=[];let p=el.parentElement;while(p){ancestors.push({class:p.className,scroll:p.scrollTop});p=p.parentElement}return {id:el.dataset.focusId,top:el.offsetTop,transform:el.closest('.video-grid').style.transform,ancestors};})}));
    await page.reload(); await ready(page); await page.waitForTimeout(300);
    await checkGrid('.video-grid');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bili_settings')));
    assert.equal(saved.gridCols, cols); assert.equal(saved.uiScale, scale);
    await page.locator('.sidebar-item').filter({ hasText: '收藏' }).click();
    await checkGrid('.video-grid');
    await page.locator('.sidebar-item').filter({ hasText: '我的' }).click();
    await checkGrid('.video-grid');
    await page.locator('.sidebar-item').filter({ hasText: '搜索' }).click();
    await page.locator('.search-input').fill('电影'); await page.keyboard.press('Enter');
    await checkGrid('.search-results-grid');
  }, { auth: true, resume: true });
}

await test('diagnostic network failures finish visibly and remain scannable', async ({ page }) => {
  await ready(page);
  await page.locator('.sidebar-item').filter({ hasText: '设置' }).click();
  await page.route('http://127.0.0.1:9527/**', route => route.abort());
  await page.getByText('网络诊断', { exact: true }).click();
  const panel = page.locator('.diagnostic-panel');
  await panel.locator('svg').waitFor();
  const detail = await panel.innerText();
  assert.equal((detail.match(/❌/g) || []).length, 7, detail);
  assert.ok(!detail.includes('⏳'), 'all probes must settle');
  const png = PNG.sync.read(await panel.screenshot({ path: `${output}/diagnostics-offline.png` }));
  const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(qr, 'failure report QR must decode from rendered pixels');
  const url = new URL(qr.data);
  assert.equal(url.origin, 'https://github.com');
  const body = url.searchParams.get('body');
  for (const step of ['svc', 'api', 'rcmd', 'view', 'playurl', 'cdn', 'imgproxy']) assert.ok(body.includes('[fail] ' + step), body);
  assert.match(body, /route=auto/);
  assert.ok(!/[^\x00-\x7f]/.test(body), 'report stays ASCII');
});

await writeFile(`${output}/${baseline ? 'before' : 'after'}.json`, JSON.stringify(reports, null, 2));
await browser.close();
console.log(`${reports.length - failed}/${reports.length} passed; evidence: ${output}`);
process.exitCode = baseline ? 0 : failed ? 1 : 0;
