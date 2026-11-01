// LG conventional remotes report numeric codes; external remotes may expose
// DOM media key names. Dedicated play/pause are idempotent, toggle is not.
export function mediaKeyAction(event) {
  if (event.key === 'MediaPlay' || event.keyCode === 415) return 'play';
  if (event.key === 'MediaPause' || event.keyCode === 19) return 'pause';
  if (event.key === 'MediaPlayPause' || event.keyCode === 179) return 'toggle';
  return null;
}
