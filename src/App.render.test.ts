import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import {
  React,
  render,
  flush,
  textOf,
  createEventTarget,
  update,
  interact,
} from './test/reactTestUtils.ts';

let focusState;
let castSubscription;
let castFailure;
let navResponse;
let navFailure;
let storageState;
let sidebarItems;
let pageProps;
let playerProps;
let eventTarget;
let timers;

beforeEach(() => {
  focusState = { current: null, listeners: [] };
  castSubscription = null;
  castFailure = null;
  navResponse = {
    data: { isLogin: true, mid: 1, uname: '已登录用户', face: 'avatar.png' },
  };
  navFailure = null;
  storageState = {
    auth: { SESSDATA: 'sess' },
    values: {},
  };
  sidebarItems = [];
  pageProps = [];
  playerProps = { video: null, live: null, login: null };
  eventTarget = createEventTarget();
  timers = [];

  globalThis.window = Object.assign(eventTarget, {
    PalmServiceBridge: function PalmServiceBridge() {},
    webOS: {
      service: {
        request(_uri, options) {
          if (options.method === 'fetch') {
            if (navFailure) {
              options.onFailure?.(navFailure);
              return;
            }
            options.onSuccess?.({
              returnValue: true,
              body: JSON.stringify(navResponse),
            });
            return;
          }
          if (options.method === 'castSubscribe') {
            castSubscription = (event) => {
              options.onSuccess?.({ event });
            };
            castFailure = (err) => {
              options.onFailure?.(err);
            };
            return;
          }
          if (options.method === 'castAck') {
            options.onSuccess?.({ returnValue: true });
          }
        },
      },
      platformBack: mock(() => {}),
    },
    close: mock(() => {}),
  });
  globalThis.document = {
    querySelector() {
      return null;
    },
  };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'bili_auth') {
        return storageState.auth ? JSON.stringify(storageState.auth) : null;
      }
      return key in storageState.values
        ? JSON.stringify(storageState.values[key])
        : null;
    },
    setItem(key, value) {
      if (key === 'bili_auth') storageState.auth = JSON.parse(value);
      else storageState.values[key] = JSON.parse(value);
    },
    removeItem(key) {
      if (key === 'bili_auth') storageState.auth = null;
      else delete storageState.values[key];
    },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.setTimeout = (fn, delay) => {
    const item = { fn, delay };
    timers.push(item);
    return item;
  };
  globalThis.clearTimeout = () => {};

  mock.module('./components/SidebarItem', () => ({
    default(props) {
      sidebarItems.push(props);
      return React.createElement(
        'sidebar-item',
        { onClick: props.onSelect, active: props.active },
        props.label,
      );
    },
  }));
  for (const page of ['LoginPage', 'HomePage', 'SearchPage', 'SettingsPage']) {
    mock.module(`./pages/${page}.tsx`, () => ({
      default(props) {
        pageProps.push({ page, props });
        if (page === 'LoginPage') playerProps.login = props;
        return React.createElement(`mock-${page}`, props, page);
      },
    }));
  }
  for (const page of ['PlayerPage', 'LivePlayerPage']) {
    mock.module(`./player/${page}.tsx`, () => ({
      default(props) {
        if (page === 'PlayerPage') playerProps.video = props;
        if (page === 'LivePlayerPage') playerProps.live = props;
        return React.createElement(`mock-${page}`, props, page);
      },
    }));
  }
});

afterEach(() => {
  mock.restore();
});

test('App loads user info, routes pages, handles cast commands, login, logout, and back behavior', async () => {
  const { default: App } = await import('./App.tsx');
  const renderer = await render(React.createElement(App));
  await flush();

  expect(textOf(renderer.toJSON())).toContain('已登录用户');
  expect(
    pageProps.some(
      (entry) => entry.page === 'HomePage' && entry.props.mode === 'recommend',
    ),
  ).toBe(true);
  timers[0].fn();

  await interact(() =>
    sidebarItems.find((item) => item.label === '热门').onSelect(),
  );
  expect(
    pageProps.some(
      (entry) => entry.page === 'HomePage' && entry.props.mode === 'hot',
    ),
  ).toBe(true);

  await interact(() =>
    sidebarItems.find((item) => item.label === '搜索').onSelect(),
  );
  expect(pageProps.some((entry) => entry.page === 'SearchPage')).toBe(true);

  const recommendEntry = pageProps.find(
    (entry) => entry.page === 'HomePage' && entry.props.mode === 'recommend',
  );
  await interact(() =>
    recommendEntry.props.onPlayVideo({
      roomid: 77,
      isLive: true,
      title: '直接直播',
    }),
  );
  expect(playerProps.live.room.roomid).toBe(77);

  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  await interact(() =>
    recommendEntry.props.onPlayVideo({ bvid: 'BV-local', title: '本地视频' }),
  );
  expect(playerProps.video.video).toMatchObject({ bvid: 'BV-local' });
  await interact(() =>
    playerProps.video.onPlayNext({ bvid: 'BV-next', title: '下一集' }),
  );
  expect(playerProps.video.video).toMatchObject({ bvid: 'BV-next' });
  await interact(() => playerProps.video.onBack());
  expect(textOf(renderer.toJSON())).not.toContain('mock-PlayerPage');
  await interact(() =>
    recommendEntry.props.onPlayVideo({ bvid: 'BV-local', title: '本地视频' }),
  );
  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  await interact(() => recommendEntry.props.onPlayVideo({ title: '坏视频' }));
  expect(textOf(renderer.toJSON())).toContain('无法播放此视频');
  await interact(() => timers.at(-1).fn());
  expect(textOf(renderer.toJSON())).not.toContain('无法播放此视频');

  await interact(() =>
    castSubscription({
      kind: 'command',
      command: {
        type: 'play',
        contentType: 'video',
        bvid: 'BV9',
        cid: 2,
        title: '投屏视频',
        seekTs: 15,
      },
    }),
  );
  expect(playerProps.video.video).toMatchObject({
    bvid: 'BV9',
    title: '投屏视频',
    progress: 15,
    fromCast: true,
  });
  await interact(() =>
    castSubscription({
      kind: 'command',
      command: { type: 'resume' },
    }),
  );
  await interact(() => castFailure?.({ errorText: 'subscribe failed' }));

  await interact(() =>
    castSubscription({
      kind: 'command',
      command: { type: 'stop' },
    }),
  );
  expect(playerProps.video).not.toBeNull();

  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(textOf(renderer.toJSON())).not.toContain('PlayerPage');
  await interact(() => renderer.unmount());

  storageState.auth = null;
  navResponse = { data: { isLogin: false } };
  const freshRenderer = await render(React.createElement(App));
  await flush();
  await interact(() =>
    sidebarItems.filter((item) => item.label === '关注').at(-1).onSelect(),
  );
  expect(playerProps.login).not.toBeNull();
  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(textOf(freshRenderer.toJSON())).not.toContain('mock-LoginPage');
  await interact(() =>
    sidebarItems.filter((item) => item.label === '我的').at(-1).onSelect(),
  );
  expect(playerProps.login).not.toBeNull();
  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(textOf(freshRenderer.toJSON())).not.toContain('mock-LoginPage');
  await interact(() =>
    freshRenderer.container
      .querySelector('.sidebar-user-login')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  expect(playerProps.login).not.toBeNull();
  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(textOf(freshRenderer.toJSON())).not.toContain('mock-LoginPage');
  await interact(() =>
    sidebarItems.filter((item) => item.label === '关注').at(-1).onSelect(),
  );

  await interact(() => playerProps.login.onLogin());
  expect(
    pageProps.some(
      (entry) => entry.page === 'HomePage' && entry.props.mode === 'recommend',
    ),
  ).toBe(true);

  await interact(() =>
    sidebarItems.filter((item) => item.label === '我的').at(-1).onSelect(),
  );
  const settingsEntry = pageProps
    .filter((entry) => entry.page === 'SettingsPage')
    .at(-1);
  await interact(() => settingsEntry.props.onLogout());
  expect(storageState.auth).toBeNull();
  globalThis.window.webOS.platformBack.mockClear();
  globalThis.window.close.mockClear();

  await interact(() =>
    castSubscription({
      kind: 'command',
      command: {
        type: 'play',
        contentType: 'live',
        roomId: 100,
        title: '直播间',
      },
    }),
  );
  expect(playerProps.live.room).toMatchObject({ roomid: 100, title: '直播间' });

  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(textOf(freshRenderer.toJSON())).not.toContain('mock-LivePlayerPage');
  expect(globalThis.window.webOS.platformBack).not.toHaveBeenCalled();
  await interact(() =>
    castSubscription({
      kind: 'command',
      command: {
        type: 'play',
        contentType: 'live',
        roomId: 101,
        title: '直接返回直播',
      },
    }),
  );
  await interact(() => playerProps.live.onBack());
  expect(textOf(freshRenderer.toJSON())).not.toContain('mock-LivePlayerPage');

  globalThis.window.webOS.platformBack.mockImplementationOnce(() => {
    throw new Error('no platform back');
  });
  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(globalThis.window.close).toHaveBeenCalled();

  navFailure = { errorText: 'nav failed' };
  storageState.auth = { SESSDATA: 'sess' };
  const failedNavRenderer = await render(React.createElement(App));
  await flush();
  await interact(() => failedNavRenderer.unmount());

  const appAgain = React.createElement(App);
  await update(freshRenderer, appAgain);
});

test('App prefers newer locally saved resume progress when opening a video', async () => {
  storageState.values.bili_resume_progress = {
    'BV-resume': {
      bvid: 'BV-resume',
      cid: 12,
      progress: 88,
      duration: 120,
      updatedAt: 1234,
    },
  };

  const { default: App } = await import('./App.tsx');
  const renderer = await render(React.createElement(App));
  await flush();

  const recommendEntry = pageProps.find(
    (entry) => entry.page === 'HomePage' && entry.props.mode === 'recommend',
  );

  await interact(() =>
    recommendEntry.props.onPlayVideo({
      bvid: 'BV-resume',
      cid: 12,
      title: '本地恢复视频',
      progress: 10,
    }),
  );

  expect(playerProps.video.video).toMatchObject({
    bvid: 'BV-resume',
    cid: 12,
    progress: 88,
  });

  await interact(() => renderer.unmount());
});

test('App ignores saved resume progress when it is older or from another cid', async () => {
  storageState.values.bili_resume_progress = {
    'BV-resume': {
      bvid: 'BV-resume',
      cid: 99,
      progress: 88,
      duration: 120,
      updatedAt: 1234,
    },
    'BV-older': {
      bvid: 'BV-older',
      cid: 21,
      progress: 8,
      duration: 120,
      updatedAt: 1235,
    },
  };

  const { default: App } = await import('./App.tsx');
  const renderer = await render(React.createElement(App));
  await flush();

  const recommendEntry = pageProps.find(
    (entry) => entry.page === 'HomePage' && entry.props.mode === 'recommend',
  );

  await interact(() =>
    recommendEntry.props.onPlayVideo({
      bvid: 'BV-resume',
      cid: 12,
      title: 'cid 不匹配',
      progress: 10,
    }),
  );
  expect(playerProps.video.video).toMatchObject({
    bvid: 'BV-resume',
    cid: 12,
    progress: 10,
  });

  await interact(() =>
    recommendEntry.props.onPlayVideo({
      bvid: 'BV-older',
      cid: 21,
      title: '本地更旧',
      progress: 18,
    }),
  );
  expect(playerProps.video.video).toMatchObject({
    bvid: 'BV-older',
    cid: 21,
    progress: 18,
  });

  await interact(() => renderer.unmount());
});
