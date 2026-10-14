import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import { cdnHostOf } from './cdn';

// Mounted only when opted in: no polling or overlay while disabled. Native
// HLS does not expose reliable transfer totals/codecs; never invent estimates.
export default function NerdInfo({ videoRef, playerRef, transferRef, audio }) {
  const [info, setInfo] = useState({});
  useEffect(() => {
    let previousBytes = transferRef?.current.bytes || 0, previousTime = performance.now();
    const sample = () => {
      const v = videoRef.current;
      const track = playerRef?.current?.getVariantTracks?.().find(x => x.active);
      const frames = v?.getVideoPlaybackQuality?.();
      const transfer = transferRef?.current;
      const now = performance.now();
      let buffer = 0;
      for (let i = 0; v && i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) buffer = v.buffered.end(i) - v.currentTime;
      }
      setInfo({ width: v?.videoWidth, height: v?.videoHeight, fps: track?.frameRate,
        video: track?.videoCodec, audio: track?.audioCodec,
        host: transfer?.host || cdnHostOf(v?.currentSrc), buffer,
        bytes: transfer?.bytes, rate: transfer ? Math.max(0, transfer.bytes - previousBytes) * 1000 / Math.max(1, now - previousTime) : null,
        dropped: frames?.droppedVideoFrames, frames: frames?.totalVideoFrames });
      previousBytes = transfer?.bytes || 0; previousTime = now;
    };
    sample(); const timer = setInterval(sample, 1000);
    return () => clearInterval(timer);
  }, [videoRef, playerRef, transferRef]);
  const unknown = '—';
  return <aside className="nerd-info" aria-label={t('Nerd 信息')}>
    <strong>{t('Nerd 信息')}</strong>
    <div>{t('分辨率')}：{info.width ? `${info.width} × ${info.height}` : unknown}{info.fps ? ` · ${info.fps} fps` : ''}</div>
    <div>{t('视频编码')}：{info.video || unknown}</div>
    <div>{t('音频编码')}：{info.audio || audio || unknown}</div>
    <div>CDN：{info.host || unknown}</div>
    <div>{t('媒体下载')}：{info.bytes == null ? unknown : `${(info.bytes / 1048576).toFixed(2)} MiB · ${(info.rate / 1048576).toFixed(2)} MiB/s`}</div>
    <div>{t('缓冲')}：{(info.buffer || 0).toFixed(1)} s · {t('丢帧')}：{info.dropped ?? unknown} / {info.frames ?? unknown}</div>
    <small>{t('下载统计为已完成媒体请求；原生直播不可用的指标显示 —')}</small>
  </aside>;
}
