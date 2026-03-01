/**
 * Extension Host Service
 *
 * This service manages the Node.js extension host sidecar process
 * that runs VS Code extensions requiring Node.js runtime.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

// Types for extension host communication
export interface ExtensionHostNotification {
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface ExtensionHostOutput {
  channel: string;
  text: string;
}

export interface ExtensionHostDiagnostics {
  uri: string;
  diagnostics: unknown[];
}

export interface ExtensionHostProvider {
  kind: 'completion' | 'hover' | 'definition' | 'typeDefinition' | 'implementation' | 'references' | 'documentSymbol' | 'codeAction' | 'formatting' | 'signatureHelp';
  id: string;
  selector: unknown;
  triggers?: string[];
}

// Position and Range types
export interface DocumentPosition {
  line: number;
  character: number;
}

export interface DocumentRange {
  start: DocumentPosition;
  end: DocumentPosition;
}

// Provider result types
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
  filterText?: string;
}

export interface HoverResult {
  contents: string[];
  range?: DocumentRange;
}

export interface LocationResult {
  uri: string;
  range: DocumentRange;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: DocumentRange;
  selectionRange: DocumentRange;
  children?: DocumentSymbol[];
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: unknown[];
  isPreferred?: boolean;
  edit?: unknown;
  command?: { command: string; title: string; arguments?: unknown[] };
}

export interface TextEdit {
  range: DocumentRange;
  newText: string;
}

export interface SignatureHelp {
  signatures: Array<{
    label: string;
    documentation?: string;
    parameters?: Array<{ label: string; documentation?: string }>;
  }>;
  activeSignature: number;
  activeParameter: number;
}

export interface ExtensionHostCommand {
  command: string;
}

export interface ExtensionHostResponse {
  success?: boolean;
  error?: string;
  extensions?: string[];
  pong?: boolean;
}

// Event listeners
type NotificationListener = (notification: ExtensionHostNotification) => void;
type OutputListener = (output: ExtensionHostOutput) => void;
type DiagnosticsListener = (diagnostics: ExtensionHostDiagnostics) => void;
type ProviderListener = (provider: ExtensionHostProvider) => void;
type CommandListener = (command: ExtensionHostCommand) => void;
type ReadyListener = () => void;
type ExitListener = () => void;

class ExtensionHostService {
  private isRunning = false;
  private _isReady = false;
  private unlisteners: UnlistenFn[] = [];
  private pendingRequests = new Map<string, {
    resolve: (value: ExtensionHostResponse) => void;
    reject: (error: Error) => void;
  }>();

  // Event listeners
  private notificationListeners: NotificationListener[] = [];
  private outputListeners: OutputListener[] = [];
  private diagnosticsListeners: DiagnosticsListener[] = [];
  private providerListeners: ProviderListener[] = [];
  private commandListeners: CommandListener[] = [];
  private readyListeners: ReadyListener[] = [];
  private exitListeners: ExitListener[] = [];

  /**
   * Start the extension host sidecar
   * Uses the singleton extension host for simplified connection management
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[ExtensionHost] Already running');
      return;
    }

    console.log('[EXTHOST-FE] Starting extension host...');

    // Set up event listeners BEFORE starting (uses Promise.all for parallel setup)
    await this.setupEventListeners();
    console.log('[EXTHOST-FE] setupEventListeners complete');

    // Start the singleton extension host
    // This now blocks until the sidecar sends "ready" message
    const connectionId = await invoke<string>('start_default_extension_host');
    console.log('[EXTHOST-FE] spawn returned connectionId:', connectionId);

    this.isRunning = true;
    this._isReady = true; // spawn() now blocks until ready, so we're immediately ready

    console.log('[ExtensionHost] Sidecar started and ready');
  }

  /**
   * Stop the extension host sidecar
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[ExtensionHost] Stopping sidecar...');

    await invoke('stop_default_extension_host');
    this.isRunning = false;
    this._isReady = false;

    // Clean up event listeners
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];

    console.log('[ExtensionHost] Sidecar stopped');
  }

  /**
   * Check if extension host is ready
   */
  async checkReady(): Promise<boolean> {
    // First check local state, then verify with Rust backend
    if (this._isReady) {
      return true;
    }
    return await invoke<boolean>('is_default_extension_host_ready');
  }

  /**
   * Set workspace folder for the extension host
   */
  async setWorkspaceFolder(path: string): Promise<ExtensionHostResponse> {
    console.log(`[EXTHOST-FE] setWorkspaceFolder: ${path}`);
    await invoke('set_default_extension_host_workspace', { path });
    return { success: true };
  }

  /**
   * Activate an extension
   */
  async activateExtension(extensionPath: string, extensionId: string): Promise<ExtensionHostResponse> {
    console.log(`[EXTHOST-FE] activateExtension: ${extensionId} queued`);
    const result = await invoke<{ success?: boolean; error?: string }>('activate_default_extension', {
      extensionPath,
      extensionId,
    });
    return result as ExtensionHostResponse;
  }

  /**
   * Deactivate an extension
   */
  async deactivateExtension(extensionId: string): Promise<ExtensionHostResponse> {
    console.log(`[ExtensionHost] Deactivating extension: ${extensionId}`);
    const result = await invoke<{ success?: boolean; error?: string }>('deactivate_default_extension', {
      extensionId,
    });
    return result as ExtensionHostResponse;
  }

  /**
   * Execute a command registered by an extension
   */
  async executeCommand(command: string, args: unknown[] = []): Promise<ExtensionHostResponse> {
    const result = await invoke<{ success?: boolean; error?: string }>('execute_default_extension_command', {
      command,
      args,
    });
    return result as ExtensionHostResponse;
  }

  /**
   * Get list of activated extensions
   */
  async getActivatedExtensions(): Promise<string[]> {
    const result = await invoke<{ extensions?: string[] }>('get_default_activated_extensions', {});
    return result.extensions || [];
  }

  // ============================================================================
  // Document Management Methods
  // ============================================================================

  /**
   * Open a document in the extension host
   */
  async openDocument(path: string): Promise<ExtensionHostResponse> {
    return this.sendRequest('extension_host_open_document', { path });
  }

  /**
   * Update document content in the extension host
   */
  async updateDocument(uri: string, content: string): Promise<ExtensionHostResponse> {
    return this.sendRequest('extension_host_update_document', { uri, content });
  }

  /**
   * Close a document in the extension host
   */
  async closeDocument(uri: string): Promise<ExtensionHostResponse> {
    return this.sendRequest('extension_host_close_document', { uri });
  }

  /**
   * Set configuration in the extension host
   */
  async setConfiguration(section: string, values: Record<string, unknown>): Promise<ExtensionHostResponse> {
    return this.sendRequest('set_extension_host_configuration', { section, values });
  }

  // ============================================================================
  // Language Provider Methods
  // ============================================================================

  /**
   * Request completion items from extensions
   */
  async requestCompletion(
    uri: string,
    line: number,
    character: number,
    triggerCharacter?: string
  ): Promise<CompletionItem[]> {
    const response = await this.sendRequest('request_completion', {
      uri,
      line,
      character,
      triggerCharacter,
    });
    return (response as unknown as { items: CompletionItem[] }).items || [];
  }

  /**
   * Request hover information from extensions
   */
  async requestHover(
    uri: string,
    line: number,
    character: number
  ): Promise<HoverResult | null> {
    const response = await this.sendRequest('request_hover', {
      uri,
      line,
      character,
    });
    const items = (response as unknown as { items: HoverResult[] }).items;
    return items[0] || null;
  }

  /**
   * Request definition location from extensions
   */
  async requestDefinition(
    uri: string,
    line: number,
    character: number
  ): Promise<LocationResult[]> {
    const response = await this.sendRequest('request_definition', {
      uri,
      line,
      character,
    });
    return (response as unknown as { items: LocationResult[] }).items || [];
  }

  /**
   * Request type definition location from extensions
   */
  async requestTypeDefinition(
    uri: string,
    line: number,
    character: number
  ): Promise<LocationResult[]> {
    const response = await this.sendRequest('request_type_definition', {
      uri,
      line,
      character,
    });
    return (response as unknown as { items: LocationResult[] }).items || [];
  }

  /**
   * Request references from extensions
   */
  async requestReferences(
    uri: string,
    line: number,
    character: number,
    includeDeclaration = true
  ): Promise<LocationResult[]> {
    const response = await this.sendRequest('request_references', {
      uri,
      line,
      character,
      includeDeclaration,
    });
    return (response as unknown as { items: LocationResult[] }).items || [];
  }

  /**
   * Request document symbols from extensions
   */
  async requestDocumentSymbols(uri: string): Promise<DocumentSymbol[]> {
    const response = await this.sendRequest('request_document_symbols', { uri });
    return (response as unknown as { items: DocumentSymbol[] }).items || [];
  }

  /**
   * Request code actions from extensions
   */
  async requestCodeActions(
    uri: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    only?: string[]
  ): Promise<CodeAction[]> {
    const response = await this.sendRequest('request_code_actions', {
      uri,
      startLine,
      startCharacter,
      endLine,
      endCharacter,
      only,
    });
    return (response as unknown as { items: CodeAction[] }).items || [];
  }

  /**
   * Request formatting edits from extensions
   */
  async requestFormatting(
    uri: string,
    tabSize?: number,
    insertSpaces?: boolean
  ): Promise<TextEdit[]> {
    const response = await this.sendRequest('request_formatting', {
      uri,
      tabSize,
      insertSpaces,
    });
    return (response as unknown as { items: TextEdit[] }).items || [];
  }

  /**
   * Request signature help from extensions
   */
  async requestSignatureHelp(
    uri: string,
    line: number,
    character: number
  ): Promise<SignatureHelp | null> {
    const response = await this.sendRequest('request_signature_help', {
      uri,
      line,
      character,
    });
    const items = (response as unknown as { items: SignatureHelp[] }).items;
    return items[0] || null;
  }

  // Event subscription methods
  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.push(listener);
    return () => {
      const index = this.notificationListeners.indexOf(listener);
      if (index >= 0) this.notificationListeners.splice(index, 1);
    };
  }

  onOutput(listener: OutputListener): () => void {
    this.outputListeners.push(listener);
    return () => {
      const index = this.outputListeners.indexOf(listener);
      if (index >= 0) this.outputListeners.splice(index, 1);
    };
  }

  onDiagnostics(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.push(listener);
    return () => {
      const index = this.diagnosticsListeners.indexOf(listener);
      if (index >= 0) this.diagnosticsListeners.splice(index, 1);
    };
  }

  onProviderRegistered(listener: ProviderListener): () => void {
    this.providerListeners.push(listener);
    return () => {
      const index = this.providerListeners.indexOf(listener);
      if (index >= 0) this.providerListeners.splice(index, 1);
    };
  }

  onCommandRegistered(listener: CommandListener): () => void {
    this.commandListeners.push(listener);
    return () => {
      const index = this.commandListeners.indexOf(listener);
      if (index >= 0) this.commandListeners.splice(index, 1);
    };
  }

  onReady(listener: ReadyListener): () => void {
    this.readyListeners.push(listener);
    return () => {
      const index = this.readyListeners.indexOf(listener);
      if (index >= 0) this.readyListeners.splice(index, 1);
    };
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.push(listener);
    return () => {
      const index = this.exitListeners.indexOf(listener);
      if (index >= 0) this.exitListeners.splice(index, 1);
    };
  }

  /**
   * Setup event listeners for sidecar events
   * Uses Promise.all for parallel listener registration to avoid race conditions
   * where the sidecar might emit events before all listeners are set up
   */
  private async setupEventListeners(): Promise<void> {
    // Register all event listeners in parallel
    const [
      unlistenReady,
      unlistenExit,
      unlistenNotification,
      unlistenOutput,
      unlistenDiagnostics,
      unlistenProvider,
      unlistenCommand,
    ] = await Promise.all([
      // Ready event
      listen('extension-host-ready', () => {
        console.log('[ExtensionHost] Sidecar ready event received');
        this._isReady = true;
        this.readyListeners.forEach(l => l());
      }),

      // Exit event
      listen('extension-host-exit', () => {
        console.log('[ExtensionHost] Sidecar exited');
        this.isRunning = false;
        this._isReady = false;
        this.exitListeners.forEach(l => l());
      }),

      // Notification events
      listen<ExtensionHostNotification>(
        'extension-host-notification',
        (event) => {
          this.notificationListeners.forEach(l => l(event.payload));
        }
      ),

      // Output events
      listen<ExtensionHostOutput>(
        'extension-host-output',
        (event) => {
          this.outputListeners.forEach(l => l(event.payload));
        }
      ),

      // Diagnostics events
      listen<ExtensionHostDiagnostics>(
        'extension-host-diagnostics',
        (event) => {
          this.diagnosticsListeners.forEach(l => l(event.payload));
        }
      ),

      // Provider registration events
      listen<ExtensionHostProvider>(
        'extension-host-register-provider',
        (event) => {
          this.providerListeners.forEach(l => l(event.payload));
        }
      ),

      // Command registration events
      listen<ExtensionHostCommand>(
        'extension-host-register-command',
        (event) => {
          this.commandListeners.forEach(l => l(event.payload));
        }
      ),
    ]);

    this.unlisteners = [
      unlistenReady,
      unlistenExit,
      unlistenNotification,
      unlistenOutput,
      unlistenDiagnostics,
      unlistenProvider,
      unlistenCommand,
    ];
  }

  /**
   * Send a request to the extension host and wait for response
   */
  private async sendRequest(
    command: string,
    args: Record<string, unknown>
  ): Promise<ExtensionHostResponse> {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      // Set up response listener
      const unlistenPromise = listen<ExtensionHostResponse>(
        `extension-host-response-${requestId}`,
        (event) => {
          // Clean up
          unlistenPromise.then(unlisten => unlisten());
          this.pendingRequests.delete(requestId);

          if (event.payload.error) {
            reject(new Error(event.payload.error));
          } else {
            resolve(event.payload);
          }
        }
      );

      // Store pending request
      this.pendingRequests.set(requestId, { resolve, reject });

      // Send the request
      invoke(command, { requestId, ...args }).catch((error) => {
        unlistenPromise.then(unlisten => unlisten());
        this.pendingRequests.delete(requestId);
        reject(error);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          unlistenPromise.then(unlisten => unlisten());
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timed out'));
        }
      }, 30000);
    });
  }
}

// Export singleton instance
export const extensionHostService = new ExtensionHostService();
