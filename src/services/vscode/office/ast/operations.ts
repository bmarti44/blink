/**
 * Document Edit Operations
 *
 * Unified types for document operations that can be executed
 * across all Office document types.
 */

import type { WordOperation } from './word-ast';
import type { ExcelOperation } from './excel-ast';
import type { PowerPointOperation } from './pptx-ast';
import type { DocumentType, OperationResult, ValidationResult } from './types';

/**
 * Union type of all document operations
 */
export type DocumentOperation = WordOperation | ExcelOperation | PowerPointOperation;

/**
 * Operation with document context
 */
export interface ContextualOperation {
  documentType: DocumentType;
  documentPath: string;
  operation: DocumentOperation;
}

/**
 * Batch of operations to execute atomically
 */
export interface OperationBatch {
  id: string;
  documentPath: string;
  operations: DocumentOperation[];
  description?: string;
}

/**
 * Result of batch execution
 */
export interface BatchResult {
  success: boolean;
  batchId: string;
  results: OperationResult[];
  totalAffected: number;
  failedCount: number;
}

/**
 * Operation history entry for undo/redo
 */
export interface HistoryEntry {
  id: string;
  timestamp: number;
  operation: DocumentOperation;
  documentPath: string;
  documentType: DocumentType;
  snapshot?: unknown; // Pre-operation state for undo
}

/**
 * Operation executor interface
 */
export interface IOperationExecutor {
  /**
   * Validate an operation before execution
   */
  validate(operation: DocumentOperation): Promise<ValidationResult>;

  /**
   * Execute a single operation
   */
  execute(operation: DocumentOperation): Promise<OperationResult>;

  /**
   * Execute a batch of operations atomically
   */
  executeBatch(batch: OperationBatch): Promise<BatchResult>;

  /**
   * Undo the last operation
   */
  undo(): Promise<OperationResult | null>;

  /**
   * Redo the last undone operation
   */
  redo(): Promise<OperationResult | null>;

  /**
   * Get operation history
   */
  getHistory(): HistoryEntry[];

  /**
   * Clear operation history
   */
  clearHistory(): void;
}

/**
 * Map operation type to document type
 */
export function getDocumentTypeForOperation(operation: DocumentOperation): DocumentType {
  const wordOps = [
    'insertParagraph', 'deleteParagraph', 'replaceParagraph',
    'formatText', 'insertTable', 'insertList', 'replaceText', 'applyStyle'
  ];
  const excelOps = [
    'setCellValue', 'setCellFormula', 'formatRange',
    'insertRows', 'insertColumns', 'deleteRows', 'deleteColumns',
    'createSheet', 'deleteSheet', 'renameSheet', 'mergeCells', 'unmergeCells'
  ];
  const pptxOps = [
    'addSlide', 'deleteSlide', 'reorderSlides', 'updateSlideText',
    'insertTextBox', 'insertImage', 'insertShape', 'insertTable',
    'deleteShape', 'updateShape', 'setSlideNotes', 'setSlideLayout'
  ];

  if (wordOps.includes(operation.type)) return 'word';
  if (excelOps.includes(operation.type)) return 'excel';
  if (pptxOps.includes(operation.type)) return 'powerpoint';

  throw new Error(`Unknown operation type: ${operation.type}`);
}

/**
 * Check if operation is valid for document type
 */
export function isOperationValidForType(
  operation: DocumentOperation,
  documentType: DocumentType
): boolean {
  try {
    return getDocumentTypeForOperation(operation) === documentType;
  } catch {
    return false;
  }
}

/**
 * Create a unique operation ID
 */
export function createOperationId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a history entry for an operation
 */
export function createHistoryEntry(
  operation: DocumentOperation,
  documentPath: string,
  snapshot?: unknown
): HistoryEntry {
  return {
    id: createOperationId(),
    timestamp: Date.now(),
    operation,
    documentPath,
    documentType: getDocumentTypeForOperation(operation),
    snapshot
  };
}
