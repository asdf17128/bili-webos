import { test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(import.meta.dir, 'SearchPage.jsx'), 'utf8');

const keyboardMatch = source.match(/const KEYBOARD_ROWS = ([\s\S]*?\n];)/);
if (!keyboardMatch) throw new Error('missing KEYBOARD_ROWS');
const KEYBOARD_ROWS = new Function(`return ${keyboardMatch[1]}`)();

function mapResultItem(item) {
  return {
    ...item,
    title: item.title?.replace(/<[^>]+>/g, '') || '',
    pic: item.pic,
    bvid: item.bvid,
    owner: { name: item.author },
    stat: { view: item.play },
    duration: item.duration,
  };
}

test('KEYBOARD_ROWS layout includes action keys', () => {
  expect(KEYBOARD_ROWS).toHaveLength(4);
  expect(KEYBOARD_ROWS[3]).toContain('删除');
  expect(KEYBOARD_ROWS[3]).toContain('搜索');
});

test('search mapping strips html tags and maps owner/stat fields', () => {
  const mapped = mapResultItem({
    title: '<em class="keyword">测试</em>标题',
    pic: 'p',
    bvid: 'BV1',
    author: 'up',
    play: 123,
    duration: '03:21',
  });
  expect(mapped.title).toBe('测试标题');
  expect(mapped.owner).toEqual({ name: 'up' });
  expect(mapped.stat).toEqual({ view: 123 });
});

test('search mapping handles empty title', () => {
  expect(mapResultItem({ title: null }).title).toBe('');
});
