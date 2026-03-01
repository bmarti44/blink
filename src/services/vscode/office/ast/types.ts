/**
 * Core shared types for Office document AST
 *
 * These types define the common structure for document manipulation
 * across Word, Excel, and PowerPoint formats.
 */

/**
 * Base node interface for all document elements
 */
export interface BaseNode {
  type: string;
  id: string;
}

/**
 * Position specification for insert operations
 */
export interface InsertPosition {
  type: 'before' | 'after' | 'start' | 'end' | 'at';
  anchorId?: string;
  index?: number;
}

/**
 * Text formatting marks (ProseMirror-style flat model)
 */
export interface Mark {
  type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link' | 'highlight';
  attrs?: Record<string, unknown>;
}

/**
 * Generic edit operation (base interface)
 */
export interface BaseOperation {
  type: string;
  targetId?: string;
  position?: InsertPosition;
  data?: unknown;
}

/**
 * Operation result with undo capability
 */
export interface OperationResult {
  success: boolean;
  operationId: string;
  affectedNodeIds: string[];
  errors?: ValidationError[];
  undo?: () => void;
  redo?: () => void;
}

/**
 * Validation error from operation validation
 */
export interface ValidationError {
  code: string;
  message: string;
  path?: string;
}

/**
 * Validation warning (non-fatal)
 */
export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

/**
 * Result of operation validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Document metadata common to all types
 */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  created?: string;
  modified?: string;
  description?: string;
}

/**
 * Document type identifier
 */
export type DocumentType = 'word' | 'excel' | 'powerpoint';

/**
 * Base document interface
 */
export interface BaseDocument extends BaseNode {
  type: 'document' | 'workbook' | 'presentation';
  metadata: DocumentMetadata;
}
