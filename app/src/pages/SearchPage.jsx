import React, { useState, useCallback, useEffect, useRef } from 'react';
import { searchVideo, searchSuggest, getHotSearches } from '../api/client';
import { storage } from '../utils/storage';
import { useFocusable, setFocus, registerFocusable, unregisterFocusable } from '../hooks/useFocus';
import VideoCard from '../components/VideoCard';
import { t } from '../i18n';

// YouTube-style search: the box is a real <input> — selecting it raises the
// webOS system keyboard (typing + its built-in mic). Below the box is a
// recommendation list: autocomplete suggestions while typing, and 搜索历史 +
// 热门搜索 when idle. No custom on-screen keyboard.
const RESULT_COLS = 4;

// A focusable full-width recommendation row (suggestion / history / trending).
const RecItem = React.memo(function RecItem({ id, row, icon, label, onPress }) {
  const handleSelect = useCallback(() => { onPress?.(); }, [onPress]);
  const { props } = useFocusable({ id, row, col: 0, group: 'content', onSelect: handleSelect });
  return (
    <div {...props} className="search-rec-item">
      <span className="rec-ico">{icon}</span>
      <span className="rec-label">{label}</span>
    </div>
  );
});

export default function SearchPage({ onPlayVideo }) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('browse'); // 'browse' (recs) | 'results'
  const [suggestions, setSuggestions] = useState([]);
  const [history, setHistory] = useState(() => storage.getSearchHistory());
  const [trending, setTrending] = useState([]);
  const inputRef = useRef(null);

  const keywordRef = useRef('');
  keywordRef.current = keyword;
  const lastSearchedRef = useRef('');

  const focusInput = useCallback(() => { try { inputRef.current?.focus(); } catch (e) { /* ignore */ } }, []);

  // Register the search box as a focus cell (col 0, row 0); OK raises the
  // system keyboard. Manual registration keeps the native <input> focus ring
  // without useFocusable's click-preventDefault (which blocks input focus).
  useEffect(() => {
    // NB: do NOT setFocus here — the search page also mounts on sidebar *preview*
    // (arrowing onto 搜索), and stealing focus into the box would break sidebar
    // navigation. App's selectPage → focusFirstContent moves focus in on OK.
    registerFocusable('content-0-0', { row: 0, col: 0, group: 'content', onSelect: focusInput });
    return () => unregisterFocusable('content-0-0');
  }, [focusInput]);

  // Trending searches for the idle state.
  useEffect(() => {
    let alive = true;
    getHotSearches(10).then(list => { if (alive) setTrending(list); });
    return () => { alive = false; };
  }, []);

  const doSearch = useCallback(async (term) => {
    const q = (term != null ? term : keywordRef.current).trim();
    if (!q) return;
    lastSearchedRef.current = q;
    setKeyword(q);
    setLoading(true);
    setMode('results');
    setSuggestions([]);
    storage.addSearchHistory(q);
    setHistory(storage.getSearchHistory());
    if (inputRef.current) { try { inputRef.current.blur(); } catch (e) { /* ignore */ } }
    let items = [];
    try {
      const res = await searchVideo(q);
      items = (res?.data?.result || []).map(item => ({
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
      setResults([]);
    }
    setLoading(false);
    setTimeout(() => setFocus(items.length ? 'content-1-0' : 'content-0-0'), 60);
  }, []);

  // Debounced autocomplete as the user types / dictates.
  const suggestTimer = useRef(null);
  useEffect(() => {
    const q = keyword.trim();
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!q || q === lastSearchedRef.current) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(() => {
      searchSuggest(q).then(s => {
        if (keywordRef.current.trim() === q) setSuggestions(s);
      });
    }, 250);
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
  }, [keyword]);

  const onInputChange = useCallback((e) => {
    setKeyword(e.target.value);
    setMode('browse'); // editing → show recommendations again
  }, []);

  const onInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation?.();
      doSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation?.();
      if (inputRef.current) { try { inputRef.current.blur(); } catch (err) { /* ignore */ } }
      setFocus('content-1-0');
    }
  }, [doSearch]);

  const clearHistory = useCallback(() => {
    storage.clearSearchHistory();
    setHistory([]);
    setFocus('content-0-0');
  }, []);

  // Build the browse list (with section headers). Only non-header rows are
  // focusable; row index counts focusable rows starting at 1.
  const kw = keyword.trim();
  const browse = [];
  if (kw.length > 0) {
    suggestions.forEach(s => browse.push({ key: 's:' + s, icon: '🔍', label: s, onPress: () => doSearch(s) }));
  } else {
    if (history.length) {
      browse.push({ header: t('搜索历史') });
      history.forEach(h => browse.push({ key: 'h:' + h, icon: '🕘', label: h, onPress: () => doSearch(h) }));
      browse.push({ key: 'clear', icon: '🗑', label: t('清除历史'), onPress: clearHistory });
    }
    if (trending.length) {
      browse.push({ header: t('热门搜索') });
      trending.forEach((h, i) => browse.push({ key: 't:' + h, icon: i < 3 ? '🔥' : '·', label: h, onPress: () => doSearch(h) }));
    }
  }

  let fidx = 0;

  return (
    <div className="search-container" style={{ overflowY: 'auto' }}>
      <div className="page-title" style={{ padding: 0 }}>{t('搜索')}</div>

      <div className="search-bar">
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          data-focus-id="content-0-0"
          value={keyword}
          placeholder={t('搜索')}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          onFocus={() => { setMode('browse'); setFocus('content-0-0'); }}
        />
      </div>

      {loading ? (
        <div className="loading" style={{ marginTop: 30 }}><div className="loading-spinner" />{t('搜索中...')}</div>
      ) : mode === 'results' ? (
        results.length > 0 ? (
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
                  focusId={`content-${1 + Math.floor(i / RESULT_COLS)}-${i % RESULT_COLS}`}
                  row={1 + Math.floor(i / RESULT_COLS)}
                  col={i % RESULT_COLS}
                  group="content"
                  onSelect={onPlayVideo}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">{t('未找到相关视频')}</div>
        )
      ) : (
        <div className="search-recs">
          {browse.map((it) => {
            if (it.header) return <div key={'H:' + it.header} className="search-rec-section">{it.header}</div>;
            const row = 1 + fidx; fidx++;
            return (
              <RecItem key={it.key} id={`content-${row}-0`} row={row} icon={it.icon} label={it.label} onPress={it.onPress} />
            );
          })}
        </div>
      )}
    </div>
  );
}
