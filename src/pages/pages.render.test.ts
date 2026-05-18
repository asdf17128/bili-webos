import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  React,
  render,
  textOf,
  flush,
  interact,
} from '../test/reactTestUtils.ts';

let api;
let storageState;
let focusConfigs;
let oskKeys;
let videoGridCalls;
let qrCalls;
let intervals;
let timeouts;
const apiPath = new URL('../api/client.ts', import.meta.url).pathname;
const hooksPath = new URL('../hooks/useFocus.ts', import.meta.url).pathname;
const storagePath = new URL('../utils/storage.ts', import.meta.url).pathname;
const realApi = await import(apiPath);
const realHooks = await import(hooksPath);
const realStorage = await import(storagePath);

async function importFresh(pathname) {
  return import(`${pathname}?t=${Date.now()}-${Math.random()}`);
}

beforeEach(() => {
  api = {
    getFavFolders: mock(async () => ({ data: { list: [] } })),
    getFavList: mock(async () => ({ data: { medias: [] } })),
    getHistory: mock(async () => ({ data: { list: [] } })),
    searchVideo: mock(async () => ({ data: { result: [] } })),
    qrCodeGenerate: mock(async () => ({
      data: { url: 'https://qr', qrcode_key: 'key-1' },
    })),
    qrCodePoll: mock(async () => ({ data: { code: 86101 } })),
  };
  storageState = {
    auth: {},
    settings: { danmaku: true, quality: 80 },
  };
  focusConfigs = [];
  oskKeys = [];
  videoGridCalls = [];
  qrCalls = [];
  intervals = [];
  timeouts = [];

  mock.module(apiPath, () => ({
    ...realApi,
    ...api,
  }));
  mock.module('../components/VideoGrid', () => ({
    default(props) {
      videoGridCalls.push(props);
      return React.createElement(
        'mock-grid',
        { count: props.videos?.length || 0, onSelect: props.onSelect },
        props.videos?.map((v) => v.title).join('|') || 'empty',
      );
    },
  }));
  mock.module('../components/OSKey', () => ({
    default(props) {
      oskKeys.push(props);
      return React.createElement(
        'mock-key',
        { label: props.label, onPress: props.onPress },
        props.label,
      );
    },
  }));
  mock.module(hooksPath, () => ({
    ...realHooks,
    useFocusable(config) {
      focusConfigs.push(config);
      return {
        props: {
          'data-focus-id': config.id,
          onClick: () => config.onSelect?.(),
        },
      };
    },
  }));
  mock.module(storagePath, () => ({
    ...realStorage,
    storage: {
      ...realStorage.storage,
      getAuth: () => storageState.auth,
      setAuth: (value) => {
        storageState.auth = value;
      },
      clearAuth: () => {
        storageState.auth = null;
      },
      getSettings: () => storageState.settings,
      setSettings: (value) => {
        storageState.settings = value;
      },
    },
  }));
  mock.module('qrcode', () => ({
    default: {
      toCanvas: (...args) => {
        qrCalls.push(args);
        return Promise.resolve();
      },
    },
  }));

  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.setInterval = (fn, delay) => {
    const item = { fn, delay, cleared: false };
    intervals.push(item);
    return item;
  };
  globalThis.clearInterval = (item) => {
    if (item) item.cleared = true;
  };
  globalThis.setTimeout = (fn, delay) => {
    const item = { fn, delay, cleared: false };
    timeouts.push(item);
    return item;
  };
  globalThis.clearTimeout = (item) => {
    if (item) item.cleared = true;
  };
});

afterEach(() => {
  mock.restore();
});

describe('page rendering', () => {
  test('FavoritesPage covers logged-out, loading, and loaded states', async () => {
    const { default: FavoritesPage } = await importFresh('./FavoritesPage.tsx');

    const noUser = await render(
      React.createElement(FavoritesPage, { onPlayVideo() {} }),
    );
    expect(textOf(noUser.toJSON())).toContain('请先登录');

    api.getFavFolders.mockImplementationOnce(async () => ({
      data: { list: [{ id: 7 }] },
    }));
    api.getFavList.mockImplementationOnce(async () => ({
      data: {
        medias: [
          {
            bvid: 'BV1',
            title: '收藏视频',
            cover: 'p',
            duration: 12,
            upper: { name: 'UP' },
            cnt_info: { play: 99 },
          },
        ],
      },
    }));
    const page = await render(
      React.createElement(FavoritesPage, { userMid: 1, onPlayVideo() {} }),
    );
    await flush();
    expect(api.getFavFolders).toHaveBeenCalledWith(1);
    expect(api.getFavList).toHaveBeenCalledWith(7, 1, 24);
    expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
      bvid: 'BV1',
      title: '收藏视频',
      owner: { name: 'UP' },
    });
    expect(textOf(page.toJSON())).toContain('收藏视频');
  });

  test('HistoryPage handles login errors, api errors, and successful mapping', async () => {
    const { default: HistoryPage } = await importFresh('./HistoryPage.tsx');

    api.getHistory.mockImplementationOnce(async () => ({ code: -101 }));
    const needLogin = await render(
      React.createElement(HistoryPage, { onPlayVideo() {} }),
    );
    await flush();
    expect(textOf(needLogin.toJSON())).toContain('请先登录');

    api.getHistory.mockImplementationOnce(async () => {
      throw new Error('网络异常');
    });
    const failed = await render(
      React.createElement(HistoryPage, { onPlayVideo() {} }),
    );
    await flush();
    expect(textOf(failed.toJSON())).toContain('网络异常');

    api.getHistory.mockImplementationOnce(async () => ({
      data: {
        list: [
          {
            history: { bvid: 'BV2', cid: 9 },
            title: '历史视频',
            cover: 'c',
            duration: 33,
            progress: 10,
            author_name: '作者',
          },
        ],
      },
    }));
    const ok = await render(
      React.createElement(HistoryPage, { onPlayVideo() {} }),
    );
    await flush();
    expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
      bvid: 'BV2',
      cid: 9,
      progress: 10,
    });
    expect(textOf(ok.toJSON())).toContain('历史视频');
  });

  test('LoginPage renders QR, handles scanned, success, expired, and error states', async () => {
    const { default: LoginPage } = await importFresh('./LoginPage.tsx');
    const logins = [];

    api.qrCodeGenerate.mockImplementationOnce(async () => ({
      data: { url: 'https://qr-1', qrcode_key: 'key-1' },
    }));
    const renderer = await render(
      React.createElement(LoginPage, { onLogin: () => logins.push('ok') }),
      {
        createNodeMock: (element) =>
          element.type === 'canvas' ? { tag: 'canvas' } : null,
      },
    );
    await flush();
    expect(qrCalls[0][1]).toBe('https://qr-1');
    expect(textOf(renderer.toJSON())).toContain(
      '请使用哔哩哔哩手机客户端扫描二维码',
    );

    api.qrCodePoll.mockResolvedValueOnce({ data: { code: 86090 } });
    await interact(() => intervals[0].fn());
    expect(textOf(renderer.toJSON())).toContain('已扫描');

    api.qrCodePoll.mockResolvedValueOnce({
      data: { code: 0, refresh_token: 'refresh-1' },
    });
    await interact(() => intervals[0].fn());
    expect(storageState.auth.refresh_token).toBe('refresh-1');
    await interact(() => timeouts.at(-1).fn());
    expect(logins).toEqual(['ok']);

    api.qrCodePoll.mockResolvedValueOnce({ data: { code: 86038 } });
    await interact(() => intervals[0].fn());
    expect(textOf(renderer.toJSON())).toContain('二维码已过期');

    api.qrCodeGenerate.mockImplementationOnce(async () => ({ nope: true }));
    const errorRenderer = await render(
      React.createElement(LoginPage, { onLogin() {} }),
      {
        createNodeMock: (element) =>
          element.type === 'canvas' ? { tag: 'canvas' } : null,
      },
    );
    await flush();
    expect(textOf(errorRenderer.toJSON())).toContain('登录失败');
  });

  test('SearchPage updates keyword, runs search, and renders empty/results states', async () => {
    const { default: SearchPage } = await importFresh('./SearchPage.tsx');
    api.searchVideo.mockImplementationOnce(async () => ({
      data: { result: [] },
    }));
    const keyByLabel = (label) =>
      oskKeys.filter((item) => item.label === label).at(-1);

    const renderer = await render(
      React.createElement(SearchPage, { onPlayVideo() {} }),
    );
    expect(textOf(renderer.toJSON())).toContain('输入关键词');

    await interact(() => keyByLabel('A').onPress());
    await interact(() => keyByLabel('搜索').onPress());
    expect(api.searchVideo).toHaveBeenCalledWith('a');
    expect(textOf(renderer.toJSON())).toContain('未找到相关视频');

    await interact(() => keyByLabel('B').onPress());
    await interact(() => keyByLabel('删除').onPress());
    await interact(() => keyByLabel('搜索').onPress());

    api.searchVideo.mockImplementationOnce(async () => ({
      data: {
        result: [
          {
            title: '<em>结果</em>',
            pic: 'p',
            bvid: 'BV3',
            author: '作者',
            play: 12,
            duration: '01:20',
          },
        ],
      },
    }));
    await interact(() => keyByLabel('搜索').onPress());
    expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
      title: '结果',
      owner: { name: '作者' },
      stat: { view: 12 },
    });
    expect(textOf(renderer.toJSON())).toContain('结果');
  });

  test('SettingsPage toggles danmaku, logs out, and renders watch history', async () => {
    const { default: SettingsPage } = await importFresh('./SettingsPage.tsx');
    api.getHistory.mockImplementationOnce(async () => ({
      data: {
        list: [
          {
            history: { bvid: 'BV4', cid: 4 },
            title: '最近观看',
            cover: 'x',
            duration: 90,
            progress: 20,
            author_name: 'UP',
          },
        ],
      },
    }));
    const logs = [];
    const renderer = await render(
      React.createElement(SettingsPage, {
        user: { uname: '测试用户' },
        onLogout: () => logs.push('logout'),
        onPlayVideo() {},
      }),
    );
    await flush();

    expect(textOf(renderer.toJSON())).toContain('测试用户 的空间');
    expect(textOf(renderer.toJSON())).not.toContain('代理:');
    expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
      bvid: 'BV4',
      progress: 20,
    });

    await interact(() => focusConfigs[0].onSelect());
    expect(storageState.settings.danmaku).toBe(false);
    await interact(() => focusConfigs[1].onSelect());
    expect(logs).toEqual(['logout']);
  });
});
