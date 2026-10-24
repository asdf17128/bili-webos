import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { createAuthorFollowersStore, normalizeAuthorMid } from '../utils/authorFollowers';

const followers = createAuthorFollowersStore(mid => apiFetch('/x/relation/stat', { vmid: mid }));

// Pass the current video identity as videoKey, and disable while its author is
// being resolved. Public counts are shared by author; UI ownership is per video.
export function useAuthorFollowers(mid, enabled = true, videoKey = null) {
  const author = normalizeAuthorMid(mid);
  const [state, setState] = useState({ mid: null, videoKey: null, count: null });
  useEffect(() => {
    let active = true;
    // Visibility gates fetching, not already-resolved presentation. The deck
    // remains painted during its fade-out, so keep this video's count mounted.
    if (!enabled || !author) return;
    setState(previous => previous.mid === author && previous.videoKey === videoKey
      ? previous : { mid: author, videoKey, count: null });
    followers.load(author).then(count => {
      if (active) setState({ mid: author, videoKey, count });
    });
    return () => { active = false; };
  }, [author, enabled, videoKey]);

  // Effects run after render; never expose the previous author's count during
  // the intervening render when the video or author has already changed.
  return state.mid === author && state.videoKey === videoKey ? state.count : null;
}
