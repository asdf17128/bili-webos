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
let navResponse;
let storageState;
let sidebarItems;
let pageProps;
let playerProps;
let eventTarget;
let timers;

async function importFresh(pathname) {
  return import(`${pathname}?t=${Date.now()}-${Math.random()}`);
}

beforeEach(() => {
  focusState = { current: null, listeners: [] };
  castSubscription = null;
  navResponse = {
    data: { isLogin: true, mid: 1, uname: '已登录用户', face: 'avatar.png' },
  };
  storageState = {
    auth: { SESSDATA: 'sess' },
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
      if (key === 'bili_auth')
        return storageState.auth ? JSON.stringify(storageState.auth) : null;
      return null;
    },
    setItem(key, value) {
      if (key === 'bili_auth') storageState.auth = JSON.parse(value);
    },
    removeItem(key) {
      if (key === 'bili_auth') storageState.auth = null;
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
  const { default: App } = await importFresh('./App.tsx');
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
  await interact(() => recommendEntry.props.onPlayVideo({ title: '坏视频' }));
  expect(textOf(renderer.toJSON())).toContain('无法播放此视频');

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
      command: { type: 'stop' },
    }),
  );
  expect(playerProps.video).not.toBeNull();

  await interact(() => eventTarget.dispatchEvent(new CustomEvent('tv-back')));
  expect(textOf(renderer.toJSON())).not.toContain('PlayerPage');

  storageState.auth = null;
  navResponse = { data: { isLogin: false } };
  const freshRenderer = await render(React.createElement(App));
  await flush();
  await interact(() =>
    sidebarItems.find((item) => item.label === '关注').onSelect(),
  );
  expect(playerProps.login).not.toBeNull();

  await interact(() => playerProps.login.onLogin());
  expect(
    pageProps.some(
      (entry) => entry.page === 'HomePage' && entry.props.mode === 'recommend',
    ),
  ).toBe(true);

  await interact(() =>
    sidebarItems.find((item) => item.label === '我的').onSelect(),
  );
  const settingsEntry = pageProps
    .filter((entry) => entry.page === 'SettingsPage')
    .at(-1);
  await interact(() => settingsEntry.props.onLogout());
  expect(storageState.auth).toBeNull();

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
  expect(globalThis.window.webOS.platformBack).toHaveBeenCalled();

  const appAgain = React.createElement(App);
  await update(freshRenderer, appAgain);
});
