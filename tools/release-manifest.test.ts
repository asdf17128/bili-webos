import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  expectedIpkName,
  findExpectedIpk,
  generateReleaseManifest,
  renderReleaseManifest,
  sha256File,
} from './release-manifest.ts';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-webos-release-'));
  tempDirs.push(dir);
  return dir;
}

function bunBin() {
  return process.env.BUN_BIN || path.join(os.homedir(), '.bun/bin/bun');
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('release manifest helpers', () => {
  it('builds the native webOS ipk filename from app id and version', () => {
    expect(
      expectedIpkName({ appId: 'com.biliwebos.app', version: '1.2.3' }),
    ).toBe('com.biliwebos.app_1.2.3_all.ipk');
  });

  it('rejects missing app id or version when deriving ipk names', () => {
    expect(() => expectedIpkName({ appId: '', version: '1.2.3' })).toThrow(
      'appId and version are required',
    );
    expect(() =>
      expectedIpkName({ appId: 'com.biliwebos.app', version: '' }),
    ).toThrow('appId and version are required');
  });

  it('renders the final manifest by replacing the version placeholder and injecting the hash', () => {
    const rendered = renderReleaseManifest({
      template: {
        id: 'com.biliwebos.app',
        version: '1.2.3',
        ipkUrl:
          'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
      },
      sha256: 'abc123',
    });

    expect(rendered).toEqual({
      id: 'com.biliwebos.app',
      version: '1.2.3',
      ipkUrl:
        'https://github.com/dotennin/bili-webos/releases/download/v1.2.3/com.biliwebos.app_1.2.3_all.ipk',
      ipkHash: {
        sha256: 'abc123',
      },
    });
  });

  it('validates release manifest inputs before rendering', () => {
    expect(() =>
      renderReleaseManifest({
        template: null,
        sha256: 'abc123',
      }),
    ).toThrow('manifest template object is required');
    expect(() =>
      renderReleaseManifest({
        template: {
          id: 'com.biliwebos.app',
          ipkUrl: 'https://example.com/app_{version}.ipk',
        },
        sha256: 'abc123',
      }),
    ).toThrow('Manifest template must include a version');
    expect(() =>
      renderReleaseManifest({
        template: {
          id: 'com.biliwebos.app',
          version: '1.2.3',
          ipkUrl: 'https://example.com/app.ipk',
        },
        sha256: 'abc123',
      }),
    ).toThrow('ipkUrl must include a {version} placeholder');
    expect(() =>
      renderReleaseManifest({
        template: {
          id: 'com.biliwebos.app',
          version: '1.2.3',
          ipkUrl: 'https://example.com/app_{version}.ipk',
        },
        sha256: '',
      }),
    ).toThrow('SHA-256 digest is required');
  });

  it('finds an expected ipk and hashes its contents', async () => {
    const dir = makeTempDir();
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const ipkPath = path.join(distDir, 'com.biliwebos.app_1.2.3_all.ipk');
    fs.writeFileSync(ipkPath, 'release-binary');

    expect(
      findExpectedIpk({
        distDir,
        appId: 'com.biliwebos.app',
        version: '1.2.3',
      }),
    ).toBe(ipkPath);
    expect(await sha256File(ipkPath)).toHaveLength(64);
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
      `${JSON.stringify(
        {
          id: 'com.biliwebos.app',
          version: '1.2.3',
          ipkUrl:
            'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(ipkPath, 'release-binary');

    const result = await generateReleaseManifest({
      distDir,
      templatePath,
      outputPath,
    });

    expect(result.ipkPath).toBe(ipkPath);
    expect(result.manifest.ipkUrl).toContain(
      '/v1.2.3/com.biliwebos.app_1.2.3_all.ipk',
    );
    expect(result.manifest.ipkHash.sha256).toHaveLength(64);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(
      result.manifest,
    );
  });

  it('fails when the expected packaged ipk is missing', async () => {
    const dir = makeTempDir();
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const templatePath = path.join(dir, 'manifest.template.json');
    fs.writeFileSync(
      templatePath,
      `${JSON.stringify(
        {
          id: 'com.biliwebos.app',
          version: '1.2.3',
          ipkUrl:
            'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      generateReleaseManifest({
        distDir,
        templatePath,
        outputPath: path.join(dir, 'manifest.final.json'),
      }),
    ).rejects.toThrow('Expected packaged IPK');
  });

  it('lists available ipks when the expected package name is missing', () => {
    const dir = makeTempDir();
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'other-package.ipk'), 'x');

    expect(() =>
      findExpectedIpk({
        distDir,
        appId: 'com.biliwebos.app',
        version: '1.2.3',
      }),
    ).toThrow('found: other-package.ipk');
  });

  it('cli writes the manifest and reports the generated output path', () => {
    const dir = makeTempDir();
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const templatePath = path.join(dir, 'manifest.template.json');
    const outputPath = path.join(dir, 'nested/manifest.final.json');
    const ipkPath = path.join(distDir, 'com.biliwebos.app_1.2.3_all.ipk');

    fs.writeFileSync(
      templatePath,
      `${JSON.stringify(
        {
          id: 'com.biliwebos.app',
          version: '1.2.3',
          ipkUrl:
            'https://github.com/dotennin/bili-webos/releases/download/v{version}/com.biliwebos.app_{version}_all.ipk',
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(ipkPath, 'release-binary');

    const output = execFileSync(
      bunBin(),
      [
        'tools/release-manifest.ts',
        '--template',
        templatePath,
        '--dist',
        distDir,
        '--output',
        outputPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(output).toContain(`Generated ${outputPath}`);
    expect(output).toContain('Using com.biliwebos.app_1.2.3_all.ipk');
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).ipkHash.sha256).toHaveLength(64);
  });

  it('cli reports missing argument values and exits non-zero', () => {
    expect(() =>
      execFileSync(bunBin(), ['tools/release-manifest.ts', '--template'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow('Missing value for --template');
  });
});
