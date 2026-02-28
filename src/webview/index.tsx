import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/index.js';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
