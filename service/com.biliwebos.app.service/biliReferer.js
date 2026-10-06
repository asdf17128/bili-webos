// ranking/v2 rejects the site-root Referer with -352 even for anonymous
// requests. Use its actual page context; other API/media requests keep theirs.
// Shared by the TV service and the optional standalone development proxy.
module.exports = function biliReferer(host, pathname) {
  return host === 'api.bilibili.com' && pathname === '/x/web-interface/ranking/v2'
    ? 'https://www.bilibili.com/v/popular/rank/all'
    : 'https://www.bilibili.com/';
};
