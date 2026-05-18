// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function expectedIpkName({ appId, version }) {
  if (!appId || !version) {
    throw new Error(
      'appId and version are required to derive the packaged IPK name',
    );
  }

  return `${appId}_${version}_all.ipk`;
}

export function renderReleaseManifest({ template, sha256 }) {
  if (!template || typeof template !== 'object') {
    throw new Error('A manifest template object is required');
  }
  if (!template.version) {
    throw new Error('Manifest template must include a version');
  }
  if (!template.ipkUrl || !template.ipkUrl.includes('{version}')) {
    throw new Error(
      'Manifest template ipkUrl must include a {version} placeholder',
    );
  }
  if (!sha256) {
    throw new Error(
      'A SHA-256 digest is required to render the final manifest',
    );
  }

  return {
    ...template,
    ipkUrl: template.ipkUrl.replaceAll('{version}', template.version),
    ipkHash: {
      sha256,
    },
  };
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

export function findExpectedIpk({ distDir, appId, version }) {
  const expectedName = expectedIpkName({ appId, version });
  const expectedPath = path.join(distDir, expectedName);

  if (!fs.existsSync(expectedPath)) {
    const available = fs.existsSync(distDir)
      ? fs.readdirSync(distDir).filter((file) => file.endsWith('.ipk'))
      : [];
    const availableLabel = available.length ? available.join(', ') : 'none';
    throw new Error(
      `Expected packaged IPK ${expectedName} in ${distDir}, found: ${availableLabel}`,
    );
  }

  return expectedPath;
}

export async function generateReleaseManifest({
  templatePath,
  distDir,
  outputPath,
}) {
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const ipkPath = findExpectedIpk({
    distDir,
    appId: template.id,
    version: template.version,
  });
  const sha256 = await sha256File(ipkPath);
  const manifest = renderReleaseManifest({ template, sha256 });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifest, ipkPath, sha256 };
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith('--')) continue;
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    args[key.slice(2)] = value;
    index += 1;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const templatePath = args.template ?? 'com.biliwebos.app.manifest.json';
  const distDir = args.dist ?? 'dist';
  const outputPath =
    args.output ??
    path.join(distDir, 'com.biliwebos.app.manifest.release.json');

  const result = await generateReleaseManifest({
    templatePath,
    distDir,
    outputPath,
  });

  console.log(`Generated ${outputPath}`);
  console.log(`Using ${path.basename(result.ipkPath)} (${result.sha256})`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
