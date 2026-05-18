import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  expectedIpkName,
  generateReleaseManifest,
  renderReleaseManifest,
} from './release-manifest.mjs';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-webos-release-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('release manifest helpers', () => {
  it('builds the native webOS ipk filename from app id and version', () => {
    expect(expectedIpkName({ appId: 'com.biliwebos.app', version: '1.2.3' })).toBe(
      'com.biliwebos.app_1.2.3_all.ipk',
    );
  });

  it('renders the final manifest by replacing the version placeholder and injecting the hash', () => {
    const rendered = renderReleaseManifest({
      template: {
        id: 'com.biliwebos.app',
        version: '1.2.3',
        ipkUrl: 'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
      },
      sha256: 'abc123',
    });

    expect(rendered).toEqual({
      id: 'com.biliwebos.app',
      version: '1.2.3',
      ipkUrl: 'https://github.com/dotennin/bili-webos/releases/download/v1.2.3/com.biliwebos.app_1.2.3_all.ipk',
      ipkHash: {
        sha256: 'abc123',
      },
    });
  });

  it('writes a final manifest from the template and packaged ipk', async () => {
    const dir = makeTempDir();
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const templatePath = path.join(dir, 'manifest.template.json');
    const outputPath = path.join(dir, 'manifest.final.json');
    const ipkPath = path.join(distDir, 'com.biliwebos.app_1.2.3_all.ipk');

    fs.writeFileSync(
      templatePath,
      `${JSON.stringify({
        id: 'com.biliwebos.app',
        version: '1.2.3',
        ipkUrl: 'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
      }, null, 2)}\n`,
    );
    fs.writeFileSync(ipkPath, 'release-binary');

    const result = await generateReleaseManifest({
      distDir,
      templatePath,
      outputPath,
    });

    expect(result.ipkPath).toBe(ipkPath);
    expect(result.manifest.ipkUrl).toContain('/v1.2.3/com.biliwebos.app_1.2.3_all.ipk');
    expect(result.manifest.ipkHash.sha256).toHaveLength(64);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(result.manifest);
  });

  it('fails when the expected packaged ipk is missing', async () => {
    const dir = makeTempDir();
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const templatePath = path.join(dir, 'manifest.template.json');
    fs.writeFileSync(
      templatePath,
      `${JSON.stringify({
        id: 'com.biliwebos.app',
        version: '1.2.3',
        ipkUrl: 'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
      }, null, 2)}\n`,
    );

    await expect(generateReleaseManifest({
      distDir,
      templatePath,
      outputPath: path.join(dir, 'manifest.final.json'),
    })).rejects.toThrow('Expected packaged IPK');
  });
});
