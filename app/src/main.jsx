import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initErrorHooks } from './utils/errlog';

// Capture uncaught errors from the very start - they feed the diagnostics page.
initErrorHooks();

createRoot(document.getElementById('root')).render(<App />);
