# Playback Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist VOD playback progress locally and reuse it on immediate reopen so the player resumes from the last watched position.

**Architecture:** Add a small storage helper for resume progress, merge saved progress into the selected VOD before entering `PlayerPage`, and have the player save or clear progress as playback changes. Keep the existing heartbeat untouched.

**Tech Stack:** React, Bun test, localStorage-backed app storage

---

### Task 1: Add resume storage helpers

**Files:**
- Modify: `src/utils/storage.ts`
- Test: `src/player/player.render.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that renders the player, advances playback, exits, and expects a persisted resume entry to exist in local storage-backed app storage.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/player/player.render.test.ts`
Expected: FAIL because no resume progress is saved on exit.

- [ ] **Step 3: Write minimal implementation**

Add storage helpers to read, write, and clear resume entries by `bvid` and `cid`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/player/player.render.test.ts`
Expected: PASS for the new resume-persistence assertion.

### Task 2: Save and clear progress in the player

**Files:**
- Modify: `src/player/PlayerPage.tsx`
- Test: `src/player/player.render.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests for:
- exit saves the current position
- ended playback clears the saved resume entry

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/player/player.render.test.ts`
Expected: FAIL because `PlayerPage` does not write or clear resume data.

- [ ] **Step 3: Write minimal implementation**

Save progress from `PlayerPage` during playback updates and on back/unmount, and clear saved progress on ended playback.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/player/player.render.test.ts`
Expected: PASS for save and clear behavior.

### Task 3: Merge saved progress before opening the player

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.render.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that stores local resume progress, opens a video with stale `progress`, and expects the player input to use the newer saved position.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/App.render.test.ts`
Expected: FAIL because `App` forwards the stale input object unchanged.

- [ ] **Step 3: Write minimal implementation**

Merge matching local resume progress into the selected VOD before calling `setPlayerVideo`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/App.render.test.ts`
Expected: PASS for immediate reopen resume behavior.

### Task 4: Verify and polish

**Files:**
- Modify: `src/player/PlayerPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/utils/storage.ts`
- Test: `src/player/player.render.test.ts`
- Test: `src/App.render.test.ts`

- [ ] **Step 1: Run focused tests**

Run: `bun test src/player/player.render.test.ts src/App.render.test.ts`
Expected: PASS

- [ ] **Step 2: Run repo formatting and lint**

Run: `bun format && bun lint`
Expected: PASS

- [ ] **Step 3: Run final coverage-relevant verification**

Run: `bun test`
Expected: PASS
