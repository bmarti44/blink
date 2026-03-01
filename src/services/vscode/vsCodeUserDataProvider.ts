/**
 * VS Code User Data FileSystem Provider
 *
 * Implements the vscode-userdata:// scheme for VS Code's user data storage.
 * Maps paths like vscode-userdata:/User/workspaceStorage/... to the Tauri
 * app data directory.
 *
 * This is critical for:
 * - Chat session persistence (ChatSessionStore)
 * - User settings and state
 * - Workspace storage
 * - Extension global state
 */

import {
  registerCustomProvider,
  FileSystemProviderCapabilities,
  FileType,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat,
  type IWatchOptions,
  type IFileWriteOptions,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileChange,
} from '@codingame/monaco-vscode-files-service-override';
import { FileSystemProviderErrorCode, createFileSystemProviderError } from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files';
import { readFile, writeFile, readDir, stat, mkdir, remove, rename, exists } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { Disposable, type IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';

/**
 * File system provider for vscode-userdata:// scheme
 * Maps VS Code's virtual user data paths to Tauri's app data directory
 */
export class VSCodeUserDataProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;

  private _onDidChangeCapabilities = new Emitter<void>();
  readonly onDidChangeCapabilities: Event<void> = this._onDidChangeCapabilities.event;

  private _onDidChangeFile = new Emitter<readonly IFileChange[]>();
  readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

  private _baseDir: string | null = null;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    this._initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    // Guard: Tauri IPC is not available in web workers or webview iframes
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    try {
      const dataDir = await appDataDir();
      const separator = dataDir.endsWith('/') ? '' : '/';
      this._baseDir = `${dataDir}${separator}vscode-userdata`;
      console.log('[VSCodeUserData] Base directory:', this._baseDir);
      try {
        const dirExists = await exists(this._baseDir);
        if (!dirExists) {
          await mkdir(this._baseDir, { recursive: true });
          console.log('[VSCodeUserData] Created base directory');
        }
      } catch (e) {
        try {
          await mkdir(this._baseDir, { recursive: true });
          console.log('[VSCodeUserData] Created base directory (fallback)');
        } catch (e2) {
          console.error('[VSCodeUserData] mkdir failed:', e2);
        }
      }
    } catch (error) {
      console.error('[VSCodeUserData] Failed to initialize:', error);
    }
  }

  async ensureInitialized(): Promise<void> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      throw new Error('[VSCodeUserData] Not in Tauri context');
    }
    let attempts = 0;
    while (!this._baseDir && attempts < 40) {
      if (this._initPromise) {
        await this._initPromise;
        this._initPromise = null;
      }
      if (this._baseDir) break;
      try {
        await new Promise((r) => setTimeout(r, 125));
        this._initPromise = this.initialize();
      } catch {}
      attempts++;
    }
    if (!this._baseDir) {
      throw new Error('[VSCodeUserData] Provider not initialized');
    }
  }

  async whenReady(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * Convert a vscode-userdata URI to a file system path
   * e.g., vscode-userdata:/User/workspaceStorage/abc/chatSessions/xyz.json
   *       -> /path/to/app/data/vscode-userdata/User/workspaceStorage/abc/chatSessions/xyz.json
   */
  private uriToPath(resource: URI): string {
    if (!this._baseDir) {
      throw new Error('[VSCodeUserData] Provider not initialized');
    }

    // The URI path starts with / so we need to handle that
    // vscode-userdata:/User/... -> User/...
    let uriPath = resource.path;
    if (uriPath.startsWith('/')) {
      uriPath = uriPath.substring(1);
    }

    // Decode any URI-encoded characters
    uriPath = decodeURIComponent(uriPath);

    return `${this._baseDir}/${uriPath}`;
  }

  /**
   * Ensure parent directory exists for a file path
   * Creates all parent directories recursively if they don't exist
   */
  private async ensureParentDir(filePath: string): Promise<void> {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const parentDir = filePath.substring(0, lastSlash);
      try {
        const dirExists = await exists(parentDir);
        if (!dirExists) {
          await mkdir(parentDir, { recursive: true });
          console.log('[VSCodeUserData] Created parent directory:', parentDir.substring(this._baseDir!.length));
        }
      } catch (error) {
        // If exists() fails, try to create anyway
        console.log('[VSCodeUserData] ensureParentDir - creating:', parentDir.substring(this._baseDir!.length));
        try {
          await mkdir(parentDir, { recursive: true });
        } catch (mkdirError) {
          // Ignore if directory already exists
          console.debug('[VSCodeUserData] mkdir error (may already exist):', mkdirError);
        }
      }
    }
  }

  /**
   * Read file contents
   */
  async readFile(resource: URI): Promise<Uint8Array> {
    await this.ensureInitialized();
    const path = this.uriToPath(resource);

    try {
      const content = await readFile(path);
      return content;
    } catch (error) {
      // Log errors but don't spam for expected missing files
      const pathStr = resource.path;
      if (!pathStr.includes('globalStorage') && !pathStr.includes('.obsolete')) {
        console.debug('[VSCodeUserData] File not found:', path);
      }
      // Throw proper FileSystemProviderError
      throw createFileSystemProviderError('File not found', FileSystemProviderErrorCode.FileNotFound);
    }
  }

  /**
   * Write file contents
   */
  async writeFile(resource: URI, content: Uint8Array, _opts: IFileWriteOptions): Promise<void> {
    await this.ensureInitialized();
    const path = this.uriToPath(resource);

    try {
      // Ensure parent directory exists
      await this.ensureParentDir(path);
      await writeFile(path, content);
      console.log('[VSCodeUserData] Wrote file:', path.substring(this._baseDir!.length));
    } catch (error) {
      console.error('[VSCodeUserData] Failed to write file:', path, error);
      throw error;
    }
  }

  /**
   * Get file/directory stats
   */
  async stat(resource: URI): Promise<IStat> {
    await this.ensureInitialized();
    const path = this.uriToPath(resource);

    try {
      const info = await stat(path);
      return {
        type: info.isDirectory ? FileType.Directory : FileType.File,
        ctime: info.mtime?.getTime() ?? Date.now(),
        mtime: info.mtime?.getTime() ?? Date.now(),
        size: info.size,
      };
    } catch (error) {
      // Throw a proper FileSystemProviderError for "file not found"
      // This allows VS Code to handle it properly (e.g., create parent dirs)
      throw createFileSystemProviderError('File not found', FileSystemProviderErrorCode.FileNotFound);
    }
  }

  /**
   * Read directory contents
   */
  async readdir(resource: URI): Promise<[string, FileType][]> {
    await this.ensureInitialized();
    const path = this.uriToPath(resource);

    try {
      const entries = await readDir(path);
      const result: [string, FileType][] = [];

      for (const entry of entries) {
        try {
          const entryPath = `${path}/${entry.name}`;
          const info = await stat(entryPath);
          result.push([entry.name, info.isDirectory ? FileType.Directory : FileType.File]);
        } catch {
          // Skip entries we can't stat
        }
      }

      return result;
    } catch (error) {
      // Return empty array for missing directories (they'll be created on write)
      return [];
    }
  }

  /**
   * Create directory
   */
  async mkdir(resource: URI): Promise<void> {
    await this.ensureInitialized();
    const path = this.uriToPath(resource);

    try {
      await mkdir(path, { recursive: true });
      console.log('[VSCodeUserData] Created directory:', path.substring(this._baseDir!.length));
    } catch (error) {
      console.error('[VSCodeUserData] Failed to mkdir:', path, error);
      throw error;
    }
  }

  /**
   * Delete file or directory
   */
  async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
    await this.ensureInitialized();
    const path = this.uriToPath(resource);

    try {
      await remove(path, { recursive: opts.recursive ?? false });
    } catch (error) {
      // Ignore errors for non-existent files
      console.debug('[VSCodeUserData] Delete failed (may not exist):', path);
    }
  }

  /**
   * Rename/move file or directory
   */
  async rename(from: URI, to: URI, _opts: IFileOverwriteOptions): Promise<void> {
    await this.ensureInitialized();
    const fromPath = this.uriToPath(from);
    const toPath = this.uriToPath(to);

    try {
      await this.ensureParentDir(toPath);
      await rename(fromPath, toPath);
    } catch (error) {
      console.error('[VSCodeUserData] Failed to rename:', fromPath, error);
      throw error;
    }
  }

  /**
   * Watch for file changes (not implemented - would need Tauri watcher)
   */
  watch(_resource: URI, _opts: IWatchOptions): IDisposable {
    // TODO: Implement file watching with Tauri's watch API
    return Disposable.None;
  }
}

// Global instance
let userDataProvider: VSCodeUserDataProvider | null = null;

/**
 * Initialize and register the VS Code user data provider
 * This must be called BEFORE any services try to use vscode-userdata:// URIs
 */
export function initializeVSCodeUserDataProvider(): VSCodeUserDataProvider {
  if (userDataProvider) {
    return userDataProvider;
  }

  userDataProvider = new VSCodeUserDataProvider();

  // Register for the vscode-userdata scheme
  registerCustomProvider('vscode-userdata', userDataProvider);

  console.log('[VSCodeUserData] Registered provider for vscode-userdata:// scheme');
  return userDataProvider;
}

/**
 * Get the user data provider instance
 */
export function getVSCodeUserDataProvider(): VSCodeUserDataProvider | null {
  return userDataProvider;
}
