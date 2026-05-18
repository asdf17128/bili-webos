import { test, expect } from 'bun:test';
import { React, render, update, textOf } from './reactTestUtils.ts';

function Counter({ count }) {
  return React.createElement('div', null, 'count:' + count);
}

test('reactTestUtils render/update smoke test', async () => {
  const renderer = await render(React.createElement(Counter, { count: 1 }));
  expect(textOf(renderer.toJSON())).toBe('count:1');

  await update(renderer, React.createElement(Counter, { count: 2 }));
  expect(textOf(renderer.toJSON())).toBe('count:2');

  renderer.unmount();
});
