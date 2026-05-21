// End-to-end test script for Bilibili webOS TV app
// Tests all API endpoints through the Vite dev server proxy
// Run: bun tools/test-e2e.ts

import crypto from 'node:crypto';

const PROXY = 'http://localhost:5173';
let passed = 0;
let failed = 0;

function ok(name, result) {
  passed++;
  console.log(`  ✅ ${name}: ${result}`);
}
function fail(name, result) {
  failed++;
  console.log(`  ❌ ${name}: ${result}`);
}

// ============ WBI Signing ============
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((i) => orig[i])
    .join('')
    .slice(0, 32);
}

function signWbi(params, mixinKey) {
  const wts = Math.floor(Date.now() / 1000);
  const p = { ...params, wts: String(wts) };
  const q = Object.keys(p)
    .sort()
    .map(
      (k) => k + '=' + encodeURIComponent(String(p[k]).replace(/[!'()*]/g, '')),
    )
    .join('&');
  const w_rid = crypto
    .createHash('md5')
    .update(q + mixinKey)
    .digest('hex');
  return q + '&w_rid=' + w_rid;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function run() {
  console.log('\n=== Bilibili webOS TV - End-to-End Tests ===\n');

  // Test 1: Proxy health
  console.log('[Proxy]');
  try {
    const ping = await fetchJSON(`${PROXY}/ping`);
    if (ping.status === 'ok') ok('Health check', 'ok');
    else fail('Health check', JSON.stringify(ping));
  } catch (e) {
    fail('Health check', e.message + ' -- is the Vite dev server running?');
    console.log('\nVite dev server not running. Start with: bun run dev\n');
    process.exit(1);
  }

  // Test 2: Get WBI keys
  console.log('\n[WBI Keys]');
  let mixinKey;
  try {
    const nav = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/nav`,
    );
    const imgKey = nav.data?.wbi_img?.img_url?.split('/').pop().split('.')[0];
    const subKey = nav.data?.wbi_img?.sub_url?.split('/').pop().split('.')[0];
    if (imgKey && subKey) {
      mixinKey = getMixinKey(imgKey + subKey);
      ok(
        'WBI keys',
        `imgKey=${imgKey.slice(0, 8)}... subKey=${subKey.slice(0, 8)}...`,
      );
    } else {
      fail('WBI keys', 'Missing keys in nav response');
    }
  } catch (e) {
    fail('WBI keys', e.message);
  }

  // Test 3: QR Code Generate
  console.log('\n[Login]');
  try {
    const qr = await fetchJSON(
      `${PROXY}/proxy/passport.bilibili.com/x/passport-login/web/qrcode/generate`,
    );
    if (qr.code === 0 && qr.data?.qrcode_key) {
      ok('QR generate', `key=${qr.data.qrcode_key.slice(0, 12)}...`);
    } else {
      fail('QR generate', `code=${qr.code} msg=${qr.message}`);
    }
  } catch (e) {
    fail('QR generate', e.message);
  }

  // Test 4: Popular videos (with WBI)
  console.log('\n[Content APIs]');
  try {
    const q = signWbi({ pn: 1, ps: 3 }, mixinKey);
    const pop = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/popular?${q}`,
    );
    if (pop.code === 0 && pop.data?.list?.length > 0) {
      ok(
        'Popular videos',
        `${pop.data.list.length} videos, first: ${pop.data.list[0].title?.slice(0, 30)}...`,
      );
    } else {
      fail('Popular videos', `code=${pop.code} msg=${pop.message}`);
    }
  } catch (e) {
    fail('Popular videos', e.message);
  }

  // Test 5: Recommend (WBI signed endpoint)
  try {
    const q = signWbi(
      { fresh_idx: 1, fresh_idx_1h: 1, fresh_type: 4, ps: 5 },
      mixinKey,
    );
    const rec = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?${q}`,
    );
    if (rec.code === 0 && rec.data?.item?.length > 0) {
      ok('Recommend', `${rec.data.item.length} videos`);
    } else {
      fail('Recommend', `code=${rec.code} msg=${rec.message}`);
    }
  } catch (e) {
    fail('Recommend', e.message);
  }

  // Test 6: Search
  try {
    const q = signWbi(
      {
        search_type: 'video',
        keyword: '猫',
        page: 1,
        page_size: 3,
        duration: 0,
        order: '',
        tids: 0,
      },
      mixinKey,
    );
    const search = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/search/type?${q}`,
    );
    if (search.code === 0 && search.data?.result?.length > 0) {
      ok('Search', `${search.data.result.length} results for "猫"`);
    } else {
      fail('Search', `code=${search.code} msg=${search.message}`);
    }
  } catch (e) {
    fail('Search', e.message);
  }

  // Test 7: Video info
  let testCid;
  try {
    const q = signWbi({ bvid: 'BV1GvXKBMEAb' }, mixinKey);
    const info = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/view?${q}`,
    );
    if (info.code === 0 && info.data?.cid) {
      testCid = info.data.cid;
      ok(
        'Video info',
        `cid=${testCid} title="${info.data.title?.slice(0, 30)}..."`,
      );
    } else {
      fail('Video info', `code=${info.code} msg=${info.message}`);
    }
  } catch (e) {
    fail('Video info', e.message);
  }

  // Test 8: Play URL (DASH)
  if (testCid) {
    try {
      const q = signWbi(
        {
          bvid: 'BV1GvXKBMEAb',
          cid: testCid,
          fnval: 4048,
          fnver: 0,
          fourk: 1,
          platform: 'pc',
          qn: 80,
        },
        mixinKey,
      );
      const play = await fetchJSON(
        `${PROXY}/proxy/api.bilibili.com/x/player/playurl?${q}`,
      );
      if (play.code === 0 && play.data?.dash) {
        const dash = play.data.dash;
        const hasVideo = dash.video?.length > 0 && dash.video[0].baseUrl;
        const hasAudio = dash.audio?.length > 0 && dash.audio[0].baseUrl;
        const hasSeg = dash.video?.[0]?.SegmentBase?.Initialization;
        if (hasVideo && hasAudio && hasSeg) {
          ok(
            'Play URL (DASH)',
            `${dash.video.length} video + ${dash.audio.length} audio streams, quality=${play.data.quality}`,
          );
        } else {
          fail(
            'Play URL (DASH)',
            `Missing baseUrl or SegmentBase: video=${hasVideo} audio=${hasAudio} seg=${hasSeg}`,
          );
        }
      } else {
        fail('Play URL (DASH)', `code=${play.code} msg=${play.message}`);
      }
    } catch (e) {
      fail('Play URL (DASH)', e.message);
    }
  }

  // Test 9: Danmaku
  if (testCid) {
    try {
      const res = await fetch(
        `${PROXY}/proxy/api.bilibili.com/x/v1/dm/list.so?oid=${testCid}`,
      );
      const text = await res.text();
      const count = (text.match(/<d /g) || []).length;
      if (count > 0) {
        ok('Danmaku', `${count} items parsed from XML`);
      } else {
        fail(
          'Danmaku',
          `No <d> tags found, response starts with: ${text.slice(0, 80)}`,
        );
      }
    } catch (e) {
      fail('Danmaku', e.message);
    }
  }

  // Test 10: Related videos
  try {
    const q = signWbi({ bvid: 'BV1GvXKBMEAb' }, mixinKey);
    const rel = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/archive/related?${q}`,
    );
    if (rel.code === 0 && rel.data?.length > 0) {
      ok('Related videos', `${rel.data.length} related`);
    } else {
      fail('Related videos', `code=${rel.code} msg=${rel.message}`);
    }
  } catch (e) {
    fail('Related videos', e.message);
  }

  // Test 11: Ranking
  try {
    const q = signWbi({ rid: 0, type: 'all' }, mixinKey);
    const rank = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/web-interface/ranking/v2?${q}`,
    );
    if (rank.code === 0 && rank.data?.list?.length > 0) {
      ok('Ranking', `${rank.data.list.length} videos`);
    } else {
      fail('Ranking', `code=${rank.code} msg=${rank.message}`);
    }
  } catch (e) {
    fail('Ranking', e.message);
  }

  // Test 12: Video segment proxy (test that CDN URLs can be proxied)
  console.log('\n[Video CDN]');
  try {
    const q = signWbi(
      {
        bvid: 'BV1GvXKBMEAb',
        cid: testCid,
        fnval: 4048,
        fnver: 0,
        fourk: 1,
        platform: 'pc',
        qn: 32,
      },
      mixinKey,
    );
    const play = await fetchJSON(
      `${PROXY}/proxy/api.bilibili.com/x/player/playurl?${q}`,
    );
    const videoUrl =
      play.data?.dash?.video?.[play.data.dash.video.length - 1]?.baseUrl;
    if (videoUrl) {
      const u = new URL(videoUrl);
      const proxyUrl = `${PROXY}/proxy/${u.host}${u.pathname}${u.search}`;
      const segRes = await fetch(proxyUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
      });
      if (segRes.status === 200 || segRes.status === 206) {
        const buf = await segRes.arrayBuffer();
        ok(
          'Video segment proxy',
          `Got ${buf.byteLength} bytes, status=${segRes.status}`,
        );
      } else {
        fail('Video segment proxy', `status=${segRes.status}`);
      }
    } else {
      fail('Video segment proxy', 'No video URL found');
    }
  } catch (e) {
    fail('Video segment proxy', e.message);
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(
    `Results: ${passed} passed, ${failed} failed, ${passed + failed} total`,
  );
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
