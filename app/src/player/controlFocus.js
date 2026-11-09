// Local control-row focus: changing a button does not invalidate the player.
// Other focus regions still request a player render via setFocusIdx.
export function createControlFocus(initial) {
  let index = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => index,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(value) {
      const next = typeof value === 'function' ? value(index) : value;
      if (next === index) return;
      index = next;
      listeners.forEach(listener => listener());
    },
  };
}
