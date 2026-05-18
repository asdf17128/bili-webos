import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getWbiKeys, signWbi, md5 } from './wbi.ts';

describe('wbi helpers', () => {
  let nowSpy;

  beforeEach(() => {
    nowSpy = globalThis.Date.now;
  });

  afterEach(() => {
    globalThis.Date.now = nowSpy;
  });

  it('md5 matches known digest', () => {
    expect(md5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('md5 handles long inputs across block and tail branches', () => {
    expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
    expect(md5('a'.repeat(60))).toBe('cc7ed669cf88f201c3297c6a91e1d18d');
  });

  it('getWbiKeys fetches and caches values within ttl', async () => {
    globalThis.Date.now = () => 1_000_000;
    const calls = [];
    const apiFetch = async (path) => {
      calls.push(path);
      return {
        data: {
          wbi_img: {
            img_url: 'https://i0.hdslb.com/bfs/wbi/abc123.png',
            sub_url: 'https://i0.hdslb.com/bfs/wbi/def456.png',
          },
        },
      };
    };

    const first = await getWbiKeys(apiFetch);
    const second = await getWbiKeys(apiFetch);

    expect(first).toEqual({ imgKey: 'abc123', subKey: 'def456' });
    expect(second).toEqual(first);
    expect(calls.length).toBe(1);
  });

  it('getWbiKeys refetches after ttl and handles missing urls', async () => {
    let t = 2_000_000;
    globalThis.Date.now = () => t;
    let count = 0;
    const apiFetch = async () => {
      count += 1;
      if (count === 1) {
        return {
          data: {
            wbi_img: {
              img_url: 'https://x/one.png',
              sub_url: 'https://x/two.png',
            },
          },
        };
      }
      return { data: {} };
    };

    await getWbiKeys(apiFetch);
    t += 600_001;
    const refreshed = await getWbiKeys(apiFetch);

    expect(count).toBe(2);
    expect(refreshed).toEqual({ imgKey: '', subKey: '' });
  });

  it('signWbi sorts params, strips special chars and appends w_rid', () => {
    globalThis.Date.now = () => 1_710_000_000_000;
    const result = signWbi(
      { z: "x!'()*", a: '1 2' },
      'abcdefghijklmnopqrstuvwxyz012345',
      '6789abcdefghijklmnopqrstuvwxyzAB',
    );

    expect(result).toContain('a=1%202');
    expect(result).toContain('z=x');
    expect(result).toContain('wts=1710000000');
    expect(result).toMatch(/^a=1%202&wts=1710000000&z=x&w_rid=[0-9a-f]{32}$/);
  });
});
