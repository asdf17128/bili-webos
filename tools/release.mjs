// 发版:打包 → 生成三件资产 → 建 release → **回头验证线上真的可用**。
//
// 为什么必须有这个脚本(2026-08-31 的事故):v1.7.0 我用 `gh release create`
// 只挂了 ipk,漏了 version.json 和 manifest。后果不是"少个文件":
//   1. app 查更新走 releases/latest/download/version.json → 全部电视 404,
//      连带我们的 DAU 计数(就是这个资产的下载数)冻死 15 小时;
//   2. webOS Homebrew 目录的 manifestUrl 也指 latest/download/…manifest.json
//      → 目录侧看不到新版本,更新根本铺不出去。
// 两件事都**悄无声息**:GitHub 上 release 页面看着一切正常。
//
// 所以这里做两件机器能做、人会忘的事:三件资产一起挂,挂完立刻当外人访问一遍。
//
// Usage: node tools/release.mjs v1.7.1 [--notes-file path]
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';

const TAG = process.argv[2];
const CHECK_ONLY = TAG === '--check';
if (!CHECK_ONLY && !/^v\d+\.\d+\.\d+$/.test(TAG || '')) {
  console.error('用法: node tools/release.mjs v1.7.1 [--notes-file notes.md]');
  console.error('     node tools/release.mjs --check     # 只体检线上,不发版');
  process.exit(2);
}
let VER = CHECK_ONLY ? null : TAG.slice(1);
const notesIdx = process.argv.indexOf('--notes-file');
const NOTES = notesIdx > 0 ? process.argv[notesIdx + 1] : null;
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

// --check:以外人身份体检当前 latest,任何一项不通就非零退出。
// 这条路径可以随时跑,也可以挂进定时任务 —— 发版翻车是**静默**的
// (release 页面看着一切正常),只有从外面访问才发现得了。
if (CHECK_ONLY) {
  const base = 'https://github.com/asdf17128/bili-webos/releases/latest/download/';
  let v;
  try { v = JSON.parse(sh('curl', ['-sL', base + 'version.json'])).version; }
  catch (e) { console.error('❌ latest 的 version.json 取不到或不是 JSON —— app 查更新和 DAU 计数都断了'); process.exit(1); }
  let m;
  try { m = JSON.parse(sh('curl', ['-sL', base + 'com.biliwebos.app.manifest.json'])); }
  catch (e) { console.error('❌ latest 的 manifest 取不到 —— Homebrew 目录看不到这个版本'); process.exit(1); }
  const ipkCode = sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-L', base + m.ipkUrl]);
  const problems = [];
  if (m.version !== v) problems.push(`manifest ${m.version} 与 version.json ${v} 不一致`);
  if (ipkCode !== '200') problems.push(`manifest 指向的 ipk 取不到(${ipkCode})`);
  if (problems.length) { console.error('❌ ' + problems.join(' · ')); process.exit(1); }
  console.log(`✅ 线上体检通过:latest = ${v} · manifest ${m.version} · ipk 可下载`);
  process.exit(0);
}

// 1. 版本号一致性:appinfo / version.js / tag 三处必须相同
const appinfo = JSON.parse(readFileSync('app/webos-meta/appinfo.json', 'utf8')).version;
const srcVer = (readFileSync('app/src/version.js', 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
if (appinfo !== VER || srcVer !== VER) {
  console.error(`版本不一致: tag=${VER} appinfo=${appinfo} version.js=${srcVer}`);
  process.exit(1);
}

// 2. 三件资产
const IPK = `app/dist/com.biliwebos.app_${VER}_all.ipk`;
const sha = createHash('sha256').update(readFileSync(IPK)).digest('hex');
mkdirSync('.release', { recursive: true });
writeFileSync('.release/version.json', JSON.stringify({ version: VER }) + '\n');
writeFileSync('.release/com.biliwebos.app.manifest.json', JSON.stringify({
  id: 'com.biliwebos.app', version: VER, type: 'web', title: 'BiliTV',
  appDescription: 'Bilibili client for webOS TV',
  iconUri: 'https://raw.githubusercontent.com/asdf17128/bili-webos/main/app/webos-meta/largeIcon.png',
  sourceUrl: 'https://github.com/asdf17128/bili-webos',
  rootRequired: false,
  ipkUrl: `com.biliwebos.app_${VER}_all.ipk`,
  ipkHash: { sha256: sha },
}, null, 2) + '\n');

// 3. 建 release(已存在就只补资产)
const assets = [IPK, '.release/version.json', '.release/com.biliwebos.app.manifest.json'];
let exists = true;
try { sh('gh', ['release', 'view', TAG]); } catch (e) { exists = false; }
if (exists) {
  console.log(`${TAG} 已存在,补挂资产`);
  sh('gh', ['release', 'upload', TAG, ...assets, '--clobber']);
} else {
  const args = ['release', 'create', TAG, ...assets];
  if (NOTES) args.push('--notes-file', NOTES);
  sh('gh', args);
}

// 4. 以外人身份验证 —— 这一步才是这个脚本存在的理由
const base = 'https://github.com/asdf17128/bili-webos/releases/latest/download/';
const need = ['version.json', 'com.biliwebos.app.manifest.json', `com.biliwebos.app_${VER}_all.ipk`];
let ok = true;
for (let attempt = 1; attempt <= 6; attempt++) {
  ok = true;
  for (const f of need) {
    const code = sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-L', base + f]);
    if (code !== '200') { ok = false; console.log(`  ${f} → ${code}(第 ${attempt} 次)`); }
  }
  if (ok) break;
  sh('sleep', ['10']);   // GitHub 的资产刚上传有几十秒生效延迟
}
if (!ok) { console.error('❌ latest/download 下有资产取不到,发版没完成'); process.exit(1); }

const liveVer = JSON.parse(sh('curl', ['-sL', base + 'version.json'])).version;
const liveManifest = JSON.parse(sh('curl', ['-sL', base + 'com.biliwebos.app.manifest.json']));
if (liveVer !== VER) { console.error(`❌ latest 的 version.json 是 ${liveVer},不是 ${VER}`); process.exit(1); }
if (liveManifest.ipkHash.sha256 !== sha) { console.error('❌ manifest 里的 sha256 与 ipk 不符'); process.exit(1); }

console.log(`✅ ${TAG} 发布完成并已验证:`);
console.log(`   version.json = ${liveVer}(app 查更新 + DAU 计数都靠它)`);
console.log(`   manifest    = ${liveManifest.version} · sha256 匹配(Homebrew 目录靠它)`);
console.log(`   ipk         = ${(readFileSync(IPK).length / 1024).toFixed(0)} KB`);
