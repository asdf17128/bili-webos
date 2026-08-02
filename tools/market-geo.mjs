// 路径 C 的测量:用「生态参与者的地理构成」当分配钥匙,把全球 Homebrew 装机切出中国份额。
//
// 思路:全球活跃装机 H_G 是硬数据(ipk 下载),缺的只是中国占比 s。s 必须由一把
// **与我们自身数据无关**的钥匙来量,否则就是循环论证(见 docs/MARKET-SIZE.md §三之6)。
// 这里的钥匙是:webOS Homebrew 生态各仓库的 issue 作者,其 GitHub 资料里的 location。
//
// 已知这把钥匙**系统性低估**中国份额,偏差拆成两项、其中一项可实测:
//   β_fill  = 填写 location 的比例之比(全球生态 / 中文受众)  ← 本脚本实测
//   β_voice = 中文用户在英文仓库开 issue 的倾向折减           ← 先验,写在文档里
// 中文受众的样本用我们自己仓库的 star 用户(唯一能拿到的、确定是中文受众的名单)。
//
// 注意:GitHub 的 stargazers 端点对非本人仓库需要相应 token 权限;生态仓库只读 issue 作者。
// Usage: node tools/market-geo.mjs   → 打印并追加 tools/.market-geo.jsonl
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/.market-geo.jsonl');
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'bilitv-market-geo' };

const api = async (p) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://api.github.com' + p, { headers: H });
    if (r.ok) return r.json();
    if (r.status === 403 || r.status === 429) { await new Promise(s => setTimeout(s, 3000)); continue; }
    return null;
  }
  return null;
};

const ECO = [
  'webosbrew/webos-homebrew-channel',
  'webosbrew/youtube-webos',
  'mariotaku/moonlight-tv',
  'webosbrew/dev-manager-desktop',
  'webosbrew/webos-userscripts',
];
// 只认可识别的中文地名。写着汉字但不是地名的(玩梗)另计,见下。
const CN = /(^|[^a-z])(china|prc|中国|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu|北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|苏州|重庆|天津|青岛|厦门|大连|ganzhou|nanjing|wuhan|xi'?an|suzhou|chongqing|tianjin|qingdao|xiamen|dalian)([^a-z]|$)/i;
const HAN = /[一-鿿]/, KANA = /[぀-ヿ]/, HANGUL = /[가-힯]/;

async function profiles(logins) {
  const out = [];
  let idx = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (idx < logins.length) {
      const l = logins[idx++];
      const u = await api('/users/' + l);
      if (u) out.push((u.location || '').trim());
    }
  }));
  return out;
}

const tally = (locs) => {
  const filled = locs.filter(Boolean);
  const cn = filled.filter(l => CN.test(l));
  // 玩梗式中文 location(「层峦叠嶂山中树下」)——正则识别不了,但确定是中文用户
  const cnText = filled.filter(l => !CN.test(l) && HAN.test(l) && !KANA.test(l) && !HANGUL.test(l));
  return { n: locs.length, filled: filled.length, cn: cn.length, cnText: cnText.length };
};

// A. 生态样本:issue 作者
const authors = new Set();
for (const repo of ECO) {
  for (let page = 1; page <= 10; page++) {
    const items = await api(`/repos/${repo}/issues?state=all&per_page=100&page=${page}`);
    if (!items || !items.length) break;
    for (const it of items) if (it.user?.login && !/\[bot\]$/.test(it.user.login)) authors.add(it.user.login);
  }
}
const eco = tally(await profiles([...authors]));

// B. 中文受众样本:我们自己仓库的 star 用户
let stars = [];
for (let page = 1; page <= 5; page++) {
  const b = await api(`/repos/asdf17128/bili-webos/stargazers?per_page=100&page=${page}`);
  if (!b || !b.length) break;
  stars = stars.concat(b.map(u => u.login));
}
const mine = tally(await profiles(stars));

const row = {
  ts: new Date().toISOString(),
  eco, mine,
  sRaw: +((eco.cn + eco.cnText) / eco.filled).toFixed(5),          // 生态参与者里的中国占比(未修偏)
  betaFill: +((eco.filled / eco.n) / (mine.filled / mine.n)).toFixed(3), // 填写率之比 = 可实测的那半边偏差
};
fs.appendFileSync(OUT, JSON.stringify(row) + '\n');

console.log(`[生态] ${eco.n} 个 issue 作者 · 填 location ${eco.filled} 人(${(eco.filled / eco.n * 100).toFixed(0)}%)`);
console.log(`       中国相关 ${eco.cn} + 中文玩梗 ${eco.cnText} → 原始中国占比 ${(row.sRaw * 100).toFixed(2)}%`);
console.log(`[中文受众] 我们 ${mine.n} 个 star 用户 · 填 location ${mine.filled} 人(${(mine.filled / mine.n * 100).toFixed(0)}%)`);
console.log(`β_fill(填写率之比,中文用户少填 location 的修偏)= ${row.betaFill}`);
console.log(`→ 交给 tools/market-mc.mjs 的路径 C 使用`);
