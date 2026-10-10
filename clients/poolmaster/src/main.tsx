import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { logger } from './lib/logger';
import { registerGlobalBrowserFailureHandlers } from './lib/logger/browser-failure-handlers';
import './styles/globals.css';

logger.debug(
  {
    action: 'app.bootstrap.renderRequested',
  },
  'Rendering PoolMaster webapp root',
);

registerGlobalBrowserFailureHandlers(logger);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('index.html is missing the #root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
