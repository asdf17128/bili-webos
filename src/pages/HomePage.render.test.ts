import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import {
  React,
  render,
  flush,
  createEventTarget,
  interact,
} from '../test/reactTestUtils.ts';

let api;
let focusId;
let focusListener;
let setFocusCalls;
let videoGridCalls;
let timers;
const apiPath = new URL('../api/client.ts', import.meta.url).pathname;
const hooksPath = new URL('../hooks/useFocus.ts', import.meta.url).pathname;
const realApi = await import(apiPath);
const realHooks = await import(hooksPath);

async function importFresh() {
  return import(`./HomePage.tsx?t=${Date.now()}-${Math.random()}`);
}

beforeEach(() => {
  api = {
    getPopular: mock(async () => ({
      data: {
        list: [
          { bvid: 'BV1', title: '热门1' },
          { bvid: 'BV1', title: '重复' },
        ],
      },
    })),
    getRecommend: mock(async () => ({
      data: { item: [{ bvid: 'BV2', title: '推荐1' }] },
    })),
    getRegionDynamic: mock(async () => ({
      data: { archives: [{ bvid: 'BV3', title: '分区1' }] },
    })),
    getFollowFeed: mock(async () => ({
      data: {
        items: [
          {
            modules: {
              module_dynamic: {
                major: {
                  archive: {
                    bvid: 'BV4',
                    title: '关注1',
                    cover: 'p',
                    duration_text: '01:00',
                    pubdate: 1,
                    stat: { play: 2 },
                  },
                },
              },
              module_author: { name: '作者' },
            },
          },
        ],
      },
    })),
    getLiveList: mock(async () => ({
      data: {
        list: [
          { roomid: 3, title: '直播1', cover: 'c', uname: '主播', online: 8 },
        ],
      },
    })),
  };
  focusId = null;
  focusListener = null;
  setFocusCalls = [];
  videoGridCalls = [];
  timers = [];

  globalThis.window = createEventTarget();
  globalThis.setTimeout = (fn, delay) => {
    const item = { fn, delay };
    timers.push(item);
    return item;
  };
  globalThis.clearTimeout = () => {};

  mock.module(apiPath, () => ({
    ...realApi,
    ...api,
  }));
  mock.module('../components/VideoGrid', () => ({
    default(props) {
      videoGridCalls.push(props);
      return React.createElement(
        'grid',
        { count: props.videos.length },
        props.videos.map((v) => v.title).join('|'),
      );
    },
  }));
  mock.module(hooksPath, () => ({
    ...realHooks,
    getCurrentFocusId: () => focusId,
    setFocus(id) {
      setFocusCalls.push(id);
      focusId = id;
    },
    onFocusChange(handler) {
      focusListener = handler;
      return () => {
        if (focusListener === handler) focusListener = null;
      };
    },
  }));
});

afterEach(() => {
  mock.restore();
});

test('HomePage loads by mode, dedupes items, focuses first content, and loads more near bottom', async () => {
  const { default: HomePage } = await importFresh();
  const renderer = await render(
    React.createElement(HomePage, {
      mode: 'hot',
      refreshKey: 0,
      onPlayVideo() {},
    }),
  );
  await flush();

  expect(api.getPopular).toHaveBeenCalledWith(1, 20);
  expect(videoGridCalls.at(-1).videos).toEqual([
    { bvid: 'BV1', title: '热门1' },
  ]);
  timers[0].fn();
  expect(setFocusCalls).toEqual(['content-0-0']);

  api.getPopular.mockResolvedValueOnce({
    data: { list: [{ bvid: 'BV5', title: '热门2' }] },
  });
  await interact(() => focusListener?.('content-0-0'));
  expect(videoGridCalls.at(-1).videos.map((v) => v.bvid)).toEqual([
    'BV1',
    'BV5',
  ]);
  expect(videoGridCalls.at(-1).focusRow).toBe(0);

  focusId = 'sidebar-0-0';
  const recommendRenderer = await render(
    React.createElement(HomePage, {
      mode: 'recommend',
      refreshKey: 1,
      onPlayVideo() {},
    }),
  );
  await flush();
  timers.at(-1).fn();
  expect(api.getRecommend).toHaveBeenCalledWith(4, 20);
  expect(setFocusCalls).toEqual(['content-0-0']);

  await render(
    React.createElement(HomePage, {
      mode: 'partition',
      refreshKey: 2,
      onPlayVideo() {},
    }),
  );
  await flush();
  expect(api.getRegionDynamic).toHaveBeenCalled();

  await render(
    React.createElement(HomePage, {
      mode: 'follow',
      refreshKey: 3,
      onPlayVideo() {},
    }),
  );
  await flush();
  expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
    bvid: 'BV4',
    owner: { name: '作者' },
  });

  await render(
    React.createElement(HomePage, {
      mode: 'live',
      refreshKey: 4,
      onPlayVideo() {},
    }),
  );
  await flush();
  expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
    bvid: 'live-3',
    roomid: 3,
    isLive: true,
  });

  expect(renderer).toBeTruthy();
  expect(recommendRenderer).toBeTruthy();
});
