import type { StoryboardTile } from '../api/client';

export type StoryboardFrame = {
  spriteUrl: string;
  spriteW: number;
  spriteH: number;
  tileW: number;
  tileH: number;
  bgX: number;
  bgY: number;
};

function getFramePosition(
  frameIndex: number,
  storyboard: StoryboardTile,
): { spriteIdx: number; col: number; row: number } | null {
  const tilesPerSprite = storyboard.cols * storyboard.rows;
  const maxFrames = storyboard.imageUrls.length * tilesPerSprite;
  const idx = Math.min(Math.max(0, frameIndex), Math.max(0, maxFrames - 1));
  const spriteIdx = Math.floor(idx / tilesPerSprite);
  const localIdx = idx % tilesPerSprite;
  return {
    spriteIdx,
    col: localIdx % storyboard.cols,
    row: Math.floor(localIdx / storyboard.cols),
  };
}

function findClosestFrameIndex(
  frameTimes: number[],
  timeSec: number,
  totalFrames: number,
): number {
  if (timeSec <= frameTimes[0]) return 0;
  if (timeSec >= frameTimes[frameTimes.length - 1])
    return Math.min(frameTimes.length - 1, totalFrames - 1);

  let lo = 0;
  let hi = frameTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frameTimes[mid] < timeSec) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && timeSec - frameTimes[lo - 1] < frameTimes[lo] - timeSec) {
    return Math.min(lo - 1, totalFrames - 1);
  }
  return Math.min(lo, totalFrames - 1);
}

export function getStoryboardFrame(
  storyboard: StoryboardTile | null | undefined,
  timeSec: number,
  durationSec: number,
): StoryboardFrame | null {
  if (!storyboard) return null;
  if (durationSec <= 0 || timeSec < 0) return null;
  if (
    storyboard.cols <= 0 ||
    storyboard.rows <= 0 ||
    storyboard.tileW <= 0 ||
    storyboard.tileH <= 0 ||
    storyboard.interval <= 0 ||
    !storyboard.imageUrls.length
  ) {
    return null;
  }

  const tilesPerSprite = storyboard.cols * storyboard.rows;
  const maxAvailableFrames = storyboard.imageUrls.length * tilesPerSprite;

  let frameIndex: number;

  if (storyboard.frameTimes && storyboard.frameTimes.length > 0) {
    const nFrames = storyboard.frameTimes.length;
    const totalFrames = Math.min(maxAvailableFrames, nFrames);
    frameIndex = findClosestFrameIndex(
      storyboard.frameTimes,
      timeSec,
      totalFrames,
    );
  } else {
    const durationFrames = Math.ceil(durationSec / storyboard.interval);
    const totalFrames = Math.min(maxAvailableFrames, durationFrames);
    if (totalFrames <= 0) return null;
    frameIndex = Math.min(
      Math.max(0, Math.floor(timeSec / storyboard.interval)),
      Math.max(0, totalFrames - 1),
    );
  }

  const pos = getFramePosition(frameIndex, storyboard);
  if (!pos) return null;

  const spriteUrl = storyboard.imageUrls[pos.spriteIdx];
  if (!spriteUrl) return null;

  return {
    spriteUrl,
    spriteW: storyboard.cols * storyboard.tileW,
    spriteH: storyboard.rows * storyboard.tileH,
    tileW: storyboard.tileW,
    tileH: storyboard.tileH,
    bgX: -pos.col * storyboard.tileW || 0,
    bgY: -pos.row * storyboard.tileH || 0,
  };
}
