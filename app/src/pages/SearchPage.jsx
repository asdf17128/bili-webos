import React, { useState, useCallback, useEffect, useRef } from 'react';
import { searchVideo, searchSuggest, getHotSearches } from '../api/client';
import { storage } from '../utils/storage';
import { useFocusable, setFocus, getCurrentFocusId, registerFocusable, unregisterFocusable } from '../hooks/useFocus';
import VideoCard from '../components/VideoCard';
import Icon from '../components/Icon';
import PageState, { GridSkeleton } from '../components/PageState';
import { t } from '../i18n';

// YouTube-style search: the box is a real <input> — selecting it raises the
// webOS system keyboard (typing + its built-in mic). Below the box is a
// recommendation list: autocomplete suggestions while typing, and 搜索历史 +
// 热门搜索 when idle. No custom on-screen keyboard.

// A focusable full-width recommendation row (suggestion / history / trending).
const RecItem = React.memo(function RecItem({ id, row, col = 0, icon, rank, label, onPress }) {
  const handleSelect = useCallback(() => { onPress?.(); }, [onPress]);
  const { props, isFocused } = useFocusable({ id, row, col, group: 'content', onSelect: handleSelect });
  return (
    <div {...props} role="button" className={`search-rec-item${isFocused ? ' focused' : ''}`}>
      <span className={`rec-ico${rank && rank < 4 ? ' rec-top' : ''}`}>{rank ? String(rank).padStart(2, '0') : <Icon name={icon} size={22} />}</span>
      <span className="rec-label">{label}</span><Icon name="arrow" className="rec-arrow" size={20} />
    </div>
  );
});

export default function SearchPage({ onPlayVideo }) {
  const RESULT_COLS = Math.min(4, Math.max(2, storage.getSettings().gridCols || 3));
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState('browse'); // 'browse' (recs) | 'results'
  const [suggestions, setSuggestions] = useState([]);
  const [history, setHistory] = useState(() => storage.getSearchHistory());
  const [trending, setTrending] = useState([]);
  const inputRef = useRef(null);
  const requestRef = useRef(0);
  const resultFocusRef = useRef(false);
  useEffect(() => () => { requestRef.current++; }, []);

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
    const requestId = ++requestRef.current;
    lastSearchedRef.current = q;
    setKeyword(q);
    setLoading(true);
    setError(false); setResults([]);
    setMode('results');
    setSuggestions([]);
    storage.addSearchHistory(q);
    setHistory(storage.getSearchHistory());
    if (inputRef.current) { try { inputRef.current.blur(); } catch (e) { /* ignore */ } }
    setFocus('content-0-0');
    let items = [];
    try {
      const res = await searchVideo(q);
      if (requestId !== requestRef.current) return;
      if (res?.code && res.code !== 0) throw new Error(res.message || String(res.code));
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
      if (requestId !== requestRef.current) return;
      console.error('Search error:', err);
      setResults([]);
      setError(true);
    }
    resultFocusRef.current = getCurrentFocusId() === 'content-0-0';
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loading || mode !== 'results' || !resultFocusRef.current) return;
    resultFocusRef.current = false;
    if (getCurrentFocusId() === 'content-0-0') setFocus(results.length || error ? 'content-1-0' : 'content-0-0');
  }, [loading, mode, results, error]);

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
    requestRef.current++; // An older search must never replace this newer edit.
    setLoading(false); setError(false); resultFocusRef.current = false;
    setKeyword(e.target.value);
    setMode('browse'); // editing → show recommendations again
  }, []);

  const onInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation?.();
      if (e.repeat || e.nativeEvent.repeat) return;
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

  const kw = keyword.trim();
  const historyItems = history.map(h => ({ key: h, icon: 'history', label: h, onPress: () => doSearch(h) }));
  if (history.length) historyItems.push({ key: 'clear', icon: 'trash', label: t('清除历史'), onPress: clearHistory });
  const columns = kw ? [{ title: t('搜索建议'), items: suggestions.map(s => ({ key: s, icon: 'search', label: s, onPress: () => doSearch(s) })) }]
    : [{ title: t('热门搜索'), items: trending.map((h, i) => ({ key: h, rank: i + 1, label: h, onPress: () => doSearch(h) })) },
      { title: t('搜索历史'), items: historyItems }];

  return (
    <div className="search-container" style={{ overflowY: 'auto' }}>
      <header className="page-heading"><h1>{t('搜索')}</h1></header>

      <div className="search-bar"><Icon name="search" size={30} />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          data-focus-id="content-0-0"
          value={keyword}
          placeholder={t('搜索视频、UP 主')}
          aria-label={t('搜索视频、UP 主')}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          onFocus={() => { requestRef.current++; setLoading(false); setMode('browse'); setFocus('content-0-0'); }}
        />
      </div>
      <p className="search-help">{t('按确认输入，支持系统键盘与语音输入')}</p>

      {loading ? (
        <GridSkeleton cols={RESULT_COLS} />
      ) : mode === 'results' ? (
        error ? <PageState row={1} title={t('搜索暂时不可用')} description={t('请检查网络连接后重试')} action={t('重试')} onAction={() => doSearch(lastSearchedRef.current)} /> : results.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 'calc(18px * var(--ui-scale))', color: '#aaa', margin: '0 4px 14px' }}>{t('搜索结果')}</div>
            <div className="search-results-grid" style={{
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
        <div className="search-discovery">
          {columns.map((section, col) => <section className="search-recs" key={section.title}>
            <h2 className="search-rec-section">{section.title}</h2>
            {section.items.length ? section.items.map((it, i) => <RecItem key={it.key} id={`content-${i + 1}-${col}`}
              row={i + 1} col={col} icon={it.icon} rank={it.rank} label={it.label} onPress={it.onPress} />)
              : <p className="search-empty">{kw ? t('输入关键词，按确认搜索') : col ? t('搜过的内容会出现在这里') : t('输入关键词，发现更多内容')}</p>}
          </section>)}
        </div>
      )}
    </div>
  );
}
