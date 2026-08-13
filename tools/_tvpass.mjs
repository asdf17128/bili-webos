// 电视 SSH 私钥的口令来源。以前这个值直接硬编码在 17 个工具里(PR #21 by @anupamme
// 指出了其中一个),配上同样硬编码的 IP/端口就是一整套可用凭据。
//
// 现在只从两个地方取,都在仓库之外:
//   1. 环境变量 TV_SSH_PASSPHRASE
//   2. ~/.ssh/tv_webos.pass —— 和私钥放一起,chmod 600
//
// 取不到就**明确报错退出**,不静默用空口令(那样 ssh2 会抛一个看不懂的解密错误)。
import { readFileSync, existsSync } from 'fs';

export function tvPassphrase(argvValue) {
  if (argvValue) return argvValue;
  if (process.env.TV_SSH_PASSPHRASE) return process.env.TV_SSH_PASSPHRASE;
  const file = process.env.HOME + '/.ssh/tv_webos.pass';
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim();
    if (v) return v;
  }
  console.error(
    '缺少电视 SSH 私钥口令。设置其一:\n' +
    '  export TV_SSH_PASSPHRASE=xxxxxx\n' +
    `  或写入 ${file}(chmod 600)\n` +
    '口令来自电视上的 Developer Mode app。'
  );
  process.exit(2);
}
