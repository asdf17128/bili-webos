import { test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(import.meta.dir, 'LivePlayerPage.jsx'), 'utf8');

function extractFunction(name) {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n}`);
  const m = source.match(re);
  if (!m) throw new Error(`missing function ${name}`);
  return m[0];
}

const getMpegtsModule = new Function(`${extractFunction('getMpegtsModule')}; return getMpegtsModule;`)();
const configureShakaForLive = new Function(`${extractFunction('configureShakaForLive')}; return configureShakaForLive;`)();

test('getMpegtsModule prefers default export and falls back to module itself', () => {
  expect(getMpegtsModule({ default: { x: 1 }, y: 2 })).toEqual({ x: 1 });
  expect(getMpegtsModule({ y: 2 })).toEqual({ y: 2 });
  expect(getMpegtsModule(null)).toBeNull();
});

test('configureShakaForLive sets low latency streaming config', () => {
  const calls = [];
  const fakePlayer = { configure: (arg) => calls.push(arg) };
  configureShakaForLive(fakePlayer);
  expect(calls).toHaveLength(1);
  expect(calls[0].streaming.lowLatencyMode).toBe(true);
  expect(calls[0].streaming.stallThreshold).toBe(0.5);
});
