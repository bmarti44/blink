/**
 * Operation Validator
 *
 * Validates document operations before execution to ensure
 * they are safe and well-formed.
 */

import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '../ast/types';
import type { DocumentOperation } from '../ast/operations';

/**
 * Validates document operations before execution
 */
export class OperationValidator {
  /**
   * Validate an operation against the document state
   */
  validate(operation: DocumentOperation, _documentState?: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Basic type validation
    if (!operation || typeof operation !== 'object') {
      errors.push({
        code: 'INVALID_OPERATION',
        message: 'Operation must be a non-null object',
      });
      return { valid: false, errors, warnings };
    }

    if (!operation.type || typeof operation.type !== 'string') {
      errors.push({
        code: 'MISSING_TYPE',
        message: 'Operation must have a type property',
      });
      return { valid: false, errors, warnings };
    }

    // Type-specific validation
    switch (operation.type) {
      case 'setCellValue':
        this.validateSetCellValue(operation, errors, warnings);
        break;
      case 'setCellFormula':
        this.validateSetCellFormula(operation, errors, warnings);
        break;
      case 'insertParagraph':
        this.validateInsertParagraph(operation, errors, warnings);
        break;
      case 'formatText':
        this.validateFormatText(operation, errors, warnings);
        break;
      case 'insertTable':
        this.validateInsertTable(operation, errors, warnings);
        break;
      case 'addSlide':
        this.validateAddSlide(operation, errors, warnings);
        break;
      case 'insertTextBox':
        this.validateInsertTextBox(operation, errors, warnings);
        break;
      default:
        // Unknown operation type - still allow but warn
        warnings.push({
          code: 'UNKNOWN_OPERATION_TYPE',
          message: `Unknown operation type: ${operation.type}`,
          suggestion: 'Check if this operation is supported',
        });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate cell reference format (A1, B2, AA1, etc.)
   */
  private validateCellRef(ref: string, errors: ValidationError[]): void {
    const cellPattern = /^[A-Z]+[0-9]+$/;
    const rangePattern = /^[A-Z]+[0-9]+:[A-Z]+[0-9]+$/;

    if (!cellPattern.test(ref) && !rangePattern.test(ref)) {
      errors.push({
        code: 'INVALID_CELL_REF',
        message: `Invalid cell reference: ${ref}. Expected format like A1 or A1:C3`,
        path: 'ref',
      });
    }
  }

  /**
   * Validate formula syntax
   */
  private validateFormulaSyntax(formula: string, warnings: ValidationWarning[]): void {
    if (!formula.startsWith('=')) {
      warnings.push({
        code: 'FORMULA_NO_EQUALS',
        message: 'Formula should start with =',
        suggestion: 'Add = prefix to the formula',
      });
    }

    // Check for common formula issues
    const openParens = (formula.match(/\(/g) || []).length;
    const closeParens = (formula.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      warnings.push({
        code: 'UNBALANCED_PARENTHESES',
        message: 'Formula has unbalanced parentheses',
        suggestion: 'Check that all parentheses are properly closed',
      });
    }
  }

  /**
   * Validate setCellValue operation
   */
  private validateSetCellValue(
    op: DocumentOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const { sheetName, ref, value } = op as { sheetName?: string; ref?: string; value?: unknown };

    if (!sheetName || typeof sheetName !== 'string') {
      errors.push({
        code: 'MISSING_SHEET_NAME',
        message: 'setCellValue requires a sheetName',
        path: 'sheetName',
      });
    }

    if (!ref || typeof ref !== 'string') {
      errors.push({
        code: 'MISSING_REF',
        message: 'setCellValue requires a cell reference',
        path: 'ref',
      });
    } else {
      this.validateCellRef(ref, errors);
    }

    if (value === undefined) {
      warnings.push({
        code: 'EMPTY_VALUE',
        message: 'Setting cell to undefined value',
        suggestion: 'Use null to clear cell or provide a value',
      });
    }
  }

  /**
   * Validate setCellFormula operation
   */
  private validateSetCellFormula(
    op: DocumentOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const { sheetName, ref, formula } = op as { sheetName?: string; ref?: string; formula?: string };

    if (!sheetName || typeof sheetName !== 'string') {
      errors.push({
        code: 'MISSING_SHEET_NAME',
        message: 'setCellFormula requires a sheetName',
        path: 'sheetName',
      });
    }

    if (!ref || typeof ref !== 'string') {
      errors.push({
        code: 'MISSING_REF',
        message: 'setCellFormula requires a cell reference',
        path: 'ref',
      });
    } else {
      this.validateCellRef(ref, errors);
    }

    if (!formula || typeof formula !== 'string') {
      errors.push({
        code: 'MISSING_FORMULA',
        message: 'setCellFormula requires a formula',
        path: 'formula',
      });
    } else {
      this.validateFormulaSyntax(formula, warnings);
    }
  }

  /**
   * Validate insertParagraph operation
   */
  private validateInsertParagraph(
    op: DocumentOperation,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    const { position, content } = op as { position?: unknown; content?: string };

    if (!position || typeof position !== 'object') {
      errors.push({
        code: 'MISSING_POSITION',
        message: 'insertParagraph requires a position object',
        path: 'position',
      });
    }

    if (content === undefined || typeof content !== 'string') {
      errors.push({
        code: 'MISSING_CONTENT',
        message: 'insertParagraph requires content string',
        path: 'content',
      });
    }
  }

  /**
   * Validate formatText operation
   */
  private validateFormatText(
    op: DocumentOperation,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    const { paragraphId, startOffset, endOffset, marks, action } = op as {
      paragraphId?: string;
      startOffset?: number;
      endOffset?: number;
      marks?: unknown[];
      action?: string;
    };

    if (!paragraphId || typeof paragraphId !== 'string') {
      errors.push({
        code: 'MISSING_PARAGRAPH_ID',
        message: 'formatText requires a paragraphId',
        path: 'paragraphId',
      });
    }

    if (typeof startOffset !== 'number' || startOffset < 0) {
      errors.push({
        code: 'INVALID_START_OFFSET',
        message: 'formatText requires a non-negative startOffset',
        path: 'startOffset',
      });
    }

    if (typeof endOffset !== 'number' || endOffset < 0) {
      errors.push({
        code: 'INVALID_END_OFFSET',
        message: 'formatText requires a non-negative endOffset',
        path: 'endOffset',
      });
    }

    if (startOffset !== undefined && endOffset !== undefined && startOffset > endOffset) {
      errors.push({
        code: 'INVALID_RANGE',
        message: 'startOffset must be less than or equal to endOffset',
        path: 'startOffset',
      });
    }

    if (!Array.isArray(marks) || marks.length === 0) {
      errors.push({
        code: 'MISSING_MARKS',
        message: 'formatText requires at least one mark',
        path: 'marks',
      });
    }

    if (!action || !['add', 'remove', 'toggle'].includes(action)) {
      errors.push({
        code: 'INVALID_ACTION',
        message: 'formatText action must be "add", "remove", or "toggle"',
        path: 'action',
      });
    }
  }

  /**
   * Validate insertTable operation
   */
  private validateInsertTable(
    op: DocumentOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const { position, rows, columns } = op as {
      position?: unknown;
      rows?: number;
      columns?: number;
    };

    if (!position || typeof position !== 'object') {
      errors.push({
        code: 'MISSING_POSITION',
        message: 'insertTable requires a position object',
        path: 'position',
      });
    }

    if (typeof rows !== 'number' || rows < 1) {
      errors.push({
        code: 'INVALID_ROWS',
        message: 'insertTable requires at least 1 row',
        path: 'rows',
      });
    } else if (rows > 100) {
      warnings.push({
        code: 'LARGE_TABLE',
        message: 'Table has more than 100 rows',
        suggestion: 'Consider using a smaller table for better performance',
      });
    }

    if (typeof columns !== 'number' || columns < 1) {
      errors.push({
        code: 'INVALID_COLUMNS',
        message: 'insertTable requires at least 1 column',
        path: 'columns',
      });
    } else if (columns > 26) {
      warnings.push({
        code: 'WIDE_TABLE',
        message: 'Table has more than 26 columns',
        suggestion: 'Consider using fewer columns for better readability',
      });
    }
  }

  /**
   * Validate addSlide operation
   */
  private validateAddSlide(
    op: DocumentOperation,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    const { position } = op as { position?: number };

    if (typeof position !== 'number' || position < 0) {
      errors.push({
        code: 'INVALID_POSITION',
        message: 'addSlide requires a non-negative position',
        path: 'position',
      });
    }
  }

  /**
   * Validate insertTextBox operation
   */
  private validateInsertTextBox(
    op: DocumentOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const { slideIndex, x, y, width, height, text } = op as {
      slideIndex?: number;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
    };

    if (typeof slideIndex !== 'number' || slideIndex < 0) {
      errors.push({
        code: 'INVALID_SLIDE_INDEX',
        message: 'insertTextBox requires a non-negative slideIndex',
        path: 'slideIndex',
      });
    }

    // Validate position is within bounds (0-100%)
    const validatePercentage = (value: number | undefined, name: string) => {
      if (typeof value !== 'number') {
        errors.push({
          code: `MISSING_${name.toUpperCase()}`,
          message: `insertTextBox requires ${name}`,
          path: name,
        });
      } else if (value < 0 || value > 100) {
        warnings.push({
          code: `${name.toUpperCase()}_OUT_OF_BOUNDS`,
          message: `${name} (${value}) is outside 0-100 range`,
          suggestion: 'Position values are percentages (0-100)',
        });
      }
    };

    validatePercentage(x, 'x');
    validatePercentage(y, 'y');
    validatePercentage(width, 'width');
    validatePercentage(height, 'height');

    if (typeof text !== 'string') {
      errors.push({
        code: 'MISSING_TEXT',
        message: 'insertTextBox requires text content',
        path: 'text',
      });
    }
  }
}

/**
 * Singleton validator instance
 */
export const operationValidator = new OperationValidator();
