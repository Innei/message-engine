import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Demo root element is unavailable');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
