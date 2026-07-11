import { useEffect, useCallback, useRef } from 'react';

// ======================================================
// Zero-React-render focus system
// Focus changes ONLY manipulate DOM classes directly,
// no React setState, no re-renders, no virtual DOM diff.
// ======================================================

const focusRegistry = new Map(); // id -> { ref, row, col, group, onSelect }
let currentFocusId = null;

// Pointer hover (Magic Remote) always moves the focus, so the highlighted item
// follows the pointer and highlight == pointer == click target (fixes the #11
// desync where the wheel moved focus in a fixed column while a click hit
// whatever was under the pointer). The sidebar treats pointer-driven focus as
// highlight-only (no page switch) — see isPointerFocus — so the cursor drifting
// over the menu no longer rapidly switches pages.
//
// True when the current focus was moved by the pointer (hover), false when by
// the D-pad. Lets the sidebar preview on D-pad only, not on hover.
let lastFocusFromPointer = false;
export function isPointerFocus() { return lastFocusFromPointer; }

// The ACTUAL edge auto-scroll cause (#11, per @ZMonsterror): hover-focusing a
// card that's only half on-screen at the edge triggers a scroll to reveal it
// (scrollIntoView + the pages' focus-row translateY), which slides the next
// half-card under the stationary pointer → hover → scroll → loop. Fix: pointer
// hover only HIGHLIGHTS, never scrolls — that alone breaks the loop (no scroll →
// nothing new slides under the pointer). Scrolling stays with the D-pad and the
// wheel. hoverDriven is true only during a hover-initiated setFocus, and both
// scroll paths (applyFocus's scrollIntoView here, and HomePage/FavoritesPage's
// focus-row) consult it.
//
// NOTE: an earlier attempt (v1.1.24) also gated hover on "did the pointer really
// move" via coordinate/timestamp checks — that was fragile and actually blocked
// legit hovers (killed highlight-follows-pointer). Removed: the no-scroll rule
// is the correct and sufficient loop fix, so hover can always move the focus.
let hoverDriven = false;
export function isHoverDriven() { return hoverDriven; }

// Track last sidebar focus position
let lastSidebarFocus = 'sidebar-0-0';

// Direct DOM focus update - no React involved
// The pages pin the FOCUSED row to the top of the viewport (VideoGrid:
// scrollY = focusRow * rowHeight) — but only for non-hover focus changes.
// So the view anchor = the last NON-hover focus. The wheel must step THIS
// row (view movement), never "the card under the pointer": with the pointer
// near the bottom, that card sits 2 rows below the anchor and stepping from
// it scrolls the view the WRONG way / wedges (#11 v1.2.5 retest).
let lastAnchor = null; // { group, row, col }

function applyFocus(newId) {
  const prevId = currentFocusId;
  currentFocusId = newId;

  // Remember sidebar position
  if (newId?.startsWith('sidebar-')) lastSidebarFocus = newId;
  if (newId && !hoverDriven) {
    const meta = focusRegistry.get(newId);
    if (meta) lastAnchor = { group: meta.group, row: meta.row, col: meta.col };
  }

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
      // Don't scroll for a pointer-hover focus — that's the edge-scroll loop (#11).
      if (!hoverDriven) newEl.scrollIntoView({ block: 'nearest' });
    }
  }

  // Notify global listeners (sidebar expand etc)
  globalListeners.forEach(fn => fn(newId));
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

export function getCurrentFocusId() { return currentFocusId; }

// Move focus into the page's content area (used when "entering" a section via
// OK). The content may still be loading, so retry briefly until a card has
// registered. Aborts if the user has already navigated into content.
export function focusFirstContent(maxMs = 1500) {
  const start = Date.now();
  const attempt = () => {
    if (currentFocusId && currentFocusId.startsWith('content-')) return; // already inside
    const id = focusRegistry.has('content-0-0') ? 'content-0-0' : findInGroup('content', 0);
    if (id) { setFocus(id); return; }
    if (Date.now() - start < maxMs) setTimeout(attempt, 60);
  };
  setTimeout(attempt, 30);
}

// Return focus to the sidebar — the last item the user was on, else the first.
export function focusSidebar() {
  let id = lastSidebarFocus;
  if (!id || !focusRegistry.has(id)) id = findInGroup('sidebar', 0);
  if (id) setFocus(id);
}

// Global listeners (minimal - only for things like page switching)
const globalListeners = new Set();
export function onFocusChange(fn) {
  globalListeners.add(fn);
  return () => globalListeners.delete(fn);
}

// O(1) grid navigation
function navigateGrid(fromId, direction) {
  const from = focusRegistry.get(fromId);
  if (!from) return null;
  const { row, col, group } = from;

  let tr = row, tc = col;
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

function findInGroup(group, preferRow) {
  const id = `${group}-${preferRow}-0`;
  if (focusRegistry.has(id)) return id;
  for (let d = 1; d <= 8; d++) {
    if (focusRegistry.has(`${group}-${preferRow - d}-0`)) return `${group}-${preferRow - d}-0`;
    if (focusRegistry.has(`${group}-${preferRow + d}-0`)) return `${group}-${preferRow + d}-0`;
  }
  for (const [id, data] of focusRegistry) {
    if (data.group === group) return id;
  }
  return null;
}

// Keyboard handler
let keyHandler = null;
let customKeyHandler = null;
export function setCustomKeyHandler(handler) { customKeyHandler = handler; }

export function initKeyboardNav() {
  if (keyHandler) return;
  keyHandler = (e) => {
    if (customKeyHandler && customKeyHandler(e)) return;
    const key = e.key;

    if (e.keyCode === 461 || key === 'Backspace' || key === 'GoBack') {
      e.preventDefault(); e.stopPropagation();
      window.dispatchEvent(new CustomEvent('tv-back'));
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return;
    e.preventDefault();
    lastFocusFromPointer = false; // this focus move is from the D-pad

    if (key === 'Enter') {
      if (currentFocusId) focusRegistry.get(currentFocusId)?.onSelect?.();
      return;
    }

    if (!currentFocusId) return;
    const from = focusRegistry.get(currentFocusId);
    if (!from) return;

    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key];

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

  // Magic Remote scroll wheel: scroll the page by moving focus one row up/down
  // FROM THE CARD UNDER THE POINTER (not from some fixed column — that desynced
  // highlight and click target, #11). The content scroll is focus-driven, so
  // this scrolls the feed; after the row shifts under the stationary pointer,
  // the focused card is again the one at the pointer, keeping them in sync.
  let pointerX = 960, pointerY = 540;
  window.addEventListener('mousemove', (e) => {
    pointerX = e.clientX; pointerY = e.clientY;
  }, { passive: true });
  // Step one row per ~140px of ACCUMULATED wheel delta, not per event. webOS
  // auto-fires a continuous stream of small wheel events while the Magic-Remote
  // pointer sits in the top/bottom edge zones; per-event stepping made the page
  // scroll wildly there (#11). Accumulation turns that stream into a gentle
  // scroll while a real wheel flick (large delta) still steps immediately.
  // One LG Magic Remote wheel detent = deltaY 200 (MEASURED on the owner's C4
  // via an in-page logger, 2026-07-11 — NOT the standard 120, and the official
  // docs don't document it). Matching the step to the real detent gives exactly
  // one-notch-one-row: 140 made notches worth 1.4 steps (carry made some
  // notches jump 2 rows), 100 made every notch jump 2. The rate cap below
  // still tames edge-zone streams.
  const WHEEL_STEP = 200;
  let wheelAcc = 0;
  let lastWheelTs = 0;
  let lastStepTs = 0;
  // Always-on wheel diagnostics ring buffer (test hook, like __openVideo):
  // every event records WHY it did or didn't step — reachable after any
  // relaunch via `window.__wheelDiag` from CDP.
  const wheelDiag = (window.__wheelDiag = []);
  const diag = (dy, why, extra) => {
    wheelDiag.push({ t: Date.now() % 1000000, dy, why, ...(extra || {}) });
    if (wheelDiag.length > 200) wheelDiag.shift();
  };
  window.addEventListener('wheel', (e) => {
    if (customKeyHandler) { diag(e.deltaY, 'custom-handler-owns-input'); return; }
    const now = Date.now();
    if (now - lastWheelTs > 600) wheelAcc = 0; // stale/direction-idle reset
    lastWheelTs = now;
    // Direction flip: discard the opposite-direction carry — a banked up-carry
    // was silently EATING the next down notch (owner: "向下拨一格没反应").
    if ((wheelAcc > 0 && e.deltaY < 0) || (wheelAcc < 0 && e.deltaY > 0)) wheelAcc = 0;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < WHEEL_STEP) { diag(e.deltaY, 'below-threshold', { acc: wheelAcc }); return; }
    // Rate cap (edge-zone runaway protection), but CARRY the surplus instead
    // of discarding it — zeroing on every step ate most of a vigorous flick
    // and read as "卡卡的" (sticky). Carry is clamped to 2 rows so a banked
    // stream can't keep scrolling after the finger stops.
    if (now - lastStepTs < 120) {
      const lim = WHEEL_STEP * 2;
      if (wheelAcc > lim) wheelAcc = lim; else if (wheelAcc < -lim) wheelAcc = -lim;
      diag(e.deltaY, 'rate-capped', { acc: wheelAcc });
      return;
    }
    const dir = wheelAcc > 0 ? 'down' : 'up';
    wheelAcc -= dir === 'down' ? WHEEL_STEP : -WHEEL_STEP;
    lastStepTs = now;
    // Step the VIEW-ANCHOR row (see lastAnchor above). Falls back to the
    // current focus for the very first wheel.
    let base = lastAnchor;
    if (!base || base.group !== 'content') {
      const meta = currentFocusId ? focusRegistry.get(currentFocusId) : null;
      if (!meta || meta.group !== 'content') return;
      base = { group: meta.group, row: meta.row, col: meta.col };
    }
    // Find a card in the target row, preferring the same column.
    const findInRow = (group, rowN, col) => {
      for (let cCol = col; cCol >= 0; cCol--) {
        const id = `${group}-${rowN}-${cCol}`;
        if (focusRegistry.has(id)) return id;
      }
      return null;
    };
    const targetRow = base.row + (dir === 'down' ? 1 : -1);
    let next = targetRow < 0 ? null : findInRow(base.group, targetRow, base.col);
    if (!next) {
      // The ANCHOR is at a boundary (e.g. bottom row while load-more catches
      // up) but the FOCUS may not be — retry from the focused row so a notch
      // is never silently dead when there's still somewhere to go.
      const meta = currentFocusId ? focusRegistry.get(currentFocusId) : null;
      if (meta && meta.group === 'content' && meta.row !== base.row) {
        const t2 = meta.row + (dir === 'down' ? 1 : -1);
        if (t2 >= 0) next = findInRow(meta.group, t2, meta.col);
      }
    }
    if (!next) { diag(e.deltaY, 'no-target-row', { baseRow: base.row, dir }); return; }
    diag(e.deltaY, 'stepped', { to: next });
    lastFocusFromPointer = true;
    setFocus(next); // non-hover → pages re-anchor the view to targetRow
  }, { passive: true });
}

// Hook: registers element, NO re-renders on focus change
export function useFocusable({ id, row = 0, col = 0, group = 'content', onSelect }) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    registerFocusable(id, {
      row, col, group,
      onSelect: () => onSelectRef.current?.(),
    });
    return () => unregisterFocusable(id);
  }, [id, row, col, group]);

  const handleClick = useCallback((e) => {
    e.preventDefault();
    setFocus(id);
    onSelectRef.current?.();
  }, [id]);

  const handleMouseEnter = useCallback(() => {
    lastFocusFromPointer = true; // pointer moved the focus → sidebar won't switch pages
    hoverDriven = true;          // highlight only, no scroll (breaks the edge loop)
    setFocus(id);
    hoverDriven = false;
  }, [id]);

  return {
    isFocused: currentFocusId === id, // Only accurate at render time, not reactive
    props: {
      'data-focus-id': id,
      onClick: handleClick,
      onMouseEnter: handleMouseEnter,
      style: { cursor: 'pointer' },
    }
  };
}
