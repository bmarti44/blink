/**
 * Extension Host Worker Entry Point
 *
 * This file is bundled by webpack as a web worker.
 * It imports the VS Code extension host worker main module which sets up
 * the extension host message handling.
 */

// Import the extension host worker main module
// The package.json exports field maps ./vscode/* to ./vscode/src/*.js
import '@codingame/monaco-vscode-api/vscode/vs/workbench/api/worker/extensionHostWorkerMain';
