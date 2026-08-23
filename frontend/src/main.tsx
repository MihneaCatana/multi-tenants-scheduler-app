/*
 * Copyright (c) 2026 Mihnea Catana. All rights reserved.
 * Proprietary and Confidential. Unauthorized copying or commercial use is strictly prohibited.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'primereact/resources/themes/arya-orange/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import './app.css';
import App from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
