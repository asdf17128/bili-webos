import React, { useEffect, useState } from 'react';
import { getHistory } from '../api/client';
import { storage } from '../utils/storage';
import { useFocusable } from '../hooks/useFocus';
import { thumbUrl } from '../utils/thumb';
import { cleanTitle, formatDuration } from '../utils/format';
import { t } from '../i18n';
import Icon from './Icon';

let snapshot = null;

export function useContinueWatching(enabled) {
  const account = storage.getAuth()?.DedeUserID || '';
  const [items, setItems] = useState(() => enabled && snapshot?.account === account ? snapshot.items : []);
  useEffect(() => {
    if (!enabled || !account) { setItems([]); return; }
    let alive = true, revision = 0;
    const load = async (force = false) => {
      const request = ++revision;
      if (!force && snapshot?.account === account && Date.now() - snapshot.at < 60000) { setItems(snapshot.items); return; }
      try {
        const result = await getHistory(0, 0, 30);
        if (!alive || request !== revision || result?.code) return;
        const seen = new Set();
        const list = (result?.data?.list || []).filter(item => {
          const h = item.history || {};
          // Keep the server's exact part + position together. Finished videos,
          // live rooms and unsupported history types aren't resume actions.
          if (!h.bvid || !h.cid || h.business !== 'archive' || seen.has(h.bvid) ||
            !(item.progress > 5 && item.duration - item.progress > 15)) return false;
          seen.add(h.bvid); return true;
        }).slice(0, 3).map(item => ({
          bvid: item.history.bvid, cid: item.history.cid, title: item.title,
          pic: item.cover, owner: { name: item.author_name },
          duration: item.duration, progress: item.progress, resumeMode: 'at',
        }));
        snapshot = { account, items: list, at: Date.now() }; setItems(list);
      } catch { /* Optional history never blocks discovery or shows a fake card. */ }
    };
    load();
    const unsubscribe = storage.onProgressChange(() => load(true));
    return () => { alive = false; unsubscribe(); };
  }, [enabled, account]);
  return items;
}

function ResumeCard({ video, col, onSelect }) {
  const { props, isFocused } = useFocusable({ id: `content--1-${col}`, row: -1, col,
    onSelect: () => onSelect(video) });
  return <button {...props} type="button" tabIndex={-1} data-resume-at={video.progress} className={`resume-card${isFocused ? ' focused' : ''}`}>
    <div className="resume-cover"><img src={thumbUrl(video.pic, 4)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
      <span className="resume-play"><Icon name="play" size={20} /></span>
      <span className="resume-progress"><i style={{ width: `${Math.min(100, 100 * video.progress / video.duration)}%` }} /></span>
    </div>
    <div className="resume-info"><div className="resume-title">{cleanTitle(video.title)}</div>
      <div className="resume-position">{t('看到 {time}', { time: formatDuration(video.progress) })}<Icon name="arrow" size={18} /></div>
    </div>
  </button>;
}

export default function ContinueWatching({ items, onSelect }) {
  return <section className="continue-section" aria-label={t('继续观看')}>
    <div className="shelf-heading"><h2>{t('继续观看')}</h2></div>
    <div className="resume-shelf">{items.map((video, col) => <ResumeCard key={video.bvid} video={video} col={col} onSelect={onSelect} />)}</div>
    <div className="shelf-heading feed-heading"><h2>{t('为你推荐')}</h2></div>
  </section>;
}
