/**
 * Tauri Extension Management Service
 *
 * Custom extension management that:
 * 1. Enables installation for ALL extensions (including Node.js ones)
 * 2. Downloads VSIX files and installs to Tauri directory
 * 3. Activates Node.js extensions via the sidecar
 * 4. Shows installed extensions in VS Code UI
 */

import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { invoke } from '@tauri-apps/api/core';
import { extensionHostService } from './extensionHostService';

// Extension manifest interface
interface ExtensionManifest {
  name: string;
  version: string;
  publisher: string;
  displayName?: string;
  description?: string;
  main?: string;
  browser?: string;
  icon?: string;
  categories?: string[];
  keywords?: string[];
  activationEvents?: string[];
  contributes?: Record<string, unknown>;
  extensionDependencies?: string[];
  extensionPack?: string[];
}

// Installed extension from Tauri
interface TauriInstalledExtension {
  extensionId: string;
  extensionPath: string;
  manifest: ExtensionManifest;
}

// Local extension representation for VS Code UI
export interface LocalExtension {
  identifier: { id: string };
  location: URI;
  manifest: ExtensionManifest;
  type: number; // 1 = User
  isBuiltin: boolean;
  targetPlatform: string;
  isValid: boolean;
  validations: unknown[];
}

// Gallery extension representation
export interface GalleryExtension {
  identifier: { id: string; uuid?: string };
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description?: string;
  assets: {
    download?: { uri: string };
    icon?: { uri: string };
  };
  properties?: {
    dependencies?: string[];
    extensionPack?: string[];
  };
}

/**
 * Extension installation result
 */
export interface InstallExtensionResult {
  identifier: { id: string };
  local?: LocalExtension;
  error?: Error;
  operation: number;
  source?: URI | GalleryExtension;
}

/**
 * Tauri Extension Manager
 * Manages extensions installed via Tauri filesystem
 */
class TauriExtensionManager extends Disposable {
  private _installedExtensions: Map<string, LocalExtension> = new Map();
  private _onDidInstall = this._register(new Emitter<InstallExtensionResult[]>());
  readonly onDidInstall: Event<InstallExtensionResult[]> = this._onDidInstall.event;

  private _onDidUninstall = this._register(new Emitter<{ identifier: { id: string } }>());
  readonly onDidUninstall: Event<{ identifier: { id: string } }> = this._onDidUninstall.event;

  private _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor() {
    super();
    this.loadInstalledExtensions();
  }

  /**
   * Load installed extensions from Tauri
   */
  async loadInstalledExtensions(): Promise<void> {
    try {
      type Scanned = { id: string; path: string; manifest: ExtensionManifest; is_builtin: boolean };
      const scanned = await invoke<Scanned[]>('scan_extensions');
      console.log('[TauriExtMgr] Scanned extensions:', scanned.length);

      this._installedExtensions.clear();
      for (const ext of scanned) {
        const local: LocalExtension = {
          identifier: { id: ext.id },
          location: URI.file(ext.path),
          manifest: ext.manifest,
          type: ext.is_builtin ? 0 : 1,
          isBuiltin: !!ext.is_builtin,
          targetPlatform: 'universal',
          isValid: true,
          validations: [],
        };
        this._installedExtensions.set(ext.id.toLowerCase(), local);
      }

      this._onDidChange.fire();
    } catch (err) {
      console.error('[TauriExtMgr] Failed to load extensions:', err);
    }
  }

  /**
   * Convert Tauri extension to VS Code LocalExtension
   */
  private toLocalExtension(ext: TauriInstalledExtension): LocalExtension {
    return {
      identifier: { id: ext.extensionId },
      location: URI.file(ext.extensionPath),
      manifest: ext.manifest,
      type: 1, // User extension
      isBuiltin: false,
      targetPlatform: 'universal',
      isValid: true,
      validations: [],
    };
  }

  /**
   * Check if an extension is installed
   */
  isInstalled(extensionId: string): boolean {
    return this._installedExtensions.has(extensionId.toLowerCase());
  }

  /**
   * Get installed extension
   */
  getInstalled(extensionId: string): LocalExtension | undefined {
    return this._installedExtensions.get(extensionId.toLowerCase());
  }

  /**
   * Get all installed extensions
   */
  getAllInstalled(): LocalExtension[] {
    return Array.from(this._installedExtensions.values());
  }

  /**
   * Install an extension from the gallery
   */
  async installFromGallery(gallery: GalleryExtension): Promise<LocalExtension> {
    const extensionId = `${gallery.publisher}.${gallery.name}`;
    console.log('[TauriExtMgr] Installing from gallery:', extensionId);

    // Download VSIX
    const downloadUrl = gallery.assets.download?.uri;
    if (!downloadUrl) {
      // Construct Open VSX URL
      const vsixUrl = `https://open-vsx.org/api/${gallery.publisher}/${gallery.name}/${gallery.version}/file/${gallery.publisher}.${gallery.name}-${gallery.version}.vsix`;
      return this.installFromUrl(vsixUrl, extensionId, gallery);
    }

    return this.installFromUrl(downloadUrl, extensionId, gallery);
  }

  /**
   * Install extension from URL
   */
  private async installFromUrl(url: string, extensionId: string, gallery?: GalleryExtension): Promise<LocalExtension> {
    console.log('[TauriExtMgr] Downloading VSIX from:', url);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const vsixData = new Uint8Array(await response.arrayBuffer());
      console.log('[TauriExtMgr] Downloaded:', vsixData.length, 'bytes');

      // Install via Tauri
      const result = await invoke<TauriInstalledExtension>('install_extension_from_data', {
        data: Array.from(vsixData),
        filename: `${extensionId}.vsix`,
      });

      console.log('[TauriExtMgr] Installed to:', result.extensionPath);

      const local = this.toLocalExtension(result);
      this._installedExtensions.set(extensionId.toLowerCase(), local);

      // Activate Node.js extensions in sidecar
      if (result.manifest.main && !result.manifest.browser) {
        console.log('[TauriExtMgr] Activating Node.js extension:', extensionId);
        try {
          const ready = await extensionHostService.checkReady();
          if (ready) {
            await extensionHostService.activateExtension(result.extensionPath, extensionId);
          }
        } catch (err) {
          console.warn('[TauriExtMgr] Failed to activate in sidecar:', err);
        }
      }

      // AUTO-RESOLVE DEPENDENCIES: Install any missing dependencies
      if (result.manifest.extensionDependencies && result.manifest.extensionDependencies.length > 0) {
        console.log('[TauriExtMgr] Extension has dependencies:', result.manifest.extensionDependencies);
        // Install dependencies in background (don't block main installation)
        this.installDependencies(result.manifest.extensionDependencies).catch((err) => {
          console.warn('[TauriExtMgr] Some dependencies failed to install:', err);
        });
      }

      // Emit install event
      this._onDidInstall.fire([
        {
          identifier: { id: extensionId },
          local,
          operation: 1, // Install
          source: gallery,
        },
      ]);

      this._onDidChange.fire();

      return local;
    } catch (err) {
      console.error('[TauriExtMgr] Installation failed:', err);
      throw err;
    }
  }

  /**
   * Install extension dependencies automatically
   */
  private async installDependencies(dependencies: string[]): Promise<void> {
    for (const depId of dependencies) {
      // Skip if already installed
      if (this.isInstalled(depId)) {
        console.log('[TauriExtMgr] Dependency already installed:', depId);
        continue;
      }

      // Skip built-in VS Code extensions (they start with 'vscode.')
      if (depId.startsWith('vscode.')) {
        console.log('[TauriExtMgr] Skipping built-in dependency:', depId);
        continue;
      }

      console.log('[TauriExtMgr] Installing dependency:', depId);

      try {
        // Parse extension ID (format: publisher.name)
        const parts = depId.split('.');
        if (parts.length < 2) {
          console.warn('[TauriExtMgr] Invalid dependency ID format:', depId);
          continue;
        }

        const publisher = parts[0];
        const name = parts.slice(1).join('.');

        // Query Open VSX API for the extension
        const apiUrl = `https://open-vsx.org/api/${publisher}/${name}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
          console.warn('[TauriExtMgr] Dependency not found on Open VSX:', depId);
          continue;
        }

        const extensionInfo = await response.json();

        // Build a GalleryExtension-like object
        const gallery: GalleryExtension = {
          identifier: { id: depId },
          name: extensionInfo.name || name,
          displayName: extensionInfo.displayName || name,
          publisher,
          version: extensionInfo.version,
          description: extensionInfo.description,
          assets: {
            download: extensionInfo.files?.download ? { uri: extensionInfo.files.download } : undefined,
            icon: extensionInfo.files?.icon ? { uri: extensionInfo.files.icon } : undefined,
          },
        };

        // Install the dependency
        await this.installFromGallery(gallery);
        console.log('[TauriExtMgr] Dependency installed:', depId);
      } catch (err) {
        console.warn('[TauriExtMgr] Failed to install dependency:', depId, err);
        // Continue with other dependencies even if one fails
      }
    }
  }

  /**
   * Uninstall an extension
   */
  async uninstall(extensionId: string): Promise<void> {
    console.log('[TauriExtMgr] Uninstalling:', extensionId);

    try {
      await invoke('uninstall_extension', { extensionId });
      this._installedExtensions.delete(extensionId.toLowerCase());

      // Deactivate from sidecar
      try {
        await extensionHostService.deactivateExtension(extensionId);
      } catch {
        // Ignore deactivation errors
      }

      this._onDidUninstall.fire({ identifier: { id: extensionId } });
      this._onDidChange.fire();
    } catch (err) {
      console.error('[TauriExtMgr] Uninstall failed:', err);
      throw err;
    }
  }
}

// Singleton instance
let tauriExtensionManager: TauriExtensionManager | null = null;

/**
 * Get the Tauri extension manager instance
 */
export function getTauriExtensionManager(): TauriExtensionManager {
  if (!tauriExtensionManager) {
    tauriExtensionManager = new TauriExtensionManager();
  }
  return tauriExtensionManager;
}

/**
 * Check if an extension is installed via Tauri
 */
export function isExtensionInstalled(extensionId: string): boolean {
  return getTauriExtensionManager().isInstalled(extensionId);
}

/**
 * Get all Tauri-installed extensions
 */
export function getInstalledExtensions(): LocalExtension[] {
  return getTauriExtensionManager().getAllInstalled();
}

/**
 * Install extension from gallery via Tauri
 */
export async function installExtensionFromGallery(gallery: GalleryExtension): Promise<LocalExtension> {
  return getTauriExtensionManager().installFromGallery(gallery);
}
