// 高保真设计稿生成器:用真实的推荐/历史/直播数据 + 真实封面(走本机 7654 代理)
// 渲染 1920×1080 截图,便于与 audit_*.png(现状)逐屏对比。
import fs from 'fs';
import { chromium } from 'playwright';

const S = process.env.S || (process.cwd() + '/docs/screenshots');
const D = JSON.parse(fs.readFileSync(`${S}/mock-data.json`, 'utf8'));
const px = (u) => {
  if (!u) return '';
  let s = u.startsWith('//') ? 'https:' + u : u;
  if (s.includes('hdslb.com') && !s.includes('@')) s += '@672w_420h_1c.webp';
  const p = new URL(s);
  return `http://127.0.0.1:7654/proxy/${p.host}${p.pathname}${p.search}`;
};
const dur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cnt = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n || 0);

// 线性单色图标(替换 emoji):24px 网格,1.8 描边 —— 3 米外靠形状识别,不靠颜色
const ICON = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  home: '<path d="M3.5 10.5L12 4l8.5 6.5V20a1 1 0 0 1-1 1h-4v-6h-7v6h-4a1 1 0 0 1-1-1z"/>',
  hot: '<path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5S9 11 10.5 11C10.5 8 12 6 12 3z"/>',
  live: '<rect x="3" y="5.5" width="18" height="12" rx="2"/><path d="M9 21h6"/><path d="M10.5 9.5l4 2.5-4 2.5z"/>',
  follow: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
  fav: '<path d="M12 4l2.4 5 5.6.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.6-.8z"/>',
  later: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
  game: '<rect x="3" y="7.5" width="18" height="9.5" rx="4"/><path d="M7.5 10.5v3M6 12h3M15.5 11.5h.01M17.5 13.5h.01"/>',
  anime: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  know: '<path d="M4 5.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-1.6H4z"/><path d="M20 5.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-1.6h6z"/>',
  fun: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  me: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3 1.8"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
};
const icon = (k, size = 26) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ''}</svg>`;

const NAV = [
  ['search', '搜索'], null,
  ['home', '推荐'], ['hot', '热门'], ['live', '直播'], ['follow', '关注'], ['fav', '收藏'], ['later', '稍后再看'], null,
  ['game', '游戏'], ['anime', '动画'], ['music', '音乐'], ['know', '知识'], ['fun', '娱乐'], null,
  ['me', '我的'], ['cog', '设置'],
];

const sidebar = (activeIdx) => `
<nav class="rail">
  <div class="brand"><span class="mark">Bili</span><span class="markb">TV</span></div>
  ${NAV.map((n, i) => n === null ? '<div class="rule"></div>' :
    `<div class="navitem${i === activeIdx ? ' on' : ''}">${icon(n[0])}<span>${n[1]}</span></div>`).join('')}
  <div class="who"><div class="ava"></div><span>asdf17128</span></div>
</nav>`;

const card = (v, opts = {}) => `
<div class="card${opts.focus ? ' focus' : ''}">
  <div class="thumb">
    <img src="${px(v.pic)}">
    ${v.dur ? `<span class="dur">${dur(v.dur)}</span>` : ''}
    ${opts.liveBadge ? `<span class="livebadge">直播中</span>` : ''}
    ${opts.progress ? `<i class="prog" style="width:${opts.progress}%"></i>` : ''}
  </div>
  <div class="meta">
    <div class="t">${v.title}</div>
    <div class="s">${v.up || ''}${v.view ? ' · ' + cnt(v.view) + '播放' : ''}${v.online ? ' · ' + cnt(v.online) + '人在看' : ''}</div>
  </div>
</div>`;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--fg);
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
:root{
  --bg:#141518; --rail:#1a1b1f; --card:#1e1f24; --line:#2a2b31;
  --fg:#f2f2f4; --fg2:#a1a4ad; --fg3:#7e828c;
  --pink:#fb7299; --focus:#ffffff;
  --r:14px;
}
.app{display:flex;height:1080px}
.rail{width:236px;flex:0 0 236px;background:var(--rail);padding:26px 0 0;display:flex;flex-direction:column;
  border-right:1px solid var(--line)}
.brand{padding:0 26px 22px;font-size:30px;font-weight:700;letter-spacing:.5px}
.mark{color:var(--fg)} .markb{color:var(--pink)}
.rule{height:1px;background:var(--line);margin:12px 22px}
.navitem{display:flex;align-items:center;gap:15px;padding:12px 26px;font-size:21px;color:var(--fg2);border-radius:0}
.navitem.on{color:var(--fg);font-weight:600}
.navitem.on::before{content:'';position:absolute;left:0;width:4px;height:34px;background:var(--pink);border-radius:0 4px 4px 0}
.navitem.on{position:relative;background:linear-gradient(90deg,rgba(251,114,153,.14),transparent 70%)}
.who{margin-top:auto;display:flex;align-items:center;gap:12px;padding:20px 26px;border-top:1px solid var(--line);
  font-size:18px;color:var(--fg2)}
.ava{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#fb7299,#3a3b44)}
.main{flex:1;padding:34px 44px 0;overflow:hidden}
.h1{font-size:15px;letter-spacing:3px;text-transform:uppercase;color:var(--fg3);margin:0 0 14px}
.sec{font-size:24px;font-weight:600;margin:0 0 16px;display:flex;align-items:baseline;gap:14px}
.sec small{font-size:17px;color:var(--fg3);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;margin-bottom:34px}
.card{background:var(--card);border-radius:var(--r);overflow:hidden;position:relative}
.card .thumb{position:relative;width:100%;height:0;padding-top:56.25%;background:#26272d;overflow:hidden}
.card .thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.dur{position:absolute;right:10px;bottom:10px;background:rgba(0,0,0,.72);border-radius:6px;
  padding:3px 8px;font-size:17px;color:#fff}
.livebadge{position:absolute;left:10px;top:10px;background:var(--pink);border-radius:6px;padding:3px 9px;
  font-size:17px;font-weight:600;color:#fff}
.prog{position:absolute;left:0;bottom:0;height:5px;background:var(--pink)}
.meta{padding:14px 16px 16px;height:112px}
.t{font-size:22px;line-height:1.35;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;margin-bottom:8px}
.s{font-size:18px;color:var(--fg3)}
.card.focus{transform:scale(1.04);z-index:5;box-shadow:0 22px 44px rgba(0,0,0,.6)}
.card.focus::after{content:'';position:absolute;inset:0;border:4px solid var(--focus);border-radius:var(--r);pointer-events:none}
`;

const page = (body, extra = '') => `<!doctype html><html><head><meta charset="utf-8">
<style>${CSS}${extra}</style></head><body>${body}</body></html>`;

// ── 方案 A:安静的画廊(内容优先,chrome 退到背景) ─────────────────────
const homeA = page(`
<div class="app">${sidebar(2)}
  <div class="main">
    <div class="sec">继续观看 <small>接着上次的进度</small></div>
    <div class="row">
      ${D.h.slice(0, 4).map((v, i) => card(v, { progress: v.dur ? Math.min(96, Math.round((v.progress || 0) / v.dur * 100)) || 38 : 38, focus: i === 0 })).join('')}
    </div>
    <div class="sec">为你推荐</div>
    <div class="grid">${D.items.slice(0, 6).map(v => card(v)).join('')}</div>
  </div>
</div>`);

// ── 方案 B:焦点即预览(用空出来的画布做大图上下文) ────────────────────
const hero = D.items[0];
const homeB = page(`
<div class="app">${sidebar(2)}
  <div class="main" style="padding:0">
    <div class="hero">
      <img class="herobg" src="${px(hero.pic)}">
      <div class="heroshade"></div>
      <div class="herotext">
        <div class="herokick">正在选中 · 为你推荐</div>
        <div class="herotitle">${hero.title}</div>
        <div class="herosub">${hero.up} · ${cnt(hero.view)}播放 · ${dur(hero.dur)}</div>
      </div>
    </div>
    <div class="strip">
      ${D.items.slice(0, 5).map((v, i) => `
        <div class="mini${i === 0 ? ' focus' : ''}">
          <div class="thumb"><img src="${px(v.pic)}"><span class="dur">${dur(v.dur)}</span></div>
          <div class="mt">${v.title}</div>
        </div>`).join('')}
    </div>
  </div>
</div>`, `
.hero{position:relative;height:560px;overflow:hidden}
.herobg{width:100%;height:100%;object-fit:cover;filter:saturate(.9)}
.heroshade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(20,21,24,.96) 22%,rgba(20,21,24,.25) 62%,rgba(20,21,24,.9)),
  linear-gradient(0deg,var(--bg),transparent 46%)}
.herotext{position:absolute;left:56px;bottom:64px;max-width:820px}
.herokick{font-size:17px;letter-spacing:2px;color:var(--pink);margin-bottom:14px;font-weight:600}
.herotitle{font-size:44px;line-height:1.25;font-weight:700;margin-bottom:16px}
.herosub{font-size:20px;color:var(--fg2)}
.strip{display:grid;grid-template-columns:repeat(5,1fr);gap:20px;padding:0 44px}
.mini{background:var(--card);border-radius:var(--r);overflow:hidden;position:relative}
.mini .thumb{position:relative;width:100%;height:0;padding-top:56.25%;background:#26272d}
.mini .thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mt{padding:12px 14px 16px;font-size:19px;line-height:1.3;height:78px;overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mini.focus{transform:scale(1.05);z-index:5;box-shadow:0 22px 44px rgba(0,0,0,.6)}
.mini.focus::after{content:'';position:absolute;inset:0;border:4px solid #fff;border-radius:var(--r)}
`);

// ── 搜索页重做(现状:右半屏全空) ─────────────────────────────────────
const HOT = ['LGD TT', '如何理解奥德修斯的两难选择', '作品深度是新时代的审美谎言', '烽火职业联赛夏季赛',
  'UP主复刻痴迷同款许愿柳玩具版', '央视评日防卫白皮书', '7月新番的大火猛炒', '歌手2026总决赛阵容官宣'];
const searchA = page(`
<div class="app">${sidebar(0)}
  <div class="main">
    <div class="searchbar"><span class="si">${icon('search', 30)}</span><span class="ph">搜索视频、UP主、番剧</span></div>
    <div class="scols">
      <div>
        <div class="sec">热搜榜</div>
        <div class="hotlist">
          ${HOT.map((h, i) => `<div class="hotrow${i === 0 ? ' focus' : ''}">
            <span class="rank r${i < 3 ? 'top' : ''}">${i + 1}</span><span class="ht">${h}</span></div>`).join('')}
        </div>
      </div>
      <div>
        <div class="sec">最近搜索</div>
        <div class="chips">${['原神', '罗翔', 'LOL 全球总决赛', '手工耿', '黑神话'].map(c => `<span class="chip">${c}</span>`).join('')}</div>
        <div class="sec" style="margin-top:34px">猜你想看</div>
        <div class="row2">${D.items.slice(6, 10).map(v => card(v)).join('')}</div>
      </div>
    </div>
  </div>
</div>`, `
.searchbar{display:flex;align-items:center;gap:16px;height:74px;border-radius:16px;background:var(--card);
  border:2px solid var(--line);padding:0 24px;margin-bottom:30px}
.si{color:var(--fg3);display:flex}
.ph{font-size:23px;color:var(--fg3)}
.scols{display:grid;grid-template-columns:1fr 1.25fr;gap:52px}
.hotlist{display:flex;flex-direction:column;gap:6px}
.hotrow{display:flex;align-items:center;gap:18px;padding:13px 16px;border-radius:12px;font-size:22px}
.hotrow.focus{background:var(--card);position:relative}
.hotrow.focus::after{content:'';position:absolute;inset:0;border:3px solid #fff;border-radius:12px}
.rank{width:30px;text-align:center;font-size:20px;color:var(--fg3);font-weight:600}
.rank.rtop{color:var(--pink)}
.chips{display:flex;flex-wrap:wrap;gap:12px}
.chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:10px 20px;font-size:20px;color:var(--fg2)}
.row2{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
`);

const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, html] of [['A_home', homeA], ['B_home', homeB], ['A_search', searchA]]) {
  await p.setContent(html);
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `${S}/mock_${name}.png` });
  console.log('rendered', name);
}
await b.close();
