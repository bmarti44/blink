/**
 * Monaco Worker Setup Entry Point
 *
 * This is a separate webpack entry point that MUST load before the main application.
 * It sets up:
 * 1. MonacoEnvironment with proper worker factories
 * 2. A fake process object to make VS Code think it's in a native environment
 *
 * SIMPLIFIED VERSION: Single definitive implementation with clear worker routing.
 *
 * CRITICAL: This file should have NO imports from monaco-editor or monaco-vscode-api
 * to avoid circular dependencies and ensure the environment is ready first.
 */

// ============================================================================
// Worker Creation Functions
// ============================================================================

/**
 * Create worker for a given label
 * Returns undefined for unknown labels to allow VS Code fallback
 */
const createWorker = (label: string): Worker | undefined => {
  console.log('[MonacoWorkerSetup] Creating worker for:', label);

  switch (label) {
    case 'extensionHostWorkerMain':
      return new Worker(
        new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url),
        { type: 'module' }
      );

    case 'editorWorkerService':
    case 'OutputLinkDetectionWorker':
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
      );

    default:
      // Return undefined for unknown labels to allow VS Code to use bundled URLs
      console.log('[MonacoWorkerSetup] Unknown worker label, deferring to VS Code:', label);
      return undefined;
  }
};

// ============================================================================
// MonacoEnvironment Setup - Set Once, Globally
// ============================================================================

const monacoEnvironment = {
  getWorker: (_workerId: string, label: string) => createWorker(label),
};

// Set on all possible globals
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).MonacoEnvironment = monacoEnvironment;
}
if (typeof globalThis !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MonacoEnvironment = monacoEnvironment;
}
if (typeof self !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).MonacoEnvironment = monacoEnvironment;
}

console.log('[MonacoWorkerSetup] MonacoEnvironment configured');

// ============================================================================
// Fake Native Environment Injection
// ============================================================================

(function injectFakeNativeEnvironment() {
  if (typeof window === 'undefined') {
    return;
  }

  // Detect the actual OS from the user agent
  const ua = navigator.userAgent;
  let platform = 'darwin'; // default to macOS
  if (ua.indexOf('Windows') >= 0) {
    platform = 'win32';
  } else if (ua.indexOf('Linux') >= 0) {
    platform = 'linux';
  }

  // Create a fake process object that mimics Node.js/Electron
  // This is what platform.js checks to determine if we're in a native environment
  const fakeProcess = {
    platform,
    env: {
      CI: undefined,
      BUILD_ARTIFACTSTAGINGDIRECTORY: undefined,
      GITHUB_WORKSPACE: undefined,
    },
    versions: {
      node: '20.0.0', // Fake Node.js version
      // NOTE: We intentionally do NOT set 'electron' here
    },
    type: undefined,
    cwd: () => '/',
    pid: 1,
    nextTick: (fn: () => void) => setTimeout(fn, 0),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;

  // Set on vscode.process (VS Code specific path)
  if (!g.vscode) {
    g.vscode = {};
  }
  g.vscode.process = fakeProcess;

  // Also set global process (standard Node.js path)
  if (!g.process) {
    g.process = fakeProcess;
  }

  console.log('[MonacoWorkerSetup] Fake native environment injected:', platform);
})();

// Export empty object to make this a valid module
export {};
