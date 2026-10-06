// Existing autoplayNext=false users must keep stopping at the end after upgrade.
export function getPlaybackMode(settings = {}) {
  if (['next', 'stop', 'repeat'].includes(settings.playbackMode)) return settings.playbackMode;
  return settings.autoplayNext === false ? 'stop' : 'next';
}
