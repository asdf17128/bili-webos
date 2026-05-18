import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

export { React, act };

function getRenderWindow() {
  return globalThis.__TEST_WINDOW__ || globalThis.window;
}

function getRenderDocument() {
  return globalThis.__TEST_DOCUMENT__ || globalThis.document;
}

function applyMockNode(element, mockNode) {
  const descriptors = Object.getOwnPropertyDescriptors(mockNode);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === '__attachElement') continue;
    try {
      Object.defineProperty(element, key, descriptor);
    } catch {
      try {
        element[key] = mockNode[key];
      } catch {}
    }
  }
  if (typeof mockNode.__attachElement === 'function') {
    mockNode.__attachElement(element);
  }
}

function installCreateNodeMock(options) {
  if (!options?.createNodeMock) {
    return () => {};
  }

  const renderDocument = getRenderDocument();
  const originalCreateElement =
    renderDocument.createElement.bind(renderDocument);
  const originalCreateElementNS =
    renderDocument.createElementNS?.bind(renderDocument);

  const applyIfNeeded = (element, type) => {
    const mockNode = options.createNodeMock({ type });
    if (mockNode && typeof mockNode === 'object') {
      applyMockNode(element, mockNode);
    }
    return element;
  };

  renderDocument.createElement = function patchedCreateElement(
    tagName,
    elementOptions,
  ) {
    const element = originalCreateElement(tagName, elementOptions);
    return applyIfNeeded(element, tagName);
  };
  if (originalCreateElementNS) {
    renderDocument.createElementNS = function patchedCreateElementNS(
      namespaceURI,
      qualifiedName,
      optionsArg,
    ) {
      const element = originalCreateElementNS(
        namespaceURI,
        qualifiedName,
        optionsArg,
      );
      return applyIfNeeded(element, qualifiedName);
    };
  }

  return () => {
    renderDocument.createElement = originalCreateElement;
    if (originalCreateElementNS) {
      renderDocument.createElementNS = originalCreateElementNS;
    }
  };
}

function serializeNode(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const props = {};
  for (const attr of Array.from(node.attributes)) {
    props[attr.name === 'class' ? 'className' : attr.name] = attr.value;
  }
  if (node.style && node.getAttribute('style')) {
    props.style = node.style.cssText;
  }

  const children = Array.from(node.childNodes)
    .map(serializeNode)
    .filter((child) => child != null && child !== '');

  return {
    type: node.tagName.toLowerCase(),
    props,
    children: children.length ? children : null,
  };
}

function createRenderer(container, root, element, options) {
  return {
    container,
    element,
    root,
    options,
    toJSON() {
      if (container.childNodes.length === 0) return null;
      if (container.childNodes.length === 1) {
        return serializeNode(container.firstChild);
      }
      return Array.from(container.childNodes)
        .map(serializeNode)
        .filter(Boolean);
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    rerender(nextElement) {
      this.element = nextElement;
      return root.render(nextElement);
    },
  };
}

export async function render(element, options = {}) {
  const renderDocument = getRenderDocument();
  const container = renderDocument.createElement('div');
  renderDocument.body.appendChild(container);
  const root = createRoot(container);
  const renderer = createRenderer(container, root, element, options);

  await act(async () => {
    const restoreCreateNodeMock = installCreateNodeMock(options);
    try {
      root.render(element);
      await flush();
    } finally {
      restoreCreateNodeMock();
    }
  });

  return renderer;
}

export async function update(renderer, element) {
  await act(async () => {
    const restoreCreateNodeMock = installCreateNodeMock(renderer.options);
    try {
      renderer.rerender(element);
      await flush();
    } finally {
      restoreCreateNodeMock();
    }
  });
}

export async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

export async function interact(fn) {
  await act(async () => {
    await fn();
    await flush();
  });
}

export function textOf(node) {
  const renderWindow = getRenderWindow();
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (renderWindow?.Node && node instanceof renderWindow.Node)
    return node.textContent || '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children || []);
}

export function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      try {
        event.target = this;
      } catch {}
      for (const handler of listeners.get(event.type) || []) {
        handler(event);
      }
      return true;
    },
    listenerCount(type) {
      return (listeners.get(type) || new Set()).size;
    },
  };
}

export function createVideoMock() {
  const events = new Map();
  const mockVideo = {
    currentTime: 0,
    duration: 120,
    paused: true,
    readyState: 0,
    ended: false,
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(type, handler) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      events.get(type)?.delete(handler);
    },
    dispatch(type) {
      for (const handler of events.get(type) || []) {
        handler({ type });
      }
    },
    play() {
      this.paused = false;
      this.playCalls += 1;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      this.pauseCalls += 1;
    },
    scrollIntoView() {},
    __attachElement(element) {
      this.element = element;
      const bindMethod = (name) => {
        Object.defineProperty(element, name, {
          configurable: true,
          value: mockVideo[name].bind(mockVideo),
        });
      };
      for (const name of [
        'addEventListener',
        'removeEventListener',
        'play',
        'pause',
        'scrollIntoView',
      ]) {
        bindMethod(name);
      }
      for (const key of [
        'currentTime',
        'duration',
        'paused',
        'readyState',
        'ended',
        'playCalls',
        'pauseCalls',
      ]) {
        Object.defineProperty(element, key, {
          configurable: true,
          get() {
            return mockVideo[key];
          },
          set(value) {
            mockVideo[key] = value;
          },
        });
      }
    },
  };
  return mockVideo;
}
