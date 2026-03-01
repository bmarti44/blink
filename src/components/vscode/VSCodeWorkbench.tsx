/**
 * VS Code Workbench Component
 *
 * This component renders the full VS Code workbench UI using monaco-vscode-api.
 * It provides the complete VS Code experience including:
 * - Activity bar (left vertical nav)
 * - Sidebar (file explorer, search, source control, etc.)
 * - Editor area with tabs and split views
 * - Panel (terminal, problems, output, debug console)
 * - Status bar
 *
 * NOTE: MonacoEnvironment is configured by workerSetupEntry.ts which is imported
 * first in main.tsx.
 */

import type { FC } from 'react';
import { useRef, useEffect, useState } from 'react';
import { initializeWorkbench, isWorkbenchInitialized } from '../../services/vscode/workbench';
import './VSCodeWorkbench.css';

interface VSCodeWorkbenchProps {
  /**
   * Initial folder to open in the explorer
   */
  initialFolder?: string;
  /**
   * Callback when workbench is ready
   */
  onReady?: () => void;
  /**
   * Callback when workbench fails to initialize
   */
  onError?: (error: Error) => void;
}

export const VSCodeWorkbench: FC<VSCodeWorkbenchProps> = ({
  initialFolder,
  onReady,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (!containerRef.current) return;

      // Skip if already initialized
      if (isWorkbenchInitialized()) {
        setIsLoading(false);
        onReady?.();
        return;
      }

      try {
        console.log('[VSCodeWorkbench] Initializing workbench...');

        await initializeWorkbench(containerRef.current);

        if (disposed) return;

        setIsLoading(false);
        console.log('[VSCodeWorkbench] Workbench ready');
        onReady?.();

        // TODO: Open initial folder if provided
        if (initialFolder) {
          console.log('[VSCodeWorkbench] Opening folder:', initialFolder);
          // This will be implemented when we have the file system provider hooked up
        }
      } catch (err) {
        if (disposed) return;

        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('[VSCodeWorkbench] Failed to initialize:', err);
        setError(errorMessage);
        setIsLoading(false);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      }
    }

    init();

    return () => {
      disposed = true;
    };
  }, [initialFolder, onReady, onError]);

  if (error) {
    return (
      <div className="vscode-workbench vscode-workbench--error">
        <div className="vscode-workbench__error-content">
          <h2>Failed to load VS Code Workbench</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vscode-workbench">
      <div
        ref={containerRef}
        className="vscode-workbench__container"
      />
      {isLoading && (
        <div className="vscode-workbench__loading">
          <div className="vscode-workbench__loading-spinner" />
          <span>Loading VS Code...</span>
        </div>
      )}
    </div>
  );
};

export default VSCodeWorkbench;
