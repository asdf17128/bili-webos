const LOCAL_PROXY_BASE = 'http://127.0.0.1:7654';

type ProxyLocation = {
  hostname?: string;
  origin?: string;
};

type ProxyOptions = {
  location?: ProxyLocation;
};

function isLocalDevLocation(location?: ProxyLocation) {
  const hostname = location?.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function getProxyBase(options: ProxyOptions = {}) {
  const {
    location = typeof window !== 'undefined' ? window.location : undefined,
  } = options;

  if (isLocalDevLocation(location) && location?.origin) {
    return location.origin.replace(/\/$/, '');
  }

  return LOCAL_PROXY_BASE;
}

export function buildProxyUrl(url: string, options: ProxyOptions = {}) {
  const parsed = new URL(url);
  const proxyBase = getProxyBase(options);
  return `${proxyBase}/proxy/${parsed.host}${parsed.pathname}${parsed.search}`;
}

export { LOCAL_PROXY_BASE };
