import { test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(import.meta.dir, 'PlayerPage.tsx'),
  'utf8',
);

function extractFunction(name) {
  const sig = `function ${name}(`;
  const start = source.indexOf(sig);
  if (start < 0) throw new Error(`missing function ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const escapeXml = new Function(
  `${extractFunction('escapeXml')}; return escapeXml;`,
)();
const buildMPD = new Function(
  'escapeXml',
  `${extractFunction('buildMPD')}; return buildMPD;`,
)(escapeXml);
const browserAppIdMatch = source.match(
  /const WEBOS_BROWSER_APP_ID = '([^']+)'/,
);
if (!browserAppIdMatch) throw new Error('missing WEBOS_BROWSER_APP_ID');
const supportsPlaybackSpeedControl = new Function(
  'WEBOS_BROWSER_APP_ID',
  `${extractFunction('supportsPlaybackSpeedControl')}; return supportsPlaybackSpeedControl;`,
)(browserAppIdMatch[1]);
const getActiveSubtitleText = new Function(
  `${extractFunction('getActiveSubtitleText')}; return getActiveSubtitleText;`,
)();

test('escapeXml encodes xml-sensitive characters', () => {
  expect(escapeXml('a&b<c>"')).toBe('a&amp;b&lt;c&gt;&quot;');
});

test('buildMPD emits both video/audio adaptation sets and escaped URLs', () => {
  const dash = {
    duration: 100,
    minBufferTime: 2,
    video: [{ id: 80, baseUrl: 'https://x/v?a=1&b=2', bandwidth: 900000 }],
    audio: [{ id: 30216, base_url: 'https://x/a<1>.m4a', bandwidth: 128000 }],
  };
  const mpd = buildMPD(dash);
  expect(mpd).toContain('mediaPresentationDuration="PT100S"');
  expect(mpd).toContain('contentType="video"');
  expect(mpd).toContain('contentType="audio"');
  expect(mpd).toContain('https://x/v?a=1&amp;b=2');
  expect(mpd).toContain('https://x/a&lt;1&gt;.m4a');
});

test('buildMPD supports empty tracks', () => {
  const mpd = buildMPD({ duration: 0, minBufferTime: 1, video: [], audio: [] });
  expect(mpd).toContain('<Period></Period>');
});

test('supportsPlaybackSpeedControl disables speed in packaged webos apps only', () => {
  const originalWindow = globalThis.window;

  globalThis.window = {};
  expect(supportsPlaybackSpeedControl()).toBe(true);

  globalThis.window = {
    PalmSystem: { identifier: 'com.webos.app.browser' },
  };
  expect(supportsPlaybackSpeedControl()).toBe(true);

  globalThis.window = {
    PalmSystem: { identifier: 'com.biliwebos.app' },
  };
  expect(supportsPlaybackSpeedControl()).toBe(false);

  globalThis.window = originalWindow;
});

test('getActiveSubtitleText returns active cues and preserves overlapping lines', () => {
  const cues = [
    { from: 1, to: 3, content: '第一行' },
    { from: 2, to: 4, content: '第二行' },
    { from: 5, to: 6, content: '稍后' },
  ];

  expect(getActiveSubtitleText(cues, 2.5)).toBe('第一行\n第二行');
  expect(getActiveSubtitleText(cues, 4)).toBe('');
});
