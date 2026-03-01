/**
 * VS Code IDE Page
 *
 * Full VS Code workbench experience using monaco-vscode-api.
 * This provides:
 * - Activity bar with file explorer, search, source control, etc.
 * - Sidebar with tree views
 * - Editor area with tabs and split views
 * - Panel with terminal, problems, output
 * - Status bar
 *
 * NOTE: MonacoEnvironment is configured by workerSetupEntry.ts which is imported
 * first in main.tsx.
 */

import type { FC } from 'react';
import { useState, useCallback } from 'react';
import { VSCodeWorkbench } from '../../vscode/VSCodeWorkbench';
import './VSCodeIDE.css';

export const VSCodeIDE: FC = () => {
  const [initialFolder] = useState<string | undefined>();

  const handleReady = useCallback(() => {
    console.log('[VSCodeIDE] Workbench ready');
  }, []);

  const handleError = useCallback((error: Error) => {
    console.error('[VSCodeIDE] Workbench error:', error);
  }, []);

  return (
    <div className="vscode-ide">
      <VSCodeWorkbench
        initialFolder={initialFolder}
        onReady={handleReady}
        onError={handleError}
      />
    </div>
  );
};

export default VSCodeIDE;
