import { invoke } from '@tauri-apps/api/core';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import {
  SimpleEditorPane,
  SimpleEditorInput,
  registerEditorPane,
  registerEditor,
  RegisteredEditorPriority,
} from '@codingame/monaco-vscode-views-service-override';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';

// DOCX Editor Input - represents a DOCX file in the editor
class DocxEditorInput extends SimpleEditorInput {
  static readonly ID = 'blink.docxEditorInput';
  private _path: string;

  constructor(resource: URI) {
    super(resource);
    this._path = resource.fsPath || resource.path;
    this.setName(resource.path.split('/').pop() || 'Document');
    this.setTitle(this._path);
    this.setDescription('Word Document');
  }

  override get typeId(): string {
    return DocxEditorInput.ID;
  }

  get path(): string {
    return this._path;
  }
}

// DOCX Editor Pane - renders the DOCX content
class DocxEditorPane extends SimpleEditorPane {
  static readonly ID = 'blink.docxEditorPane';
  private docContainer: HTMLDivElement | null = null;
  private currentPath: string | null = null;

  override initialize(): HTMLElement {
    this.docContainer = document.createElement('div');
    this.docContainer.className = 'docx-editor-pane';
    this.docContainer.style.cssText = `
      background: #2d2d2d;
      min-height: 100%;
      padding: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    `;

    // Add Word-like document styles
    const style = document.createElement('style');
    style.textContent = `
      .docx-editor-pane .docx-toolbar {
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid #404040;
        background: #333;
        flex-shrink: 0;
      }
      .docx-editor-pane .docx-toolbar button {
        background: #0e639c;
        color: #fff;
        border: 0;
        border-radius: 3px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 12px;
      }
      .docx-editor-pane .docx-toolbar button:hover {
        background: #1177bb;
      }
      .docx-editor-pane .docx-page-container {
        flex: 1;
        display: flex;
        justify-content: center;
        padding: 24px;
        background: #525252;
        overflow: auto;
      }
      .docx-editor-pane .docx-page {
        background: #fff;
        color: #000;
        width: 8.5in;
        min-height: 11in;
        padding: 1in;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
        font-size: 11pt;
        line-height: 1.5;
      }
      .docx-editor-pane .word-document {
        /* Document content styles */
      }
      .docx-editor-pane .word-document h1 {
        font-size: 26pt;
        font-weight: bold;
        color: #2e74b5;
        margin: 0 0 12pt 0;
        line-height: 1.2;
      }
      .docx-editor-pane .word-document h2 {
        font-size: 18pt;
        font-weight: bold;
        color: #2e74b5;
        margin: 12pt 0 6pt 0;
        line-height: 1.2;
      }
      .docx-editor-pane .word-document h3 {
        font-size: 14pt;
        font-weight: bold;
        color: #2e74b5;
        margin: 12pt 0 6pt 0;
        line-height: 1.2;
      }
      .docx-editor-pane .word-document h4 {
        font-size: 12pt;
        font-weight: bold;
        font-style: italic;
        color: #2e74b5;
        margin: 12pt 0 6pt 0;
      }
      .docx-editor-pane .word-document p {
        margin: 0 0 8pt 0;
        text-align: justify;
      }
      .docx-editor-pane .word-table {
        border-collapse: collapse;
        width: 100%;
        margin: 12pt 0;
      }
      .docx-editor-pane .word-table td,
      .docx-editor-pane .word-table th {
        border: 1px solid #bfbfbf;
        padding: 6pt 8pt;
        text-align: left;
      }
      .docx-editor-pane .word-table tr:first-child td,
      .docx-editor-pane .word-table th {
        background: #4472c4;
        color: #fff;
        font-weight: bold;
      }
      .docx-editor-pane .word-table tr:nth-child(even) td {
        background: #d9e2f3;
      }
    `;
    this.docContainer.appendChild(style);

    // Add toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'docx-toolbar';

    const insertParaBtn = document.createElement('button');
    insertParaBtn.textContent = 'Insert Paragraph';
    insertParaBtn.onclick = () => this.insertParagraph();

    const insertHeadingBtn = document.createElement('button');
    insertHeadingBtn.textContent = 'Insert Heading';
    insertHeadingBtn.onclick = () => this.insertHeading();

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.onclick = () => this.refresh();

    toolbar.appendChild(insertParaBtn);
    toolbar.appendChild(insertHeadingBtn);
    toolbar.appendChild(refreshBtn);

    // Add page container (gray background like Word)
    const pageContainer = document.createElement('div');
    pageContainer.className = 'docx-page-container';

    // Add the "page" (white paper-like area)
    const page = document.createElement('div');
    page.className = 'docx-page';
    page.id = 'docx-content';

    pageContainer.appendChild(page);
    this.docContainer.appendChild(toolbar);
    this.docContainer.appendChild(pageContainer);

    return this.docContainer;
  }

  override async renderInput(input: any): Promise<IDisposable> {
    if (input instanceof DocxEditorInput) {
      this.currentPath = input.path;
      await this.loadContent();
    }
    return { dispose: () => {} };
  }

  private async loadContent() {
    if (!this.currentPath || !this.docContainer) return;

    const contentEl = this.docContainer.querySelector('#docx-content');
    if (!contentEl) return;

    try {
      const html = await invoke<string>('render_document_html', { path: this.currentPath });
      contentEl.innerHTML = html;

      // Store for testing
      (window as any).__DOCX_LAST_RENDER_TEXT__ = (contentEl.textContent || '').slice(0, 200);
      (window as any).__DOCX_LAST_RENDER_LENGTH__ = html.length;
      (window as any).__DOCX_WEBVIEW_INNER_TEXT__ = contentEl.textContent || '';

      console.log('[DocxPane] Rendered content, length:', html.length);
    } catch (e) {
      contentEl.innerHTML = `<pre style="color:#f44">${String(e)}</pre>`;
      console.error('[DocxPane] Render error:', e);
    }
  }

  private async insertParagraph() {
    if (!this.currentPath) return;
    try {
      await invoke('apply_document_edits', {
        path: this.currentPath,
        edits: [{ type: 'InsertParagraph', text: 'New paragraph', position: 'End', style: null }],
      });
      await this.loadContent();
    } catch (e) {
      console.error('[DocxPane] Insert paragraph error:', e);
    }
  }

  private async insertHeading() {
    if (!this.currentPath) return;
    try {
      await invoke('apply_document_edits', {
        path: this.currentPath,
        edits: [{ type: 'InsertHeading', text: 'Heading', level: 2, position: 'End' }],
      });
      await this.loadContent();
    } catch (e) {
      console.error('[DocxPane] Insert heading error:', e);
    }
  }

  private async refresh() {
    await this.loadContent();
  }
}

// Keep track of registration disposables
let registrationDisposables: IDisposable[] = [];

export async function openDocxForTest(path: string): Promise<boolean> {
  console.log('[DocxResolver] openDocxForTest:', path);
  (window as any).__DOCX_WEBVIEW_OPEN__ = true;
  (window as any).__DOCX_OPEN_REQUESTED_PATH__ = path;

  // The editor will open automatically through the registered editor resolver
  // For testing, we can manually trigger it
  try {
    const { getService } = await import('@codingame/monaco-vscode-api/services');
    const { IEditorService } = await import(
      '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service'
    );
    const editorSvc: any = await getService(IEditorService as any);
    const uri = URI.file(path);
    await editorSvc.openEditor({ resource: uri });
    return true;
  } catch (e) {
    console.error('[DocxResolver] openDocxForTest error:', e);
    return false;
  }
}

export async function registerDocxResolver(): Promise<void> {
  try {
    console.log('[DocxResolver] Registering DOCX editor...');

    // Register the editor pane
    const paneDisposable = registerEditorPane(
      DocxEditorPane.ID,
      'Word Document Editor',
      DocxEditorPane as any,
      [DocxEditorInput]
    );
    registrationDisposables.push(paneDisposable);

    // Register the editor for .docx and .doc files
    const editorDisposable = registerEditor(
      '**/*.{docx,doc}',
      {
        id: DocxEditorPane.ID,
        label: 'Word Document Editor',
        priority: RegisteredEditorPriority.default,
      },
      {},
      {
        createEditorInput: (editorInput: any) => {
          const resource = editorInput.resource;
          console.log('[DocxResolver] Creating DocxEditorInput for:', resource?.path);
          return {
            editor: new DocxEditorInput(resource),
          };
        },
      }
    );
    registrationDisposables.push(editorDisposable);

    // Expose test function globally
    (window as any).__OPEN_DOCX_FOR_TEST__ = openDocxForTest;

    console.log('[DocxResolver] DOCX editor registered successfully');
  } catch (e) {
    console.error('[DocxResolver] Registration error:', e);
  }
}

// Cleanup function
export function disposeDocxResolver(): void {
  registrationDisposables.forEach((d) => d.dispose());
  registrationDisposables = [];
}
