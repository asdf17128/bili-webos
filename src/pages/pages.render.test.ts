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
let setFocusCalls;
let currentFocusId;
let customKeyHandler;
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
    getMySubscriptions: mock(
      async () => ({ items: [], page: { pageNum: 1, pageSize: 20, total: 0 } }),
    ),
    getSubscriptionVideos: mock(
      async () => ({ items: [], page: { pageNum: 1, pageSize: 30, total: 0 } }),
    ),
    getHistory: mock(async () => ({ data: { list: [] } })),
    searchVideo: mock(async () => ({ data: { result: [] } })),
    qrCodeGenerate: mock(async () => ({
      data: { url: 'https://qr', qrcode_key: 'key-1' },
    })),
    qrCodePoll: mock(async () => ({ data: { code: 86101 } })),
  };
  storageState = {
    auth: {},
    settings: { danmaku: true, quality: 80, videoGridCols: 4 },
  };
  focusConfigs = [];
  oskKeys = [];
  videoGridCalls = [];
  qrCalls = [];
  intervals = [];
  timeouts = [];
  setFocusCalls = [];
  currentFocusId = null;
  customKeyHandler = null;

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
    getCurrentFocusId() {
      return currentFocusId;
    },
    setFocus(id) {
      setFocusCalls.push(id);
      currentFocusId = id;
    },
    setCustomKeyHandler(handler) {
      customKeyHandler = handler;
    },
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
  test('FavoritesPage covers logged-out, folder switching, loading, and loaded states', async () => {
    const { default: FavoritesPage } = await importFresh('./FavoritesPage.tsx');

    const noUser = await render(
      React.createElement(FavoritesPage, { onPlayVideo() {} }),
    );
    expect(textOf(noUser.toJSON())).toContain('请先登录');

    api.getFavFolders.mockImplementationOnce(async () => ({
      data: { list: [{ id: 7, title: '默认收藏夹' }, { id: 8, title: '动画' }] },
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
    expect(textOf(page.toJSON())).toContain('默认收藏夹');
    expect(textOf(page.toJSON())).toContain('动画');
    expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
      bvid: 'BV1',
      title: '收藏视频',
      owner: { name: 'UP' },
    });
    expect(videoGridCalls.at(-1).cols).toBe(4);
    expect(setFocusCalls).toContain('content-2-0');
    expect(textOf(page.toJSON())).toContain('收藏视频');

    api.getFavList.mockImplementationOnce(async () => ({
      data: {
        medias: [
          {
            bvid: 'BV2',
            title: '动画合集',
            cover: 'q',
            duration: 25,
            upper: { name: '作者2' },
            cnt_info: { play: 8 },
          },
        ],
      },
    }));
    await interact(() =>
      focusConfigs.find((config) => config.id === 'content-1-1').onSelect(),
    );
    await flush();
    expect(api.getFavList).toHaveBeenLastCalledWith(8, 1, 24);
    expect(videoGridCalls.at(-1).videos[0]).toMatchObject({
      bvid: 'BV2',
      title: '动画合集',
    });
    expect(setFocusCalls.at(-1)).toBe('content-2-0');

    const keyboardEvent = {
      key: 'ArrowUp',
      preventDefault() {},
      stopPropagation() {},
    };
    currentFocusId = 'content-2-0';
    expect(customKeyHandler(keyboardEvent)).toBe(true);
    expect(setFocusCalls.at(-1)).toBe('content-1-1');
  });

  test('FavoritesPage keeps folder tabs visible while switching favorite folder content', async () => {
    const { default: FavoritesPage } = await importFresh('./FavoritesPage.tsx');

    let resolveFirstList;
    let resolveSecondList;

    api.getFavFolders.mockImplementationOnce(async () => ({
      data: { list: [{ id: 7, title: '默认收藏夹' }, { id: 8, title: '动画' }] },
    }));
    api.getFavList
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstList = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondList = resolve;
          }),
      );

    const page = await render(
      React.createElement(FavoritesPage, { userMid: 1, onPlayVideo() {} }),
    );
    await flush();

    expect(textOf(page.toJSON())).toContain('默认收藏夹');
    expect(textOf(page.toJSON())).toContain('动画');
    expect(textOf(page.toJSON())).toContain('加载中');

    await interact(() =>
      focusConfigs.find((config) => config.id === 'content-1-1').onSelect(),
    );
    await flush();

    expect(textOf(page.toJSON())).toContain('默认收藏夹');
    expect(textOf(page.toJSON())).toContain('动画');
    expect(textOf(page.toJSON())).toContain('加载中');

    await interact(() =>
      resolveSecondList({
        data: {
          medias: [
            {
              bvid: 'BV2',
              title: '动画合集',
              cover: 'q',
              duration: 25,
              upper: { name: '作者2' },
              cnt_info: { play: 8 },
            },
          ],
        },
      }),
    );
    await flush();

    expect(textOf(page.toJSON())).toContain('动画合集');

    await interact(() =>
      resolveFirstList({
        data: {
          medias: [
            {
              bvid: 'BV1',
              title: '旧收藏夹结果',
              cover: 'p',
              duration: 12,
              upper: { name: 'UP' },
              cnt_info: { play: 99 },
            },
          ],
        },
      }),
    );

    page.unmount();
  });

  test('FavoritesPage supports subscriptions list, detail, and focus restoration', async () => {
    const { default: FavoritesPage } = await importFresh('./FavoritesPage.tsx');

    api.getFavFolders.mockImplementationOnce(async () => ({
      data: { list: [{ id: 7, title: '默认收藏夹' }] },
    }));
    api.getFavList.mockImplementationOnce(async () => ({ data: { medias: [] } }));
    api.getMySubscriptions.mockImplementationOnce(async () => ({
      items: Array.from({ length: 15 }, (_, index) => ({
        id: `collected-folder-${index + 1}`,
        mediaId: index + 1,
        seasonId: index + 1,
        ownerMid: 100,
        title: `订阅 ${index + 1}`,
        cover: `cover-${index + 1}`,
        total: 3,
        isInvalid: false,
      })),
      page: { pageNum: 1, pageSize: 20, total: 15 },
    }));
    api.getSubscriptionVideos.mockImplementationOnce(async () => ({
      items: [
        {
          bvid: 'BV-DETAIL',
          title: '详情视频',
          pic: 'detail-cover',
          owner: { name: 'UP' },
          stat: { view: 5 },
          isInvalid: false,
        },
        {
          bvid: '',
          title: '视频已失效',
          pic: '',
          duration: 0,
          owner: { name: '未知UP主' },
          stat: { view: 0 },
          isInvalid: true,
        },
      ],
      page: { pageNum: 1, pageSize: 30, total: 2 },
    }));

    const page = await render(
      React.createElement(FavoritesPage, { userMid: 1, onPlayVideo() {} }),
    );
    await flush();

    await interact(() =>
      focusConfigs.find((config) => config.id === 'content-0-1').onSelect(),
    );
    await flush();

    expect(api.getMySubscriptions).toHaveBeenCalledWith(1, 1, 50);
    expect(textOf(page.toJSON())).toContain('订阅 15');

    await interact(() =>
      focusConfigs.find((config) => config.id === 'subscription-3-2').onSelect(),
    );
    await flush();

    expect(api.getSubscriptionVideos).toHaveBeenCalledWith({
      seasonId: 15,
      pageNum: 1,
      pageSize: 30,
    });
    expect(textOf(page.toJSON())).toContain('详情视频');
    expect(videoGridCalls.at(-1).videos[1]).toMatchObject({
      isInvalid: true,
      title: '视频已失效',
      owner: { name: '未知UP主' },
    });

    currentFocusId = 'content-1-0';
    const backEvent = {
      key: 'GoBack',
      keyCode: 461,
      preventDefault() {},
      stopPropagation() {},
    };
    await interact(() => {
      expect(customKeyHandler(backEvent)).toBe(true);
    });
    await flush();

    expect(textOf(page.toJSON())).toContain('订阅 15');
    expect(setFocusCalls.at(-1)).toBe('subscription-3-2');

    await interact(() =>
      focusConfigs.find((config) => config.id === 'content-0-0').onSelect(),
    );
    await flush();
    expect(textOf(page.toJSON())).toContain('默认收藏夹');

    await interact(() =>
      focusConfigs.find((config) => config.id === 'content-0-1').onSelect(),
    );
    await flush();

    expect(api.getMySubscriptions).toHaveBeenCalledTimes(1);

    await interact(() =>
      focusConfigs.find((config) => config.id === 'subscription-3-2').onSelect(),
    );
    await flush();

    expect(api.getSubscriptionVideos).toHaveBeenCalledTimes(1);
  });

  test('FavoritesPage keeps ArrowUp inside subscription grid until the first row', async () => {
    const { default: FavoritesPage } = await importFresh('./FavoritesPage.tsx');

    api.getFavFolders.mockImplementationOnce(async () => ({
      data: { list: [{ id: 7, title: '默认收藏夹' }] },
    }));
    api.getFavList.mockImplementationOnce(async () => ({ data: { medias: [] } }));
    api.getMySubscriptions.mockImplementationOnce(async () => ({
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `collected-folder-${index + 1}`,
        mediaId: index + 1,
        seasonId: index + 1,
        ownerMid: 100,
        title: `订阅 ${index + 1}`,
        cover: `cover-${index + 1}`,
        total: 3,
        isInvalid: false,
      })),
      page: { pageNum: 1, pageSize: 20, total: 8 },
    }));

    const page = await render(
      React.createElement(FavoritesPage, { userMid: 1, onPlayVideo() {} }),
    );
    await flush();

    await interact(() =>
      focusConfigs.find((config) => config.id === 'content-0-1').onSelect(),
    );
    await flush();

    currentFocusId = 'subscription-1-0';
    const upEvent = {
      key: 'ArrowUp',
      preventDefault() {},
      stopPropagation() {},
    };

    expect(customKeyHandler(upEvent)).toBe(false);

    currentFocusId = 'subscription-0-0';
    expect(customKeyHandler(upEvent)).toBe(true);
    expect(setFocusCalls.at(-1)).toBe('content-0-1');

    page.unmount();
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
    expect(videoGridCalls.at(-1).cols).toBe(4);
    expect(textOf(ok.toJSON())).toContain('历史视频');

    api.getHistory.mockImplementationOnce(async () => ({ message: '服务异常' }));
    const fallbackError = await render(
      React.createElement(HistoryPage, { onPlayVideo() {} }),
    );
    await flush();
    expect(textOf(fallbackError.toJSON())).toContain('服务异常');

    api.getHistory.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const timeoutRenderer = await render(
      React.createElement(HistoryPage, { onPlayVideo() {} }),
    );
    await interact(() => timeouts.at(-1).fn());
    expect(textOf(timeoutRenderer.toJSON())).toContain('加载超时');
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

    api.qrCodeGenerate.mockImplementationOnce(async () => {
      throw new Error('qr down');
    });
    const generateFailRenderer = await render(
      React.createElement(LoginPage, { onLogin() {} }),
      {
        createNodeMock: (element) =>
          element.type === 'canvas' ? { tag: 'canvas' } : null,
      },
    );
    await flush();
    expect(textOf(generateFailRenderer.toJSON())).toContain('登录失败');
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
    expect(videoGridCalls.at(-1).cols).toBe(4);
    expect(textOf(renderer.toJSON())).toContain('结果');
  });

  test('SettingsPage toggles danmaku, updates grid columns, and logs out', async () => {
    const { default: SettingsPage } = await importFresh('./SettingsPage.tsx');
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
    expect(textOf(renderer.toJSON())).toContain('每行视频数: 4');
    expect(textOf(renderer.toJSON())).not.toContain('最近观看');

    await interact(() =>
      focusConfigs.filter((config) => config.id === 'content-0-0').at(-1).onSelect(),
    );
    expect(storageState.settings.danmaku).toBe(false);
    await interact(() =>
      focusConfigs.filter((config) => config.id === 'content-0-1').at(-1).onSelect(),
    );
    expect(storageState.settings.videoGridCols).toBe(2);
    await interact(() =>
      focusConfigs.filter((config) => config.id === 'content-0-1').at(-1).onSelect(),
    );
    expect(storageState.settings.videoGridCols).toBe(3);
    await interact(() =>
      focusConfigs.filter((config) => config.id === 'content-0-2').at(-1).onSelect(),
    );
    expect(logs).toEqual(['logout']);
  });
});
