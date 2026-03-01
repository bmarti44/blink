/**
 * Default Extensions
 *
 * Registers default VS Code extensions that provide syntax highlighting
 * and language features via the monaco-vscode-api.
 *
 * The theme-defaults extension is imported in initialize.ts to ensure
 * it loads before service initialization.
 */

/**
 * Register default extensions
 * Called during VS Code service initialization
 */
export async function registerDefaultExtensions(): Promise<void> {
  console.log('[DefaultExtensions] Default VS Code themes loaded');
  // The theme-defaults-default-extension is imported in initialize.ts
  // Additional extensions can be imported here as needed
}

/**
 * List of recommended extension packages for enhanced language support
 * These can be installed from Open VSX
 */
export const RECOMMENDED_EXTENSIONS = [
  // Language support
  'vscode.typescript-language-features',
  'vscode.javascript',
  'vscode.json-language-features',
  'vscode.html-language-features',
  'vscode.css-language-features',
  'vscode.markdown-language-features',
  // Themes
  'vscode.theme-defaults',
  'vscode.theme-monokai',
  'vscode.theme-solarized-dark',
];
