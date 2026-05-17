import { Window } from 'happy-dom';

const window = new Window({
  url: 'http://localhost/',
});

window.SyntaxError ??= globalThis.SyntaxError;
window.TypeError ??= globalThis.TypeError;
window.Error ??= globalThis.Error;

globalThis.window = window;
globalThis.document = window.document;
globalThis.__TEST_WINDOW__ = window;
globalThis.__TEST_DOCUMENT__ = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLVideoElement = window.HTMLVideoElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.Node = window.Node;
globalThis.Text = window.Text;
globalThis.Element = window.Element;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.SyntaxError = globalThis.SyntaxError || window.SyntaxError;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

if (!globalThis.IS_REACT_ACT_ENVIRONMENT) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
