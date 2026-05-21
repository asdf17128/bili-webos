import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

type FocusableEntry = {
  row: number;
  col: number;
  group: string;
  onSelect?: () => void;
};

type FocusDirection = 'up' | 'down' | 'left' | 'right';
type FocusListener = (id: string | null) => void;
type KeyEventHandler = (event: KeyboardEvent) => boolean;
type FocusableOptions = {
  id: string;
  row?: number;
  col?: number;
  group?: string;
  onSelect?: () => void;
};

// ======================================================
// Zero-React-render focus system
// Focus changes ONLY manipulate DOM classes directly,
// no React setState, no re-renders, no virtual DOM diff.
// ======================================================

const focusRegistry = new Map<string, FocusableEntry>();
let currentFocusId: string | null = null;

// Track last sidebar focus position
let lastSidebarFocus = 'sidebar-0-0';

// Direct DOM focus update - no React involved
function applyFocus(newId: string | null) {
  const prevId = currentFocusId;
  currentFocusId = newId;

  // Remember sidebar position
  if (newId?.startsWith('sidebar-')) lastSidebarFocus = newId;

  // Remove focus from previous element
  if (prevId) {
    const prevEl = document.querySelector(`[data-focus-id="${prevId}"]`);
    if (prevEl) prevEl.classList.remove('focused');
  }

  // Add focus to new element
  if (newId) {
    const newEl = document.querySelector(`[data-focus-id="${newId}"]`);
    if (newEl) {
      newEl.classList.add('focused');
      newEl.scrollIntoView({ block: 'nearest' });
    }
  }

  // Notify global listeners (sidebar expand etc)
  globalListeners.forEach((fn) => fn(newId));
}

export function registerFocusable(id, data) {
  focusRegistry.set(id, data);
}

export function unregisterFocusable(id) {
  focusRegistry.delete(id);
  if (currentFocusId === id) currentFocusId = null;
}

export function setFocus(id) {
  if (!focusRegistry.has(id) || id === currentFocusId) return;
  applyFocus(id);
}

export function getCurrentFocusId() {
  return currentFocusId;
}

// Global listeners (minimal - only for things like page switching)
const globalListeners = new Set<FocusListener>();
export function onFocusChange(fn: FocusListener) {
  globalListeners.add(fn);
  return () => {
    globalListeners.delete(fn);
  };
}

// O(1) grid navigation
function navigateGrid(fromId: string, direction: FocusDirection) {
  const from = focusRegistry.get(fromId);
  if (!from) return null;
  const { row, col, group } = from;

  let tr = row,
    tc = col;
  if (direction === 'up') tr--;
  else if (direction === 'down') tr++;
  else if (direction === 'left') tc--;
  else if (direction === 'right') tc++;

  const targetId = `${group}-${tr}-${tc}`;
  if (focusRegistry.has(targetId)) return targetId;

  if (direction === 'down' || direction === 'up') {
    for (let c = col; c >= 0; c--) {
      const id = `${group}-${tr}-${c}`;
      if (focusRegistry.has(id)) return id;
    }
  }
  return null;
}

function findInGroup(group: string, preferRow: number) {
  const id = `${group}-${preferRow}-0`;
  if (focusRegistry.has(id)) return id;
  for (let d = 1; d <= 8; d++) {
    if (focusRegistry.has(`${group}-${preferRow - d}-0`))
      return `${group}-${preferRow - d}-0`;
    if (focusRegistry.has(`${group}-${preferRow + d}-0`))
      return `${group}-${preferRow + d}-0`;
  }
  for (const [id, data] of focusRegistry) {
    if (data.group === group) return id;
  }
  return null;
}

// Keyboard handler
let keyHandler: ((event: KeyboardEvent) => void) | null = null;
let customKeyHandler: KeyEventHandler | null = null;
export function setCustomKeyHandler(handler: KeyEventHandler | null) {
  customKeyHandler = handler;
}

export function initKeyboardNav() {
  if (keyHandler) return;
  keyHandler = (e: KeyboardEvent) => {
    if (customKeyHandler && customKeyHandler(e)) return;
    const key = e.key;

    if (e.keyCode === 461 || key === 'Backspace' || key === 'GoBack') {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('tv-back'));
      return;
    }

    if (
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(
        key,
      )
    )
      return;
    e.preventDefault();

    if (key === 'Enter') {
      if (currentFocusId) focusRegistry.get(currentFocusId)?.onSelect?.();
      return;
    }

    if (!currentFocusId) return;
    const from = focusRegistry.get(currentFocusId);
    if (!from) return;

    const dir = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }[key] as FocusDirection;

    if (dir === 'up' || dir === 'down') {
      const next = navigateGrid(currentFocusId, dir);
      if (next) setFocus(next);
      return;
    }

    let next = navigateGrid(currentFocusId, dir);
    if (!next) {
      if (dir === 'left' && from.group !== 'sidebar') {
        // Go back to the last focused sidebar item
        next = lastSidebarFocus || 'sidebar-0-0';
        if (!focusRegistry.has(next)) next = findInGroup('sidebar', 0);
      } else if (dir === 'right' && from.group === 'sidebar') {
        // Always go to first content item
        next = 'content-0-0';
        if (!focusRegistry.has(next)) next = findInGroup('content', 0);
      }
    }
    if (next) setFocus(next);
  };
  window.addEventListener('keydown', keyHandler);
}

export function createFocusableHandlers(id: string, onSelect?: () => void) {
  return {
    onClick(e: ReactMouseEvent<HTMLElement>) {
      e.preventDefault();
      setFocus(id);
      onSelect?.();
    },
    onMouseEnter() {
      setFocus(id);
    },
  };
}

// Hook: registers element, NO re-renders on focus change
export function useFocusable({
  id,
  row = 0,
  col = 0,
  group = 'content',
  onSelect,
}: FocusableOptions) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    registerFocusable(id, {
      row,
      col,
      group,
      onSelect: () => onSelectRef.current?.(),
    });
    return () => unregisterFocusable(id);
  }, [id, row, col, group]);

  const handlers = createFocusableHandlers(id, () => onSelectRef.current?.());

  return {
    isFocused: currentFocusId === id, // Only accurate at render time, not reactive
    props: {
      'data-focus-id': id,
      onClick: handlers.onClick,
      onMouseEnter: handlers.onMouseEnter,
      style: { cursor: 'pointer' },
    },
  };
}

export const __testing = {
  hasFocusable(id: string) {
    return focusRegistry.has(id);
  },
  createFocusableHandlers,
  getKeyHandler() {
    return keyHandler;
  },
  invokeCustomKeyHandler(event: KeyboardEvent) {
    return customKeyHandler?.(event) ?? false;
  },
  reset() {
    focusRegistry.clear();
    currentFocusId = null;
    lastSidebarFocus = 'sidebar-0-0';
    customKeyHandler = null;
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    globalListeners.clear();
  },
};
