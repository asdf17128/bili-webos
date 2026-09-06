import React from 'react';

// One stroke, one optical size. Inline vectors stay crisp on every TV and avoid
// platform-dependent emoji glyphs or an icon font download during startup.
const paths = {
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  home: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  hot: 'M12 2c2 5 7 6 7 12a7 7 0 0 1-14 0c0-3 2-5 3-7 0 4 2 5 3 5 2-3 2-6 1-10Z',
  live: 'M3 5h18v13H3ZM9 22h6M10 9l5 3-5 3Z',
  follow: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  star: 'M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
  game: 'M7 6h10c3 0 4 3 5 10 0 3-2 4-4 2l-3-3H9l-3 3c-2 2-4 1-4-2 1-7 2-10 5-10ZM7 9v5M4.5 11.5h5M16 10h.1M19 13h.1',
  tv: 'M4 6h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM7 2l3 4M17 2l-3 4M8 11v4M16 11v4',
  music: 'M9 18V5l12-3v13M9 18a3 3 0 1 1-3-3c2 0 3 1 3 3M21 15a3 3 0 1 1-3-3c2 0 3 1 3 3',
  book: 'M12 5v16M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z',
  smile: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M8 9h.1M16 9h.1M7 14c2 5 8 5 10 0',
  remix: 'M3 7h3c5 0 7 10 12 10h3M17 13l4 4-4 4M3 17h3c2 0 3-2 4-4M14 7c1-1 2 0 4 0h3M17 3l4 4-4 4',
  history: 'M3 3v6h6M3 9a9 9 0 1 1 0 6M12 7v6l4 2',
  settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z',
  refresh: 'M20 7A9 9 0 1 0 21 15M21 2v6h-6',
  play: 'M7 3l14 9-14 9Z',
  pause: 'M7 4v16M17 4v16',
  like: 'M8 10l5-8c3 0 3 3 2 7h5c2 0 2 2 1 5l-2 7H8ZM3 10h5v11H3Z',
  later: 'M12 3a9 9 0 1 1-9 9M12 7v5l3 2M2 5h6M5 2v6',
  danmaku: 'M2 4h20v14H9l-5 4v-4H2ZM6 9h6M16 9h2M6 13h3M13 13h5',
  subtitle: 'M3 4h18v16H3ZM6 9h4M14 9h4M6 14h3M12 14h6',
  comments: 'M3 3h18v14H10l-6 5v-5H3ZM7 8h10M7 12h6',
  speed: 'M3 18a10 10 0 1 1 18 0M12 13l5-6M6 17h12',
  quality: 'M3 4h18v16H3ZM7 8v8M11 8v8M7 12h4M15 8h3v8h-3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
};

export default function Icon({ name, size = 24, className = '' }) {
  return <svg className={`tv-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={paths[name] || paths.tv} />
  </svg>;
}
