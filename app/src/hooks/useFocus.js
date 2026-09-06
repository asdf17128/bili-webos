import { useEffect, useCallback, useRef } from 'react';
import { markAfterPaint } from '../utils/perf';

// ======================================================
// Zero-React-render focus system
// Focus changes ONLY manipulate DOM classes directly,
// no React setState, no re-renders, no virtual DOM diff.
// ======================================================

const focusRegistry = new Map(); // id -> { ref, row, col, group, onSelect }
let currentFocusId = null;
let contentContext = 'recommend';
const contentMemory = new Map();
let pendingContentFocus = null;
let contentFocusTimer = null;

export function cancelContentFocus() {
  pendingContentFocus = null;
  clearTimeout(contentFocusTimer);
}

export function setContentContext(key) {
  if (contentContext === key) return;
  cancelContentFocus();
  contentContext = key;
  lastAnchor = null;
}

export function resetContentMemory() { contentMemory.delete(contentContext); }

function rememberedContent() {
  const id = contentMemory.get(contentContext);
  if (id && focusRegistry.has(id)) return id;
  if (focusRegistry.has('content-0-0')) return 'content-0-0';
  for (const [key, data] of focusRegistry) {
    if (data.group === 'content' && data.row >= 0) return key;
  }
  return null;
}

function resolveContentFocus() {
  const request = pendingContentFocus;
  if (!request || request.context !== contentContext || Date.now() > request.until) return;
  const id = rememberedContent();
  if (id) { cancelContentFocus(); setFocus(id); }
}

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
// D-pad navigation owns focus until the pointer actually moves again.
// Scrolling content beneath a stationary cursor must not steal that focus.
let pointerEnabled = true;
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
  if (newId?.startsWith('content-')) contentMemory.set(contentContext, newId);

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
      // And never inside VideoGrid: it scrolls itself via translateY, so a
      // browser scroll STACKS on top of the transform (measured: wrapper
      // scrollTop 608px, focused card pushed above the viewport — PR #16).
      // Test by ANCESTRY, not by id prefix: 设置/搜索/我的 rows are also
      // 'content-N-0' but live in real overflow:auto containers and DO need
      // scrollIntoView (gating them by prefix broke 4 smoke assertions).
      const selfScrolled = !!(newEl.closest && newEl.closest('.video-grid-viewport'));
      // Native library cards also enlarge on focus. Center their row so the
      // finished scale animation cannot push the bottom edge out of view.
      if (!hoverDriven && !selfScrolled) newEl.scrollIntoView({ block: newEl.classList.contains('video-card') ? 'center' : 'nearest' });
      if (selfScrolled) {                    // undo any stray wrapper scroll
        let p = newEl.parentElement;
        while (p && p !== document.body) {
          if (p.scrollTop) p.scrollTop = 0;
          p = p.parentElement;
        }
      }
    }
  }

  // Notify global listeners (sidebar expand etc)
  globalListeners.forEach(fn => fn(newId));
}

export function registerFocusable(id, data) {
  focusRegistry.set(id, data);
  // Wait until all cells in this React commit have registered, then resolve the
  // user's pending entry. A slow network must not need a second OK press.
  if (pendingContentFocus && data.group === 'content') {
    clearTimeout(contentFocusTimer);
    contentFocusTimer = setTimeout(resolveContentFocus, 0);
  }
}

export function unregisterFocusable(id) {
  focusRegistry.delete(id);
  if (currentFocusId === id) currentFocusId = null;
}

export function setFocus(id) {
  const entry = focusRegistry.get(id);
  if (!entry) return;
  // The pointer may already highlight the wheel's target row without scrolling
  // to it. A deliberate wheel/D-pad entry must still anchor that same cell.
  if (id === currentFocusId && (hoverDriven || (lastAnchor?.group === entry.group && lastAnchor.row === entry.row && lastAnchor.col === entry.col))) return;
  cancelContentFocus();
  applyFocus(id);
}

export function getCurrentFocusId() { return currentFocusId; }

// Move focus into the page's content area (used when "entering" a section via
// OK/Right). Resolve when cells register; later navigation cancels the request.
export function focusFirstContent(maxMs = 15000) {
  cancelContentFocus();
  pendingContentFocus = { context: contentContext, until: Date.now() + maxMs };
  contentFocusTimer = setTimeout(resolveContentFocus, 0);
}

// Return focus to the sidebar — the last item the user was on, else the first.
export function focusSidebar() {
  let id = lastSidebarFocus;
  if (!id || !focusRegistry.has(id)) id = findInGroup('sidebar', 0);
  if (id) setFocus(id);
}

// Seed the "home" sidebar target (the app sets this to 推荐, not sidebar[0]
// which is now 搜索) so Left-from-content and focusSidebar default there.
export function setLastSidebarFocus(id) {
  if (id) lastSidebarFocus = id;
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
  const override = from.onNavigate?.(direction);
  if (override && focusRegistry.has(override)) return override;
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

  // 侧栏上下循环:顶部按上 → 最底 icon,底部按下 → 顶部(owner request)。
  // 只给 sidebar 组 — 内容网格到边就该停,循环会让长列表迷失方向。
  if (group === 'sidebar' && (direction === 'up' || direction === 'down')) {
    let min = Infinity, max = -Infinity;
    for (const [, d] of focusRegistry) {
      if (d.group === 'sidebar') {
        if (d.row < min) min = d.row;
        if (d.row > max) max = d.row;
      }
    }
    if (min !== Infinity) {
      const wrapId = `sidebar-${direction === 'up' ? max : min}-0`;
      if (focusRegistry.has(wrapId) && wrapId !== fromId) return wrapId;
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

// ---- 通用长按(OK 键按住)---------------------------------------------------
// 播放器里的三连长按是按钮私有的实现;网格卡片也需要长按(稍后再看里长按移除),
// 所以把它做成焦点系统的通用能力:useFocusable 传了 onLongPress 的项才启用,
// 没传的项行为一个字节都不变(仍然 keydown 即触发 onSelect)。
const HOLD_MS = 800;   // 比播放器三连的 2s 短:移除是轻量操作,不需要那么强的确认
let hold = { id: null, timer: null, fired: false };
const elOf = (id) => document.querySelector(`[data-focus-id="${id}"]`);

function clearHold() {
  if (hold.timer) clearTimeout(hold.timer);
  if (hold.id) elOf(hold.id)?.classList.remove('holding');
  hold = { id: null, timer: null, fired: false };
}

function startHold(id) {
  if (hold.id) return;              // 已在长按中(自动重复的 keydown)
  elOf(id)?.classList.add('holding');   // CSS 里画进度条,让用户知道正在按住
  hold = {
    id, fired: false,
    timer: setTimeout(() => {
      hold.fired = true;
      elOf(id)?.classList.remove('holding');
      focusRegistry.get(id)?.onLongPress?.();
    }, HOLD_MS),
  };
}

// 松开:没到时长就是普通 OK;到了时长长按已经触发过,松开什么也不做。
function endHold() {
  if (!hold.id) return;
  const { id, fired } = hold;
  clearHold();
  if (!fired) focusRegistry.get(id)?.onSelect?.();
}

export function initKeyboardNav() {
  if (keyHandler) return;
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') endHold();
  });
  window.addEventListener('blur', clearHold);
  // 焦点被移走(方向键/指针)时中断长按,否则松手会误触发到别的卡片上
  onFocusChange(() => { if (hold.id && hold.id !== currentFocusId) clearHold(); });
  keyHandler = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Escape', 'GoBack'].includes(e.key) || e.keyCode === 461) pointerEnabled = false;
    if (customKeyHandler && customKeyHandler(e)) return;
    const key = e.key;
    const editable = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if (editable) {
      // Leave typing, deletion and caret movement to the system keyboard.
      if (e.keyCode === 461 || key === 'GoBack' || key === 'Escape') {
        e.preventDefault(); e.target.blur();
      }
      return;
    }

    if (e.keyCode === 461 || key === 'Backspace' || key === 'GoBack' || key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      cancelContentFocus(); clearHold();
      if (e.repeat) return;
      window.dispatchEvent(new CustomEvent('tv-back'));
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return;
    e.preventDefault();
    cancelContentFocus();
    lastFocusFromPointer = false; // this focus move is from the D-pad
    // 跟手 = 按下到焦点**画出来**的时间。起点必须是按键进来的第一行,
    // 终点是绘制后(双 rAF),中间的 setState/滚动/重排都算进去。
    const keyT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    if (key === 'Enter') {
      if (!currentFocusId) return;
      const entry = focusRegistry.get(currentFocusId);
      if (!entry) return;
      // Items WITHOUT a long-press action keep the old behaviour exactly: fire on
      // keydown. Only items that opt in wait for the release, so nothing else in
      // the app changes timing (the player runs its own hold machinery).
      if (!entry.onLongPress) { if (!e.repeat) entry.onSelect?.(); return; }
      if (!e.repeat) startHold(currentFocusId);
      return;
    }

    if (!currentFocusId) { focusSidebar(); return; }
    const from = focusRegistry.get(currentFocusId);
    if (!from) return;

    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key];

    if (dir === 'up' || dir === 'down') {
      const next = navigateGrid(currentFocusId, dir);
      if (next) { setFocus(next); markAfterPaint('focus-move', keyT0); }
      return;
    }

    let next = navigateGrid(currentFocusId, dir);
    if (!next) {
      if (dir === 'left' && from.group !== 'sidebar') {
        // Go back to the last focused sidebar item
        next = lastSidebarFocus || 'sidebar-0-0';
        if (!focusRegistry.has(next)) next = findInGroup('sidebar', 0);
      } else if (dir === 'right' && from.group === 'sidebar') {
        // Commit the focused section, including a pending sidebar preview.
        window.dispatchEvent(new CustomEvent('tv-enter-content', { detail: currentFocusId }));
        return;
      }
    }
    if (next) { setFocus(next); markAfterPaint('focus-move', keyT0); }
  };
  window.addEventListener('keydown', keyHandler);

  // Magic Remote scroll wheel: scroll the page by moving focus one row up/down
  // FROM THE CARD UNDER THE POINTER (not from some fixed column — that desynced
  // highlight and click target, #11). The content scroll is focus-driven, so
  // this scrolls the feed; after the row shifts under the stationary pointer,
  // the focused card is again the one at the pointer, keeping them in sync.
  let pointerX = 960, pointerY = 540;
  window.addEventListener('mousemove', (e) => {
    const moved = pointerX !== e.clientX || pointerY !== e.clientY;
    pointerX = e.clientX; pointerY = e.clientY;
    if (moved && !pointerEnabled) {
      pointerEnabled = true;
      const item = e.target.closest?.('[data-focus-id]');
      if (item && !customKeyHandler) {
        lastFocusFromPointer = true; hoverDriven = true;
        setFocus(item.dataset.focusId);
        hoverDriven = false;
      }
    }
  }, { passive: true });
  // Step one row per ~140px of ACCUMULATED wheel delta, not per event. webOS
  // auto-fires a continuous stream of small wheel events while the Magic-Remote
  // pointer sits in the top/bottom edge zones; per-event stepping made the page
  // scroll wildly there (#11). Accumulation turns that stream into a gentle
  // scroll while a real wheel flick (large delta) still steps immediately.
  // LG Magic Remote wheel is VELOCITY-SENSITIVE (measured on the owner's C4
  // via __wheelDiag, 2026-07-11): a slow notch sends deltaY=120, a fast one
  // 200 — so pixel-accumulation can never make "one notch = one row" hold for
  // both. Model it by INTENT instead: any event with |deltaY| ≥ NOTCH_MIN is a
  // real notch → exactly one row (rate-capped, no carry — carries made some
  // notches jump 2 rows). Smaller deltas are the pointer edge-zone auto-stream
  // (#11) → gentle pixel accumulation with a slower cap.
  const NOTCH_MIN = 100;
  const STREAM_STEP = 200;
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
    pointerEnabled = true;
    if (customKeyHandler) { diag(e.deltaY, 'custom-handler-owns-input'); return; }
    const now = Date.now();
    if (now - lastWheelTs > 600) wheelAcc = 0; // stale stream reset
    lastWheelTs = now;
    let dir;
    if (Math.abs(e.deltaY) >= NOTCH_MIN) {
      // A real notch: one row, always (120 slow / 200 fast — same intent).
      wheelAcc = 0;
      if (now - lastStepTs < 120) { diag(e.deltaY, 'rate-capped'); return; }
      dir = e.deltaY > 0 ? 'down' : 'up';
    } else {
      // Edge-zone auto-stream: small continuous deltas → gentle scroll.
      if ((wheelAcc > 0 && e.deltaY < 0) || (wheelAcc < 0 && e.deltaY > 0)) wheelAcc = 0;
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) < STREAM_STEP) { diag(e.deltaY, 'below-threshold', { acc: wheelAcc }); return; }
      if (now - lastStepTs < 200) { diag(e.deltaY, 'rate-capped', { acc: wheelAcc }); return; }
      dir = wheelAcc > 0 ? 'down' : 'up';
      wheelAcc -= dir === 'down' ? STREAM_STEP : -STREAM_STEP;
    }
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
export function useFocusable({ id, row = 0, col = 0, group = 'content', onSelect, onLongPress, onNavigate }) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  // 只有"这一项是否支持长按"会改变 OK 键的时序,所以它进依赖数组;
  // 回调本身走 ref,重渲染不会重新注册。
  const hasLongPress = !!onLongPress;

  useEffect(() => {
    registerFocusable(id, {
      row, col, group,
      onSelect: () => onSelectRef.current?.(),
      onLongPress: hasLongPress ? () => onLongPressRef.current?.() : undefined,
      onNavigate: direction => onNavigateRef.current?.(direction),
    });
    return () => unregisterFocusable(id);
  }, [id, row, col, group, hasLongPress]);

  const handleClick = useCallback((e) => {
    e.preventDefault();
    pointerEnabled = true;
    cancelContentFocus();
    lastFocusFromPointer = true;
    setFocus(id);
    onSelectRef.current?.();
  }, [id]);

  const handleMouseEnter = useCallback(() => {
    if (!pointerEnabled || customKeyHandler) return;
    cancelContentFocus();
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
