/**
 * Excel Workbook AST Type Definitions
 *
 * Defines the structure for Excel (.xlsx) workbooks that can be
 * manipulated through the LLM function calling interface.
 */

import type { BaseNode, DocumentMetadata } from './types';

/**
 * Root Excel workbook structure
 */
export interface ExcelWorkbook {
  type: 'workbook';
  id: string;
  metadata: WorkbookMetadata;
  sheets: Sheet[];
  namedRanges?: NamedRange[];
  styles?: CellStyle[];
}

/**
 * Workbook-specific metadata
 */
export interface WorkbookMetadata extends DocumentMetadata {
  sheetCount?: number;
  activeSheet?: string;
}

/**
 * Worksheet within a workbook
 */
export interface Sheet extends BaseNode {
  type: 'sheet';
  name: string;
  data: SheetData;
  mergedCells?: MergedCell[];
  conditionalFormats?: ConditionalFormat[];
  frozenRows?: number;
  frozenColumns?: number;
}

/**
 * Sheet data containing rows
 */
export interface SheetData {
  rows: Row[];
  columnWidths?: Record<string, number>;
  defaultRowHeight?: number;
}

/**
 * Row within a sheet
 */
export interface Row {
  type: 'row';
  index: number;
  height?: number;
  cells: Cell[];
  hidden?: boolean;
}

/**
 * Cell within a row
 */
export interface Cell {
  type: 'cell';
  ref: string; // "A1", "B2", etc.
  value: CellValue;
  formula?: string;
  dataType: CellDataType;
  styleId?: string;
  hyperlink?: string;
  comment?: string;
}

/**
 * Cell value types
 */
export type CellValue = string | number | boolean | null | Date;

/**
 * Cell data type identifiers
 */
export type CellDataType = 'string' | 'number' | 'boolean' | 'date' | 'error' | 'blank' | 'formula';

/**
 * Named range definition
 */
export interface NamedRange {
  name: string;
  ref: string; // "Sheet1!$A$1:$C$10"
  scope?: string;
}

/**
 * Merged cell range
 */
export interface MergedCell {
  ref: string; // "A1:C3"
}

/**
 * Conditional formatting rule
 */
export interface ConditionalFormat {
  range: string;
  type: 'cellValue' | 'colorScale' | 'dataBar' | 'iconSet';
  rule: Record<string, unknown>;
}

/**
 * Cell style definition
 */
export interface CellStyle {
  id: string;
  font?: FontStyle;
  fill?: FillStyle;
  border?: BorderStyle;
  alignment?: AlignmentStyle;
  numberFormat?: string;
}

/**
 * Font styling
 */
export interface FontStyle {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
}

/**
 * Fill styling
 */
export interface FillStyle {
  type: 'solid' | 'pattern' | 'gradient';
  color?: string;
  patternType?: string;
}

/**
 * Border styling
 */
export interface BorderStyle {
  top?: BorderEdge;
  bottom?: BorderEdge;
  left?: BorderEdge;
  right?: BorderEdge;
}

/**
 * Border edge definition
 */
export interface BorderEdge {
  style: 'thin' | 'medium' | 'thick' | 'double' | 'dashed' | 'dotted';
  color?: string;
}

/**
 * Alignment styling
 */
export interface AlignmentStyle {
  horizontal?: 'left' | 'center' | 'right' | 'justify';
  vertical?: 'top' | 'middle' | 'bottom';
  wrapText?: boolean;
  textRotation?: number;
}

/**
 * Excel-specific edit operations
 */
export type ExcelOperation =
  | SetCellValueOp
  | SetCellFormulaOp
  | FormatRangeOp
  | InsertRowsOp
  | InsertColumnsOp
  | DeleteRowsOp
  | DeleteColumnsOp
  | CreateSheetOp
  | DeleteSheetOp
  | RenameSheetOp
  | MergeCellsOp
  | UnmergeCellsOp;

/**
 * Set cell value operation
 */
export interface SetCellValueOp {
  type: 'setCellValue';
  sheetName: string;
  ref: string; // Cell reference like "A1" or range like "A1:C3"
  value: CellValue | CellValue[][];
  dataType?: 'auto' | 'string' | 'number' | 'date' | 'boolean';
}

/**
 * Set cell formula operation
 */
export interface SetCellFormulaOp {
  type: 'setCellFormula';
  sheetName: string;
  ref: string;
  formula: string; // Formula starting with "=" like "=SUM(A1:A10)"
}

/**
 * Format range operation
 */
export interface FormatRangeOp {
  type: 'formatRange';
  sheetName: string;
  range: string;
  format: {
    numberFormat?: string;
    bold?: boolean;
    italic?: boolean;
    backgroundColor?: string;
    textColor?: string;
    horizontalAlignment?: 'left' | 'center' | 'right';
    verticalAlignment?: 'top' | 'middle' | 'bottom';
    fontSize?: number;
    fontName?: string;
  };
}

/**
 * Insert rows operation
 */
export interface InsertRowsOp {
  type: 'insertRows';
  sheetName: string;
  rowIndex: number;
  count: number;
  position?: 'above' | 'below';
}

/**
 * Insert columns operation
 */
export interface InsertColumnsOp {
  type: 'insertColumns';
  sheetName: string;
  columnRef: string; // Column letter like "A" or "B"
  count: number;
  position?: 'before' | 'after';
}

/**
 * Delete rows operation
 */
export interface DeleteRowsOp {
  type: 'deleteRows';
  sheetName: string;
  startRow: number;
  count: number;
}

/**
 * Delete columns operation
 */
export interface DeleteColumnsOp {
  type: 'deleteColumns';
  sheetName: string;
  startColumn: string;
  count: number;
}

/**
 * Create sheet operation
 */
export interface CreateSheetOp {
  type: 'createSheet';
  name: string;
  position?: number;
}

/**
 * Delete sheet operation
 */
export interface DeleteSheetOp {
  type: 'deleteSheet';
  sheetName: string;
}

/**
 * Rename sheet operation
 */
export interface RenameSheetOp {
  type: 'renameSheet';
  oldName: string;
  newName: string;
}

/**
 * Merge cells operation
 */
export interface MergeCellsOp {
  type: 'mergeCells';
  sheetName: string;
  range: string;
}

/**
 * Unmerge cells operation
 */
export interface UnmergeCellsOp {
  type: 'unmergeCells';
  sheetName: string;
  range: string;
}

/**
 * Helper function to parse cell reference
 */
export function parseCellRef(ref: string): { column: string; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { column: match[1], row: parseInt(match[2], 10) };
}

/**
 * Helper function to convert column letter to index (A=0, B=1, etc.)
 */
export function columnToIndex(column: string): number {
  let result = 0;
  for (let i = 0; i < column.length; i++) {
    result = result * 26 + (column.charCodeAt(i) - 64);
  }
  return result - 1;
}

/**
 * Helper function to convert index to column letter
 */
export function indexToColumn(index: number): string {
  let result = '';
  index++;
  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}
