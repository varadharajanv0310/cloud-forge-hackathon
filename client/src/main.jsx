import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Demo reset. Opening /?demo wipes the on-device vault before the app mounts,
// so the session always starts on the landing page instead of resuming into
// the dashboard. Recording a walkthrough otherwise means clearing storage by
// hand between takes.
if (typeof window !== 'undefined' && /[?&]demo\b/.test(window.location.search)) {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  window.history.replaceState({}, '', '/');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Register Service Worker for PWA / offline / push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[SW] Registered, scope:', reg.scope))
      .catch((err) => console.warn('[SW] Registration failed:', err));
  });
}
