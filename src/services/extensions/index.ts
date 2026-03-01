/**
 * Extensions Service
 *
 * Provides VS Code extension management capabilities.
 */

export * from './types';
export * from './extensionStorage';
export * from './vsixLoader';
export {
  getExtensionManager,
  initializeExtensionManager,
} from './extensionManager';
