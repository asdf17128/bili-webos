import React, { useState, useCallback } from 'react';
import { searchVideo } from '../api/client';
import VideoCard from '../components/VideoCard';
import OSKey from '../components/OSKey';
import { t } from '../i18n';

const KEYBOARD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '删除', '搜索'],
];

const RESULT_COLS = 4;
const RESULT_START_ROW = 4; // keyboard uses content rows 0-3

export default function SearchPage({ onPlayVideo }) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await searchVideo(keyword.trim());
      const items = (res?.data?.result || []).map(item => ({
        ...item,
        title: item.title?.replace(/<[^>]+>/g, '') || '',
        pic: item.pic,
        bvid: item.bvid,
        owner: { name: item.author },
        stat: { view: item.play },
        duration: item.duration,
      }));
      setResults(items);
    } catch (err) {
      console.error('Search error:', err);
    }
    setLoading(false);
  }, [keyword]);

  return (
    <div className="search-container" style={{ overflowY: 'auto' }}>
      <div className="page-title" style={{ padding: 0 }}>{t('搜索')}</div>

      <div className="search-bar">
        <div className="search-input" style={{ display: 'flex', alignItems: 'center' }}>
          {keyword || <span style={{ color: '#555' }}>{t('输入关键词...')}</span>}
        </div>
      </div>

      <div className="osk-container">
        {KEYBOARD_ROWS.map((row, rowIdx) => (
          <div key={rowIdx} className="osk-row">
            {row.map((key, colIdx) => {
              const isAction = key === '删除' || key === '搜索';
              return (
                <OSKey
                  key={`${rowIdx}-${colIdx}`}
                  id={`content-${rowIdx}-${colIdx}`}
                  row={rowIdx}
                  col={colIdx}
                  group="content"
                  label={isAction ? t(key) : key}
                  isAction={isAction}
                  onPress={() => {
                    if (key === '删除') setKeyword(prev => prev.slice(0, -1));
                    else if (key === '搜索') doSearch();
                    else setKeyword(prev => prev + key.toLowerCase());
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading" style={{ marginTop: 30 }}><div className="loading-spinner" />{t('搜索中...')}</div>
      ) : searched && results.length === 0 ? (
        <div className="empty-state">{t('未找到相关视频')}</div>
      ) : results.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 18, color: '#aaa', margin: '0 4px 14px' }}>{t('搜索结果')}</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${RESULT_COLS}, 1fr)`,
            gap: '18px 16px',
            paddingBottom: 40,
          }}>
            {results.map((v, i) => (
              <VideoCard
                key={v.bvid || i}
                video={v}
                focusId={`content-${RESULT_START_ROW + Math.floor(i / RESULT_COLS)}-${i % RESULT_COLS}`}
                row={RESULT_START_ROW + Math.floor(i / RESULT_COLS)}
                col={i % RESULT_COLS}
                group="content"
                onSelect={onPlayVideo}
              />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ color: '#666', fontSize: 16, marginTop: 24, textAlign: 'center' }}>
          {t('输入关键词后选「搜索」')}
        </div>
      )}
    </div>
  );
}
