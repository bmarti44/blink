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

// XLSX Editor Input - represents an Excel file in the editor
class XlsxEditorInput extends SimpleEditorInput {
  static readonly ID = 'blink.xlsxEditorInput';
  private _path: string;

  constructor(resource: URI) {
    super(resource);
    this._path = resource.fsPath || resource.path;
    this.setName(resource.path.split('/').pop() || 'Spreadsheet');
    this.setTitle(this._path);
    this.setDescription('Excel Spreadsheet');
  }

  override get typeId(): string {
    return XlsxEditorInput.ID;
  }

  get path(): string {
    return this._path;
  }
}

// XLSX Editor Pane - renders the Excel content
class XlsxEditorPane extends SimpleEditorPane {
  static readonly ID = 'blink.xlsxEditorPane';
  private docContainer: HTMLDivElement | null = null;
  private currentPath: string | null = null;

  override initialize(): HTMLElement {
    this.docContainer = document.createElement('div');
    this.docContainer.className = 'xlsx-editor-pane';
    this.docContainer.style.cssText = `
      background: #2d2d2d;
      min-height: 100%;
      padding: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    `;

    // Add Excel-like styles
    const style = document.createElement('style');
    style.textContent = `
      .xlsx-editor-pane .xlsx-toolbar {
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid #404040;
        background: #217346;
        flex-shrink: 0;
      }
      .xlsx-editor-pane .xlsx-toolbar button {
        background: rgba(255,255,255,0.15);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 3px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 12px;
      }
      .xlsx-editor-pane .xlsx-toolbar button:hover {
        background: rgba(255,255,255,0.25);
      }
      .xlsx-editor-pane .xlsx-sheet-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #1e1e1e;
        overflow: auto;
      }
      .xlsx-editor-pane .xlsx-formula-bar {
        display: flex;
        align-items: center;
        background: #2d2d2d;
        border-bottom: 1px solid #404040;
        padding: 4px 8px;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 12px;
        color: #ccc;
      }
      .xlsx-editor-pane .xlsx-formula-bar .cell-ref {
        background: #3c3c3c;
        padding: 4px 8px;
        border: 1px solid #555;
        min-width: 60px;
        margin-right: 8px;
      }
      .xlsx-editor-pane .xlsx-formula-bar .formula-input {
        flex: 1;
        background: #3c3c3c;
        padding: 4px 8px;
        border: 1px solid #555;
        color: #fff;
      }
      .xlsx-editor-pane .xlsx-content {
        flex: 1;
        padding: 0;
        overflow: auto;
        background: #fff;
      }
      .xlsx-editor-pane table {
        border-collapse: collapse;
        width: 100%;
        font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
        font-size: 11pt;
        background: #fff;
        color: #000;
      }
      .xlsx-editor-pane th,
      .xlsx-editor-pane td {
        border: 1px solid #d4d4d4;
        padding: 4px 8px;
        text-align: left;
        min-width: 80px;
        white-space: nowrap;
      }
      .xlsx-editor-pane th {
        background: #f3f3f3;
        font-weight: normal;
        color: #333;
        text-align: center;
      }
      .xlsx-editor-pane .excel-corner {
        background: #e0e0e0;
        width: 40px;
        min-width: 40px;
      }
      .xlsx-editor-pane .excel-col-header {
        background: #217346;
        color: #fff;
        font-weight: bold;
        min-width: 80px;
      }
      .xlsx-editor-pane .excel-row-header {
        background: #217346;
        color: #fff;
        font-weight: bold;
        text-align: center;
        width: 40px;
        min-width: 40px;
      }
      .xlsx-editor-pane .excel-row-even td {
        background: #fff;
      }
      .xlsx-editor-pane .excel-row-odd td {
        background: #f9f9f9;
      }
      .xlsx-editor-pane tbody tr:hover td:not(.excel-row-header) {
        background: #e8f4ea;
      }
      .xlsx-editor-pane .excel-number {
        font-family: 'Consolas', 'Monaco', monospace;
        color: #0066cc;
      }
      .xlsx-editor-pane .excel-formula {
        font-family: 'Consolas', 'Monaco', monospace;
        color: #006600;
      }
      .xlsx-editor-pane .excel-boolean {
        color: #993399;
        font-weight: bold;
      }
      .xlsx-editor-pane .excel-currency {
        color: #006600;
      }
      .xlsx-editor-pane .excel-percent {
        color: #cc6600;
      }
      .xlsx-editor-pane .sheet-tabs {
        display: flex;
        background: #2d2d2d;
        border-top: 1px solid #404040;
        padding: 4px 8px;
      }
      .xlsx-editor-pane .sheet-tab {
        background: #3c3c3c;
        color: #ccc;
        border: 1px solid #555;
        border-bottom: none;
        padding: 4px 12px;
        font-size: 11px;
        cursor: pointer;
        margin-right: 2px;
      }
      .xlsx-editor-pane .sheet-tab.active {
        background: #217346;
        color: #fff;
      }
    `;
    this.docContainer.appendChild(style);

    // Add toolbar (Excel green theme)
    const toolbar = document.createElement('div');
    toolbar.className = 'xlsx-toolbar';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.onclick = () => this.refresh();

    const setCellBtn = document.createElement('button');
    setCellBtn.textContent = 'Set C1=Edited';
    setCellBtn.onclick = () => this.setCell('C1', 'Edited');

    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(setCellBtn);

    // Add formula bar
    const formulaBar = document.createElement('div');
    formulaBar.className = 'xlsx-formula-bar';
    formulaBar.innerHTML = `
      <div class="cell-ref">A1</div>
      <div class="formula-input">Formula bar (read-only)</div>
    `;

    // Sheet container
    const sheetContainer = document.createElement('div');
    sheetContainer.className = 'xlsx-sheet-container';

    // Add content area
    const content = document.createElement('div');
    content.className = 'xlsx-content';
    content.id = 'xlsx-content';

    // Sheet tabs
    const sheetTabs = document.createElement('div');
    sheetTabs.className = 'sheet-tabs';
    sheetTabs.innerHTML = '<div class="sheet-tab active">Sheet1</div>';

    sheetContainer.appendChild(content);
    sheetContainer.appendChild(sheetTabs);

    this.docContainer.appendChild(toolbar);
    this.docContainer.appendChild(formulaBar);
    this.docContainer.appendChild(sheetContainer);

    return this.docContainer;
  }

  override async renderInput(input: any): Promise<IDisposable> {
    if (input instanceof XlsxEditorInput) {
      this.currentPath = input.path;
      await this.loadContent();
    }
    return { dispose: () => {} };
  }

  private async loadContent() {
    if (!this.currentPath || !this.docContainer) return;

    const contentEl = this.docContainer.querySelector('#xlsx-content');
    if (!contentEl) return;

    try {
      const html = await invoke<string>('render_document_html', { path: this.currentPath });
      contentEl.innerHTML = html;

      // Store for testing
      (window as any).__XLSX_LAST_RENDER_TEXT__ = (contentEl.textContent || '').slice(0, 200);
      (window as any).__XLSX_LAST_RENDER_LENGTH__ = html.length;

      console.log('[XlsxPane] Rendered content, length:', html.length);
    } catch (e) {
      contentEl.innerHTML = `<pre style="color:#f44">${String(e)}</pre>`;
      console.error('[XlsxPane] Render error:', e);
    }
  }

  private async setCell(cell: string, value: string) {
    if (!this.currentPath) return;
    try {
      await invoke('apply_document_edits', {
        path: this.currentPath,
        edits: [{ type: 'SetCell', sheet: 'Sheet1', cell, value }],
      });
      await this.loadContent();
    } catch (e) {
      console.error('[XlsxPane] Set cell error:', e);
    }
  }

  private async refresh() {
    await this.loadContent();
  }
}

// Keep track of registration disposables
let registrationDisposables: IDisposable[] = [];

export async function openXlsxForTest(path: string): Promise<boolean> {
  console.log('[XlsxResolver] openXlsxForTest:', path);

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
    console.error('[XlsxResolver] openXlsxForTest error:', e);
    return false;
  }
}

export async function setXlsxCellForTest(path: string, sheet: string, cell: string, value: string): Promise<boolean> {
  try {
    await invoke('apply_document_edits', { path, edits: [{ type: 'SetCell', sheet, cell, value }] });
    const h = await invoke<string>('render_document_html', { path });
    const txt = (h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 200);
    (window as any).__XLSX_LAST_RENDER_TEXT__ = txt;
    return true;
  } catch {
    return false;
  }
}

export async function registerXlsxResolver(): Promise<void> {
  try {
    console.log('[XlsxResolver] Registering XLSX editor...');

    // Register the editor pane
    const paneDisposable = registerEditorPane(
      XlsxEditorPane.ID,
      'Excel Spreadsheet Editor',
      XlsxEditorPane as any,
      [XlsxEditorInput]
    );
    registrationDisposables.push(paneDisposable);

    // Register the editor for .xlsx, .xls, and .xlsm files
    const editorDisposable = registerEditor(
      '**/*.{xlsx,xls,xlsm}',
      {
        id: XlsxEditorPane.ID,
        label: 'Excel Spreadsheet Editor',
        priority: RegisteredEditorPriority.default,
      },
      {},
      {
        createEditorInput: (editorInput: any) => {
          const resource = editorInput.resource;
          console.log('[XlsxResolver] Creating XlsxEditorInput for:', resource?.path);
          return {
            editor: new XlsxEditorInput(resource),
          };
        },
      }
    );
    registrationDisposables.push(editorDisposable);

    // Expose test functions globally
    (window as any).__OPEN_XLSX_FOR_TEST__ = openXlsxForTest;
    (window as any).__XLSX_SET_CELL_FOR_TEST__ = setXlsxCellForTest;

    console.log('[XlsxResolver] XLSX editor registered successfully');
  } catch (e) {
    console.error('[XlsxResolver] Registration error:', e);
  }
}

// Cleanup function
export function disposeXlsxResolver(): void {
  registrationDisposables.forEach((d) => d.dispose());
  registrationDisposables = [];
}
