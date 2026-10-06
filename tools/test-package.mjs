// Invoked only through release.mjs --test. Immutable prerelease distribution;
// numeric webOS package version stays equal to the stable base for rollback.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const repo = 'asdf17128/bili-webos';
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const gh = args => run('gh', [...args, '--repo', repo]);
const json = path => JSON.parse(run('gh', ['api', 'repos/' + repo + path]));
const download = url => execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '90', url], { maxBuffer: 20 * 1024 * 1024 });
function stableSnapshot() {
  const release = json('/releases/latest');
  return { tag: release.tag_name, files: ['version.json', 'com.biliwebos.app.manifest.json'].map(name => {
    const asset = release.assets.find(a => a.name === name);
    if (!asset) throw new Error('Stable channel asset missing: ' + name);
    return { name, sha: hash(download(asset.browser_download_url)) };
  }) };
}
export async function distributeTestBuild(tag, args) {
  if (!/^v\d+\.\d+\.\d+-[a-z][a-z0-9.-]+$/.test(tag || '')) throw new Error('--test requires an explicit prerelease tag');
  const source = readFileSync('app/src/version.js', 'utf8');
  const version = (source.match(/APP_VERSION = '([^']+)'/) || [])[1];
  const build = (source.match(/TEST_BUILD = '([^']+)'/) || [])[1];
  if (!build || tag !== `v${version}-${build}`) throw new Error('Tag must match the visible test build label');
  if (JSON.parse(readFileSync('app/webos-meta/appinfo.json')).version !== version) throw new Error('webOS version mismatch');
  const notesIndex = args.indexOf('--notes-file'), notes = args[notesIndex + 1];
  if (notesIndex < 0 || !notes) throw new Error('A test plan in --notes-file is required');
  readFileSync(notes);
  const ipk = `app/dist/com.biliwebos.app_${version}_all.ipk`, bytes = readFileSync(ipk), sha = hash(bytes);
  const target = run('git', ['rev-parse', 'HEAD']);
  const name = `com.biliwebos.app_${version}_${build}_all.ipk`;
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ tag, target, name, sha, prerelease: true, latest: false, stableMetadata: false }, null, 2)); return;
  }
  run('gh', ['auth', 'status', '-h', 'github.com']);
  if (run('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Commit tracked changes before distributing the test build');
  const branch = run('git', ['branch', '--show-current']);
  if (branch === 'main' || !branch) throw new Error('Test builds require a separate source branch');
  const remote = run('git', ['ls-remote', 'origin', 'refs/heads/' + branch]).split(/\s/)[0];
  if (remote !== target) throw new Error('Push this exact test-build commit first');
  if (run('git', ['ls-remote', 'origin', 'refs/tags/' + tag])) throw new Error('Test tag already exists; choose a new build identifier');
  const before = stableSnapshot();
  if (before.tag !== 'v' + version) throw new Error('Stable base has changed; recheck the test build');
  const existing = json('/releases?per_page=100');
  if (existing.some(r => r.tag_name === tag)) throw new Error('Test build already exists; do not overwrite packages already tested');
  const dir = '.release/' + tag;
  mkdirSync(dir, { recursive: true });
  copyFileSync(ipk, dir + '/' + name);
  writeFileSync(dir + '/SHA256SUMS.txt', sha + '  ' + name + '\n');
  gh(['release', 'create', tag, dir + '/' + name, dir + '/SHA256SUMS.txt', '--target', target,
    '--title', `Test only: ${version} ${build}`, '--prerelease', '--latest=false', '--notes-file', notes]);
  const result = json('/releases/tags/' + tag);
  if (!result.prerelease || result.draft) throw new Error('Unexpected test distribution state');
  if (result.assets.some(a => /^(version\.json|com\.biliwebos\.app\.manifest\.json)$/.test(a.name))) throw new Error('Test package must not contain stable-channel metadata');
  const asset = result.assets.find(a => a.name === name);
  if (!asset || hash(download(asset.browser_download_url)) !== sha) throw new Error('Downloaded test package hash mismatch');
  const after = stableSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Stable channel changed during distribution; inspect before proceeding');
  console.log(JSON.stringify({ url: result.html_url, download: asset.browser_download_url, sha, stable: after }, null, 2));
}
