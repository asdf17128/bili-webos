import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './tv-design.css';
import { initErrorHooks } from './utils/errlog';
import { initializeMediaProxy } from './api/client';
import { t } from './i18n';

// Capture uncaught errors from the very start - they feed the diagnostics page.
initErrorHooks();

// Discover the bound proxy before the first thumbnail or media URL is built.
// A service restart can choose a different port if the old listener survives.
function Startup() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    initializeMediaProxy().then(() => { if (active) setReady(true); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  if (ready) return <App />;
  return <div className="startup-state" role="status">
    <p>{t(failed ? '连接服务失败，请重试' : '正在连接服务…')}</p>
    {failed && <button autoFocus onClick={() => setAttempt(n => n + 1)}>{t('重试')}</button>}
  </div>;
}

createRoot(document.getElementById('root')).render(<Startup />);
