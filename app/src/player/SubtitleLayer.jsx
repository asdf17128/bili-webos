import React, { useRef, useEffect } from 'react';
import { pickCueIndex } from './subtitles';

// CC subtitle overlay. Same performance contract as DanmakuLayer: one rAF loop
// reading video.currentTime directly, DOM mutated only when the active cue
// CHANGES — no React state on the playback hot path.
//
// lift: 0 = resting (just above the bottom edge), 1 = controls bar open,
// 2 = controls + panel open. Moves via transform (GPU) per the perf rules.
const LIFT_Y = ['0', '-190px', '-46vh'];

export default function SubtitleLayer({ videoRef, cues, enabled, lead = 0, lift = 0, fontScale = 1 }) {
  const boxRef = useRef(null);
  const idxRef = useRef(-2); // -2 forces the first paint (pickCueIndex returns -1/-0+)

  useEffect(() => {
    idxRef.current = -2;
    if (!enabled || !cues || cues.length === 0) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const box = boxRef.current;
      if (v && box) {
        const i = pickCueIndex(cues, v.currentTime + lead);
        if (i !== idxRef.current) {
          idxRef.current = i;
          if (i < 0) {
            box.style.visibility = 'hidden';
          } else {
            box.textContent = cues[i].text;
            box.style.visibility = 'visible';
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cues, enabled, lead, videoRef]);

  if (!enabled || !cues || cues.length === 0) return null;

  return (
    <div className="subtitle-layer" style={{ transform: `translateY(${LIFT_Y[lift] || '0'})` }}>
      <span ref={boxRef} className="subtitle-text"
        style={{ visibility: 'hidden', fontSize: Math.round(34 * fontScale) }} />
    </div>
  );
}
