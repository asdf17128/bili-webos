import { useEffect, useState } from 'react';

// Keep media ticks inside small consumers, never in the whole player page.
export function useMediaClock(videoRef, enabled = true, wholeSeconds = false) {
  const read = () => {
    const time = videoRef.current?.currentTime || 0;
    return { currentTime: wholeSeconds ? Math.floor(time) : time, duration: videoRef.current?.duration || 0 };
  };
  const [clock, setClock] = useState(read);
  useEffect(() => {
    let last = null;
    const sample = () => {
      const next = read();
      if (last && last.currentTime === next.currentTime && last.duration === next.duration) return;
      last = next;
      setClock(prev => prev.currentTime === next.currentTime && prev.duration === next.duration ? prev : next);
    };
    sample();
    if (!enabled) return;
    const media = videoRef.current;
    let timer = null;
    const sync = () => {
      sample();
      if (timer !== null) { clearInterval(timer); timer = null; }
      if (media && !media.paused && !media.ended) timer = setInterval(sample, 500);
    };
    const events = ['play', 'pause', 'ended', 'seeked', 'loadedmetadata', 'durationchange'];
    events.forEach(name => media?.addEventListener(name, sync));
    sync();
    return () => {
      if (timer !== null) clearInterval(timer);
      events.forEach(name => media?.removeEventListener(name, sync));
    };
  }, [videoRef, enabled, wholeSeconds]);
  return clock;
}
