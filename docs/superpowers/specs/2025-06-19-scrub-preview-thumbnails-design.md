# Scrub Preview Thumbnails — Design Spec

Add video frame preview thumbnails above the progress bar when the user scrubs (left/right arrow keys on TV remote).

## Interaction Model

- **Trigger:** User presses ArrowLeft/ArrowRight while `focusArea === 'timeline'`
- **Display:** Preview thumbnail appears above the progress bar at the scrub position
- **Hide:** Thumbnail disappears when: seek committed (ArrowDown/Enter), idle timeout, controls hide, route leave/unmount, pause/play (if timeline no longer focused)
- **No mouse/touch:** This is a TV app — all interactions are via remote control

## Data Source: Bilibili Storyboard API

New API endpoint: `/x/player/videolike?bvid={bvid}&cid={cid}` (WBI-signed via `wbiFetch`)

### Expected Response

```json
{
  "code": 0,
  "data": {
    "storyboard": [{
      "img_x_len": 10,
      "img_y_len": 10,
      "img_x_size": 160,
      "img_y_size": 90,
      "image": [
        "https://i0.hdslb.com/bfs/storyboard/xxx_1.jpg",
        "https://i0.hdslb.com/bfs/storyboard/xxx_2.jpg"
      ],
      "avg_time": 60
    }]
  }
}
```

Each `image[]` entry is a sprite sheet containing `img_x_len × img_y_len` tiles.
`avg_time` = seconds between consecutive frames.

### API Client Changes (`api/client.ts`)

Add `getStoryboard(bvid, cid)` that normalizes the raw API response into `StoryboardTile | null`:

```typescript
export type StoryboardTile = {
  imageUrls: string[];  // sprite sheet URLs (proxied)
  cols: number;         // img_x_len
  rows: number;         // img_y_len
  tileW: number;        // img_x_size (px)
  tileH: number;        // img_y_size (px)
  interval: number;     // avg_time (seconds)
};

export async function getStoryboard(
  bvid: string,
  cid: number | string
): Promise<StoryboardTile | null> {
  const res = await wbiFetch('/x/player/videolike', { bvid, cid });
  const first = res?.data?.storyboard?.[0];

  if (
    !first ||
    !Array.isArray(first.image) ||
    first.image.length === 0 ||
    first.img_x_len <= 0 ||
    first.img_y_len <= 0 ||
    first.img_x_size <= 0 ||
    first.img_y_size <= 0 ||
    first.avg_time <= 0
  ) {
    return null;
  }

  return {
    imageUrls: first.image.map(proxyStoryboardUrl),
    cols: first.img_x_len,
    rows: first.img_y_len,
    tileW: first.img_x_size,
    tileH: first.img_y_size,
    interval: first.avg_time,
  };
}
```

Key decisions:
- Strict field validation — Bilibili API can be unpredictable, guard against bad data
- Proxy URL conversion happens in the normalize layer, so `PlayerPage` never sees raw CDN URLs
- Returns `null` on any failure, caller checks once and proceeds without preview

### Proxy Helper

```typescript
function proxyStoryboardUrl(url: string): string {
  const proxyBase = getProxyBase();
  return `${proxyBase}/proxy/${new URL(url).host}${new URL(url).pathname}${new URL(url).search}`;
}
```

Reuses the same `getProxyBase()` + proxy URL format already established in the codebase (see `loadVideo` request filter and `buildProxyUrl`).

## Data Model

```typescript
type StoryboardTile = {
  imageUrls: string[];  // sprite sheet URLs (already proxied)
  cols: number;         // img_x_len
  rows: number;         // img_y_len
  tileW: number;        // img_x_size (px)
  tileH: number;        // img_y_size (px)
  interval: number;     // avg_time (seconds)
};

type StoryboardFrame = {
  spriteUrl: string;
  spriteW: number;
  spriteH: number;
  tileW: number;
  tileH: number;
  bgX: number;
  bgY: number;
};
```

`StoryboardFrame` is the output of the pure calculation function `getStoryboardFrame()` — it contains everything needed to render a single thumbnail frame via DOM.

## Player Page Changes (`PlayerPage.tsx`)

### New Refs

| Ref | Type | Purpose |
|-----|------|---------|
| `storyboardRef` | `StoryboardTile \| null` | Cached storyboard metadata |
| `spriteCacheRef` | `Map<string, HTMLImageElement>` | Loaded sprite Image objects |
| `previewThumbRef` | `HTMLDivElement \| null` | The thumbnail DOM element |
| `storyboardVideoKeyRef` | `string \| null` | `"bvid:cid"` — guards against stale onload callbacks |

### New DOM Element

Inside `.player-progress-bar`, after `.player-progress-fill`:

```html
<div ref={previewThumbRef} class="player-scrub-thumb" />
```

CSS:
```css
.player-scrub-thumb {
  position: absolute;
  bottom: 100%;
  margin-bottom: 8px;
  transform: translateX(-50%);
  pointer-events: none;
  display: none;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  background-repeat: no-repeat;
  background-color: #000;
  box-sizing: content-box;
  z-index: 2;
}
```

### Data Fetching

In `loadVideo()`, at the start — RESET all old state before fetching new data for a new video:

```typescript
// At top of loadVideo:
storyboardRef.current = null;
spriteCacheRef.current.clear();
hideScrubThumbnail();
storyboardVideoKeyRef.current = null;

// Then fetch storyboard in parallel with danmaku/related:
const storyboardPromise = getStoryboard(bvid, cid).catch(() => null);
```

Store result in `storyboardRef.current`:

```typescript
const storyboardData = await storyboardPromise;
storyboardRef.current = storyboardData;
storyboardVideoKeyRef.current = `${bvid}:${cid}`;
```

### Function Decomposition

Replace the monolithic `renderTimelinePreview` extension with small focused functions:

#### `getStoryboardFrame(storyboard, timeSec, durationSec)` — Pure Function

Defined outside the component, fully testable without React/DOM.

```typescript
function getStoryboardFrame(
  storyboard: StoryboardTile,
  timeSec: number,
  durationSec: number,
): StoryboardFrame | null {
  if (durationSec <= 0 || timeSec < 0) return null;

  const tilesPerSprite = storyboard.cols * storyboard.rows;
  const maxAvailableFrames = storyboard.imageUrls.length * tilesPerSprite;
  const durationFrames = Math.ceil(durationSec / storyboard.interval);
  const totalFrames = Math.min(maxAvailableFrames, durationFrames);

  if (totalFrames <= 0) return null;

  const frameIndex = Math.min(
    Math.max(0, Math.floor(timeSec / storyboard.interval)),
    Math.max(0, totalFrames - 1),
  );

  const spriteIdx = Math.floor(frameIndex / tilesPerSprite);
  const localIdx = frameIndex % tilesPerSprite;
  const col = localIdx % storyboard.cols;
  const row = Math.floor(localIdx / storyboard.cols);

  const spriteUrl = storyboard.imageUrls[spriteIdx];
  if (!spriteUrl) return null;

  return {
    spriteUrl,
    spriteW: storyboard.cols * storyboard.tileW,
    spriteH: storyboard.rows * storyboard.tileH,
    tileW: storyboard.tileW,
    tileH: storyboard.tileH,
    bgX: -col * storyboard.tileW,
    bgY: -row * storyboard.tileH,
  };
}
```

Coverage:
- `totalFrames = min(maxAvailableFrames, durationFrames)` — last sprite may have blank tiles
- frameIndex clamped to `[0, totalFrames - 1]`
- `spriteUrl` existence check before returning
- Null on any invalid input

#### `ensureSpriteLoaded(url)` — Image Cache + Load Management

Returns `boolean` (loaded == `complete && naturalWidth > 0`). On first load, attaches onload that re-renders preview if still scrubbing.

```typescript
// Inside PlayerPage, using refs:
function ensureSpriteLoaded(url: string): boolean {
  const cached = spriteCacheRef.current.get(url);

  if (cached) {
    return cached.complete && cached.naturalWidth > 0;
  }

  const currentVideoKey = storyboardVideoKeyRef.current;

  const img = new Image();
  img.onload = () => {
    if (storyboardVideoKeyRef.current !== currentVideoKey) return; // stale
    spriteCacheRef.current.set(url, img);
    if (scrubActiveRef.current && displayTimeRef.current != null) {
      const dur = videoRef.current?.duration || 0;
      if (dur > 0) {
        renderTimelinePreview(displayTimeRef.current, dur);
      }
    }
  };
  img.onerror = () => {
    spriteCacheRef.current.delete(url);
  };

  img.src = url;
  spriteCacheRef.current.set(url, img);

  return false;
}
```

Stale protection via `storyboardVideoKeyRef` prevents race conditions when switching videos rapidly.

#### `updateScrubThumbnail(frame, percent)` — DOM Style Write

Writes background-image/position/size, width, height, left (with clamp). Only DOM, no logic.

```typescript
function updateScrubThumbnail(frame: StoryboardFrame, percent: number) {
  const thumb = previewThumbRef.current;
  if (!thumb) return;

  const progressBar = progressBarRef.current;
  const progressBarWidth = progressBar?.clientWidth ?? 0;
  if (!progressBarWidth) return;

  const clampMargin = (frame.tileW / 2 / progressBarWidth) * 100;
  const clampedPercent = Math.max(
    clampMargin,
    Math.min(percent, 100 - clampMargin),
  );

  thumb.style.display = 'block';
  thumb.style.backgroundImage = `url("${frame.spriteUrl}")`;
  thumb.style.backgroundPosition = `${frame.bgX}px ${frame.bgY}px`;
  thumb.style.backgroundSize = `${frame.spriteW}px ${frame.spriteH}px`;
  thumb.style.width = `${frame.tileW}px`;
  thumb.style.height = `${frame.tileH}px`;
  thumb.style.left = `${clampedPercent}%`;
}
```

Edge clamp uses `tileW / 2` (half tile width) because `transform: translateX(-50%)` makes `left` refer to the thumbnail center point.

#### `hideScrubThumbnail()` — Unified Hide

```typescript
function hideScrubThumbnail() {
  if (previewThumbRef.current) {
    previewThumbRef.current.style.display = 'none';
  }
}
```

### Updated `renderTimelinePreview`

```typescript
const renderTimelinePreview = useCallback((timeSec, durationSec) => {
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const safeTime = Math.max(0, Number(timeSec) || 0);
  displayTimeRef.current = safeTime;

  // Progress fill (existing)
  if (progressFillRef.current) {
    const progress = safeDuration > 0 ? (safeTime / safeDuration) * 100 : 0;
    progressFillRef.current.style.width = `${progress}%`;
  }

  // Time text (existing)
  if (timeTextRef.current) {
    timeTextRef.current.textContent =
      `${formatDuration(safeTime)} / ${formatDuration(safeDuration)}`;
  }

  // Thumbnail (new)
  if (!storyboardRef.current || safeDuration <= 0) {
    hideScrubThumbnail();
    return;
  }

  const frame = getStoryboardFrame(storyboardRef.current, safeTime, safeDuration);
  if (!frame) {
    hideScrubThumbnail();
    return;
  }

  const loaded = ensureSpriteLoaded(frame.spriteUrl);
  if (loaded) {
    const percent = (safeTime / safeDuration) * 100;
    updateScrubThumbnail(frame, percent);
  } else {
    hideScrubThumbnail();
  }
}, []);
```

### Integration Points

| Scenario | Handling |
|----------|----------|
| `commitPreviewSeek` | Call `hideScrubThumbnail()` |
| Idle timeout (SEEK_IDLE_RESET_MS) | Call `hideScrubThumbnail()` |
| Controls hide / focus change to 'none' | Call `hideScrubThumbnail()` |
| Route leave / component unmount | Cleanup: `storyboardRef.current = null`, `spriteCacheRef.current.clear()`, `hideScrubThumbnail()` |
| Pause/play state change | Only hide if timeline not focused (`focusArea !== 'timeline'`) |
| `loadVideo` start (new video) | Reset storyboardRef, spriteCache, hide thumbnail |
| `durationSec <= 0` | Don't show, hide if visible |
| `progressBar.clientWidth === 0` | Skip thumbnail render, avoid division by zero |

## Edge Cases

| Case | Handling |
|------|----------|
| No storyboard data | `storyboardRef.current === null` → `hideScrubThumbnail()`, existing behavior unchanged |
| Sprite not yet loaded | `ensureSpriteLoaded` returns false → `hideScrubThumbnail()`; onload triggers re-render if still scrubbing |
| Frame index out of bounds | Clamped to `[0, totalFrames-1]` by `getStoryboardFrame` |
| Last sprite has blank tiles | `totalFrames = min(maxAvailableFrames, durationFrames)` prevents accessing blank tiles |
| Multiple storyboard levels | Only first level used (most detailed / smallest interval) |
| Short video (< interval) | `frameIndex = 0`, shows first tile |
| Stale onload (fast video switch) | `storyboardVideoKeyRef` comparison in `ensureSpriteLoaded` onload |
| TV proxy for image URLs | Already proxied in `getStoryboard` normalize step |
| Scrubbing at 0% or 100% | Edge clamp keeps thumbnail fully within progress bar bounds |

## Testing

### API test (`test-e2e.ts` or unit test)
- `getStoryboard` returns `StoryboardTile` with correct shape from mocked response
- `getStoryboard` returns `null` for 404 / missing storyboard / invalid fields
- `getStoryboard` returns `null` when `avg_time <= 0` or `img_x_len <= 0`
- Proxy URL conversion applied to all `imageUrls`

### Pure function test (`getStoryboardFrame`)
- First frame: `timeSec=0` → `frameIndex=0`, column 0, row 0
- Normal frame: `timeSec=65, interval=60` → `frameIndex=1`
- Cross-sprite: `cols=10, rows=10, interval=1, timeSec=101` → sprite 2, localIdx 1
- Last frame at exact duration: correct totalFrames
- Beyond duration: clamped to last frame
- Negative timeSec: returns null
- durationSec <= 0: returns null
- Empty/null storyboard: returns null

### Player render test (`player.render.test.ts`)
- Scrubbing with storyboard data → previewThumb has correct `backgroundImage`/`backgroundPosition`/`backgroundSize`
- Scrubbing without storyboard data → no error, `display: none`
- `display: none` after commit
- Edge clamp: `timeSec=0` → left not `0%` (clamped inward)
- Edge clamp: `timeSec=duration` → left not `100%`
- Video switch: A has storyboard, B does not → B scrub shows no old thumbnail
- Sprite load pending: image not yet loaded → `display: none`; onload fires → thumbnail appears
- Proxy URL: `backgroundImage` uses proxied URL, not raw CDN URL
- Verify style properties update correctly during scrub acceleration

## Not In Scope

- Multiple storyboard levels (only first level)
- Timestamp overlay on thumbnail
- Mouse hover on progress bar (TV-only)
- Canvas-based rendering (CSS background-position only)
