import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

async function ensureWebOSScript() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.webOS || document.querySelector('script[data-webos-runtime]'))
    return;

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './webOSTVjs-1.2.13/webOSTV.js';
    script.async = false;
    script.dataset.webosRuntime = 'true';
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function bootstrap() {
  if (typeof document === 'undefined') return;
  await ensureWebOSScript().catch(() => {});
  createRoot(document.getElementById('root')).render(<App />);
}

if (typeof document !== 'undefined') {
  bootstrap();
}
