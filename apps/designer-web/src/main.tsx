import '@verbis/ui/tokens.css';
import '@verbis/ui/fonts.css';
import './workspace/styles.css';
import './workspace/script-detail.css';
import './workspace/visual-hierarchy.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createI18n, negotiateLocale } from '@verbis/i18n';
import { initializeBrowserSecurity } from '@verbis/ui';

import { App } from './app.js';
import { AppProviders } from './providers.js';

initializeBrowserSecurity();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

const i18n = await createI18n(negotiateLocale(navigator.languages));

createRoot(container).render(
  <StrictMode>
    <AppProviders i18n={i18n}>
      <App />
    </AppProviders>
  </StrictMode>,
);
