# WEN-47 My Subscriptions Design

## Summary

Add a `我的订阅` mode under the existing `我的收藏` page. In this mode, the app first shows the user's subscribed collections/channels as a focusable list. Selecting one item opens a second-level detail view that shows the videos inside that subscription. Returning from the detail view should first go back to the subscription list instead of leaving the favorites page.

## Goals

- Keep the existing `我的收藏` workflow unchanged for current users.
- Add a new `我的订阅` entry point inside the favorites page rather than creating a brand-new sidebar page.
- Make the TV remote flow natural: list first, details second, back returns to the previous in-page level.
- Isolate unstable or evolving Bilibili subscription response shapes in the API mapping layer instead of leaking them into UI state.

## Non-Goals

- Do not implement `追番` or `追剧`.
- Do not merge subscriptions and favorites into one combined content stream.
- Do not redesign the existing sidebar or global navigation model.
- Do not broaden this task into subscription management actions such as unsubscribe, sort, edit, or search.

## Product Behavior

### Page Structure

`我的收藏` remains a single page implemented by `FavoritesPage`.

Inside that page, add a top-level mode switch with two options:

- `收藏夹`
- `我的订阅`

The default mode remains `收藏夹`.

### Favorites Mode

Favorites mode keeps the current behavior:

- Load the user's favorite folders.
- Show folder tabs.
- Show the selected folder's videos in `VideoGrid`.

No behavior changes are intended here aside from any small refactor needed to coexist with subscriptions mode.

### Subscriptions Mode

Subscriptions mode has two internal views:

- `list`: shows subscribed collections/channels
- `detail`: shows the videos for the selected subscription

The flow is:

1. User switches from `收藏夹` to `我的订阅`
2. The page loads and shows a focusable list of subscribed collections/channels
3. User selects one subscription item
4. The page switches to a detail view for that subscription
5. The detail view renders the subscription's videos in `VideoGrid`
6. Pressing back from detail returns to the subscription list

The page title in detail view should reflect the second level, for example `我的订阅 / {subscriptionName}`.

## Interaction Design

### Focus Behavior

Reuse the existing focus system rather than introducing a new navigation model.

- The top-level mode switch is focusable.
- In `我的订阅 -> list`, focus moves from the mode switch into the subscription list.
- In `我的订阅 -> detail`, focus defaults to the first video card after data loads.
- Pressing `ArrowUp` from the first content row in detail should prefer moving focus back to the page-level control area rather than jumping unexpectedly to the sidebar.
- When returning from `我的订阅 -> detail` to `我的订阅 -> list`, focus must be restored to the exact subscription item that launched the detail view instead of resetting to the top of the list.
- The mode switch must have a distinct visual focus treatment so users can tell they are in the page-level control area rather than the global sidebar.
- From the page-level control area, `ArrowLeft` should be the intentional path back to the sidebar to avoid ambiguous horizontal movement between local controls and global navigation.

This focus restoration behavior is required, not optional polish, because losing position in a long TV list creates severe navigation friction.

### Back Behavior

Back behavior is stateful:

- If the page is in `subscriptions/detail`, back returns to `subscriptions/list`
- Otherwise, the page falls through to the app's current page-level back handling

This preserves the TV expectation that back first reverses the most recent in-page drill-down.

## Data Model

Keep three kinds of state separate:

1. Favorites folder state
2. Subscription directory state
3. Subscription detail video state

Recommended UI state shape:

- `mode`: `favorites | subscriptions`
- `subscriptionView`: `list | detail`
- `selectedFolderId`
- `selectedSubscription`
- `lastFocusedSubscriptionId`
- `folders`
- `favoriteVideos`
- `subscriptions`
- `subscriptionVideos`
- pagination state for large datasets, including the subscriptions list and subscription detail content
- cache metadata such as loaded flags, cursors, or last successful fetch timestamps
- loading and error state scoped to the active mode/view where practical

The important design rule is that subscription directory items and playable video items should not share one raw shape. Subscription rows are directory entities. Detail rows are video entities.

### Focus Restoration

The subscriptions list state must retain enough information to restore the user's previous position.

- The UI must remember the last focused subscription list item by a stable identifier, not only by array index.
- Returning from detail should restore both the focused item and the visible list position whenever possible.
- Appending more items during pagination must not invalidate the remembered focus target.

### Pagination

Do not assume any subscription dataset fits into a single response.

- The subscriptions list needs explicit pagination or cursor state.
- The subscription detail videos need explicit pagination or cursor state.
- Load-more behavior should trigger as the user nears the bottom of the currently loaded list or grid.
- Appending paginated data must preserve current focus and avoid visible layout jumps.

Pagination state should stay local to the relevant mode and view so switching between `收藏夹` and `我的订阅` does not corrupt load progress.

### Cache Strategy

Mode switching should reuse successful in-memory results whenever practical.

- If `收藏夹` or `我的订阅` data already exists and is still fresh enough for the current session, show cached data immediately on re-entry.
- Prefer stale-while-refresh behavior: render cached data first, then refresh in the background if needed.
- Cache should be scoped independently for favorites folders, favorite videos, subscription list items, and subscription detail videos.

The goal is to avoid unnecessary spinners and refetch-induced jank on lower-powered TV hardware.

## API Design

Add two thin API wrappers in `src/api/client.ts`:

- fetch subscription directory items for the logged-in user
- fetch videos for a selected subscription

These wrappers should do two things:

1. Perform the network request
2. Normalize response fields into stable app-facing objects

The page component should consume normalized data only. If Bilibili field names drift, the fix should stay in the mapping layer whenever possible.

If the upstream endpoint is inconsistent or partially documented, prefer the thinnest possible wrapper plus a dedicated pure mapping helper that can be unit-tested.

The mapping layer should also harden invalid upstream entities:

- mark invalid or deleted items with a stable field such as `isInvalid`
- supply safe fallback values for missing required display fields
- prevent malformed items from breaking focusable rendering structures

## Error Handling

Handle errors independently for each mode so a subscriptions failure does not break favorites.

### Logged Out

Keep the existing logged-out behavior:

- `我的收藏` still shows `请先登录`

### Empty Subscriptions

If the user has no subscribed collections/channels, show a dedicated empty state such as `暂无订阅内容`.

### API Failure

If the subscriptions API fails or returns unmappable data:

- show an error state inside the subscriptions mode only
- keep favorites mode available and unaffected

### Invalid Or Deleted Content

Subscription collections, channels, or child videos may be partially unavailable.

- Invalid entries should still normalize into safe UI objects so list indexing and focus order stay stable.
- Invalid video entries should render with a clear unavailable presentation instead of crashing on missing artwork or metadata.
- The UI must never assume cover URLs, titles, or owner information are always present.

## UI Components

Prefer small, focused additions over forcing everything through `VideoGrid`.

Recommended rendering split:

- Favorites content: existing `VideoGrid`
- Subscriptions list: a focusable list component or focused rows compatible with the existing focus system
- Subscription detail: existing `VideoGrid`

This keeps directory entities visually distinct from playable video entities.

## Testing Strategy

### Page Rendering Tests

Extend `src/pages/pages.render.test.ts` to cover:

- logged-out state still shows `请先登录`
- switching to `我的订阅`
- rendering the subscription list
- selecting a subscription and rendering its detail videos
- back behavior from subscription detail to subscription list
- restoring focus to the previously selected subscription row after returning from detail
- empty subscriptions state
- subscriptions API failure without breaking favorites rendering
- invalid subscription or child video entries rendering safely without breaking layout or focus behavior

### API Tests

Add API-level coverage for the new subscription wrappers and mapping logic. If the mapping logic grows beyond a trivial inline transform, extract it into a pure helper and test it directly for stability.

This follows the repository guidance to avoid brittle tests that depend on global DOM timing or singleton mutation behavior.

API or mapper tests should explicitly cover:

- pagination response mapping
- cache-safe normalized entity shapes
- invalid or deleted content fallback mapping

## Implementation Notes

- Follow existing `FavoritesPage` patterns first before introducing new abstractions.
- Keep the scope narrow to WEN-47.
- If a small internal refactor improves clarity in `FavoritesPage`, it is acceptable as long as the page still behaves the same in favorites mode.
- Implementation should end with a PR, matching the Linear acceptance criteria.

## Risks And Mitigations

### Risk: unclear upstream subscription endpoint

Mitigation:

- isolate endpoint specifics in `src/api/client.ts`
- normalize early
- add mapper-focused tests

### Risk: focus regressions in a nested page flow

Mitigation:

- preserve current favorites focus behavior
- add render tests that explicitly exercise mode switching and drill-down behavior

### Risk: favorites regressions while adding subscriptions

Mitigation:

- keep state slices separate
- retain existing favorites test coverage and extend it rather than replacing it

## Acceptance Criteria Mapping

Linear issue `WEN-47` asks for:

- adding `我的订阅` under `我的收藏`
- making the page usable
- showing the user's full subscribed collections/channels list
- creating a PR after implementation

This design satisfies those requirements by:

- placing `我的订阅` inside the existing favorites page
- showing a subscription directory first
- allowing drill-down into a subscription's video list
- preserving a clean path to implementation, verification, and PR creation
