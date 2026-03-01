#!/usr/bin/env node
/**
 * VS Code Extension Host Sidecar
 *
 * This Node.js script runs as a sidecar process and hosts VS Code extensions.
 * It communicates with the Tauri webview via stdin/stdout using JSON-RPC protocol.
 *
 * Protocol:
 * - Input: JSON-RPC messages on stdin
 * - Output: JSON-RPC messages on stdout
 * - Supports extension activation, deactivation, and API calls
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const Module = require('module');

// Extension host state
const state = {
  extensions: new Map(),
  activatedExtensions: new Map(),
  extensionContext: null,
  workspaceFolder: null,
};

// Activation stack for tracking which extension is currently being loaded
// This replaces the single currentExtensionId to handle concurrent activations
const activationStack = [];

// Cache of vscode API instances per extension
const extensionAPIs = new Map();

// Activation queue for serializing extension activations
const activationQueue = [];
let isActivating = false;

// Event emitter for extension events
const extensionEvents = new EventEmitter();

// Store the original require
const originalRequire = Module.prototype.require;

/**
 * Get or create a cached vscode API instance for an extension
 */
function getOrCreateVSCodeAPI(extensionId) {
  if (!extensionAPIs.has(extensionId)) {
    extensionAPIs.set(extensionId, createVSCodeAPI(extensionId));
  }
  return extensionAPIs.get(extensionId);
}

/**
 * Find extension ID from file path by checking which extension's directory contains this file
 */
function findExtensionIdByPath(filePath) {
  for (const [extId, info] of state.activatedExtensions) {
    if (filePath.startsWith(info.extensionPath)) {
      return extId;
    }
  }
  return null;
}

// Override require at startup to intercept 'vscode' imports
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    let extensionId = null;
    let lookupMethod = 'unknown';

    // Method 1: Check activation stack (for code running during activation)
    if (activationStack.length > 0) {
      extensionId = activationStack[activationStack.length - 1];
      lookupMethod = 'stack';
    }

    // Method 2: Match by file path (for code running after activation)
    if (!extensionId && this.filename) {
      extensionId = findExtensionIdByPath(this.filename);
      if (extensionId) {
        lookupMethod = 'path';
      }
    }

    // Fallback to 'unknown' if no extension found
    if (!extensionId) {
      extensionId = 'unknown';
      lookupMethod = 'fallback';
    }

    console.error(`[SIDECAR] require("vscode") for: ${extensionId} via: ${lookupMethod}`);
    return getOrCreateVSCodeAPI(extensionId);
  }
  return originalRequire.apply(this, arguments);
};

console.error('[ExtensionHost] Require override installed at startup with activation stack support');

// Mock VS Code API for extensions
function createVSCodeAPI(extensionId) {
  const subscriptions = [];

  return {
    // Workspace API
    workspace: {
      workspaceFolders: state.workspaceFolder
        ? [
            {
              uri: { fsPath: state.workspaceFolder, scheme: 'file' },
              name: path.basename(state.workspaceFolder),
              index: 0,
            },
          ]
        : undefined,
      getWorkspaceFolder: (uri) => {
        if (state.workspaceFolder) {
          return {
            uri: { fsPath: state.workspaceFolder, scheme: 'file' },
            name: path.basename(state.workspaceFolder),
            index: 0,
          };
        }
        return undefined;
      },
      fs: {
        readFile: async (uri) => {
          const content = await fs.promises.readFile(uri.fsPath);
          return content;
        },
        writeFile: async (uri, content) => {
          await fs.promises.writeFile(uri.fsPath, content);
        },
        stat: async (uri) => {
          const stat = await fs.promises.stat(uri.fsPath);
          return {
            type: stat.isDirectory() ? 2 : 1, // FileType.Directory : FileType.File
            ctime: stat.ctimeMs,
            mtime: stat.mtimeMs,
            size: stat.size,
          };
        },
        readDirectory: async (uri) => {
          const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
          return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
        },
      },
      openTextDocument: async (uri) => {
        const content = await fs.promises.readFile(typeof uri === 'string' ? uri : uri.fsPath, 'utf8');
        return {
          uri: typeof uri === 'string' ? { fsPath: uri, scheme: 'file' } : uri,
          getText: () => content,
          lineCount: content.split('\n').length,
          lineAt: (line) => ({ text: content.split('\n')[line] || '' }),
        };
      },
      onDidChangeConfiguration: (listener) => {
        extensionEvents.on('configurationChanged', listener);
        return { dispose: () => extensionEvents.off('configurationChanged', listener) };
      },
      getConfiguration: (section) => ({
        get: (key, defaultValue) => defaultValue,
        has: (key) => false,
        update: async () => {},
        inspect: () => undefined,
      }),
      createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose: () => {} }),
        onDidChange: () => ({ dispose: () => {} }),
        onDidDelete: () => ({ dispose: () => {} }),
        dispose: () => {},
      }),
    },

    // Window API
    window: {
      showInformationMessage: async (message, ...items) => {
        sendMessage({ type: 'notification', level: 'info', message });
        return items[0];
      },
      showWarningMessage: async (message, ...items) => {
        sendMessage({ type: 'notification', level: 'warning', message });
        return items[0];
      },
      showErrorMessage: async (message, ...items) => {
        sendMessage({ type: 'notification', level: 'error', message });
        return items[0];
      },
      createOutputChannel: (name) => ({
        name,
        append: (text) => sendMessage({ type: 'output', channel: name, text }),
        appendLine: (text) => sendMessage({ type: 'output', channel: name, text: `${text}\n` }),
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      }),
      createDiagnosticCollection: (name) => {
        const diagnostics = new Map();
        return {
          name,
          set: (uri, diags) => {
            diagnostics.set(uri.toString(), diags);
            sendMessage({ type: 'diagnostics', uri: uri.toString(), diagnostics: diags });
          },
          delete: (uri) => diagnostics.delete(uri.toString()),
          clear: () => diagnostics.clear(),
          forEach: (callback) => diagnostics.forEach(callback),
          get: (uri) => diagnostics.get(uri.toString()),
          has: (uri) => diagnostics.has(uri.toString()),
          dispose: () => diagnostics.clear(),
        };
      },
      activeTextEditor: undefined,
      visibleTextEditors: [],
      onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
      onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
    },

    // Languages API
    languages: {
      registerCompletionItemProvider: (selector, provider, ...triggers) => {
        sendMessage({ type: 'registerProvider', kind: 'completion', selector, triggers });
        return { dispose: () => {} };
      },
      registerHoverProvider: (selector, provider) => {
        sendMessage({ type: 'registerProvider', kind: 'hover', selector });
        return { dispose: () => {} };
      },
      registerDefinitionProvider: (selector, provider) => {
        sendMessage({ type: 'registerProvider', kind: 'definition', selector });
        return { dispose: () => {} };
      },
      registerCodeActionsProvider: (selector, provider) => {
        sendMessage({ type: 'registerProvider', kind: 'codeActions', selector });
        return { dispose: () => {} };
      },
      registerDocumentFormattingEditProvider: (selector, provider) => {
        sendMessage({ type: 'registerProvider', kind: 'formatting', selector });
        return { dispose: () => {} };
      },
      createDiagnosticCollection: (name) => ({
        name,
        set: () => {},
        delete: () => {},
        clear: () => {},
        dispose: () => {},
      }),
      getDiagnostics: () => [],
    },

    // Commands API
    commands: {
      registerCommand: (command, callback) => {
        sendMessage({ type: 'registerCommand', command });
        extensionEvents.on(`command:${command}`, callback);
        return { dispose: () => extensionEvents.off(`command:${command}`, callback) };
      },
      executeCommand: async (command, ...args) => {
        sendMessage({ type: 'executeCommand', command, args });
      },
      getCommands: async () => [],
    },

    // Extensions API
    extensions: {
      getExtension: (id) => state.activatedExtensions.get(id),
      all: Array.from(state.activatedExtensions.values()),
    },

    // URI API
    Uri: {
      file: (p) => ({ fsPath: p, scheme: 'file', path: p }),
      parse: (str) => {
        const url = new URL(str);
        return { fsPath: url.pathname, scheme: url.protocol.replace(':', ''), path: url.pathname };
      },
      joinPath: (base, ...pathSegments) => ({
        fsPath: path.join(base.fsPath, ...pathSegments),
        scheme: base.scheme,
        path: path.join(base.path, ...pathSegments),
      }),
    },

    // Diagnostic severity
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },

    // Range and Position
    Range: class Range {
      constructor(startLine, startChar, endLine, endChar) {
        this.start = { line: startLine, character: startChar };
        this.end = { line: endLine, character: endChar };
      }
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },

    // Disposable
    Disposable: class Disposable {
      constructor(callOnDispose) {
        this.callOnDispose = callOnDispose;
      }
      dispose() {
        if (this.callOnDispose) this.callOnDispose();
      }
    },

    // Extension context
    ExtensionContext: class ExtensionContext {
      constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.subscriptions = subscriptions;
        this.globalState = {
          get: () => undefined,
          update: async () => {},
          keys: () => [],
        };
        this.workspaceState = {
          get: () => undefined,
          update: async () => {},
          keys: () => [],
        };
        this.storagePath = path.join(extensionPath, '.storage');
        this.globalStoragePath = path.join(extensionPath, '.global-storage');
        this.logPath = path.join(extensionPath, '.logs');
      }
      asAbsolutePath(relativePath) {
        return path.join(this.extensionPath, relativePath);
      }
    },
  };
}

// Send message to webview
function sendMessage(message) {
  console.log(JSON.stringify(message));
}

// Log to stderr (doesn't interfere with stdout protocol)
function log(...args) {
  console.error('[ExtensionHost]', ...args);
}

/**
 * Queue an extension activation and process serially
 * This prevents race conditions when multiple extensions are activated concurrently
 */
async function queueActivation(extensionPath, extensionId) {
  console.error(`[SIDECAR] Activation queued: ${extensionId} (queue depth: ${activationQueue.length})`);

  return new Promise((resolve, reject) => {
    activationQueue.push({ extensionPath, extensionId, resolve, reject });
    processActivationQueue();
  });
}

/**
 * Process the activation queue one at a time
 */
async function processActivationQueue() {
  if (isActivating || activationQueue.length === 0) {
    return;
  }

  isActivating = true;
  const { extensionPath, extensionId, resolve, reject } = activationQueue.shift();

  try {
    const result = await activateExtensionInternal(extensionPath, extensionId);
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    isActivating = false;
    // Process next in queue after a microtask to avoid stack overflow
    setImmediate(processActivationQueue);
  }
}

/**
 * Internal extension activation (called from queue processor)
 */
async function activateExtensionInternal(extensionPath, extensionId) {
  console.error(`[SIDECAR] Activating: ${extensionId}`);

  try {
    log(`Activating extension: ${extensionId} from ${extensionPath}`);

    // Read package.json
    const packageJsonPath = path.join(extensionPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`Extension package.json not found: ${packageJsonPath}`);
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const mainPath = packageJson.main ? path.join(extensionPath, packageJson.main) : null;

    if (!mainPath || !fs.existsSync(mainPath)) {
      log(`Extension ${extensionId} has no main entry point`);
      return { success: true, message: 'No main entry point' };
    }

    // Store extension info BEFORE require so path lookup works
    state.activatedExtensions.set(extensionId, {
      id: extensionId,
      extensionPath,
      packageJSON: packageJson,
      exports: null, // Will be set after load
      isActive: false,
    });

    // Push onto activation stack before require
    activationStack.push(extensionId);

    try {
      // Create VS Code API for this extension
      const vscode = getOrCreateVSCodeAPI(extensionId);

      // Create extension context
      const context = new vscode.ExtensionContext(extensionPath);

      // Clear module cache for this extension to ensure fresh load
      delete require.cache[require.resolve(mainPath)];

      // Load the extension
      const extension = require(mainPath);

      // Activate if it has an activate function
      if (typeof extension.activate === 'function') {
        await extension.activate(context);
        log(`Extension ${extensionId} activated successfully`);
      }

      // Update extension info with exports
      state.activatedExtensions.set(extensionId, {
        id: extensionId,
        extensionPath,
        packageJSON: packageJson,
        exports: extension,
        isActive: true,
      });

      console.error(`[SIDECAR] Activation complete: ${extensionId}`);
      return { success: true };
    } finally {
      // Always pop from activation stack
      activationStack.pop();
    }
  } catch (error) {
    log(`Failed to activate extension ${extensionId}:`, error.message);
    console.error(`[SIDECAR] Activation failed: ${extensionId} - ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Load and activate an extension (public API - uses queue)
async function activateExtension(extensionPath, extensionId) {
  return queueActivation(extensionPath, extensionId);
}

// Deactivate an extension
async function deactivateExtension(extensionId) {
  const extension = state.activatedExtensions.get(extensionId);
  if (!extension) {
    return { success: false, error: 'Extension not found' };
  }

  try {
    if (typeof extension.exports.deactivate === 'function') {
      await extension.exports.deactivate();
    }
    state.activatedExtensions.delete(extensionId);
    log(`Extension ${extensionId} deactivated`);
    return { success: true };
  } catch (error) {
    log(`Failed to deactivate extension ${extensionId}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Handle incoming messages
async function handleMessage(message) {
  const { id, type, ...data } = message;

  try {
    let result;

    switch (type) {
      case 'ping':
        result = { pong: true };
        break;

      case 'setWorkspaceFolder':
        state.workspaceFolder = data.path;
        log(`Workspace folder set to: ${data.path}`);
        result = { success: true };
        break;

      case 'activateExtension':
        result = await activateExtension(data.extensionPath, data.extensionId);
        break;

      case 'deactivateExtension':
        result = await deactivateExtension(data.extensionId);
        break;

      case 'executeCommand':
        extensionEvents.emit(`command:${data.command}`, ...data.args);
        result = { success: true };
        break;

      case 'getActivatedExtensions':
        result = {
          extensions: Array.from(state.activatedExtensions.keys()),
        };
        break;

      default:
        result = { error: `Unknown message type: ${type}` };
    }

    sendMessage({ id, type: 'response', ...result });
  } catch (error) {
    sendMessage({ id, type: 'response', error: error.message });
  }
}

// Main entry point
function main() {
  log('Extension Host Sidecar starting...');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      await handleMessage(message);
    } catch (error) {
      log('Failed to parse message:', error.message);
    }
  });

  rl.on('close', () => {
    log('Extension Host Sidecar shutting down...');
    process.exit(0);
  });

  // Send ready message
  sendMessage({ type: 'ready' });
  log('Extension Host Sidecar ready');
}

main();
