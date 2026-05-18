process.on('unhandledRejection', (error) => {
  console.error('[BiliService] bootstrap unhandled rejection:', error);
});

import('./dist/service.js').catch((error) => {
  console.error('[BiliService] bootstrap failed:', error);
  process.exit(1);
});
