import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { logger } from './lib/logger';
import './styles/globals.css';

logger.debug(
  {
    action: 'app.bootstrap.renderRequested',
  },
  'Rendering PoolMaster webapp root',
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
