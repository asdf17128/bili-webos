import { test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(import.meta.dir, 'HomePage.tsx'),
  'utf8',
);

function extractFunction(name) {
  const re = new RegExp(`async function ${name}\\([\\s\\S]*?\\n}`);
  const m = source.match(re);
  if (!m) throw new Error(`missing function ${name}`);
  return m[0];
}

const fetchByModeFactory = new Function(
  'getPopular',
  'getRecommend',
  'getRegionDynamic',
  'getFollowFeed',
  'getLiveList',
  'FETCH_SIZE',
  `${extractFunction('fetchByMode')}; return fetchByMode;`,
);

test('fetchByMode(hot) returns popular list', async () => {
  const fetchByMode = fetchByModeFactory(
    async () => ({ data: { list: [{ bvid: 'a' }] } }),
    async () => ({}),
    async () => ({}),
    async () => ({}),
    async () => ({}),
    20,
  );
  await expect(fetchByMode('hot', 1)).resolves.toEqual([{ bvid: 'a' }]);
});

test('fetchByMode(live) maps room fields', async () => {
  const fetchByMode = fetchByModeFactory(
    async () => ({}),
    async () => ({}),
    async () => ({}),
    async () => ({}),
    async () => ({
      data: {
        list: [{ roomid: 7, title: '直播', cover: 'c', uname: 'u', online: 9 }],
      },
    }),
    20,
  );
  await expect(fetchByMode('live', 1)).resolves.toEqual([
    {
      bvid: 'live-7',
      title: '直播',
      pic: 'c',
      owner: { name: 'u' },
      stat: { view: 9 },
      isLive: true,
      roomid: 7,
    },
  ]);
});

test('fetchByMode(follow) filters invalid items and maps archive shape', async () => {
  const fetchByMode = fetchByModeFactory(
    async () => ({}),
    async () => ({}),
    async () => ({}),
    async () => ({
      data: {
        items: [
          {
            modules: {
              module_dynamic: {
                major: {
                  archive: {
                    bvid: 'BV1',
                    title: 'T',
                    cover: 'p',
                    duration_text: '1:00',
                    pubdate: 1,
                    stat: { play: 3 },
                  },
                },
              },
              module_author: { name: 'A' },
            },
          },
          { modules: { module_dynamic: { major: {} } } },
        ],
      },
    }),
    async () => ({}),
    20,
  );
  await expect(fetchByMode('follow', 1)).resolves.toEqual([
    {
      bvid: 'BV1',
      title: 'T',
      pic: 'p',
      duration: '1:00',
      pubdate: 1,
      owner: { name: 'A' },
      stat: { view: 3 },
    },
  ]);
});

test('fetchByMode(default) returns recommend item', async () => {
  const fetchByMode = fetchByModeFactory(
    async () => ({}),
    async () => ({ data: { item: [{ bvid: 'r1' }] } }),
    async () => ({}),
    async () => ({}),
    async () => ({}),
    20,
  );
  await expect(fetchByMode('recommend', 1)).resolves.toEqual([{ bvid: 'r1' }]);
});
