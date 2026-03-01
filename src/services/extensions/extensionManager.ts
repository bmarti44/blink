/**
 * Extension Manager Service
 *
 * Central service for managing VS Code extensions.
 * Handles installation, enabling/disabling, and lifecycle management.
 */

import type {
  ExtensionInfo,
  ExtensionState,
  ExtensionEvent,
  ExtensionEventListener,
  ExtensionEventType,
} from './types';
import {
  loadRegistry,
  saveRegistry,
  removeExtensionDir,
  isExtensionInstalled,
  getExtensionPath,
  readExtensionManifest,
} from './extensionStorage';
import {
  installVsixFromPath,
  installVsixFromData,
  createExtensionInfo,
} from './vsixLoader';

/**
 * Extension Manager
 *
 * Singleton service for managing extensions.
 */
class ExtensionManager {
  private extensions: Map<string, ExtensionState> = new Map();
  private listeners: Set<ExtensionEventListener> = new Set();
  private initialized = false;

  /**
   * Initialize the extension manager
   * Loads the extension registry from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[ExtensionManager] Initializing...');

    try {
      await this.loadFromDisk();
      this.initialized = true;
      console.log(`[ExtensionManager] Loaded ${this.extensions.size} extensions`);
    } catch (err) {
      console.error('[ExtensionManager] Failed to initialize:', err);
      this.initialized = true; // Still mark as initialized to prevent retries
    }
  }

  /**
   * Refresh extensions from disk
   * Call this when extensions have been modified externally (e.g., via Tauri backend)
   */
  async refresh(): Promise<void> {
    console.log('[ExtensionManager] Refreshing from disk...');

    const previousIds = new Set(this.extensions.keys());

    try {
      await this.loadFromDisk();

      const currentIds = new Set(this.extensions.keys());

      // Find newly added extensions
      for (const id of currentIds) {
        if (!previousIds.has(id)) {
          const state = this.extensions.get(id);
          if (state) {
            this.emit('installed', id, state.info);
          }
        }
      }

      // Find removed extensions
      for (const id of previousIds) {
        if (!currentIds.has(id)) {
          this.emit('uninstalled', id);
        }
      }

      // Emit a general change event
      this.emit('refreshed', '');

      console.log(`[ExtensionManager] Refresh complete. ${this.extensions.size} extensions loaded`);
    } catch (err) {
      console.error('[ExtensionManager] Failed to refresh:', err);
      throw err;
    }
  }

  /**
   * Load extensions from disk into the manager
   */
  private async loadFromDisk(): Promise<void> {
    const registry = await loadRegistry();

    // Clear existing and reload
    this.extensions.clear();

    for (const info of registry) {
      // Verify extension still exists on disk
      const exists = await isExtensionInstalled(info.id);
      if (exists) {
        this.extensions.set(info.id, {
          info,
          status: info.enabled ? 'enabled' : 'disabled',
        });
      }
    }
  }

  /**
   * Get all installed extensions
   */
  getExtensions(): ExtensionState[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get a specific extension by ID
   */
  getExtension(extensionId: string): ExtensionState | undefined {
    return this.extensions.get(extensionId);
  }

  /**
   * Get enabled extensions
   */
  getEnabledExtensions(): ExtensionInfo[] {
    return Array.from(this.extensions.values())
      .filter((state) => state.status === 'enabled')
      .map((state) => state.info);
  }

  /**
   * Install an extension from a VSIX file path
   */
  async installFromPath(vsixPath: string): Promise<ExtensionInfo> {
    console.log(`[ExtensionManager] Installing from path: ${vsixPath}`);

    const result = await installVsixFromPath(vsixPath);

    if (!result.success || !result.manifest || !result.extensionPath) {
      throw new Error(result.error || 'Failed to install extension');
    }

    const info = createExtensionInfo(result.manifest, result.extensionPath, true);

    // Add to registry
    this.extensions.set(info.id, {
      info,
      status: 'enabled',
    });

    await this.saveState();
    this.emit('installed', info.id, info);

    return info;
  }

  /**
   * Install an extension from binary data
   */
  async installFromData(data: Uint8Array, filename: string): Promise<ExtensionInfo> {
    console.log(`[ExtensionManager] Installing from data: ${filename}`);

    const result = await installVsixFromData(data, filename);

    if (!result.success || !result.manifest || !result.extensionPath) {
      throw new Error(result.error || 'Failed to install extension');
    }

    const info = createExtensionInfo(result.manifest, result.extensionPath, true);

    // Add to registry
    this.extensions.set(info.id, {
      info,
      status: 'enabled',
    });

    await this.saveState();
    this.emit('installed', info.id, info);

    return info;
  }

  /**
   * Uninstall an extension
   */
  async uninstall(extensionId: string): Promise<void> {
    console.log(`[ExtensionManager] Uninstalling: ${extensionId}`);

    const state = this.extensions.get(extensionId);
    if (!state) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    // Update status
    this.extensions.set(extensionId, {
      ...state,
      status: 'uninstalling',
    });

    try {
      // Remove from disk
      await removeExtensionDir(extensionId);

      // Remove from registry
      this.extensions.delete(extensionId);

      await this.saveState();
      this.emit('uninstalled', extensionId);
    } catch (err) {
      // Restore previous status on error
      this.extensions.set(extensionId, {
        ...state,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Enable an extension
   */
  async enable(extensionId: string): Promise<void> {
    console.log(`[ExtensionManager] Enabling: ${extensionId}`);

    const state = this.extensions.get(extensionId);
    if (!state) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    this.extensions.set(extensionId, {
      ...state,
      info: { ...state.info, enabled: true },
      status: 'enabled',
    });

    await this.saveState();
    this.emit('enabled', extensionId, state.info);
  }

  /**
   * Disable an extension
   */
  async disable(extensionId: string): Promise<void> {
    console.log(`[ExtensionManager] Disabling: ${extensionId}`);

    const state = this.extensions.get(extensionId);
    if (!state) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    this.extensions.set(extensionId, {
      ...state,
      info: { ...state.info, enabled: false },
      status: 'disabled',
    });

    await this.saveState();
    this.emit('disabled', extensionId, state.info);
  }

  /**
   * Reload an extension's manifest from disk
   */
  async reloadManifest(extensionId: string): Promise<ExtensionInfo> {
    const state = this.extensions.get(extensionId);
    if (!state) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    const extensionPath = await getExtensionPath(extensionId);
    const manifest = await readExtensionManifest(extensionPath);

    const updatedInfo: ExtensionInfo = {
      ...state.info,
      manifest,
      displayName: manifest.displayName || manifest.name,
      description: manifest.description || '',
      version: manifest.version,
      updatedAt: Date.now(),
    };

    this.extensions.set(extensionId, {
      ...state,
      info: updatedInfo,
    });

    await this.saveState();
    this.emit('updated', extensionId, updatedInfo);

    return updatedInfo;
  }

  /**
   * Add an event listener
   */
  addEventListener(listener: ExtensionEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: ExtensionEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an extension event
   */
  private emit(
    type: ExtensionEventType,
    extensionId: string,
    extension?: ExtensionInfo,
    error?: string
  ): void {
    const event: ExtensionEvent = {
      type,
      extensionId,
      extension,
      error,
      timestamp: Date.now(),
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[ExtensionManager] Event listener error:', err);
      }
    }
  }

  /**
   * Save current state to disk
   */
  private async saveState(): Promise<void> {
    const extensions = Array.from(this.extensions.values()).map((state) => state.info);
    await saveRegistry(extensions);
  }
}

// Singleton instance
let extensionManager: ExtensionManager | null = null;

/**
 * Get the extension manager instance
 */
export function getExtensionManager(): ExtensionManager {
  if (!extensionManager) {
    extensionManager = new ExtensionManager();
  }
  return extensionManager;
}

/**
 * Initialize the extension manager
 */
export async function initializeExtensionManager(): Promise<void> {
  const manager = getExtensionManager();
  await manager.initialize();

  // Expose globally for test bridge access
  if (typeof window !== 'undefined') {
    (window as unknown as { __EXTENSION_MANAGER__: ExtensionManager }).__EXTENSION_MANAGER__ = manager;
  }
}
