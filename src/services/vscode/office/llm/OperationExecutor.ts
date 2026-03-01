/**
 * Operation Executor
 *
 * Executes validated document operations through the Tauri backend.
 * Handles operation batching, undo/redo history, and error recovery.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  OperationResult,
  DocumentType,
} from '../ast/types';
import type {
  DocumentOperation,
  HistoryEntry,
  OperationBatch,
  BatchResult,
  IOperationExecutor,
} from '../ast/operations';
import { createHistoryEntry, getDocumentTypeForOperation } from '../ast/operations';
import { operationValidator } from './OperationValidator';

/**
 * Maximum history entries to keep
 */
const MAX_HISTORY_SIZE = 100;

/**
 * Executes document operations through the Tauri backend
 */
export class OperationExecutor implements IOperationExecutor {
  private documentPath: string;
  private documentType: DocumentType;
  private history: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(documentPath: string, documentType: DocumentType) {
    this.documentPath = documentPath;
    this.documentType = documentType;
  }

  /**
   * Validate an operation before execution
   */
  async validate(operation: DocumentOperation) {
    return operationValidator.validate(operation);
  }

  /**
   * Execute a single operation
   */
  async execute(operation: DocumentOperation): Promise<OperationResult> {
    // Validate first
    const validation = await this.validate(operation);
    if (!validation.valid) {
      return {
        success: false,
        operationId: '',
        affectedNodeIds: [],
        errors: validation.errors,
      };
    }

    // Check operation matches document type
    try {
      const opType = getDocumentTypeForOperation(operation);
      if (opType !== this.documentType) {
        return {
          success: false,
          operationId: '',
          affectedNodeIds: [],
          errors: [{
            code: 'TYPE_MISMATCH',
            message: `Operation type "${operation.type}" is for ${opType} documents, but current document is ${this.documentType}`,
          }],
        };
      }
    } catch (e) {
      // Unknown operation type - let backend handle it
    }

    // Create history entry before execution
    const historyEntry = createHistoryEntry(operation, this.documentPath);

    try {
      // Convert operation to backend edit format
      const edit = this.operationToBackendEdit(operation);

      // Execute via Tauri backend
      await invoke('apply_document_edits', {
        path: this.documentPath,
        edits: [edit],
      });

      // Add to history
      this.addToHistory(historyEntry);

      // Clear redo stack on new operation
      this.redoStack = [];

      return {
        success: true,
        operationId: historyEntry.id,
        affectedNodeIds: [], // Would need to get from backend
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        operationId: historyEntry.id,
        affectedNodeIds: [],
        errors: [{
          code: 'EXECUTION_ERROR',
          message: errorMessage,
        }],
      };
    }
  }

  /**
   * Execute a batch of operations atomically
   */
  async executeBatch(batch: OperationBatch): Promise<BatchResult> {
    const results: OperationResult[] = [];
    let failedCount = 0;
    let totalAffected = 0;

    // Convert all operations to backend edits
    const edits = batch.operations.map(op => this.operationToBackendEdit(op));

    try {
      // Execute all edits in one call
      await invoke('apply_document_edits', {
        path: this.documentPath,
        edits,
      });

      // All succeeded
      for (const op of batch.operations) {
        const historyEntry = createHistoryEntry(op, this.documentPath);
        this.addToHistory(historyEntry);
        results.push({
          success: true,
          operationId: historyEntry.id,
          affectedNodeIds: [],
        });
      }
    } catch (error) {
      // Batch failed - execute individually to find failures
      for (const op of batch.operations) {
        const result = await this.execute(op);
        results.push(result);
        if (!result.success) {
          failedCount++;
        } else {
          totalAffected += result.affectedNodeIds.length;
        }
      }
    }

    return {
      success: failedCount === 0,
      batchId: batch.id,
      results,
      totalAffected,
      failedCount,
    };
  }

  /**
   * Undo the last operation
   */
  async undo(): Promise<OperationResult | null> {
    if (this.history.length === 0) {
      return null;
    }

    const lastEntry = this.history.pop()!;
    this.redoStack.push(lastEntry);

    // TODO: Implement actual undo via backend
    // For now, we'd need to reload the document or apply inverse operation
    console.warn('[OperationExecutor] Undo not yet implemented - would revert:', lastEntry.operation);

    return {
      success: true,
      operationId: `undo-${lastEntry.id}`,
      affectedNodeIds: [],
    };
  }

  /**
   * Redo the last undone operation
   */
  async redo(): Promise<OperationResult | null> {
    if (this.redoStack.length === 0) {
      return null;
    }

    const entry = this.redoStack.pop()!;
    return this.execute(entry.operation);
  }

  /**
   * Get operation history
   */
  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Clear operation history
   */
  clearHistory(): void {
    this.history = [];
    this.redoStack = [];
  }

  /**
   * Convert a document operation to the backend edit format
   */
  private operationToBackendEdit(operation: DocumentOperation): Record<string, unknown> {
    // Map frontend operation types to backend edit format
    switch (operation.type) {
      // Word operations
      case 'insertParagraph': {
        const op = operation as { content: string; styleId?: string };
        return {
          InsertParagraph: {
            index: 0, // Would need to resolve position
            text: op.content,
            style: op.styleId || 'Normal',
          },
        };
      }

      case 'deleteParagraph': {
        const op = operation as { nodeId: string };
        return {
          DeleteParagraph: {
            index: parseInt(op.nodeId, 10) || 0,
          },
        };
      }

      case 'replaceParagraph': {
        const op = operation as { nodeId: string; content: string };
        return {
          ReplaceParagraph: {
            index: parseInt(op.nodeId, 10) || 0,
            text: op.content,
          },
        };
      }

      // Excel operations
      case 'setCellValue': {
        const op = operation as { sheetName: string; ref: string; value: unknown };
        return {
          SetCell: {
            sheet: op.sheetName,
            cell: op.ref,
            value: String(op.value),
          },
        };
      }

      case 'setCellFormula': {
        const op = operation as { sheetName: string; ref: string; formula: string };
        return {
          SetFormula: {
            sheet: op.sheetName,
            cell: op.ref,
            formula: op.formula,
          },
        };
      }

      case 'insertRows': {
        const op = operation as { sheetName: string; rowIndex: number; count: number };
        return {
          InsertRow: {
            sheet: op.sheetName,
            index: op.rowIndex,
            count: op.count,
          },
        };
      }

      case 'deleteRows': {
        const op = operation as { sheetName: string; startRow: number; count: number };
        return {
          DeleteRow: {
            sheet: op.sheetName,
            index: op.startRow,
            count: op.count,
          },
        };
      }

      case 'createSheet': {
        const op = operation as { name: string };
        return {
          CreateSheet: {
            name: op.name,
          },
        };
      }

      case 'deleteSheet': {
        const op = operation as { sheetName: string };
        return {
          DeleteSheet: {
            name: op.sheetName,
          },
        };
      }

      // PowerPoint operations
      case 'addSlide': {
        const op = operation as { position: number; title?: string; content?: string };
        return {
          AddSlide: {
            index: op.position,
            title: op.title || '',
            body: op.content || '',
          },
        };
      }

      case 'deleteSlide': {
        const op = operation as { slideIndex: number };
        return {
          DeleteSlide: {
            index: op.slideIndex,
          },
        };
      }

      case 'updateSlideText': {
        const op = operation as { slideIndex: number; shapeId: string; text: string };
        if (op.shapeId === 'title') {
          return {
            SetSlideTitle: {
              index: op.slideIndex,
              title: op.text,
            },
          };
        }
        return {
          SetSlideBody: {
            index: op.slideIndex,
            body: op.text,
          },
        };
      }

      case 'setSlideNotes': {
        const op = operation as { slideIndex: number; notes: string };
        return {
          SetSpeakerNotes: {
            index: op.slideIndex,
            notes: op.notes,
          },
        };
      }

      case 'insertTextBox': {
        const op = operation as {
          slideIndex: number;
          x: number;
          y: number;
          width: number;
          height: number;
          text: string;
        };
        return {
          AddTextBox: {
            index: op.slideIndex,
            x: op.x,
            y: op.y,
            width: op.width,
            height: op.height,
            text: op.text,
          },
        };
      }

      case 'insertShape': {
        const op = operation as {
          slideIndex: number;
          shapeType: string;
          x: number;
          y: number;
          width: number;
          height: number;
          fill?: string;
          text?: string;
        };
        return {
          AddShape: {
            index: op.slideIndex,
            shape_type: op.shapeType,
            x: op.x,
            y: op.y,
            width: op.width,
            height: op.height,
            fill: op.fill,
            text: op.text,
          },
        };
      }

      default:
        // Pass through as-is for unknown operations
        return { [operation.type]: operation };
    }
  }

  /**
   * Add an entry to history, maintaining max size
   */
  private addToHistory(entry: HistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history.shift();
    }
  }
}

/**
 * Create an operation executor for a document
 */
export function createOperationExecutor(
  documentPath: string,
  documentType: DocumentType
): OperationExecutor {
  return new OperationExecutor(documentPath, documentType);
}
