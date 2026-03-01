/**
 * Tauri FileSystem Provider for VS Code
 *
 * Bridges VS Code's file system API to Tauri's filesystem plugin.
 * Implements IFileSystemProviderWithFileReadWriteCapability to handle
 * all file operations (read, write, stat, readdir, etc.) through Tauri.
 */

import {
  registerFileSystemOverlay,
  FileSystemProviderCapabilities,
  FileType,
  FileChangeType,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat,
  type IWatchOptions,
  type IFileWriteOptions,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileChange,
} from '@codingame/monaco-vscode-files-service-override';
import {
  readFile,
  writeFile,
  readDir,
  stat,
  mkdir,
  remove,
  rename,
  watch,
  type WatchEvent,
  type UnwatchFn,
} from '@tauri-apps/plugin-fs';
import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';

/**
 * File system provider that bridges to Tauri's native filesystem
 */
export class TauriFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.PathCaseSensitive;

  private _onDidChangeCapabilities = new Emitter<void>();
  readonly onDidChangeCapabilities: Event<void> = this._onDidChangeCapabilities.event;

  private _onDidChangeFile = new Emitter<readonly IFileChange[]>();
  readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

  // Track active file watchers
  private _watchers = new Map<string, { unwatch: UnwatchFn; refCount: number }>();

  /**
   * Read file contents
   */
  async readFile(resource: URI): Promise<Uint8Array> {
    const path = resource.fsPath;

    try {
      const content = await readFile(path);
      return content;
    } catch (error) {
      // Don't log errors for expected missing files (like .vscode config files)
      if (!this.isExpectedMissingPath(path)) {
        console.error('[TauriFS] Failed to read file:', path, error);
      }
      throw error;
    }
  }

  /**
   * Write file contents
   */
  async writeFile(resource: URI, content: Uint8Array, _opts: IFileWriteOptions): Promise<void> {
    const path = resource.fsPath;

    try {
      await writeFile(path, content);
    } catch (error) {
      console.error('[TauriFS] Failed to write file:', path, error);
      throw error;
    }
  }

  /**
   * Get file/directory stats
   */
  async stat(resource: URI): Promise<IStat> {
    const path = resource.fsPath;

    try {
      const info = await stat(path);
      return {
        type: info.isDirectory ? FileType.Directory : FileType.File,
        ctime: info.mtime?.getTime() ?? Date.now(), // Tauri doesn't provide ctime, use mtime
        mtime: info.mtime?.getTime() ?? Date.now(),
        size: info.size,
      };
    } catch (error) {
      // Don't log errors for expected missing paths (like .vscode, .github config folders)
      if (!this.isExpectedMissingPath(path)) {
        console.error('[TauriFS] Failed to stat:', path, error);
      }
      throw error;
    }
  }

  /**
   * Check if a path is expected to be missing (VS Code config files, etc.)
   */
  private isExpectedMissingPath(path: string): boolean {
    const expectedMissingPatterns = [
      '/.vscode/',
      '/.vscode',
      '/.github/agents',
      '/.github/chatmodes',
      '/extensions.json',
      '/.gitignore',
    ];
    return expectedMissingPatterns.some(pattern => path.includes(pattern));
  }

  /**
   * Read directory contents
   */
  async readdir(resource: URI): Promise<[string, FileType][]> {
    const path = resource.fsPath;
    console.log('[TauriFS] readdir:', path);

    try {
      const entries = await readDir(path);
      const result: [string, FileType][] = [];

      for (const entry of entries) {
        try {
          const entryPath = `${path}/${entry.name}`;
          const info = await stat(entryPath);
          result.push([entry.name, info.isDirectory ? FileType.Directory : FileType.File]);
        } catch {
          // If we can't stat an entry, skip it
          console.warn('[TauriFS] Could not stat entry:', entry.name);
        }
      }

      return result;
    } catch (error) {
      console.error('[TauriFS] Failed to readdir:', path, error);
      throw error;
    }
  }

  /**
   * Create directory
   */
  async mkdir(resource: URI): Promise<void> {
    const path = resource.fsPath;
    console.log('[TauriFS] mkdir:', path);

    try {
      await mkdir(path, { recursive: true });
    } catch (error) {
      console.error('[TauriFS] Failed to mkdir:', path, error);
      throw error;
    }
  }

  /**
   * Delete file or directory
   */
  async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
    const path = resource.fsPath;
    console.log('[TauriFS] delete:', path);

    try {
      await remove(path, { recursive: opts.recursive ?? false });
    } catch (error) {
      console.error('[TauriFS] Failed to delete:', path, error);
      throw error;
    }
  }

  /**
   * Rename/move file or directory
   */
  async rename(from: URI, to: URI, _opts: IFileOverwriteOptions): Promise<void> {
    const fromPath = from.fsPath;
    const toPath = to.fsPath;
    console.log('[TauriFS] rename:', fromPath, '->', toPath);

    try {
      await rename(fromPath, toPath);
    } catch (error) {
      console.error('[TauriFS] Failed to rename:', fromPath, error);
      throw error;
    }
  }

  /**
   * Watch for file changes using Tauri's native file watcher
   */
  watch(resource: URI, opts: IWatchOptions): IDisposable {
    const path = resource.fsPath;
    console.log('[TauriFS] watch:', path, opts);

    // Check if we're already watching this path
    const existing = this._watchers.get(path);
    if (existing) {
      existing.refCount++;
      return {
        dispose: () => {
          existing.refCount--;
          if (existing.refCount <= 0) {
            existing.unwatch();
            this._watchers.delete(path);
            console.log('[TauriFS] Stopped watching:', path);
          }
        },
      };
    }

    // Start watching the path
    let unwatchFn: UnwatchFn | null = null;

    // Watch is async, so we need to handle it properly
    watch(
      path,
      (event: WatchEvent) => {
        this.handleWatchEvent(path, event);
      },
      { recursive: opts.recursive ?? false }
    )
      .then((unwatch) => {
        unwatchFn = unwatch;
        const entry = this._watchers.get(path);
        if (entry) {
          entry.unwatch = unwatch;
        }
        console.log('[TauriFS] Started watching:', path);
      })
      .catch((error) => {
        console.error('[TauriFS] Failed to watch:', path, error);
      });

    // Create a placeholder entry
    this._watchers.set(path, {
      unwatch: () => {
        if (unwatchFn) {
          unwatchFn();
        }
      },
      refCount: 1,
    });

    return {
      dispose: () => {
        const entry = this._watchers.get(path);
        if (entry) {
          entry.refCount--;
          if (entry.refCount <= 0) {
            entry.unwatch();
            this._watchers.delete(path);
            console.log('[TauriFS] Stopped watching:', path);
          }
        }
      },
    };
  }

  /**
   * Handle a watch event from Tauri
   */
  private handleWatchEvent(basePath: string, event: WatchEvent): void {
    // WatchEvent has type and paths properties
    const changes: IFileChange[] = [];

    // Map Tauri event types to VS Code file change types
    // WatchEventKind can be 'any', 'other', or an object like { create: ... }, { modify: ... }, { remove: ... }
    let changeType: FileChangeType;
    const eventType = event.type;

    if (typeof eventType === 'object') {
      if ('create' in eventType) {
        changeType = FileChangeType.ADDED;
      } else if ('modify' in eventType) {
        changeType = FileChangeType.UPDATED;
      } else if ('remove' in eventType) {
        changeType = FileChangeType.DELETED;
      } else {
        // access or other object types
        changeType = FileChangeType.UPDATED;
      }
    } else {
      // 'any' or 'other' string types
      changeType = FileChangeType.UPDATED;
    }

    // Process each affected path
    if (event.paths && Array.isArray(event.paths)) {
      for (const affectedPath of event.paths) {
        changes.push({
          type: changeType,
          resource: URI.file(affectedPath),
        });
      }
    } else {
      // Fallback if paths is not available
      changes.push({
        type: changeType,
        resource: URI.file(basePath),
      });
    }

    // Emit the file changes
    if (changes.length > 0) {
      console.log('[TauriFS] File changes detected:', changes);
      this._onDidChangeFile.fire(changes);
    }
  }

  /**
   * Dispose all watchers
   */
  dispose(): void {
    for (const [path, entry] of this._watchers) {
      try {
        entry.unwatch();
      } catch (error) {
        console.error('[TauriFS] Error disposing watcher for:', path, error);
      }
    }
    this._watchers.clear();
    this._onDidChangeFile.dispose();
    this._onDidChangeCapabilities.dispose();
  }
}

// Global instance
let tauriFileSystem: TauriFileSystemProvider | null = null;
let overlayDisposable: IDisposable | null = null;

/**
 * Initialize the Tauri file system provider
 */
export function initializeTauriFileSystem(): TauriFileSystemProvider {
  if (tauriFileSystem) {
    return tauriFileSystem;
  }

  tauriFileSystem = new TauriFileSystemProvider();

  // Register as overlay for file:// scheme with high priority (10)
  // This ensures our provider is used before the default memory provider
  overlayDisposable = registerFileSystemOverlay(10, tauriFileSystem);

  console.log('[TauriFS] File system provider initialized with priority 10');
  return tauriFileSystem;
}

/**
 * Get the Tauri file system provider instance
 */
export function getTauriFileSystem(): TauriFileSystemProvider | null {
  return tauriFileSystem;
}

/**
 * Dispose the Tauri file system provider
 */
export function disposeTauriFileSystem(): void {
  if (overlayDisposable) {
    overlayDisposable.dispose();
    overlayDisposable = null;
  }
  if (tauriFileSystem) {
    tauriFileSystem.dispose();
    tauriFileSystem = null;
  }
}
