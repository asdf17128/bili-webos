import { storage } from './storage.js';

const LOCAL_PROXY_BASE = 'http://127.0.0.1:7654';

export function shouldUseExternalProxy(env = import.meta.env) {
  return env?.VITE_USE_PROXY === 'true';
}

export function getProxyBase(options = {}) {
  const { env = import.meta.env, proxyUrl = storage.getProxyUrl() } = options;
  return shouldUseExternalProxy(env) ? proxyUrl : LOCAL_PROXY_BASE;
}

export function buildProxyUrl(url, options = {}) {
  const parsed = new URL(url);
  const proxyBase = getProxyBase(options);
  return `${proxyBase}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
}

export { LOCAL_PROXY_BASE };
