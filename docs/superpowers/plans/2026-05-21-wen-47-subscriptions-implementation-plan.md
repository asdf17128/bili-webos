# WEN-47 My Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `我的订阅` mode inside `我的收藏` that shows subscribed collections/channels first, allows drill-down into a subscription's video list, restores focus on back, supports pagination-friendly state, and preserves favorites behavior.

**Architecture:** Extend `FavoritesPage` into a small in-page state machine with separate favorites and subscriptions slices. Keep upstream uncertainty isolated in `src/api/client.ts` with normalized wrappers and pure mapping helpers, then render subscriptions list and detail with the existing focus system plus a dedicated focus-restoration path.

**Tech Stack:** React, Vite, Bun test, existing zero-render focus hooks, existing `VideoGrid` and `FocusableTab` components

---

### Task 1: Add failing API mapping tests for subscriptions

**Files:**
- Modify: `src/api/client.integration.test.ts`
- Modify: `src/api/client.ts`

- [ ] **Step 1: Write failing tests for subscriptions list and detail wrappers**

```typescript
it('maps subscribed channel directory items into safe subscription rows', async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 0,
        data: {
          items_lists: {
            page: { page_num: 1, total: 2 },
            seasons_list: [
              {
                meta: {
                  season_id: 11,
                  mid: 22,
                  name: '连载合集',
                  cover: 'cover-a',
                  total: 30,
                },
              },
              {
                meta: {
                  season_id: 12,
                  mid: 23,
                  name: '',
                  cover: '',
                  total: 0,
                },
              },
            ],
          },
        },
      }),
    }),
  );

  const res = await getMySubscriptions(100, 1, 20);

  expect(res.items[0]).toMatchObject({
    id: 'season-11-22',
    seasonId: 11,
    mid: 22,
    title: '连载合集',
    cover: 'cover-a',
    total: 30,
    isInvalid: false,
  });
  expect(res.items[1]).toMatchObject({
    id: 'season-12-23',
    isInvalid: true,
  });
  expect(res.page.pageNum).toBe(1);
});

it('maps subscription detail videos into playable cards with invalid fallbacks', async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 0,
        data: {
          archives: [
            {
              bvid: 'BV1X',
              title: '第一集',
              pic: 'pic-a',
              duration: 61,
              owner: { name: 'UP' },
              stat: { view: 9 },
            },
            {
              bvid: '',
              title: '',
              pic: '',
            },
          ],
          meta: { name: '连载合集', season_id: 11, mid: 22, total: 2 },
          page: { page_num: 1, total: 2 },
        },
      }),
    }),
  );

  const res = await getSubscriptionVideos({ mid: 22, seasonId: 11, pageNum: 1, pageSize: 30 });

  expect(res.items[0]).toMatchObject({
    bvid: 'BV1X',
    title: '第一集',
    owner: { name: 'UP' },
    isInvalid: false,
  });
  expect(res.items[1]).toMatchObject({
    isInvalid: true,
    title: '视频已失效',
  });
  expect(res.page.total).toBe(2);
});
```

- [ ] **Step 2: Run API test file to verify the new tests fail for missing exports**

Run: `bun test src/api/client.integration.test.ts`
Expected: FAIL with missing `getMySubscriptions` and `getSubscriptionVideos` exports or assertion failures for unmapped shapes

- [ ] **Step 3: Implement normalized wrappers and helper mappers in the API client**

```typescript
function normalizeSubscriptionRow(item) {
  const meta = item?.meta || item || {};
  const seasonId = Number(meta.season_id || meta.id || 0);
  const mid = Number(meta.mid || item?.mid || 0);
  const rawTitle = meta.name || meta.title || '';
  const cover = meta.cover || item?.cover || '';
  const total = Number(meta.total || item?.total || 0);
  const isInvalid = !seasonId || !mid || !rawTitle || !cover;

  return {
    id: `season-${seasonId || 'invalid'}-${mid || 0}`,
    seasonId,
    mid,
    title: rawTitle || '未命名订阅',
    cover,
    total,
    isInvalid,
  };
}

function normalizeSubscriptionVideo(archive) {
  const bvid = archive?.bvid || '';
  const rawTitle = archive?.title || '';
  const isInvalid = !bvid || !rawTitle;

  return {
    aid: archive?.aid || 0,
    bvid,
    cid: archive?.cid || 0,
    title: isInvalid ? '视频已失效' : rawTitle,
    pic: archive?.pic || '',
    duration: Number(archive?.duration || 0),
    pubdate: Number(archive?.pubdate || 0),
    owner: {
      name: archive?.owner?.name || '未知UP主',
    },
    stat: {
      view: Number(archive?.stat?.view || 0),
    },
    isInvalid,
  };
}

export async function getMySubscriptions(userMid, pn, ps) {
  const res = await wbiFetch('/x/polymer/web-space/home/seasons_series', {
    mid: userMid,
    page_num: pn || 1,
    page_size: ps || 20,
  });
  const data = res?.data?.items_lists || res?.data || {};
  const items = data?.series_list || data?.seasons_list || data?.items || [];
  return {
    items: items.map(normalizeSubscriptionRow),
    page: {
      pageNum: Number(data?.page?.page_num || pn || 1),
      pageSize: Number(data?.page?.page_size || ps || 20),
      total: Number(data?.page?.total || items.length || 0),
    },
  };
}

export async function getSubscriptionVideos(params) {
  const res = await wbiFetch('/x/polymer/web-space/seasons_archives_list', {
    mid: params.mid,
    season_id: params.seasonId,
    page_num: params.pageNum || 1,
    page_size: params.pageSize || 30,
  });
  return {
    meta: res?.data?.meta || {},
    items: (res?.data?.archives || []).map(normalizeSubscriptionVideo),
    page: {
      pageNum: Number(res?.data?.page?.page_num || params.pageNum || 1),
      pageSize: Number(res?.data?.page?.page_size || params.pageSize || 30),
      total: Number(res?.data?.page?.total || 0),
    },
  };
}
```

`getMySubscriptions` must be called with the current logged-in user's `userMid` from `FavoritesPage`. Do not substitute the collection creator's `mid` at call time. If live endpoint verification shows an additional discriminator parameter is required, add it only after confirming the real request shape during the red-green cycle.

- [ ] **Step 4: Run API tests again to verify the wrappers pass**

Run: `bun test src/api/client.integration.test.ts`
Expected: PASS for the new subscription wrapper coverage and no regressions in existing client integration tests

- [ ] **Step 5: Commit the API groundwork**

```bash
git add src/api/client.ts src/api/client.integration.test.ts
git commit -m "feat: add subscriptions api wrappers"
```

### Task 2: Add failing page render tests for subscriptions mode

**Files:**
- Modify: `src/pages/pages.render.test.ts`
- Modify: `src/pages/FavoritesPage.tsx`

- [ ] **Step 1: Write failing render tests for mode switching, detail drill-down, and focus restoration**

```typescript
test('FavoritesPage supports subscriptions list, detail, and focus restoration', async () => {
  const { default: FavoritesPage } = await importFresh('./FavoritesPage.tsx');

  api.getFavFolders.mockImplementationOnce(async () => ({
    data: { list: [{ id: 7, title: '默认收藏夹' }] },
  }));
  api.getFavList.mockImplementationOnce(async () => ({ data: { medias: [] } }));
  api.getMySubscriptions = mock(async () => ({
    items: Array.from({ length: 15 }, (_, index) => ({
      id: `season-${index + 1}`,
      seasonId: index + 1,
      mid: 100,
      title: `订阅 ${index + 1}`,
      cover: `cover-${index + 1}`,
      total: 3,
      isInvalid: false,
    })),
    page: { pageNum: 1, total: 15 },
  }));
  api.getSubscriptionVideos = mock(async () => ({
    items: [
      {
        bvid: 'BV-DETAIL',
        title: '详情视频',
        pic: 'detail-cover',
        owner: { name: 'UP' },
        stat: { view: 5 },
        isInvalid: false,
      },
    ],
    page: { pageNum: 1, total: 1 },
  }));

  const page = await render(
    React.createElement(FavoritesPage, { userMid: 1, onPlayVideo() {} }),
  );

  await flush();
  await interact(() =>
    focusConfigs.find((config) => config.id === 'content-0-1').onSelect(),
  );
  await flush();

  expect(textOf(page.toJSON())).toContain('订阅 15');

  await interact(() =>
    focusConfigs.find((config) => config.id === 'subscription-14-0').onSelect(),
  );
  await flush();

  expect(textOf(page.toJSON())).toContain('详情视频');

  const backEvent = new Event('tv-back');
  window.dispatchEvent(backEvent);
  await flush();

  expect(setFocusCalls.at(-1)).toBe('subscription-14-0');
});
```

- [ ] **Step 2: Run the render test file to verify the new subscriptions test fails**

Run: `bun test src/pages/pages.render.test.ts`
Expected: FAIL because the current page does not expose subscriptions mode, detail state, or focus restoration

- [ ] **Step 3: Expand the existing page test doubles to support new API calls**

```typescript
beforeEach(() => {
  api = {
    getFavFolders: mock(async () => ({ data: { list: [] } })),
    getFavList: mock(async () => ({ data: { medias: [] } })),
    getMySubscriptions: mock(async () => ({ items: [], page: { pageNum: 1, total: 0 } })),
    getSubscriptionVideos: mock(async () => ({ items: [], page: { pageNum: 1, total: 0 } })),
    // keep existing mocks unchanged below
  };
});
```

- [ ] **Step 4: Re-run the render test file and keep it red until the page implementation lands**

Run: `bun test src/pages/pages.render.test.ts`
Expected: FAIL only in the new subscriptions scenarios, confirming the test seam is correct

- [ ] **Step 5: Commit the failing UI tests**

```bash
git add src/pages/pages.render.test.ts
git commit -m "test: cover subscriptions navigation flow"
```

### Task 3: Implement subscriptions mode and focus-safe rendering in FavoritesPage

**Files:**
- Modify: `src/pages/FavoritesPage.tsx`
- Create: `src/components/SubscriptionList.tsx`
- Modify: `src/api/client.ts`
- Modify: `src/components/components.render.test.ts`

- [ ] **Step 1: Add a small focused list component for subscriptions**

```tsx
// src/components/SubscriptionList.tsx
import React from 'react';
import { useFocusable } from '../hooks/useFocus';

function SubscriptionRow({ item, index, onSelect }) {
  const { props } = useFocusable({
    id: `subscription-${index}-0`,
    row: index,
    col: 0,
    group: 'subscription',
    onSelect: () => onSelect(item, index),
  });

  return (
    <div {...props} className={`subscription-row ${item.isInvalid ? 'invalid' : ''}`}>
      <div>{item.title}</div>
      <div>{item.total} 个视频</div>
    </div>
  );
}

export default function SubscriptionList({ items, onSelect }) {
  if (!items.length) return <div className="empty-state">暂无订阅内容</div>;
  return <div>{items.map((item, index) => <SubscriptionRow key={item.id} item={item} index={index} onSelect={onSelect} />)}</div>;
}
```

- [ ] **Step 2: Refactor FavoritesPage into mode-based state slices with cache-aware loaders**

```tsx
const [mode, setMode] = useState('favorites');
const [subscriptionView, setSubscriptionView] = useState('list');
const [selectedSubscription, setSelectedSubscription] = useState(null);
const [lastFocusedSubscriptionId, setLastFocusedSubscriptionId] = useState(null);
const [subscriptions, setSubscriptions] = useState([]);
const [subscriptionVideos, setSubscriptionVideos] = useState([]);
const [subscriptionPage, setSubscriptionPage] = useState({ pageNum: 1, total: 0 });
const [subscriptionDetailPage, setSubscriptionDetailPage] = useState({ pageNum: 1, total: 0 });
const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
const [subscriptionDetailCache, setSubscriptionDetailCache] = useState({});

async function loadSubscriptions(forceRefresh) {
  if (subscriptionLoaded && !forceRefresh) return;
  const res = await getMySubscriptions(userMid, 1, 20);
  setSubscriptions(res.items);
  setSubscriptionPage(res.page);
  setSubscriptionLoaded(true);
}
```

- [ ] **Step 3: Implement detail drill-down, back handling, and focus restoration**

```tsx
function handleSubscriptionSelect(item, index) {
  setSelectedSubscription(item);
  setLastFocusedSubscriptionId(`subscription-${index}-0`);
  setSubscriptionView('detail');
}

useEffect(() => {
  function handleBack() {
    if (mode === 'subscriptions' && subscriptionView === 'detail') {
      setSubscriptionView('list');
      setTimeout(() => {
        if (lastFocusedSubscriptionId) setFocus(lastFocusedSubscriptionId);
      }, 0);
    }
  }

  window.addEventListener('tv-back', handleBack);
  return () => window.removeEventListener('tv-back', handleBack);
}, [mode, subscriptionView, lastFocusedSubscriptionId]);
```

- [ ] **Step 4: Render top-level mode tabs, subscriptions list, and subscriptions detail without regressing favorites**

```tsx
<div className="tabs">
  <FocusableTab
    id="content-0-0"
    row={0}
    col={0}
    group="content"
    label="收藏夹"
    active={mode === 'favorites'}
    onSelect={() => setMode('favorites')}
  />
  <FocusableTab
    id="content-0-1"
    row={0}
    col={1}
    group="content"
    label="我的订阅"
    active={mode === 'subscriptions'}
    onSelect={() => setMode('subscriptions')}
  />
</div>
```

- [ ] **Step 5: Add a narrow render test for the new list component and run page/component tests**

Run: `bun test src/pages/pages.render.test.ts src/components/components.render.test.ts`
Expected: PASS for subscriptions list rendering and no regressions in existing component snapshots or text assertions

- [ ] **Step 6: Commit the page implementation**

```bash
git add src/pages/FavoritesPage.tsx src/components/SubscriptionList.tsx src/components/components.render.test.ts
git commit -m "feat: add subscriptions mode to favorites"
```

### Task 4: Add pagination, invalid-content polish, and full verification

**Files:**
- Modify: `src/pages/FavoritesPage.tsx`
- Modify: `src/components/SubscriptionList.tsx`
- Modify: `src/pages/pages.render.test.ts`
- Modify: `src/api/client.integration.test.ts`

- [ ] **Step 1: Add near-bottom pagination logic for subscriptions list and detail**

```tsx
useEffect(() => {
  return onFocusChange((fid) => {
    if (mode !== 'subscriptions') return;
    if (subscriptionView === 'list' && fid?.startsWith('subscription-')) {
      const index = Number(fid.split('-')[1]);
      if (index >= subscriptions.length - 2 && subscriptions.length < subscriptionPage.total) {
        loadMoreSubscriptions();
      }
    }
    if (subscriptionView === 'detail' && fid?.startsWith('content-')) {
      const row = Number(fid.split('-')[1]);
      const totalRows = Math.ceil(subscriptionVideos.length / gridCols);
      if (row >= totalRows - 2 && subscriptionVideos.length < subscriptionDetailPage.total) {
        loadMoreSubscriptionVideos();
      }
    }
  });
}, [mode, subscriptionView, subscriptions.length, subscriptionVideos.length, subscriptionPage.total, subscriptionDetailPage.total, gridCols]);
```

- [ ] **Step 2: Add safe invalid-item presentation**

```tsx
const title = item.title || '视频已失效';
const className = `subscription-row ${item.isInvalid ? 'invalid' : ''}`;
```

- [ ] **Step 3: Extend tests for invalid fallbacks and cached mode switching**

```typescript
expect(videoGridCalls.at(-1).videos[1]).toMatchObject({
  isInvalid: true,
  title: '视频已失效',
});

await interact(() =>
  focusConfigs.find((config) => config.id === 'content-0-0').onSelect(),
);
await interact(() =>
  focusConfigs.find((config) => config.id === 'content-0-1').onSelect(),
);
await flush();

expect(api.getMySubscriptions).toHaveBeenCalledTimes(1);
```

- [ ] **Step 4: Run targeted tests, lint, format, and full unit suite**

Run: `bun test src/api/client.integration.test.ts src/pages/pages.render.test.ts src/components/components.render.test.ts`
Expected: PASS

Run: `bun format`
Expected: formatting completes without errors

Run: `bun lint`
Expected: lint passes

Run: `bun test`
Expected: all unit tests pass

- [ ] **Step 5: Commit the polish and verification-ready state**

```bash
git add src/pages/FavoritesPage.tsx src/components/SubscriptionList.tsx src/pages/pages.render.test.ts src/api/client.integration.test.ts src/components/components.render.test.ts
git commit -m "fix: polish subscriptions focus and caching"
```

### Task 5: Final verification, review, and PR preparation

**Files:**
- Modify: current branch work only

- [ ] **Step 1: Run coverage because existing-code changes must stay above CI threshold**

Run: `bun test:coverage`
Expected: PASS with coverage greater than 90%

- [ ] **Step 2: Run the project verification script if it is stable in this workspace**

Run: `bash tools/verify.sh`
Expected: PASS or a clearly documented reason if an environment-specific step fails

- [ ] **Step 3: Request a code review pass before publishing**

```text
Use superpowers:requesting-code-review after implementation is green.
```

- [ ] **Step 4: Prepare the branch and PR with semantic-release wording**

```bash
git status --short
git log --oneline --max-count=5
```

Expected: clean working tree and feature commits ready for push

- [ ] **Step 5: Open a PR that references WEN-47**

```text
PR title: feat: add subscriptions mode under favorites
PR body: summarize API wrapper, subscriptions navigation, focus restoration, pagination, caching, invalid-content handling, and test coverage; include Linear reference WEN-47.
```
