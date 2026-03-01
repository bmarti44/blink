/**
 * Tauri Update Service
 *
 * Bridges the Tauri updater plugin with VS Code's Update Service interface.
 * This allows the VS Code update UI (activity bar badge, notifications, etc.)
 * to work with Tauri's native update mechanism.
 *
 * - Tauri Updater Plugin: Handles the actual update check/download/install
 * - VS Code Update Service: Provides the UI for showing update status
 *
 * The update server should return JSON in Tauri's expected format:
 * {
 *   "version": "1.0.0",
 *   "notes": "Release notes here",
 *   "pub_date": "2024-01-01T00:00:00Z",
 *   "platforms": {
 *     "darwin-x86_64": { "url": "...", "signature": "..." },
 *     "darwin-aarch64": { "url": "...", "signature": "..." },
 *     "windows-x86_64": { "url": "...", "signature": "..." }
 *   }
 * }
 */

import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { State, UpdateType } from '@codingame/monaco-vscode-api/vscode/vs/platform/update/common/update';
import type { IUpdateService } from '@codingame/monaco-vscode-api/vscode/vs/platform/update/common/update.service';

// Tauri updater types
interface TauriUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  download: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

/**
 * Update service that uses Tauri's updater plugin
 */
export class TauriUpdateService extends Disposable implements IUpdateService {
  declare readonly _serviceBrand: undefined;

  private _state: State = State.Idle(UpdateType.Archive);
  private _pendingUpdate: TauriUpdate | null = null;
  private _tauriAvailable: boolean | null = null;

  private readonly _onStateChange = this._register(new Emitter<State>());
  readonly onStateChange: Event<State> = this._onStateChange.event;

  get state(): State {
    return this._state;
  }

  constructor() {
    super();
    console.log('[TauriUpdateService] Service instantiated');
    // Start in idle state
    this._state = State.Idle(UpdateType.Archive);

    // Automatic update checking is disabled until a real update server is available.
    // The update check can still be triggered manually via the VS Code command palette.
    // When an update server is available, uncomment this code:
    //
    // setTimeout(() => {
    //   if (this.isTauriAvailable()) {
    //     this.checkForUpdates(false).catch(() => {});
    //   }
    // }, 5000);
  }

  /**
   * Check if we're running in Tauri (vs web browser)
   */
  private isTauriAvailable(): boolean {
    if (this._tauriAvailable !== null) {
      return this._tauriAvailable;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._tauriAvailable = typeof (window as any).__TAURI__ !== 'undefined';
    return this._tauriAvailable;
  }

  private setState(state: State): void {
    this._state = state;
    if (state.type !== 'idle') {
      this._onStateChange.fire(state);
    }
  }

  async checkForUpdates(explicit: boolean): Promise<void> {
    // Only check for updates if running in Tauri
    if (!this.isTauriAvailable()) {
      console.debug('[TauriUpdateService] Skipping update check - not running in Tauri');
      return;
    }

    try {
      // Dynamic import to handle cases where Tauri isn't available (e.g., web preview)
      const { check } = await import('@tauri-apps/plugin-updater');

      // Only notify "checking" state for explicit user-triggered checks
      // Automatic checks should be silent to avoid UI churn
      if (explicit) {
        this.setState(State.CheckingForUpdates(explicit));
      }

      const update = await check();

      if (update) {
        this._pendingUpdate = update as TauriUpdate;
        // Update is available - report as Ready state
        this.setState(
          State.Ready({
            version: update.version,
            productVersion: update.version,
          })
        );
        console.log('[TauriUpdateService] Update available:', update.version);
      } else {
        // No update available
        this._pendingUpdate = null;
        this.setState(State.Idle(UpdateType.Archive));
        console.log('[TauriUpdateService] App is up to date');
      }
    } catch (error) {
      console.debug('[TauriUpdateService] Update check failed:', error);
      // Don't report errors for automatic checks - just stay in idle
      // This prevents error notifications when running in dev mode or without network
      this._pendingUpdate = null;
      // Only fire state change if we're not already idle (avoid unnecessary notifications)
      if (this._state.type !== 'idle') {
        this.setState(State.Idle(UpdateType.Archive));
      }
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this._pendingUpdate) {
      console.warn('[TauriUpdateService] No pending update to download');
      return;
    }

    try {
      this.setState(State.Downloading);
      await this._pendingUpdate.download();
      this.setState(
        State.Downloaded({
          version: this._pendingUpdate.version,
          productVersion: this._pendingUpdate.version,
        })
      );
      console.log('[TauriUpdateService] Update downloaded');
    } catch (error) {
      console.error('[TauriUpdateService] Download failed:', error);
      this.setState(State.Idle(UpdateType.Archive));
    }
  }

  async applyUpdate(): Promise<void> {
    if (!this._pendingUpdate) {
      console.warn('[TauriUpdateService] No pending update to apply');
      return;
    }

    try {
      this.setState(
        State.Updating({
          version: this._pendingUpdate.version,
          productVersion: this._pendingUpdate.version,
        })
      );
      // downloadAndInstall will download if not already downloaded, then install
      await this._pendingUpdate.downloadAndInstall();
      // If we get here, the app should restart automatically
      // But in case it doesn't, we'll stay in updating state
    } catch (error) {
      console.error('[TauriUpdateService] Apply update failed:', error);
      this.setState(State.Idle(UpdateType.Archive));
    }
  }

  async quitAndInstall(): Promise<void> {
    // In Tauri, downloadAndInstall handles the restart
    await this.applyUpdate();
  }

  async isLatestVersion(): Promise<boolean | undefined> {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      return !update; // No update means we're on latest
    } catch {
      return undefined; // Unknown
    }
  }

  async _applySpecificUpdate(_packagePath: string): Promise<void> {
    // Not used in Tauri - updates come from the configured endpoint
  }
}
