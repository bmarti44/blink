/**
 * VS Code Services
 *
 * Provides monaco-vscode-api integration for VS Code extension support.
 */

export {
  initializeVSCodeServices,
  isVSCodeInitialized,
  waitForVSCode,
} from './initialize';

export { initializeWorkers } from './workers';

export {
  registerDefaultExtensions,
  RECOMMENDED_EXTENSIONS,
} from './defaultExtensions';
