/**
 * Tauri Local Extension Management Server
 *
 * This creates a "local" extension management server that makes VS Code think
 * it's running in an Electron-like environment. Instead of actual Electron APIs,
 * it uses Tauri's filesystem and Node.js sidecar.
 *
 * This removes the "not supported in web" warnings and allows proper extension
 * installation and management.
 */

import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';

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
  extensionKind?: string[];
  categories?: string[];
  keywords?: string[];
  activationEvents?: string[];
  contributes?: Record<string, unknown>;
  extensionDependencies?: string[];
  extensionPack?: string[];
}

// Gallery extension format
interface GalleryExtension {
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

// Local extension format expected by VS Code
interface ILocalExtension {
  identifier: { id: string; uuid?: string };
  location: URI;
  manifest: ExtensionManifest;
  type: number; // ExtensionType: 0 = System, 1 = User
  isBuiltin: boolean;
  targetPlatform: string;
  isValid: boolean;
  validations: Array<[number, string]>;
  readmeUrl?: URI;
  changelogUrl?: URI;
}

// Install result format
interface IInstallExtensionResult {
  identifier: { id: string };
  local?: ILocalExtension;
  error?: Error;
  operation: number;
  source?: URI | GalleryExtension;
  context?: Record<string, unknown>;
  profileLocation?: URI;
  applicationScoped?: boolean;
}

// Installed extension from Tauri backend
interface TauriInstalledExtension {
  extensionId: string;
  extensionPath: string;
  manifest: ExtensionManifest;
}

/**
 * Tauri-based Local Extension Management Service
 * This pretends to be the local/Electron extension service
 */
export class TauriLocalExtensionManagementService extends Disposable {
  private _extensionsPath: string | null = null;
  private _installedExtensions: Map<string, ILocalExtension> = new Map();

  // Event emitters - these are what VS Code UI listens to
  private readonly _onInstallExtension = this._register(new Emitter<{ identifier: { id: string }; source: GalleryExtension }>());
  readonly onInstallExtension: Event<{ identifier: { id: string }; source: GalleryExtension }> = this._onInstallExtension.event;

  private readonly _onDidInstallExtensions = this._register(new Emitter<IInstallExtensionResult[]>());
  readonly onDidInstallExtensions: Event<IInstallExtensionResult[]> = this._onDidInstallExtensions.event;

  private readonly _onUninstallExtension = this._register(new Emitter<{ identifier: { id: string } }>());
  readonly onUninstallExtension: Event<{ identifier: { id: string } }> = this._onUninstallExtension.event;

  private readonly _onDidUninstallExtension = this._register(new Emitter<{ identifier: { id: string }; error?: Error }>());
  readonly onDidUninstallExtension: Event<{ identifier: { id: string }; error?: Error }> = this._onDidUninstallExtension.event;

  private readonly _onDidUpdateExtensionMetadata = this._register(new Emitter<{ local: ILocalExtension }>());
  readonly onDidUpdateExtensionMetadata: Event<{ local: ILocalExtension }> = this._onDidUpdateExtensionMetadata.event;

  private readonly _onDidChangeProfile = this._register(new Emitter<void>());
  readonly onDidChangeProfile: Event<void> = this._onDidChangeProfile.event;

  constructor() {
    super();
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const dataDir = await appDataDir();
      // Ensure proper path separator - appDataDir() may or may not have trailing slash
      const separator = dataDir.endsWith('/') ? '' : '/';
      this._extensionsPath = `${dataDir}${separator}extensions/installed`;
      console.log('[TauriLocalServer] Extensions path:', this._extensionsPath);
      await this.loadInstalledExtensions();
    } catch (err) {
      console.error('[TauriLocalServer] Failed to initialize:', err);
    }
  }

  /**
   * Load installed extensions from Tauri filesystem
   */
  async loadInstalledExtensions(): Promise<void> {
    try {
      type Scanned = { id: string; path: string; manifest: any; is_builtin: boolean };
      const scanned = await invoke<Scanned[]>('scan_extensions');
      console.log('[TauriLocalServer] Scanned', scanned.length, 'extensions (builtin + installed)');
      this._installedExtensions.clear();
      for (const ext of scanned) {
        const local: ILocalExtension = {
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
    } catch (err) {
      console.error('[TauriLocalServer] Failed to load extensions:', err);
    }
  }

  private toLocalExtension(ext: TauriInstalledExtension): ILocalExtension {
    return {
      identifier: { id: ext.extensionId },
      location: URI.file(ext.extensionPath),
      manifest: ext.manifest,
      type: 1,
      isBuiltin: false,
      targetPlatform: 'universal',
      isValid: true,
      validations: [],
    };
  }

  /**
   * Get the extensions installation folder
   */
  get extensionsLocation(): URI | undefined {
    return this._extensionsPath ? URI.file(this._extensionsPath) : undefined;
  }

  /**
   * Check if we can install an extension - ALWAYS return true
   * This is the key method that enables all extensions
   */
  async canInstall(extension: GalleryExtension): Promise<boolean> {
    console.log('[TauriLocalServer] canInstall called for:', extension.identifier.id);
    // Always return true - we can install any extension via Tauri
    return true;
  }

  /**
   * Get the target platform - return 'universal' to accept all extensions
   */
  async getTargetPlatform(): Promise<string> {
    return 'universal';
  }

  /**
   * Get all installed extensions
   */
  async getInstalled(_type?: number, _profileLocation?: URI, _productVersion?: unknown): Promise<ILocalExtension[]> {
    await this.loadInstalledExtensions();
    return Array.from(this._installedExtensions.values());
  }

  /**
   * Install extension from gallery
   */
  async installFromGallery(extension: GalleryExtension, _options?: Record<string, unknown>): Promise<ILocalExtension> {
    const extId = extension.identifier.id || `${extension.publisher}.${extension.name}`;
    console.log('[TauriLocalServer] Installing:', extId);

    // Fire the install start event
    this._onInstallExtension.fire({
      identifier: { id: extId },
      source: extension,
    });

    try {
      // Get download URL
      let downloadUrl = extension.assets.download?.uri;
      if (!downloadUrl) {
        // Construct Open VSX URL
        downloadUrl = `https://open-vsx.org/api/${extension.publisher}/${extension.name}/${extension.version}/file/${extension.publisher}.${extension.name}-${extension.version}.vsix`;
      }

      console.log('[TauriLocalServer] Downloading from:', downloadUrl);

      // Download the VSIX
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const vsixData = new Uint8Array(await response.arrayBuffer());
      console.log('[TauriLocalServer] Downloaded', vsixData.length, 'bytes');

      // Install via Tauri backend
      const result = await invoke<TauriInstalledExtension>('install_extension_from_data', {
        data: Array.from(vsixData),
        filename: `${extId}.vsix`,
      });

      console.log('[TauriLocalServer] Installed to:', result.extensionPath);

      const local = this.toLocalExtension(result);
      this._installedExtensions.set(extId.toLowerCase(), local);

      // Build the install result
      const installResult = [
        {
          identifier: { id: extId },
          local,
          operation: 1, // InstallOperation.Install
          source: extension,
        },
      ];

      // Fire the install complete event
      console.log('[TauriLocalServer] >>> FIRING onDidInstallExtensions event for:', extId);
      console.log('[TauriLocalServer] >>> Event payload:', installResult);
      this._onDidInstallExtensions.fire(installResult);
      console.log('[TauriLocalServer] >>> Event fired successfully');

      return local;
    } catch (err) {
      console.error('[TauriLocalServer] Installation failed:', err);

      // Fire error event - serialize error as string to avoid IPC serialization issues
      this._onDidInstallExtensions.fire([
        {
          identifier: { id: extId },
          error: new Error(err instanceof Error ? err.message : String(err)),
          operation: 1,
          source: extension,
        },
      ]);

      throw err;
    }
  }

  /**
   * Install from VSIX file
   */
  async installVSIX(vsix: URI, _manifest?: ExtensionManifest, _options?: Record<string, unknown>): Promise<ILocalExtension> {
    console.log('[TauriLocalServer] Installing VSIX:', vsix.fsPath);
    // This would need to read the file and install it
    throw new Error('VSIX installation not yet implemented');
  }

  /**
   * Extract extension ID from various object formats
   */
  private getExtensionId(extension: unknown): string | null {
    const ext = extension as Record<string, unknown>;

    // Try different property paths

    // Format 0: { extension: { ... }, options: ... } - VS Code wrapper format
    if (ext.extension && typeof ext.extension === 'object') {
      console.log('[TauriLocalServer] Found wrapper format, unwrapping extension property');
      return this.getExtensionId(ext.extension);
    }

    // Format 1: { identifier: { id: string } }
    if (ext.identifier && typeof (ext.identifier as Record<string, unknown>).id === 'string') {
      return (ext.identifier as Record<string, unknown>).id as string;
    }

    // Format 2: { id: string } (direct id)
    if (typeof ext.id === 'string') {
      return ext.id;
    }

    // Format 3: { local: { identifier: { id: string } } }
    if (ext.local && typeof ext.local === 'object') {
      const local = ext.local as Record<string, unknown>;
      if (local.identifier && typeof (local.identifier as Record<string, unknown>).id === 'string') {
        return (local.identifier as Record<string, unknown>).id as string;
      }
    }

    // Format 4: { manifest: { name, publisher } }
    if (ext.manifest && typeof ext.manifest === 'object') {
      const manifest = ext.manifest as Record<string, unknown>;
      if (manifest.publisher && manifest.name) {
        return `${manifest.publisher}.${manifest.name}`;
      }
    }

    console.warn('[TauriLocalServer] Could not extract extension ID from:', ext);
    return null;
  }

  /**
   * Uninstall an extension
   */
  async uninstall(extension: ILocalExtension, _options?: Record<string, unknown>): Promise<void> {
    const extId = this.getExtensionId(extension);
    if (!extId) {
      console.error('[TauriLocalServer] Cannot uninstall - no extension ID found');
      throw new Error('Cannot uninstall extension: no ID found');
    }

    console.log('[TauriLocalServer] Uninstalling:', extId);

    this._onUninstallExtension.fire({ identifier: { id: extId } });

    try {
      await invoke('uninstall_extension', { extensionId: extId });
      this._installedExtensions.delete(extId.toLowerCase());

      this._onDidUninstallExtension.fire({ identifier: { id: extId } });
    } catch (err) {
      // Serialize error as string to avoid IPC serialization issues
      this._onDidUninstallExtension.fire({
        identifier: { id: extId },
        error: new Error(err instanceof Error ? err.message : String(err)),
      });
      throw err;
    }
  }

  /**
   * Uninstall multiple extensions (VS Code calls this method)
   */
  async uninstallExtensions(extensions: unknown[], _options?: Record<string, unknown>): Promise<void> {
    console.log('[TauriLocalServer] Uninstalling multiple extensions:', extensions.length);
    console.log(
      '[TauriLocalServer] Extension objects:',
      extensions.map((e) => JSON.stringify(e, null, 2).substring(0, 200))
    );

    for (const extension of extensions) {
      await this.uninstall(extension as ILocalExtension, _options);
    }
  }

  /**
   * Get metadata for an extension
   */
  async getMetadata(_extension: ILocalExtension): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  /**
   * Update extension metadata
   */
  async updateMetadata(local: ILocalExtension, _metadata: Record<string, unknown>): Promise<ILocalExtension> {
    return local;
  }

  /**
   * Check if extension is valid
   */
  async validate(_extension: ILocalExtension): Promise<Array<[number, string]>> {
    return [];
  }

  /**
   * Reinstall an extension
   */
  async reinstallFromGallery(_extension: ILocalExtension): Promise<ILocalExtension> {
    // Get gallery info and reinstall
    throw new Error('Reinstall not yet implemented');
  }

  /**
   * Get extensions control manifest (for blocking malicious extensions)
   */
  async getExtensionsControlManifest(): Promise<{ malicious: unknown[]; deprecated: unknown; search: unknown[] }> {
    return { malicious: [], deprecated: {}, search: [] };
  }

  /**
   * Copy extensions to a profile
   */
  async copyExtensions(_fromProfileLocation: URI, _toProfileLocation: URI): Promise<void> {
    // No-op for now
  }

  /**
   * Download extension
   */
  async download(_extension: GalleryExtension, _operation: number): Promise<URI> {
    throw new Error('Download not implemented');
  }

  /**
   * Update extension from gallery
   */
  async updateFromGallery(gallery: GalleryExtension, extension: ILocalExtension, options?: Record<string, unknown>): Promise<ILocalExtension> {
    // Uninstall old, install new
    await this.uninstall(extension);
    return this.installFromGallery(gallery, options);
  }
}

// Singleton instance
let tauriLocalServer: TauriLocalExtensionManagementService | null = null;

/**
 * Get or create the Tauri local extension management service
 */
export function getTauriLocalExtensionServer(): TauriLocalExtensionManagementService {
  if (!tauriLocalServer) {
    tauriLocalServer = new TauriLocalExtensionManagementService();
  }
  return tauriLocalServer;
}

/**
 * Create a fake "local extension management server" that VS Code expects
 */
export function createTauriLocalExtensionManagementServer() {
  const extensionManagementService = getTauriLocalExtensionServer();

  return {
    id: 'local',
    label: 'Local',
    extensionManagementService,
  };
}
