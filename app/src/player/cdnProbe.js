import { CDN_ROUTES, FALLBACK_MIRRORS, cdnHostOf } from './cdn.js';

export function diagnosticHosts(url, route) {
  return Array.from(new Set([CDN_ROUTES[route], cdnHostOf(url), ...FALLBACK_MIRRORS].filter(Boolean)));
}

// XHR's timeout covers headers AND body, including on Chromium 53 where
// AbortController/streaming fetch are unavailable. Reject servers ignoring
// Range before downloading the whole video. Closing diagnostics aborts work.
export function probeRange(url, start, end, { timeoutMs = 15000, active = new Set() } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const t0 = Date.now();
    let bytes = 0, settled = false;
    const finish = (error, timedOut = false) => {
      if (settled) return;
      settled = true; active.delete(xhr);
      if (error) reject(error);
      else resolve({ data: xhr.response, bytes, ms: Math.max(1, Date.now() - t0), timedOut,
        total: parseInt((xhr.getResponseHeader('content-range') || '').split('/')[1], 10) || 0 });
    };
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader('Range', `bytes=${start}-${end}`);
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 2) return;
      const range = xhr.getResponseHeader('content-range') || '';
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(range);
      if (xhr.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) < start || Number(match[2]) > end) {
        finish(new Error('Invalid range response (HTTP ' + xhr.status + ')'));
        xhr.abort();
      }
    };
    xhr.onprogress = e => {
      bytes = e.loaded;
      if (bytes > end - start + 1) { finish(new Error('Oversized range response')); xhr.abort(); }
    };
    xhr.onload = () => {
      bytes = xhr.response ? xhr.response.byteLength : 0;
      finish(!bytes ? new Error('Empty range response') : bytes > end - start + 1 ? new Error('Oversized range response') : null);
    };
    xhr.ontimeout = () => finish(bytes ? null : new Error('Timeout'), true);
    xhr.onerror = () => finish(new Error('Connection failed'));
    xhr.onabort = () => finish(new Error('Cancelled'));
    active.add(xhr);
    xhr.send();
  });
}
