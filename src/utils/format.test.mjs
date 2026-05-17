import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { formatCount, formatDuration, formatTime, QUALITY_MAP } from './format.js';

describe('format helpers', () => {
  let nowSpy;

  beforeEach(() => {
    nowSpy = globalThis.Date.now;
    globalThis.Date.now = () => 1715760000000; // 2024-05-15T08:00:00.000Z
  });

  afterEach(() => {
    globalThis.Date.now = nowSpy;
  });

  it('formatCount handles empty/large/small values', () => {
    expect(formatCount(undefined)).toBe('');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1234');
    expect(formatCount(12345)).toBe('1.2万');
    expect(formatCount(320000000)).toBe('3.2亿');
  });

  it('formatDuration handles empty and hh:mm:ss formatting', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3605.7)).toBe('1:00:05');
  });

  it('formatTime returns relative values and date fallback', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(formatTime(0)).toBe('');
    expect(formatTime(nowSeconds - 20)).toBe('刚刚');
    expect(formatTime(nowSeconds - 120)).toBe('2分钟前');
    expect(formatTime(nowSeconds - 3 * 3600)).toBe('3小时前');
    expect(formatTime(nowSeconds - 2 * 86400)).toBe('2天前');
    expect(formatTime(nowSeconds - 60 * 86400)).toBe('2024-03-16');
  });

  it('QUALITY_MAP contains expected key labels', () => {
    expect(QUALITY_MAP[127]).toBe('8K');
    expect(QUALITY_MAP[120]).toBe('4K');
    expect(QUALITY_MAP[16]).toBe('360P');
  });
});
