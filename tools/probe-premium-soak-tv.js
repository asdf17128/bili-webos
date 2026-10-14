// Run with tools/_cdp.mjs; normal production entry, real media, no API stubs.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const original = localStorage.getItem('bili_settings');
  const result = { samples: [], events: [], errors: [] };
  const back = async () => {
    for (let i = 0; i < 5 && document.querySelector('video'); i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await sleep(300);
    }
  };
  let player, media;
  const event = e => result.events.push({ type: e.type, time: media.currentTime });
  const error = e => result.errors.push({ code: e.detail?.code, category: e.detail?.category });
  try {
    await back();
    localStorage.setItem('bili_settings', JSON.stringify({ ...JSON.parse(original || '{}'), quality: 126, playbackMode: 'stop' }));
    window.__openVideo({ bvid: 'BV1dCNC6hEzE', cid: 39933052694, resumeMode: 'none' });
    for (let i = 0; i < 100 && !document.querySelector('video')?.videoWidth; i++) await sleep(250);
    media = document.querySelector('video'); player = window.__shakaPlayer;
    if (!media?.videoWidth || !player) throw new Error('No decoded video');
    player.addEventListener('error', error);
    for (const name of ['ended', 'waiting', 'error']) media.addEventListener(name, event);
    for (let i = 0; i < 48; i++) {
      const track = player.getVariantTracks().find(t => t.active), stats = player.getStats();
      result.samples.push({ time: media.currentTime, duration: media.duration, ready: media.readyState,
        width: media.videoWidth, height: media.videoHeight, codec: track?.videoCodec, audio: track?.audioCodec,
        fps: track?.frameRate, decoded: stats.decodedFrames, dropped: stats.droppedFrames,
        runtime: window.__dolbyRuntime?.(), ended: media.ended });
      if (media.ended || media.error || document.querySelector('.player-error')) break;
      await sleep(5000);
    }
    // The counter includes repeated responses; the separate corpus probe checks unique ranges.
    const last = result.samples[result.samples.length - 1];
    result.pass = last.ended && result.events.some(e => e.type === 'ended') && !result.errors.length
      && last.runtime?.phase === 'playing' && last.runtime.fragments >= 35
      && last.fps === 60 && last.width === 3840 && last.codec === 'dvh1.08.10' && last.decoded > 10000;
  } finally {
    player?.removeEventListener('error', error);
    if (media) for (const name of ['ended', 'waiting', 'error']) media.removeEventListener(name, event);
    if (original == null) localStorage.removeItem('bili_settings'); else localStorage.setItem('bili_settings', original);
    await back();
  }
  return result;
})()
