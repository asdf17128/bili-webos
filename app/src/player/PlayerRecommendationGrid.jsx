import React, { memo } from 'react';
import { thumbUrl } from '../utils/thumb';
import { formatDuration, formatTime, formatCount, cleanTitle } from '../utils/format';
import { titleMT, useTitlesMT } from '../utils/titlemt';
import { t } from '../i18n';

export default memo(function PlayerRecommendationGrid({ list, panelTab, currentCid, focusedIndex, onChoose, onHover }) {
  useTitlesMT();
  return (
                <div className="related-grid video-grid cols-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 24 }}>
                  {list.map((rv, i) => {
                    const thumb = thumbUrl(rv.pic || rv.cover || '', 4);
                    const nowPlaying = panelTab === 'parts' && rv.cid === currentCid;
                    const focused = focusedIndex === i;
                    return (
                      <div key={rv.cid || rv.bvid || i} className={`related-card video-card${focused ? ' focused' : ''}`} role="button" aria-label={cleanTitle(rv.title)}
                        onClick={() => onChoose(rv)}
                        onMouseMove={() => onHover(i)}>
                        <div className="video-card-thumb">
                          {thumb && <span className="video-card-placeholder" aria-hidden="true">{t('封面暂不可用')}</span>}
                          {thumb && <img src={thumb} alt="" decoding="async" loading={i < 8 ? 'eager' : 'lazy'}
                            onLoad={e => { e.currentTarget.classList.add('image-ready'); e.currentTarget.style.visibility = ''; e.currentTarget.parentElement?.classList.remove('image-failed'); }}
                            onError={e => { e.currentTarget.style.visibility = 'hidden'; e.currentTarget.parentElement?.classList.add('image-failed'); }} />}
                          {!thumb && <span className="video-card-missing">{t('封面暂不可用')}</span>}
                          {nowPlaying && <div className="video-card-live">{t('▶ 播放中')}</div>}
                          {rv.duration != null && <span className="video-card-duration">
                            {typeof rv.duration === 'number' ? formatDuration(rv.duration) : rv.duration}
                          </span>}
                        </div>
                        <div className="video-card-info">
                          <div className="video-card-title">{titleMT(cleanTitle(rv.title))}</div>
                          <div className="video-card-meta">
                            <div className="video-card-author"><span>{cleanTitle(rv.owner?.name)}</span></div>
                            <div className="video-card-stats">
                              {rv.stat?.view != null && <span>{formatCount(rv.stat.view)}{t('播放')}</span>}
                              {rv.pubdate && <span>{formatTime(rv.pubdate)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
  );
});
