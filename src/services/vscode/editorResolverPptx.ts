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

// PPTX Editor Input - represents a PowerPoint file in the editor
class PptxEditorInput extends SimpleEditorInput {
  static readonly ID = 'blink.pptxEditorInput';
  private _path: string;

  constructor(resource: URI) {
    super(resource);
    this._path = resource.fsPath || resource.path;
    this.setName(resource.path.split('/').pop() || 'Presentation');
    this.setTitle(this._path);
    this.setDescription('PowerPoint Presentation');
  }

  override get typeId(): string {
    return PptxEditorInput.ID;
  }

  get path(): string {
    return this._path;
  }
}

// PPTX Editor Pane - renders the PowerPoint content
class PptxEditorPane extends SimpleEditorPane {
  static readonly ID = 'blink.pptxEditorPane';
  private docContainer: HTMLDivElement | null = null;
  private currentPath: string | null = null;

  override initialize(): HTMLElement {
    this.docContainer = document.createElement('div');
    this.docContainer.className = 'pptx-editor-pane';
    this.docContainer.style.cssText = `
      background: #2d2d2d;
      min-height: 100%;
      padding: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    `;

    // Add PowerPoint-like styles
    const style = document.createElement('style');
    style.textContent = `
      .pptx-editor-pane .pptx-toolbar {
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid #404040;
        background: #c43e1c;
        flex-shrink: 0;
      }
      .pptx-editor-pane .pptx-toolbar button {
        background: rgba(255,255,255,0.15);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 3px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 12px;
      }
      .pptx-editor-pane .pptx-toolbar button:hover {
        background: rgba(255,255,255,0.25);
      }
      .pptx-editor-pane .pptx-workspace {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      .pptx-editor-pane .slide-panel {
        width: 180px;
        background: #252526;
        border-right: 1px solid #404040;
        padding: 12px 8px;
        overflow-y: auto;
        flex-shrink: 0;
      }
      .pptx-editor-pane .slide-thumbnail {
        background: #fff;
        margin-bottom: 8px;
        border-radius: 4px;
        padding: 4px;
        cursor: pointer;
        border: 2px solid transparent;
        aspect-ratio: 16/9;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        color: #333;
      }
      .pptx-editor-pane .slide-thumbnail.active {
        border-color: #c43e1c;
      }
      .pptx-editor-pane .slide-thumbnail:hover {
        border-color: #888;
      }
      .pptx-editor-pane .slide-canvas {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 24px;
        background: #404040;
        overflow: auto;
      }
      .pptx-editor-pane .pptx-content {
        background: #fff;
        width: 960px;
        min-height: 540px;
        aspect-ratio: 16/9;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        padding: 40px 60px;
        font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
        color: #000;
      }
      .pptx-editor-pane .slide {
        margin-bottom: 24px;
        padding: 20px;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        background: linear-gradient(135deg, #f5f5f5 0%, #fff 100%);
      }
      .pptx-editor-pane .slide .header {
        font-size: 28pt;
        font-weight: bold;
        color: #c43e1c;
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 3px solid #c43e1c;
      }
      .pptx-editor-pane .slide .content {
        font-size: 18pt;
        line-height: 1.6;
        color: #333;
      }
      .pptx-editor-pane .slide .content ul {
        margin: 12px 0;
        padding-left: 24px;
      }
      .pptx-editor-pane .slide .content li {
        margin: 8px 0;
      }
      .pptx-editor-pane .pptx-presentation .slide-title {
        font-size: 32pt;
        font-weight: bold;
        color: #c43e1c;
        text-align: center;
        margin-bottom: 24px;
      }
      .pptx-editor-pane .pptx-presentation .slide-content {
        font-size: 20pt;
        line-height: 1.8;
      }
      /* Styling for backend-rendered HTML */
      .pptx-editor-pane .pptx-presentation .pptx-header {
        padding: 16px;
        border-bottom: 2px solid #c43e1c;
        margin-bottom: 16px;
      }
      .pptx-editor-pane .pptx-presentation .pptx-doc-title {
        font-size: 24pt;
        color: #c43e1c;
        margin: 0;
      }
      .pptx-editor-pane .pptx-presentation .pptx-slide {
        background: #fff;
        margin: 16px 0;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        overflow: hidden;
      }
      .pptx-editor-pane .pptx-presentation .pptx-slide-header {
        background: linear-gradient(135deg, #c43e1c, #d4522e);
        color: #fff;
        padding: 8px 16px;
        font-size: 12px;
      }
      .pptx-editor-pane .pptx-presentation .pptx-slide-content {
        padding: 32px;
        min-height: 200px;
      }
      .pptx-editor-pane .pptx-presentation .pptx-title {
        font-size: 28pt;
        color: #333;
        margin: 0 0 24px 0;
        border-bottom: 3px solid #c43e1c;
        padding-bottom: 12px;
      }
      .pptx-editor-pane .pptx-presentation .pptx-body {
        font-size: 16pt;
        line-height: 1.6;
        color: #444;
      }
      .pptx-editor-pane .pptx-presentation .pptx-body p {
        margin: 0 0 12px 0;
      }
      .pptx-editor-pane .pptx-presentation .pptx-bullets,
      .pptx-editor-pane .pptx-presentation .pptx-numbered {
        margin: 16px 0;
        padding-left: 32px;
      }
      .pptx-editor-pane .pptx-presentation .pptx-bullets li,
      .pptx-editor-pane .pptx-presentation .pptx-numbered li {
        margin: 8px 0;
      }
      .pptx-editor-pane .pptx-presentation .pptx-notes {
        background: #f5f5f5;
        border-top: 1px solid #ddd;
        padding: 16px;
        font-size: 12pt;
        color: #666;
      }
      .pptx-editor-pane .pptx-presentation .pptx-notes-header {
        font-weight: bold;
        color: #c43e1c;
        margin-bottom: 8px;
      }
    `;
    this.docContainer.appendChild(style);

    // Add toolbar (PowerPoint orange-red theme)
    const toolbar = document.createElement('div');
    toolbar.className = 'pptx-toolbar';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.onclick = () => this.refresh();

    const setTitleBtn = document.createElement('button');
    setTitleBtn.textContent = 'Set Title';
    setTitleBtn.onclick = () => this.setSlideTitle(0, 'Hello Slide');

    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(setTitleBtn);

    // Workspace container
    const workspace = document.createElement('div');
    workspace.className = 'pptx-workspace';

    // Slide panel (thumbnails)
    const slidePanel = document.createElement('div');
    slidePanel.className = 'slide-panel';
    slidePanel.id = 'pptx-slide-panel';
    slidePanel.innerHTML = '<div class="slide-thumbnail active">Slide 1</div>';

    // Slide canvas (main editing area)
    const slideCanvas = document.createElement('div');
    slideCanvas.className = 'slide-canvas';

    // Content area
    const content = document.createElement('div');
    content.className = 'pptx-content';
    content.id = 'pptx-content';

    slideCanvas.appendChild(content);
    workspace.appendChild(slidePanel);
    workspace.appendChild(slideCanvas);

    this.docContainer.appendChild(toolbar);
    this.docContainer.appendChild(workspace);

    return this.docContainer;
  }

  override async renderInput(input: any): Promise<IDisposable> {
    if (input instanceof PptxEditorInput) {
      this.currentPath = input.path;
      await this.loadContent();
    }
    return { dispose: () => {} };
  }

  private async loadContent() {
    if (!this.currentPath || !this.docContainer) return;

    const contentEl = this.docContainer.querySelector('#pptx-content');
    if (!contentEl) return;

    try {
      const html = await invoke<string>('render_document_html', { path: this.currentPath });
      contentEl.innerHTML = html;

      // Store for testing
      (window as any).__PPTX_LAST_RENDER_TEXT__ = (contentEl.textContent || '').slice(0, 200);
      (window as any).__PPTX_LAST_RENDER_LENGTH__ = html.length;

      console.log('[PptxPane] Rendered content, length:', html.length);
    } catch (e) {
      const msg = String(e || '');
      // Handle sidecar not available gracefully
      if (msg.includes('PowerPoint service script not found') || msg.toLowerCase().includes('sidecar') || msg.includes('Failed to run Node.js')) {
        const fallback = `<div class="pptx-presentation"><div class="slide"><div class="header">Slide 1</div><div class="content"><h3>Preview not available</h3><p>PowerPoint preview requires sidecar. Please install dependencies.</p></div></div></div>`;
        contentEl.innerHTML = fallback;
        (window as any).__PPTX_LAST_RENDER_TEXT__ = 'Preview not available';
        console.log('[PptxPane] Fallback preview displayed');
        return;
      }
      contentEl.innerHTML = `<pre style="color:#f44">${msg}</pre>`;
      console.error('[PptxPane] Render error:', e);
    }
  }

  private async setSlideTitle(index: number, title: string) {
    if (!this.currentPath) return;
    try {
      await invoke('apply_document_edits', {
        path: this.currentPath,
        edits: [{ type: 'SetSlideTitle', index, title }],
      });
      await this.loadContent();
    } catch (e) {
      console.error('[PptxPane] Set title error:', e);
    }
  }

  private async refresh() {
    await this.loadContent();
  }
}

// Keep track of registration disposables
let registrationDisposables: IDisposable[] = [];

export async function openPptxForTest(path: string): Promise<boolean> {
  console.log('[PptxResolver] openPptxForTest:', path);

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
    console.error('[PptxResolver] openPptxForTest error:', e);
    return false;
  }
}

export async function setPptxTitleForTest(path: string, index: number, title: string): Promise<boolean> {
  try {
    await invoke('apply_document_edits', { path, edits: [{ type: 'SetSlideTitle', index, title }] });
    const h = await invoke<string>('render_document_html', { path });
    const txt = (h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 200);
    (window as any).__PPTX_LAST_RENDER_TEXT__ = txt;
    return true;
  } catch {
    return false;
  }
}

export async function registerPptxResolver(): Promise<void> {
  try {
    console.log('[PptxResolver] Registering PPTX editor...');

    // Register the editor pane
    const paneDisposable = registerEditorPane(
      PptxEditorPane.ID,
      'PowerPoint Presentation Editor',
      PptxEditorPane as any,
      [PptxEditorInput]
    );
    registrationDisposables.push(paneDisposable);

    // Register the editor for .pptx and .ppt files
    const editorDisposable = registerEditor(
      '**/*.{pptx,ppt}',
      {
        id: PptxEditorPane.ID,
        label: 'PowerPoint Presentation Editor',
        priority: RegisteredEditorPriority.default,
      },
      {},
      {
        createEditorInput: (editorInput: any) => {
          const resource = editorInput.resource;
          console.log('[PptxResolver] Creating PptxEditorInput for:', resource?.path);
          return {
            editor: new PptxEditorInput(resource),
          };
        },
      }
    );
    registrationDisposables.push(editorDisposable);

    // Expose test functions globally
    (window as any).__OPEN_PPTX_FOR_TEST__ = openPptxForTest;
    (window as any).__PPTX_SET_TITLE_FOR_TEST__ = setPptxTitleForTest;

    console.log('[PptxResolver] PPTX editor registered successfully');
  } catch (e) {
    console.error('[PptxResolver] Registration error:', e);
  }
}

// Cleanup function
export function disposePptxResolver(): void {
  registrationDisposables.forEach((d) => d.dispose());
  registrationDisposables = [];
}
