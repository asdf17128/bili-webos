# Playback Resume Design

## Goal

Make video playback resume from the last watched position when the user leaves the player and immediately reopens the same video from the app.

## Problem

The player already seeks to `video.progress` on load, but the app does not persist updated progress when playback stops. Existing list and history data can therefore be stale during an immediate reopen.

## Chosen Approach

Use a hybrid strategy:

1. Persist local resume progress keyed by video identity so reopen works immediately.
2. Keep the existing Bilibili heartbeat behavior so upstream history can catch up naturally.

Local progress is the authoritative source for an immediate in-app reopen. Remote history remains useful for longer-lived sync and existing history pages.

## Data Model

Store resume progress in local storage under a dedicated key. Each entry contains:

- `bvid`
- `cid`
- `progress`
- `duration`
- `updatedAt`

Entries are keyed primarily by `bvid`, with `cid` used to avoid resuming the wrong part when a video has multiple pages.

## Behavior

### Saving

Save progress during playback updates and on player exit/unmount. Only save meaningful progress:

- clamp to `0 <= progress <= duration`
- ignore empty identity
- clear saved progress when playback is effectively finished

### Reading

Before opening the player, merge any local resume entry into the selected video object. Use local progress when it matches the same `bvid` and `cid`.

### Completion

If the user reaches the end of the video, remove the local resume entry so the next open starts fresh.

## Boundaries

- Keep this feature local to VOD playback; do not change live playback behavior.
- Do not add new remote API calls in this change.
- Preserve current heartbeat reporting.

## Testing

Add render tests that prove:

1. exiting the player stores progress locally
2. reopening the same video resumes from saved progress even if the incoming card data is stale
3. finishing a video clears saved progress
