import { afterEach, beforeEach, expect, test } from 'bun:test';

let cleanupFns;
let elements;
let dispatched;
let keydownHandler;
let originalWindow;
let originalDocument;
let originalCustomEvent;

function makeElement(id) {
  return {
    id,
    classList: {
      added: [],
      removed: [],
      add(name) {
        this.added.push(name);
      },
      remove(name) {
        this.removed.push(name);
      },
    },
    scrollIntoViewCalls: [],
    scrollIntoView(arg) {
      this.scrollIntoViewCalls.push(arg);
    },
  };
}

async function loadModule() {
  return import(`./useFocus.js?t=${Date.now()}-${Math.random()}`);
}

beforeEach(() => {
  cleanupFns = [];
  elements = new Map();
  dispatched = [];
  keydownHandler = null;
  originalWindow = globalThis.window;
  originalDocument = globalThis.document;
  originalCustomEvent = globalThis.CustomEvent;

  globalThis.document = {
    querySelector(selector) {
      const id = selector.match(/data-focus-id="(.+)"/)?.[1];
      return elements.get(id) || null;
    },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    addEventListener(type, handler) {
      if (type === 'keydown') keydownHandler = handler;
    },
    removeEventListener(type, handler) {
      if (type === 'keydown' && keydownHandler === handler) keydownHandler = null;
    },
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    },
  };
});

afterEach(() => {
  while (cleanupFns.length) cleanupFns.pop()();
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.CustomEvent = originalCustomEvent;
});

test('register/setFocus/onFocusChange update DOM focus classes', async () => {
  const mod = await loadModule();
  const { registerFocusable, unregisterFocusable, setFocus, getCurrentFocusId, onFocusChange } = mod;
  const sidebar = makeElement('sidebar-0-0');
  const content = makeElement('content-0-0');
  elements.set('sidebar-0-0', sidebar);
  elements.set('content-0-0', content);

  registerFocusable('sidebar-0-0', { row: 0, col: 0, group: 'sidebar' });
  registerFocusable('content-0-0', { row: 0, col: 0, group: 'content' });
  const seen = [];
  cleanupFns.push(onFocusChange((id) => seen.push(id)));

  setFocus('sidebar-0-0');
  expect(getCurrentFocusId()).toBe('sidebar-0-0');
  expect(sidebar.classList.added).toEqual(['focused']);

  setFocus('content-0-0');
  expect(sidebar.classList.removed).toEqual(['focused']);
  expect(content.classList.added).toEqual(['focused']);
  expect(content.scrollIntoViewCalls[0]).toEqual({ block: 'nearest' });
  expect(seen).toEqual(['sidebar-0-0', 'content-0-0']);

  unregisterFocusable('content-0-0');
  expect(getCurrentFocusId()).toBeNull();
});

test('initKeyboardNav handles enter, arrows, sidebar/content transitions, and back key', async () => {
  const mod = await loadModule();
  const { registerFocusable, setFocus, initKeyboardNav, setCustomKeyHandler } = mod;

  const ids = ['sidebar-0-0', 'sidebar-1-0', 'content-0-0', 'content-1-0', 'content-1-1'];
  for (const id of ids) elements.set(id, makeElement(id));

  const selected = [];
  registerFocusable('sidebar-0-0', { row: 0, col: 0, group: 'sidebar', onSelect: () => selected.push('s0') });
  registerFocusable('sidebar-1-0', { row: 1, col: 0, group: 'sidebar', onSelect: () => selected.push('s1') });
  registerFocusable('content-0-0', { row: 0, col: 0, group: 'content', onSelect: () => selected.push('c0') });
  registerFocusable('content-1-0', { row: 1, col: 0, group: 'content', onSelect: () => selected.push('c1') });
  registerFocusable('content-1-1', { row: 1, col: 1, group: 'content', onSelect: () => selected.push('c2') });

  initKeyboardNav();
  expect(typeof keydownHandler).toBe('function');

  const consumed = [];
  setCustomKeyHandler((e) => {
    if (e.key === 'X') {
      consumed.push('custom');
      return true;
    }
    return false;
  });

  const event = (key, keyCode = 0) => ({
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
  });

  const custom = event('X');
  keydownHandler(custom);
  expect(consumed).toEqual(['custom']);

  setFocus('sidebar-0-0');
  const right = event('ArrowRight');
  keydownHandler(right);
  expect(elements.get('content-0-0').classList.added.at(-1)).toBe('focused');

  const down = event('ArrowDown');
  keydownHandler(down);
  expect(elements.get('content-1-0').classList.added.at(-1)).toBe('focused');

  const right2 = event('ArrowRight');
  keydownHandler(right2);
  expect(elements.get('content-1-1').classList.added.at(-1)).toBe('focused');

  const left = event('ArrowLeft');
  keydownHandler(left);
  expect(elements.get('content-1-0').classList.added.at(-1)).toBe('focused');

  const enter = event('Enter');
  keydownHandler(enter);
  expect(selected).toContain('c1');

  const back = event('Backspace', 461);
  keydownHandler(back);
  expect(dispatched[0].type).toBe('tv-back');
  expect(back.stopped).toBe(true);
});

test('useFocusable hook registers, focuses on hover, and selects on click', async () => {
  const mod = await loadModule();
  const { useFocusable, getCurrentFocusId } = mod;
  const { React, render, interact } = await import('../test/reactTestUtils.mjs');

  const calls = [];
  function Harness() {
    const { props, isFocused } = useFocusable({
      id: 'content-2-1',
      row: 2,
      col: 1,
      group: 'content',
      onSelect: () => calls.push('select'),
    });
    return React.createElement('button', { ...props, 'data-focused': String(isFocused) }, 'ok');
  }

  elements.set('content-2-1', makeElement('content-2-1'));
  const renderer = await render(React.createElement(Harness));
  const button = renderer.container.querySelector('button');

  await interact(() => {
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
  });
  expect(getCurrentFocusId()).toBe('content-2-1');

  await interact(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(calls).toEqual(['select']);

  renderer.unmount();
});

test('keyboard navigation falls back across sparse grids and missing groups', async () => {
  const mod = await loadModule();
  const { registerFocusable, unregisterFocusable, setFocus, initKeyboardNav, onFocusChange } = mod;

  const ids = ['sidebar-3-0', 'content-1-0', 'content-2-2'];
  for (const id of ids) elements.set(id, makeElement(id));

  registerFocusable('sidebar-3-0', { row: 3, col: 0, group: 'sidebar', onSelect() {} });
  registerFocusable('content-1-0', { row: 1, col: 0, group: 'content', onSelect() {} });
  registerFocusable('content-2-2', { row: 2, col: 2, group: 'content', onSelect() {} });

  const seen = [];
  const off = onFocusChange((id) => seen.push(id));
  initKeyboardNav();

  const event = (key) => ({
    key,
    keyCode: 0,
    preventDefault() {},
    stopPropagation() {},
  });

  setFocus('sidebar-3-0');
  keydownHandler(event('ArrowRight'));
  expect(mod.getCurrentFocusId()).toBe('content-1-0');

  setFocus('content-2-2');
  keydownHandler(event('ArrowUp'));
  expect(mod.getCurrentFocusId()).toBe('content-1-0');

  unregisterFocusable('sidebar-3-0');
  setFocus('content-1-0');
  keydownHandler(event('ArrowLeft'));
  expect(mod.getCurrentFocusId()).toBe('content-1-0');

  off();
  setFocus('content-2-2');
  expect(seen.at(-1)).toBe('content-1-0');
});
