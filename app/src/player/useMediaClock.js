import { useEffect, useState } from 'react';

// Keep media ticks inside small consumers, never in the whole player page.
export function useMediaClock(videoRef, enabled = true) {
  const read = () => ({ currentTime: videoRef.current?.currentTime || 0, duration: videoRef.current?.duration || 0 });
  const [clock, setClock] = useState(read);
  useEffect(() => {
    const sample = () => {
      const next = read();
      setClock(prev => prev.currentTime === next.currentTime && prev.duration === next.duration ? prev : next);
    };
    sample();
    if (!enabled) return;
    const timer = setInterval(sample, 500);
    const media = videoRef.current;
    media?.addEventListener('seeked', sample);
    media?.addEventListener('loadedmetadata', sample);
    return () => {
      clearInterval(timer);
      media?.removeEventListener('seeked', sample);
      media?.removeEventListener('loadedmetadata', sample);
    };
  }, [videoRef, enabled]);
  return clock;
}
