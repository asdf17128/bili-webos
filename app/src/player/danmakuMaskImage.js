import { safeMaskImage } from './danmakuMask.js';

// Work only on the server's small mask image. Never read the video plane.
// Filtering a full-size SVG CSS mask can rasterize at 1080p/4K and stall old
// TVs; this bounded bitmap is enlarged by CSS after the alpha work is done.
export const MASK_IMAGE_LIMITS = { pixels: 65536, dimension: 640, padding: 6 };

export function erodeMaskAlpha(data, width, height, radius) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MASK_IMAGE_LIMITS.pixels || width > MASK_IMAGE_LIMITS.dimension || height > MASK_IMAGE_LIMITS.dimension || data.length !== width * height * 4 || !Number.isInteger(radius) || radius < 0 || radius > MASK_IMAGE_LIMITS.padding) throw Error('Mask bitmap limit');
  if (!radius) return;
  const horizontal = new Uint8Array(width * height);
  // Pixels beyond the viewport are opaque, so erosion expands person holes
  // without also erasing a strip around the video's outer boundary.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let alpha = 255;
      for (let px = Math.max(0, x - radius), end = Math.min(width - 1, x + radius); px <= end; px++) alpha = Math.min(alpha, data[(y * width + px) * 4 + 3]);
      horizontal[y * width + x] = alpha;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let alpha = 255;
      for (let py = Math.max(0, y - radius), end = Math.min(height - 1, y + radius); py <= end; py++) alpha = Math.min(alpha, horizontal[py * width + x]);
      data[(y * width + x) * 4 + 3] = alpha;
    }
  }
}

function maskGeometry(svg) {
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = viewBox?.length === 4 ? viewBox[2] : Number.parseFloat(svg.getAttribute('width'));
  const height = viewBox?.length === 4 ? viewBox[3] : Number.parseFloat(svg.getAttribute('height'));
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 16384) || viewBox && (viewBox.length !== 4 || !viewBox.every(Number.isFinite))) throw Error('Invalid mask bitmap geometry');
  const scale = Math.min(1, MASK_IMAGE_LIMITS.dimension / width, MASK_IMAGE_LIMITS.dimension / height, Math.sqrt(MASK_IMAGE_LIMITS.pixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), sourceWidth: width, sourceHeight: height };
}

function abortedMaskPreparation() {
  const error = Error('Mask bitmap preparation aborted'); error.name = 'AbortError'; return error;
}
function checkMaskSignal(signal) { if (signal?.aborted) throw abortedMaskPreparation(); }

function decodeMaskImage(image, uri, signal, deadline) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      image.onload = image.onerror = null;
      if (error) { image.src = ''; reject(error); } else resolve();
    };
    const abort = () => finish(abortedMaskPreparation());
    const remaining = deadline - performance.now();
    const timer = setTimeout(() => finish(Error('Mask bitmap decode timeout')), Math.max(0, remaining));
    const canDecode = typeof image.decode === 'function';
    image.onload = canDecode ? null : () => finish();
    image.onerror = () => finish(Error('Mask bitmap decode failed'));
    signal?.addEventListener?.('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    if (remaining <= 0) { finish(Error('Mask bitmap decode timeout')); return; }
    try {
      image.src = uri;
      // Keep the decoded PNG alive until its LRU entry is disposed. onload is
      // the fallback for old browsers without Image.decode().
      if (canDecode) Promise.resolve(image.decode()).then(() => finish(), () => finish(Error('Mask bitmap decode failed')));
    } catch (error) { finish(error); }
  });
}

// The caller owns single-flight work, source/seek generation checks and the
// small prepared-image cache. Call dispose() when dropping a cached result.
export async function prepareDanmakuMaskImage(uri, { paddingPx, signal } = {}) {
  checkMaskSignal(signal);
  const deadline = performance.now() + 1500;
  const safe = safeMaskImage(uri);
  const svg = new DOMParser().parseFromString(atob(safe.split(',')[1]), 'image/svg+xml').documentElement;
  const geometry = maskGeometry(svg), { width, height } = geometry;
  const radius = paddingPx === undefined ? Math.max(1, Math.min(MASK_IMAGE_LIMITS.padding, Math.round(height / 90))) : paddingPx;
  if (!Number.isInteger(radius) || radius < 0 || radius > MASK_IMAGE_LIMITS.padding) throw Error('Invalid mask padding');
  // Explicit small dimensions bound even the image decode's intrinsic size.
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${geometry.sourceWidth} ${geometry.sourceHeight}`);
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  checkMaskSignal(signal);
  const sourceImage = new Image(); let canvas = null, outputImage = null, transferred = false;
  const releaseImage = image => { if (image) { image.onload = image.onerror = null; image.src = ''; } };
  try {
    await decodeMaskImage(sourceImage, 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg)), signal, deadline);
    checkMaskSignal(signal);
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw Error('Mask bitmap unavailable');
    context.drawImage(sourceImage, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    // Source edge rounding often leaves a one-pixel transparent strip. Exclude
    // it from diagnostics; this ratio is not a claim that a person was found.
    let protectedPixels = 0, interiorPixels = 0;
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) { interiorPixels++; if (pixels.data[(y * width + x) * 4 + 3] < 128) protectedPixels++; }
    erodeMaskAlpha(pixels.data, width, height, radius);
    context.putImageData(pixels, 0, 0);
    const outputUri = canvas.toDataURL('image/png');
    checkMaskSignal(signal);
    outputImage = new Image();
    await decodeMaskImage(outputImage, outputUri, signal, deadline);
    checkMaskSignal(signal);
    let disposed = false;
    const dispose = () => { if (!disposed) { disposed = true; releaseImage(outputImage); } };
    const result = { uri: outputUri, image: outputImage, dispose, width, height, sourceWidth: geometry.sourceWidth, sourceHeight: geometry.sourceHeight, radius, sourceProtectedRatio: interiorPixels ? protectedPixels / interiorPixels : 0 };
    transferred = true;
    return result;
  } finally {
    if (canvas) canvas.width = canvas.height = 1;
    releaseImage(sourceImage);
    if (!transferred) releaseImage(outputImage);
  }
}
