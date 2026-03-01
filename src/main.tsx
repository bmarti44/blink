// CRITICAL: Import workerSetupEntry FIRST to inject fake process object
// before any monaco-vscode-api modules are loaded.
import './services/vscode/workerSetupEntry';

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/app';
import './styles/app.css';

const root = document.getElementById('app')!;
createRoot(root).render(<App />);
