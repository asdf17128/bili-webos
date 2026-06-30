import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  React,
  render,
  flush,
  createEventTarget,
  createVideoMock,
  update,
  act,
  interact,
} from '../test/reactTestUtils.ts';

let api;
let storageState;
let customKeyHandler;
let eventTarget;
let timers;
let intervals;
let queryCards;
let shakaLoads;
let shakaDestroyed;
let mpegtsDestroyed;
let originalConsoleError;
let shakaSupported;
let shakaLoadError;
let shakaPlayers;
let mpegtsSupported;
let mpegtsFeatureList;
let mpegtsPlayers;
let currentNow;
let originalDateNow;
let liveDanmakuState;
const apiPath = new URL('../api/client.ts', import.meta.url).pathname;
const storagePath = new URL('../utils/storage.ts', import.meta.url).pathname;
const proxyPath = new URL('../utils/proxy.ts', import.meta.url).pathname;
const hooksPath = new URL('../hooks/useFocus.ts', import.meta.url).pathname;
const liveDanmakuHookPath = new URL(
  './useLiveDanmaku.ts',
  import.meta.url,
).pathname;
const realApi = await import(apiPath);
const realStorage = await import(storagePath);
const realProxy = await import(proxyPath);
const realHooks = await import(hooksPath);
const NativeURL = globalThis.URL;
const originalGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

function restoreGlobal(name, value) {
  if (typeof value === 'undefined') {
    delete globalThis[name];
    return;
  }
  globalThis[name] = value;
}

async function importFresh(pathname) {
  return import(`${pathname}?fixture=player-render`);
}

function applyNodeMock(element, mockNode) {
  const descriptors = Object.getOwnPropertyDescriptors(mockNode);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === '__attachElement') continue;
    Object.defineProperty(element, key, descriptor);
  }
  mockNode.__attachElement?.(element);
  return element;
}

async function renderWithNodeMock(element, createNodeMock) {
  const doc = globalThis.__TEST_DOCUMENT__;
  const originalCreateElement = doc.createElement.bind(doc);
  const originalCreateElementNS = doc.createElementNS.bind(doc);

  const decorate = (node, type) => {
    const mockNode = createNodeMock?.({ type });
    return mockNode ? applyNodeMock(node, mockNode) : node;
  };

  doc.createElement = function patchedCreateElement(tagName, options) {
    return decorate(originalCreateElement(tagName, options), tagName);
  };
  doc.createElementNS = function patchedCreateElementNS(
    namespaceURI,
    qualifiedName,
    options,
  ) {
    return decorate(
      originalCreateElementNS(namespaceURI, qualifiedName, options),
      qualifiedName,
    );
  };

  try {
    return await render(element);
  } finally {
    doc.createElement = originalCreateElement;
    doc.createElementNS = originalCreateElementNS;
  }
}

function event(key, keyCode = 0) {
  return {
    key,
    keyCode,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

beforeEach(() => {
  api = {
    getPlayUrl: mock(async (_video, _cid, qn = 80) => ({
      data: {
        dash: {
          duration: 120,
          minBufferTime: 1.5,
          video: [
            { id: 80, baseUrl: 'https://video.test/main.m4s', bandwidth: 1000 },
          ],
          audio: [
            {
              id: 30216,
              base_url: 'https://audio.test/main.m4s',
              bandwidth: 128,
            },
          ],
        },
        accept_quality: [80, 64],
        quality: qn,
      },
    })),
    getDanmaku: mock(async () => [{ time: 1, text: 'hello', mode: 1 }]),
    getVideoInfo: mock(async () => ({
      data: { cid: 7, title: '详情标题', bvid: 'BVX' },
    })),
    reportHeartbeat: mock(() => {}),
    getRelated: mock(async () => ({
      data: [
        { bvid: 'BV2', title: '相关1', pic: '//img/1.jpg' },
        { bvid: 'BV3', title: '相关2' },
      ],
    })),
    castReportProgress: mock(async () => {}),
    castReportState: mock(async () => {}),
    getLiveStreamSource: mock(async () => ({
      type: 'flv',
      url: 'https://live.test/stream.flv',
    })),
    getStoryboard: mock(async () => null),
  };
  storageState = {
    settings: { danmaku: true, quality: 80 },
    resumeProgress: {},
  };
  customKeyHandler = null;
  eventTarget = createEventTarget();
  timers = [];
  intervals = [];
  queryCards = Array.from({ length: 8 }, () => ({
    scrollIntoView: mock(() => {}),
  }));
  shakaLoads = [];
  shakaDestroyed = 0;
  mpegtsDestroyed = 0;
  shakaSupported = true;
  shakaLoadError = null;
  shakaPlayers = [];
  mpegtsSupported = true;
  mpegtsFeatureList = { mseLivePlayback: true };
  mpegtsPlayers = [];
  currentNow = 1_000;
  originalDateNow = Date.now;
  Date.now = () => currentNow;
  liveDanmakuState = {
    danmakus: [{ time: 0, text: 'live hello', mode: 1 }],
    available: true,
    currentTime: 0,
  };

  globalThis.window = Object.assign(eventTarget, {});
  const domDocument = globalThis.__TEST_DOCUMENT__;
  globalThis.document = {
    querySelectorAll(selector) {
      return selector === '.related-card' ? queryCards : [];
    },
    createElement(tag) {
      const element = domDocument.createElement(tag);
      const originalRemove = element.remove.bind(element);
      element.removed = false;
      element.remove = () => {
        element.removed = true;
        originalRemove();
      };
      return element;
    },
  };
  globalThis.setTimeout = (fn, delay) => {
    const item = { fn, delay, cleared: false };
    timers.push(item);
    return item;
  };
  globalThis.clearTimeout = (item) => {
    if (item) item.cleared = true;
  };
  globalThis.setInterval = (fn, delay) => {
    const item = { fn, delay, cleared: false };
    intervals.push(item);
    return item;
  };
  globalThis.clearInterval = (item) => {
    if (item) item.cleared = true;
  };
  globalThis.URL = class URLWithBlob extends NativeURL {
    static createObjectURL() {
      return 'blob:test';
    }
    static revokeObjectURL() {}
  };

  mock.module(apiPath, () => ({
    ...realApi,
    getPlayUrl: (...args) => api.getPlayUrl(...args),
    getDanmaku: (...args) => api.getDanmaku(...args),
    getVideoInfo: (...args) => api.getVideoInfo(...args),
    reportHeartbeat: (...args) => api.reportHeartbeat(...args),
    getRelated: (...args) => api.getRelated(...args),
    castReportProgress: (...args) => api.castReportProgress(...args),
    castReportState: (...args) => api.castReportState(...args),
    getLiveStreamSource: (...args) => api.getLiveStreamSource(...args),
    getStoryboard: (...args) => api.getStoryboard(...args),
  }));
  mock.module(storagePath, () => ({
    ...realStorage,
    storage: {
      ...realStorage.storage,
      getSettings: (...args) =>
        realStorage.storage.getSettings
          ? storageState.settings
          : storageState.settings,
      setSettings: (value) => {
        storageState.settings = value;
      },
      getResumeProgress(bvid, cid) {
        const entry = storageState.resumeProgress[bvid];
        if (!entry) return null;
        if (cid != null && entry.cid != null && entry.cid !== cid) return null;
        return entry;
      },
      setResumeProgress(video) {
        storageState.resumeProgress[video.bvid] = video;
      },
      clearResumeProgress(bvid) {
        delete storageState.resumeProgress[bvid];
      },
      shouldClearResumeProgress(progress, duration) {
        return Number(duration) - Number(progress) <= 3;
      },
    },
  }));
  mock.module(proxyPath, () => ({
    ...realProxy,
    getProxyBase: () => 'http://proxy.test',
    buildProxyUrl: (url) =>
      `http://proxy.test/proxy/${new URL(url).host}${new URL(url).pathname}${new URL(url).search}`,
  }));
  mock.module(hooksPath, () => ({
    ...realHooks,
    setCustomKeyHandler(handler) {
      customKeyHandler = handler;
    },
  }));
  mock.module(liveDanmakuHookPath, () => ({
    useLiveDanmaku: mock((_roomId, enabled) => ({
      ...liveDanmakuState,
      danmakus: enabled ? liveDanmakuState.danmakus : [],
    })),
  }));
  mock.module('./DanmakuLayer.tsx', () => ({
    default(props) {
      return React.createElement(
        'danmaku-layer',
        { enabled: props.enabled, count: props.danmakus.length },
        null,
      );
    },
  }));
  mock.module('shaka-player', () => ({
    default: null,
    polyfill: { installAll() {} },
    Player: class {
      constructor() {
        this.config = null;
        this.errorHandler = null;
        this.requestFilter = null;
        this.retryCalls = 0;
        shakaPlayers.push(this);
      }
      static isBrowserSupported() {
        return shakaSupported;
      }
      configure(config) {
        this.config = config;
      }
      async attach() {}
      addEventListener(type, handler) {
        if (type === 'error') this.errorHandler = handler;
      }
      getNetworkingEngine() {
        return {
          registerRequestFilter: (handler) => {
            this.requestFilter = handler;
          },
        };
      }
      async load(url) {
        if (shakaLoadError) throw shakaLoadError;
        shakaLoads.push(url);
      }
      async destroy() {
        shakaDestroyed += 1;
      }
      retryStreaming() {
        this.retryCalls += 1;
        return true;
      }
    },
  }));
  mock.module('mpegts.js', () => ({
    default: null,
    isSupported: () => mpegtsSupported,
    getFeatureList: () => mpegtsFeatureList,
    Events: { ERROR: 'error' },
    createPlayer(config, options) {
      const player = {
        config,
        options,
        errorHandler: null,
        on(_event, handler) {
          this.errorHandler = handler;
        },
        attachMediaElement() {},
        load() {},
        async play() {},
        destroy() {
          mpegtsDestroyed += 1;
        },
      };
      mpegtsPlayers.push(player);
      return player;
    },
  }));
  originalConsoleError = console.error;
  console.error = (...args) => {
    const first = String(args[0] || '');
    if (first.includes('not wrapped in act')) return;
    originalConsoleError(...args);
  };
});

afterEach(() => {
  mock.restore();
  mock.module(apiPath, () => realApi);
  mock.module(storagePath, () => realStorage);
  mock.module(proxyPath, () => realProxy);
  mock.module(hooksPath, () => realHooks);
  for (const [name, value] of Object.entries(originalGlobals)) {
    restoreGlobal(name, value);
  }
  globalThis.URL = NativeURL;
  console.error = originalConsoleError;
  Date.now = originalDateNow;
});

describe('DanmakuLayer', () => {
  test('renders visible danmaku items and resets on source change', async () => {
    const { default: DanmakuLayer } = await importFresh('./DanmakuLayer.tsx');

    const renderer = await render(
      React.createElement(DanmakuLayer, {
        danmakus: [
          { time: 1, text: '弹幕1', mode: 1, color: '#f00', size: 32 },
          { time: 5, text: '忽略', mode: 4 },
        ],
        currentTime: 1.1,
        enabled: true,
      }),
    );
    const container = renderer.container.querySelector('.danmaku-container');

    expect(container.children).toHaveLength(1);
    const danmaku = container.children[0];
    expect(danmaku.textContent).toBe('弹幕1');
    danmaku.dispatchEvent(new Event('animationend'));
    expect(danmaku.isConnected).toBe(false);

    await update(
      renderer,
      React.createElement(DanmakuLayer, {
        danmakus: [{ time: 2, text: '弹幕2', mode: 1 }],
        currentTime: 2.1,
        enabled: false,
      }),
    );
    expect(renderer.toJSON()).toBeNull();
  });
});

describe('PlayerPage', () => {
  test('loads video, handles controls, related, quality, cast commands, and remote keys', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    video.duration = Number.NaN;
    const onBack = mock(() => {});
    const onPlayNext = mock(() => {});

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: {
          bvid: 'BV1',
          title: '初始标题',
          owner: { name: '作者' },
          progress: 25,
          pubdate: 1710000000,
        },
        onBack,
        onPlayNext,
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    expect(api.getVideoInfo).toHaveBeenCalled();
    expect(api.getPlayUrl).toHaveBeenCalledWith(expect.any(Object), 7, 80);
    expect(shakaLoads[0]).toBe('blob:test');
    expect(video.playCalls).toBeGreaterThan(0);
    expect(shakaPlayers[0].config.streaming.bufferBehind).toBe(30);

    const proxiedRequest = { uris: ['https://cdn.test/path/seg.m4s?token=1'] };
    shakaPlayers[0].requestFilter(null, proxiedRequest);
    expect(proxiedRequest.uris[0]).toBe(
      'http://proxy.test/proxy/cdn.test/path/seg.m4s?token=1',
    );

    await interact(() => video.dispatch('loadedmetadata'));
    expect(video.currentTime).toBe(0);

    video.duration = 120;
    video.readyState = 2;
    await interact(() => video.dispatch('canplay'));
    expect(video.currentTime).toBeCloseTo(23, 1);
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'playing' });
    expect(JSON.stringify(renderer.toJSON())).toContain('"作者"," · 2024/3/9"');

    video.currentTime = 30;
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(JSON.stringify(renderer.toJSON())).toContain('player-progress-bar focused');
    expect(video.currentTime).toBe(30);
    await interact(() =>
      timers.find((item) => item.delay === 500 && !item.cleared)?.fn(),
    );
    expect(video.currentTime).toBe(35);
    expect(JSON.stringify(renderer.toJSON())).toContain('player-controls hidden');

    video.paused = true;
    await interact(() => customKeyHandler(event('Enter')));
    expect(video.playCalls).toBeGreaterThan(1);

    await interact(() => customKeyHandler(event('MediaRewind', 412)));
    expect(video.currentTime).toBe(35);
    await interact(() =>
      timers.find((item) => item.delay === 500 && !item.cleared)?.fn(),
    );
    expect(video.currentTime).toBe(30);
    video.duration = 35;
    await interact(() => customKeyHandler(event('MediaFastForward', 417)));
    expect(video.currentTime).toBe(30);
    await interact(() =>
      timers.find((item) => item.delay === 500 && !item.cleared)?.fn(),
    );
    expect(video.currentTime).toBe(34);
    await interact(() => customKeyHandler(event('MediaPause', 19)));
    await interact(() => customKeyHandler(event('MediaPlay', 415)));
    video.paused = false;
    await interact(() => customKeyHandler(event('MediaPlayPause')));
    expect(video.pauseCalls).toBeGreaterThan(1);

    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    expect(JSON.stringify(renderer.toJSON())).toContain('▶ 播放');
    await interact(() => customKeyHandler(event('Enter')));
    expect(video.playCalls).toBeGreaterThan(2);

    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(JSON.stringify(renderer.toJSON())).toContain('弹幕 关');

    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(JSON.stringify(renderer.toJSON())).toContain('quality-panel');
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(api.getPlayUrl).toHaveBeenCalledWith(expect.any(Object), 7, 64);
    expect(storageState.settings.quality).toBe(64);

    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', { detail: { type: 'pause' } }),
      ),
    );
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', { detail: { type: 'resume' } }),
      ),
    );
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', {
          detail: { type: 'seek', positionSec: 33 },
        }),
      ),
    );
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', {
          detail: { type: 'switchDanmaku', open: false },
        }),
      ),
    );
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', { detail: { type: 'stop' } }),
      ),
    );
    expect(video.currentTime).toBe(33);
    expect(onBack).toHaveBeenCalled();
    expect(storageState.settings.danmaku).toBe(false);

    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    expect(JSON.stringify(renderer.toJSON())).toContain('related-card');
    await interact(() =>
      renderer.container.querySelector('.related-card')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    );
    expect(onPlayNext).toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV2' }),
    );
    await interact(() => customKeyHandler(event('ArrowRight')));
    timers.find((item) => item.delay === 30 && !item.cleared)?.fn();
    await interact(() => customKeyHandler(event('ArrowDown')));
    expect(api.getRelated).toHaveBeenCalledWith('BV3');
    expect(queryCards[1].scrollIntoView).toHaveBeenCalled();
    await act(async () => {
      await flush();
      await flush();
    });
    await interact(() => customKeyHandler(event('ArrowUp')));
    expect(JSON.stringify(renderer.toJSON())).toContain('⏸ 暂停');
    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowUp')));
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'player-controls hidden',
    );
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() =>
      timers.find((item) => item.delay === 5000 && !item.cleared)?.fn(),
    );
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'player-controls hidden',
    );
    await interact(() => customKeyHandler(event('Backspace', 461)));
    expect(onBack).toHaveBeenCalledTimes(2);

    await interact(() => video.dispatch('pause'));
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'paused' });

    await interact(() => video.dispatch('ended'));
    expect(JSON.stringify(renderer.toJSON())).toContain('播放结束');
    await interact(() =>
      renderer.container
        .querySelectorAll('[style*="cursor: pointer"]')
        .item(0)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(onPlayNext).toHaveBeenCalledTimes(2);

    await interact(() => customKeyHandler(event('ArrowLeft')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(onPlayNext).toHaveBeenCalledTimes(3);
    await interact(() => customKeyHandler(event('Backspace', 461)));
    expect(onBack).toHaveBeenCalledTimes(3);

    timers.at(-1).fn();
    expect(JSON.stringify(renderer.toJSON())).toContain('播放结束');

    intervals.find((item) => item.delay === 500)?.fn();
    expect(api.castReportProgress).toHaveBeenCalled();

    video.paused = false;
    for (const interval of intervals.filter((item) => item.delay === 15000)) {
      interval.fn();
    }
    expect(api.reportHeartbeat).toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
    expect(customKeyHandler).toBeNull();
    expect(shakaDestroyed).toBeGreaterThan(0);
  });

  test('covers load fallback and error branches for on-demand player', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const onBack = mock(() => {});

    const noSourceRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { title: '无源视频' },
        onBack,
      }),
      (element) => (element.type === 'video' ? createVideoMock() : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.getVideoInfo).not.toHaveBeenCalled();
    await act(async () => {
      noSourceRenderer.unmount();
    });

    api.getVideoInfo.mockResolvedValueOnce({ data: { title: '无 CID' } });
    const noCidRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-NOCID', title: '缺少 cid' },
        onBack,
      }),
      (element) => (element.type === 'video' ? createVideoMock() : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.getPlayUrl).not.toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV-NOCID' }),
      undefined,
      expect.anything(),
    );
    await act(async () => {
      noCidRenderer.unmount();
    });

    api.getPlayUrl.mockResolvedValueOnce({ data: {} });
    const noDashVideo = createVideoMock();
    const noDashRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-NODASH', cid: 9, title: '无 dash' },
        onBack,
      }),
      (element) => (element.type === 'video' ? noDashVideo : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(shakaLoads).not.toContain('blob:test');
    await act(async () => {
      noDashRenderer.unmount();
    });

    shakaLoadError = new Error('boom');
    const errorVideo = createVideoMock();
    const errorRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-ERR', cid: 10, title: '错误视频' },
        onBack,
      }),
      (element) => (element.type === 'video' ? errorVideo : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.castReportState).toHaveBeenCalledWith({
      playState: 'error',
      error: 'boom',
    });
    expect(JSON.stringify(errorRenderer.toJSON())).not.toContain('加载中...');
    await act(async () => {
      errorRenderer.unmount();
    });

    shakaSupported = false;
    const unsupportedRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-UNSUPPORTED', cid: 11, title: '不支持' },
        onBack,
      }),
      (element) => (element.type === 'video' ? createVideoMock() : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.getPlayUrl).not.toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV-UNSUPPORTED' }),
      11,
      expect.anything(),
    );
    await act(async () => {
      unsupportedRenderer.unmount();
    });
  });

  test('covers additional player keyboard branches for controls, related grid, and endscreen', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const onBack = mock(() => {});
    const onPlayNext = mock(() => {});

    api.getRelated.mockResolvedValueOnce({
      data: Array.from({ length: 6 }, (_, index) => ({
        bvid: `BV-R${index + 1}`,
        title: `相关${index + 1}`,
        pic: `//img/${index + 1}.jpg`,
      })),
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: {
          bvid: 'BV-BRANCH',
          cid: 12,
          title: '分支视频',
          owner: { name: '作者' },
        },
        onBack,
        onPlayNext,
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    video.paused = true;
    await interact(() => customKeyHandler(event('MediaPlayPause')));
    await interact(() => customKeyHandler(event('Backspace', 461)));
    await interact(() => customKeyHandler(event('Enter')));
    video.paused = false;
    await interact(() => customKeyHandler(event('Enter')));
    expect(customKeyHandler(event('X'))).toBe(false);

    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowLeft')));
    video.paused = true;
    await interact(() => customKeyHandler(event('Enter')));
    video.paused = false;
    await interact(() => customKeyHandler(event('Enter')));
    expect(customKeyHandler(event('X'))).toBe(false);

    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(customKeyHandler(event('X'))).toBe(false);
    await interact(() => customKeyHandler(event('Backspace', 461)));

    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    expect(customKeyHandler(event('X'))).toBe(false);
    await interact(() => customKeyHandler(event('ArrowRight')));
    timers.find((item) => item.delay === 30 && !item.cleared)?.fn();
    await interact(() => customKeyHandler(event('ArrowLeft')));
    timers.find((item) => item.delay === 30 && !item.cleared)?.fn();
    await interact(() => customKeyHandler(event('ArrowDown')));
    timers.find((item) => item.delay === 30 && !item.cleared)?.fn();
    await interact(() => customKeyHandler(event('Enter')));
    expect(onPlayNext).toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV-R5' }),
    );

    await interact(() => video.dispatch('ended'));
    expect(customKeyHandler(event('X'))).toBe(false);
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(onPlayNext).toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV-R5' }),
    );
    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(onPlayNext).toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV-R1' }),
    );
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowLeft')));
    await interact(() => customKeyHandler(event('Enter')));
    expect(onPlayNext).toHaveBeenCalledTimes(4);

    await act(async () => {
      renderer.unmount();
    });
  });

  test('opens the speed popup and applies the selected playback rate', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: {
          bvid: 'BV-SPEED',
          cid: 14,
          title: '倍速视频',
        },
      }),
      (element) => (element.type === 'video' ? video : null),
    );

    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.playbackRate = 1;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));

    expect(JSON.stringify(renderer.toJSON())).toContain('speed-panel');

    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('Enter')));

    expect(video.playbackRate).toBe(0.5);
    expect(JSON.stringify(renderer.toJSON())).toContain('0.5x');
    expect(
      renderer.container.querySelector('.player-btn.focused')?.textContent,
    ).toContain('0.5x');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('speed-panel');

    await act(async () => {
      renderer.unmount();
    });
  });

  test('shows an unsupported-speed message inside packaged webos apps', async () => {
    globalThis.window = Object.assign(eventTarget, {
      PalmSystem: { identifier: 'com.biliwebos.app' },
    });

    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: {
          bvid: 'BV-WEBOS-NOSPEED',
          cid: 16,
          title: '实机视频',
        },
      }),
      (element) => (element.type === 'video' ? video : null),
    );

    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));
    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowDown')));

    expect(JSON.stringify(renderer.toJSON())).toContain('倍速');

    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(customKeyHandler(event('ArrowRight'))).toBe(true);
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('speed-panel');
    expect(tree).toContain('此设备不支持倍速');
    expect(tree).not.toContain('0.25x');

    await act(async () => {
      renderer.unmount();
    });
  });

  test('keeps the selected playback rate after follow-up media events and quality reloads', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: {
          bvid: 'BV-SPEED-STICKY',
          cid: 15,
          title: '倍速保持视频',
        },
      }),
      (element) => (element.type === 'video' ? video : null),
    );

    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.playbackRate = 1;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() => customKeyHandler(event('Enter')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('Enter')));

    expect(video.playbackRate).toBe(0.5);

    video.playbackRate = 1;
    await interact(() => video.dispatch('loadedmetadata'));
    expect(video.playbackRate).toBe(0.5);

    video.playbackRate = 1;
    await interact(() => video.dispatch('canplay'));
    expect(video.playbackRate).toBe(0.5);

    video.playbackRate = 1;
    await interact(() => video.dispatch('loadeddata'));
    expect(video.playbackRate).toBe(0.5);

    video.playbackRate = 1;
    await interact(() => video.dispatch('play'));
    expect(video.playbackRate).toBe(0.5);
    expect(video.defaultPlaybackRate).toBe(0.5);

    video.playbackRate = 1;
    await interact(() => video.dispatch('ratechange'));
    expect(video.playbackRate).toBe(0.5);

    await interact(() => customKeyHandler(event('ArrowLeft')));
    await interact(() => customKeyHandler(event('Enter')));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('Enter')));
    await act(async () => {
      await flush();
      await flush();
    });
    expect(video.playbackRate).toBe(0.5);

    await act(async () => {
      renderer.unmount();
    });
  });

  test('keeps endscreen navigation active after a pre-ended auto-hide timer fires', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const onPlayNext = mock(() => {});

    api.getRelated.mockResolvedValueOnce({
      data: Array.from({ length: 6 }, (_, index) => ({
        bvid: `BV-T${index + 1}`,
        title: `推荐${index + 1}`,
      })),
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-TIMER', cid: 13, title: '计时器视频' },
        onPlayNext,
      }),
      (element) => (element.type === 'video' ? video : null),
    );

    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowUp')));
    const staleAutoHideTimer = timers.find(
      (item) => item.delay === 5000 && !item.cleared,
    );
    expect(staleAutoHideTimer).toBeTruthy();

    await interact(() => video.dispatch('ended'));
    await act(async () => {
      staleAutoHideTimer?.fn();
    });

    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => customKeyHandler(event('Enter')));

    expect(onPlayNext).toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV-T5' }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test('uses timeline preview seeking with debounced commit and control-focus commit handoff', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeWrites = 0;
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get() {
        return currentTimeValue;
      },
      set(value) {
        currentTimeValue = value;
        currentTimeWrites += 1;
      },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-SCRUB', cid: 21, title: '时间轴视频' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 300;
    video.readyState = 2;
    video.currentTime = 40;
    currentTimeWrites = 0;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowUp')));
    const progressBar = renderer.container.querySelector('.player-progress-bar');
    const progressFill =
      renderer.container.querySelector('.player-progress-fill');
    const timeText = renderer.container.querySelector('.player-time');
    expect(progressBar.className).toContain('focused');
    expect(timeText.textContent).toContain('0:40 / 5:00');

    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(currentTimeWrites).toBe(0);
    expect(progressFill.style.width).toBe('15%');
    expect(timeText.textContent).toContain('0:45 / 5:00');

    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(currentTimeWrites).toBe(0);
    expect(progressFill.style.width).toBe('17.5%');
    expect(timeText.textContent).toContain('0:52 / 5:00');

    await interact(() => customKeyHandler(event('ArrowDown')));
    expect(currentTimeWrites).toBe(1);
    expect(video.currentTime).toBeCloseTo(52.5, 3);
    expect(
      renderer.container.querySelector('.player-btn.focused')?.textContent,
    ).toContain('⏸');

    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowLeft')));
    expect(currentTimeWrites).toBe(1);
    await interact(() => customKeyHandler(event('Backspace', 461)));
    expect(currentTimeWrites).toBe(2);
    expect(video.currentTime).toBeCloseTo(47.5, 3);
  });

  test('hides player controls when preview seek debounce commits', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-SCRUB-CLOSE', cid: 35, title: '关闭预览' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.readyState = 2;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(JSON.stringify(renderer.toJSON())).not.toContain(
      'player-controls hidden',
    );

    const commitTimer = timers.find(
      (item) => item.delay === 500 && !item.cleared,
    );
    expect(commitTimer).toBeTruthy();

    await interact(() => commitTimer.fn());
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'player-controls hidden',
    );
    expect(timers.some((item) => item.delay === 5000 && !item.cleared)).toBe(
      false,
    );
  });

  test('caps accelerated scrubbing, ignores flood events, and suppresses redundant clamp writes', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeWrites = 0;
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get() {
        return currentTimeValue;
      },
      set(value) {
        currentTimeValue = value;
        currentTimeWrites += 1;
      },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-STRESS', cid: 22, title: '压力视频' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 1000;
    video.readyState = 2;
    video.currentTime = 0;
    currentTimeWrites = 0;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));
    await interact(() => customKeyHandler(event('ArrowUp')));

    for (let index = 0; index < 20; index += 1) {
      currentNow += 50;
      await interact(() => customKeyHandler(event('ArrowRight')));
    }
    const timeText = renderer.container.querySelector('.player-time');
    expect(timeText.textContent).toContain('7:42 / 16:40');
    expect(currentTimeWrites).toBe(0);

    timers.find((item) => item.delay === 500 && !item.cleared)?.fn();
    expect(video.currentTime).toBeCloseTo(462.5, 3);
    expect(currentTimeWrites).toBe(1);

    video.duration = 120;
    video.currentTime = 0;
    currentTimeWrites = 0;
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowLeft')));
    currentNow += 5;
    await interact(() => customKeyHandler(event('ArrowLeft')));
    currentNow += 5;
    await interact(() => customKeyHandler(event('ArrowLeft')));
    expect(currentTimeWrites).toBe(0);
    expect(timeText.textContent).toContain('0:00 / 2:00');
    expect(
      timers.filter((item) => item.delay === 500 && !item.cleared),
    ).toHaveLength(0);

    currentNow += 15;
    await interact(() => customKeyHandler(event('ArrowRight')));
    currentNow += 5;
    await interact(() => customKeyHandler(event('ArrowRight')));
    currentNow += 10;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(timeText.textContent).toContain('0:12 / 2:00');

    const noMetadataVideo = createVideoMock();
    const noMetadataRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-NOMETA', cid: 23, title: '无元数据' },
      }),
      (element) => (element.type === 'video' ? noMetadataVideo : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });
    noMetadataVideo.duration = Number.NaN;
    noMetadataVideo.currentTime = 3;
    await interact(() => noMetadataVideo.dispatch('loadeddata'));
    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(noMetadataVideo.currentTime).toBe(3);
    await act(async () => {
      noMetadataRenderer.unmount();
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  test('keeps accelerated seek anchored to the committed preview target when player time reports stale values', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeValue = 100;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get() {
        return currentTimeValue;
      },
      set(value) {
        currentTimeValue = value;
      },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-SEEK-STALE', cid: 24, title: '长按进度回跳' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 300;
    video.readyState = 2;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    await interact(() =>
      timers.find((item) => item.delay === 500 && !item.cleared)?.fn(),
    );
    expect(video.currentTime).toBeCloseTo(112.5, 3);

    currentTimeValue = 100;
    await interact(() => intervals.find((item) => item.delay === 500)?.fn());

    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(
      renderer.container.querySelector('.player-time')?.textContent,
    ).toContain('2:05 / 5:00');

    await act(async () => {
      renderer.unmount();
    });
  });

  test('keeps short videos precise while accelerating long videos more aggressively', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');

    const shortVideo = createVideoMock();
    let shortCurrentTimeValue = 0;
    Object.defineProperty(shortVideo, 'currentTime', {
      configurable: true,
      get() {
        return shortCurrentTimeValue;
      },
      set(value) {
        shortCurrentTimeValue = value;
      },
    });

    const shortRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-SHORT', cid: 25, title: '短视频' },
      }),
      (element) => (element.type === 'video' ? shortVideo : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    shortVideo.duration = 300;
    shortVideo.readyState = 2;
    await interact(() => shortVideo.dispatch('loadeddata'));
    await interact(() => shortVideo.dispatch('play'));
    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));
    expect(
      shortRenderer.container.querySelector('.player-time')?.textContent,
    ).toContain('0:12 / 5:00');

    await act(async () => {
      shortRenderer.unmount();
    });

    const longVideo = createVideoMock();
    let longCurrentTimeValue = 0;
    Object.defineProperty(longVideo, 'currentTime', {
      configurable: true,
      get() {
        return longCurrentTimeValue;
      },
      set(value) {
        longCurrentTimeValue = value;
      },
    });

    const longRenderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-LONG', cid: 26, title: '长视频' },
      }),
      (element) => (element.type === 'video' ? longVideo : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    longVideo.duration = 7200;
    longVideo.readyState = 2;
    await interact(() => longVideo.dispatch('loadeddata'));
    await interact(() => longVideo.dispatch('play'));
    await interact(() => customKeyHandler(event('ArrowUp')));

    for (let index = 0; index < 10; index += 1) {
      currentNow += 50;
      await interact(() => customKeyHandler(event('ArrowRight')));
    }

    expect(
      longRenderer.container.querySelector('.player-time')?.textContent,
    ).toContain('23:15 / 2:00:00');

    await act(async () => {
      longRenderer.unmount();
    });
  });

  test('retries shaka streaming when on-demand playback stalls without progress', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();

    await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-STALL', cid: 27, title: '卡顿视频' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.readyState = 2;
    video.currentTime = 10;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));
    await interact(() => video.dispatch('waiting'));

    currentNow += 7_000;
    const stallTimer = intervals.find((item) => item.delay === 1000);
    expect(stallTimer).toBeTruthy();
    await interact(() => stallTimer.fn());

    expect(shakaPlayers.at(-1).retryCalls).toBe(1);
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'loading' });
  });
});

describe('scrub preview thumbnail', () => {
  test('hides thumbnail when storyboard data is null', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTimeValue,
      set: (v) => { currentTimeValue = v; },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-NOSB', cid: 99, title: '无分镜视频' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush(); await flush(); await flush();
    });

    video.duration = 300;
    video.readyState = 2;
    video.currentTime = 40;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    const previewThumb = renderer.container.querySelector('.player-scrub-thumb');
    expect(previewThumb).toBeTruthy();
    expect(previewThumb.style.display).toBe('none');

    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('ArrowRight')));

    expect(previewThumb.style.display).toBe('none');

    await act(async () => { renderer.unmount(); });
  });

  test('shows thumbnail with correct background properties when storyboard is available', async () => {
    const storyboardData = {
      imageUrls: ['https://test/sprite1.jpg'],
      cols: 10,
      rows: 10,
      tileW: 160,
      tileH: 90,
      interval: 60,
    };
    api.getStoryboard.mockResolvedValueOnce(storyboardData);

    const testImages = [];
    const OrigImage = globalThis.Image;
    globalThis.Image = class {
      constructor() {
        this.complete = true;
        this.naturalWidth = 1600;
        this.naturalHeight = 900;
        this._onload = null;
        testImages.push(this);
      }
      set onload(h) { this._onload = h; }
      get onload() { return this._onload; }
      set src(_url) { this._src = _url; }
      get src() { return this._src; }
    };

    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTimeValue,
      set: (v) => { currentTimeValue = v; },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-SB', cid: 100, title: '分镜视频' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush(); await flush(); await flush();
    });

    video.duration = 300;
    video.readyState = 2;
    video.currentTime = 0;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    const thumb = renderer.container.querySelector('.player-scrub-thumb');
    expect(thumb).toBeTruthy();
    expect(thumb.style.display).toBe('none');

    const progressBar = renderer.container.querySelector('.player-progress-bar');
    Object.defineProperty(progressBar, 'clientWidth', {
      value: 800,
      configurable: true,
    });

    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));

    for (const img of testImages) {
      if (img._onload) img._onload();
    }
    await act(async () => { await flush(); });

    expect(thumb.style.display).toBe('block');
    expect(thumb.style.backgroundImage).toContain('sprite1.jpg');

    globalThis.Image = OrigImage;
    await act(async () => { renderer.unmount(); });
  });

  test('edge clamp keeps thumbnail inside progress bar at 0% scrub position', async () => {
    const storyboardData = {
      imageUrls: ['https://test/sprite-clamp.jpg'],
      cols: 10,
      rows: 10,
      tileW: 160,
      tileH: 90,
      interval: 60,
    };
    api.getStoryboard.mockResolvedValueOnce(storyboardData);

    const testImages = [];
    const OrigImage = globalThis.Image;
    globalThis.Image = class {
      constructor() { this.complete = true; this.naturalWidth = 1600; this.naturalHeight = 900; this._onload = null; testImages.push(this); }
      set onload(h) { this._onload = h; }
      get onload() { return this._onload; }
      set src(_url) { this._src = _url; }
      get src() { return this._src; }
    };

    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true, get: () => currentTimeValue, set: (v) => { currentTimeValue = v; },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-CLAMP0', cid: 101, title: 'Clamp 0' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => { await flush(); await flush(); await flush(); });

    video.duration = 300;
    video.readyState = 2;
    video.currentTime = 0;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    const thumb = renderer.container.querySelector('.player-scrub-thumb');
    const progressBar = renderer.container.querySelector('.player-progress-bar');
    Object.defineProperty(progressBar, 'clientWidth', { value: 800, configurable: true });

    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowLeft')));

    for (const img of testImages) {
      if (img._onload) img._onload();
    }
    await act(async () => { await flush(); });

    expect(thumb.style.display).toBe('block');
    expect(thumb.style.left).not.toBe('0%');
    expect(Number(thumb.style.left.replace('%', ''))).toBeGreaterThan(0);

    globalThis.Image = OrigImage;
    await act(async () => { renderer.unmount(); });
  });

  test('edge clamp keeps thumbnail inside progress bar at 100% scrub position', async () => {
    const storyboardData = {
      imageUrls: ['https://test/sprite-clamp100.jpg'],
      cols: 10,
      rows: 10,
      tileW: 160,
      tileH: 90,
      interval: 60,
    };
    api.getStoryboard.mockResolvedValueOnce(storyboardData);

    const testImages = [];
    const OrigImage = globalThis.Image;
    globalThis.Image = class {
      constructor() { this.complete = true; this.naturalWidth = 1600; this.naturalHeight = 900; this._onload = null; testImages.push(this); }
      set onload(h) { this._onload = h; }
      get onload() { return this._onload; }
      set src(_url) { this._src = _url; }
      get src() { return this._src; }
    };

    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true, get: () => currentTimeValue, set: (v) => { currentTimeValue = v; },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-CLAMP100', cid: 102, title: 'Clamp 100' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => { await flush(); await flush(); await flush(); });

    video.duration = 300;
    video.readyState = 2;
    video.currentTime = 300;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    const thumb = renderer.container.querySelector('.player-scrub-thumb');
    const progressBar = renderer.container.querySelector('.player-progress-bar');
    Object.defineProperty(progressBar, 'clientWidth', { value: 800, configurable: true });

    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));

    for (const img of testImages) {
      if (img._onload) img._onload();
    }
    await act(async () => { await flush(); });

    expect(thumb.style.display).toBe('block');
    expect(thumb.style.left).not.toBe('100%');
    expect(Number(thumb.style.left.replace('%', ''))).toBeLessThan(100);

    globalThis.Image = OrigImage;
    await act(async () => { renderer.unmount(); });
  });

  test('sprite load pending shows hidden thumbnail, onload reveals it', async () => {
    const storyboardData = {
      imageUrls: ['https://test/sprite-pending.jpg'],
      cols: 10,
      rows: 10,
      tileW: 160,
      tileH: 90,
      interval: 60,
    };
    api.getStoryboard.mockResolvedValueOnce(storyboardData);

    let spriteLoaded = false;
    let spriteNaturalWidth = 0;
    let spriteNaturalHeight = 0;
    let spriteOnload = null;
    const OrigImage = globalThis.Image;
    globalThis.Image = class {
      get complete() { return spriteLoaded; }
      get naturalWidth() { return spriteNaturalWidth; }
      get naturalHeight() { return spriteNaturalHeight; }
      set onload(h) { spriteOnload = h; }
      get onload() { return spriteOnload; }
      set src(_url) { this._src = _url; }
      get src() { return this._src; }
    };

    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    let currentTimeValue = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true, get: () => currentTimeValue, set: (v) => { currentTimeValue = v; },
    });

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-PEND', cid: 103, title: 'Pending' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => { await flush(); await flush(); await flush(); });

    video.duration = 300;
    video.readyState = 2;
    video.currentTime = 150;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    const thumb = renderer.container.querySelector('.player-scrub-thumb');
    const progressBar = renderer.container.querySelector('.player-progress-bar');
    Object.defineProperty(progressBar, 'clientWidth', { value: 800, configurable: true });

    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));

    expect(thumb.style.display).toBe('none');

    spriteLoaded = true;
    spriteNaturalWidth = 1600;
    spriteNaturalHeight = 900;
    if (spriteOnload) spriteOnload();
    await act(async () => { await flush(); });

    expect(thumb.style.display).toBe('block');
    expect(thumb.style.backgroundImage).toContain('sprite-pending.jpg');

    globalThis.Image = OrigImage;
    await act(async () => { renderer.unmount(); });
  });
});

describe('LivePlayerPage', () => {
  test('plays live stream, reacts to cast commands and key handler, and stops cleanly', async () => {
    const { default: LivePlayerPage } = await importFresh(
      './LivePlayerPage.tsx',
    );
    const video = createVideoMock();
    const onBack = mock(() => {});

    const renderer = await renderWithNodeMock(
      React.createElement(LivePlayerPage, {
        room: { roomid: 9, title: '直播间', owner: { name: '主播' } },
        onBack,
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    expect(api.getLiveStreamSource).toHaveBeenCalledWith(9);
    mpegtsPlayers.at(-1)?.errorHandler?.(
      'network',
      'stalled',
      { msg: 'decoder-broke' },
    );
    expect(api.castReportState).toHaveBeenCalledWith({
      playState: 'error',
      error: 'decoder-broke',
    });

    video.readyState = 2;
    await interact(() => video.dispatch('playing'));
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'playing' });
    await interact(() => customKeyHandler(event('ArrowUp')));
    expect(
      renderer.container.querySelector('.player-btn.focused')?.textContent,
    ).toContain('暂停');
    await interact(() =>
      renderer.container.querySelector('.player-btn.focused')?.click(),
    );
    expect(
      renderer.container.querySelector('.player-btn.focused')?.textContent,
    ).toContain('播放');

    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', { detail: { type: 'pause' } }),
      ),
    );
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', { detail: { type: 'resume' } }),
      ),
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('danmaku-layer');
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', {
          detail: { type: 'switchDanmaku', open: false },
        }),
      ),
    );
    expect(storageState.settings.danmaku).toBe(false);
    video.duration = 100;
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', {
          detail: { type: 'seek', positionSec: 44 },
        }),
      ),
    );
    await interact(() =>
      eventTarget.dispatchEvent(
        new CustomEvent('bili-cast-command', { detail: { type: 'stop' } }),
      ),
    );
    expect(video.currentTime).toBe(44);
    expect(onBack).toHaveBeenCalled();

    await interact(() => customKeyHandler(event('MediaPause', 19)));
    await interact(() => customKeyHandler(event('ArrowUp')));
    await interact(() => customKeyHandler(event('Backspace', 461)));
    expect(onBack).toHaveBeenCalledTimes(1);
    await interact(() => customKeyHandler(event('Backspace', 461)));
    expect(onBack).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
    });
    expect(customKeyHandler).toBeNull();
    expect(mpegtsDestroyed).toBeGreaterThan(0);
  });

  test('covers hls playback, request filtering, media keys, and live error paths', async () => {
    const { default: LivePlayerPage } = await importFresh(
      './LivePlayerPage.tsx',
    );
    const video = createVideoMock();
    const onBack = mock(() => {});

    api.getLiveStreamSource.mockResolvedValueOnce({
      type: 'hls',
      url: 'https://live.test/master.m3u8?token=1',
    });
    const renderer = await renderWithNodeMock(
      React.createElement(LivePlayerPage, {
        room: { roomid: 10, title: 'HLS 直播间', owner: { name: 'HLS 主播' } },
        onBack,
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    expect(shakaLoads.at(-1)).toBe(
      'http://proxy.test/proxy/live.test/master.m3u8?token=1',
    );
    const directReq = { uris: ['segment-1.ts'] };
    shakaPlayers.at(-1).requestFilter(null, directReq);
    expect(directReq.uris[0]).toBe(
      'http://proxy.test/proxy/live.test/segment-1.ts',
    );
    const passthroughReq = {
      uris: ['http://proxy.test/proxy/live.test/segment-2.ts'],
    };
    shakaPlayers.at(-1).requestFilter(null, passthroughReq);
    expect(passthroughReq.uris[0]).toBe(
      'http://proxy.test/proxy/live.test/segment-2.ts',
    );

    video.readyState = 2;
    intervals.at(-1)?.fn();
    video.currentTime = 1;
    await interact(() => video.dispatch('timeupdate'));
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('canplay'));
    await interact(() => video.dispatch('waiting'));
    video.ended = false;
    await interact(() => video.dispatch('pause'));
    await interact(() => video.dispatch('ended'));
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'loading' });
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'paused' });
    expect(api.castReportState).toHaveBeenCalledWith({ playState: 'stop' });

    shakaPlayers.at(-1).errorHandler?.({ detail: { message: 'stream broke' } });
    expect(api.castReportState).toHaveBeenCalledWith({
      playState: 'error',
      error: 'stream broke',
    });

    await interact(() => customKeyHandler(event('MediaPlayPause')));
    await interact(() => customKeyHandler(event('MediaPlay', 415)));
    await interact(() => customKeyHandler(event('MediaRewind', 412)));
    await interact(() => customKeyHandler(event('MediaFastForward', 417)));
    await interact(() => customKeyHandler(event('ArrowDown')));
    await interact(() => timers.at(-1).fn());
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'player-controls hidden',
    );

    await act(async () => {
      renderer.unmount();
    });

    api.getLiveStreamSource.mockResolvedValueOnce(null);
    const missingRenderer = await renderWithNodeMock(
      React.createElement(LivePlayerPage, {
        room: { roomid: 11, title: '缺失直播源', owner: { name: '主播' } },
        onBack,
      }),
      (element) => (element.type === 'video' ? createVideoMock() : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.castReportState).toHaveBeenCalledWith({
      playState: 'error',
      error: 'live-stream-source-missing',
    });
    await act(async () => {
      missingRenderer.unmount();
    });

    mpegtsSupported = false;
    api.getLiveStreamSource.mockResolvedValueOnce({
      type: 'flv',
      url: 'https://live.test/fallback.flv',
    });
    const unsupportedRenderer = await renderWithNodeMock(
      React.createElement(LivePlayerPage, {
        room: { roomid: 12, title: 'FLV 不支持', owner: { name: '主播' } },
        onBack,
      }),
      (element) => (element.type === 'video' ? createVideoMock() : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.castReportState).toHaveBeenCalledWith({
      playState: 'error',
      error: 'mpegts-live-not-supported',
    });
    await act(async () => {
      unsupportedRenderer.unmount();
    });

    shakaSupported = false;
    api.getLiveStreamSource.mockResolvedValueOnce({
      type: 'hls',
      url: 'https://live.test/fail.m3u8',
    });
    const shakaUnsupportedRenderer = await renderWithNodeMock(
      React.createElement(LivePlayerPage, {
        room: { roomid: 13, title: 'HLS 不支持', owner: { name: '主播' } },
        onBack,
      }),
      (element) => (element.type === 'video' ? createVideoMock() : null),
    );
    await act(async () => {
      await flush();
      await flush();
    });
    expect(api.castReportState).toHaveBeenCalledWith({
      playState: 'error',
      error: 'shaka-live-not-supported',
    });
    await act(async () => {
      shakaUnsupportedRenderer.unmount();
    });
  });

  test('fires stall detection interval while playing without changing currentTime', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-STALL', cid: 33, title: '卡顿检测' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.paused = false;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    const stallInterval = intervals.find((i) => i.delay === 1000 && !i.cleared);
    expect(stallInterval).toBeTruthy();
    stallInterval.fn();

    await act(async () => {
      renderer.unmount();
    });
  });

  test('configures generous buffer targets for stable playback', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-BUFFERCFG', cid: 31, title: '缓冲配置' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });
    expect(shakaPlayers[0].config.streaming.bufferingGoal).toBe(15);
    expect(shakaPlayers[0].config.streaming.rebufferingGoal).toBe(5);
    expect(shakaPlayers[0].config.streaming.bufferBehind).toBe(30);
  });

  test('shows buffering overlay during waiting and hides it on playing', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-BUFFERUI', cid: 32, title: '缓冲UI' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    expect(JSON.stringify(renderer.toJSON())).not.toContain('buffering');

    await interact(() => video.dispatch('waiting'));
    expect(JSON.stringify(renderer.toJSON())).toContain('buffering');

    await interact(() => video.dispatch('playing'));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('buffering');

    await act(async () => {
      renderer.unmount();
    });
  });

  test('suppresses buffering overlay during active seeking and recovers after commit', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: { bvid: 'BV-SEEK-BUFFER', cid: 34, title: '搜索缓冲' },
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.readyState = 2;
    await interact(() => video.dispatch('loadeddata'));
    await interact(() => video.dispatch('play'));

    await interact(() => customKeyHandler(event('ArrowUp')));
    currentNow += 50;
    await interact(() => customKeyHandler(event('ArrowRight')));

    await interact(() => video.dispatch('waiting'));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('buffering');

    const commitTimer = timers.find(
      (item) => item.delay === 500 && !item.cleared,
    );
    expect(commitTimer).toBeTruthy();
    await interact(() => commitTimer.fn());
    expect(JSON.stringify(renderer.toJSON())).toContain('buffering');

    await interact(() => video.dispatch('playing'));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('buffering');

    await act(async () => {
      renderer.unmount();
    });
  });

  test('persists resume progress on exit and clears it after playback ends', async () => {
    const { default: PlayerPage } = await importFresh('./PlayerPage.tsx');
    const video = createVideoMock();
    const onBack = mock(() => {});

    const renderer = await renderWithNodeMock(
      React.createElement(PlayerPage, {
        video: {
          bvid: 'BV-RESUME',
          cid: 77,
          title: '继续播放视频',
          duration: 120,
        },
        onBack,
      }),
      (element) => (element.type === 'video' ? video : null),
    );
    await act(async () => {
      await flush();
      await flush();
      await flush();
    });

    video.duration = 120;
    video.currentTime = 48;
    await interact(() => customKeyHandler(event('Backspace', 461)));

    expect(storageState.resumeProgress['BV-RESUME']).toMatchObject({
      bvid: 'BV-RESUME',
      cid: 77,
      progress: 48,
      duration: 120,
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    video.currentTime = 120;
    await interact(() => video.dispatch('ended'));
    expect(storageState.resumeProgress['BV-RESUME']).toBeUndefined();

    await act(async () => {
      renderer.unmount();
    });
  });
});
