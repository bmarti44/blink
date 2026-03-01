/**
 * Monaco Editor Worker Configuration
 *
 * Configures the MonacoEnvironment for web workers required by Monaco editor.
 * The editor worker handles diff computations and other editor operations.
 * TextMate tokenization is handled by the textmate service override internally.
 */

/**
 * Initialize Monaco web workers
 * Must be called before Monaco editor is created
 */
export function initializeWorkers(): void {
  // Skip if already configured
  if (window.MonacoEnvironment?.getWorker) {
    return;
  }

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      console.log('[Monaco] Creating worker for:', label);

      switch (label) {
        case 'extensionHostWorkerMain':
          // Extension host worker for running browser extensions
          return new Worker(
            new URL(
              '@codingame/monaco-vscode-api/workers/extensionHost.worker',
              import.meta.url
            ),
            { type: 'module' }
          );
        case 'editorWorkerService':
        default:
          // Editor worker for diff computations and other editor operations
          // The TextMate service override handles syntax highlighting internally
          return new Worker(
            new URL(
              'monaco-editor/esm/vs/editor/editor.worker.js',
              import.meta.url
            ),
            { type: 'module' }
          );
      }
    },
  };

  console.log('[Monaco] Worker environment configured');
}
