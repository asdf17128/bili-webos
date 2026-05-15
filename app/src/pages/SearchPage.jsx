import React, { useState, useCallback } from 'react';
import { searchVideo } from '../api/client';
import VideoRow from '../components/VideoRow';
import OSKey from '../components/OSKey';

const KEYBOARD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '删除', '搜索'],
];

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
    <div className="search-container">
      <div className="page-title" style={{ padding: 0 }}>搜索</div>
      <div className="search-bar">
        <div className="search-input" style={{ display: 'flex', alignItems: 'center' }}>
          {keyword || <span style={{ color: '#555' }}>输入关键词...</span>}
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
                  id={`osk-${rowIdx}-${colIdx}`}
                  row={rowIdx}
                  col={colIdx}
                  group="content"
                  label={key}
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
        <div className="loading"><div className="loading-spinner" />搜索中...</div>
      ) : searched && results.length === 0 ? (
        <div className="empty-state">未找到相关视频</div>
      ) : results.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <VideoRow title="搜索结果" videos={results.slice(0, 10)} rowIndex={10} group="content" onSelect={onPlayVideo} />
          {results.length > 10 && <VideoRow title="" videos={results.slice(10)} rowIndex={11} group="content" onSelect={onPlayVideo} />}
        </div>
      ) : null}
    </div>
  );
}
