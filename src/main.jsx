import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if (typeof document !== 'undefined') {
  createRoot(document.getElementById('root')).render(<App />);
}
