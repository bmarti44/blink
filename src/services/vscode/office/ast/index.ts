/**
 * Office Document AST Type Definitions
 *
 * Exports all AST types for document manipulation.
 */

// Core types
export type {
  BaseNode,
  InsertPosition,
  Mark,
  BaseOperation,
  OperationResult,
  ValidationError,
  ValidationWarning,
  ValidationResult,
  DocumentMetadata,
  DocumentType,
  BaseDocument,
} from './types';

// Word document types
export type {
  WordDocument,
  WordMetadata,
  Body,
  BlockNode,
  InlineNode,
  Paragraph,
  ParagraphStyle,
  TextRun as WordTextRun,
  Break,
  HyperLink,
  Table as WordTable,
  TableRow as WordTableRow,
  TableCell as WordTableCell,
  List,
  ListItem,
  Image,
  InlineImage,
  Section,
  PageBreak,
  Style,
  WordOperation,
  InsertParagraphOp,
  DeleteParagraphOp,
  ReplaceParagraphOp,
  FormatTextOp,
  InsertTableOp as WordInsertTableOp,
  InsertListOp,
  ReplaceTextOp,
  ApplyStyleOp,
} from './word-ast';

// Excel workbook types
export type {
  ExcelWorkbook,
  WorkbookMetadata,
  Sheet,
  SheetData,
  Row,
  Cell,
  CellValue,
  CellDataType,
  NamedRange,
  MergedCell,
  ConditionalFormat,
  CellStyle,
  FontStyle,
  FillStyle,
  BorderStyle,
  BorderEdge,
  AlignmentStyle,
  ExcelOperation,
  SetCellValueOp,
  SetCellFormulaOp,
  FormatRangeOp,
  InsertRowsOp,
  InsertColumnsOp,
  DeleteRowsOp,
  DeleteColumnsOp,
  CreateSheetOp,
  DeleteSheetOp,
  RenameSheetOp,
  MergeCellsOp,
  UnmergeCellsOp,
} from './excel-ast';

export {
  parseCellRef,
  columnToIndex,
  indexToColumn,
} from './excel-ast';

// PowerPoint presentation types
export type {
  PowerPointPresentation,
  PresentationMetadata,
  Slide,
  SlideLayoutType,
  Shape,
  Position,
  Size,
  TextBox,
  TextParagraph,
  TextRun as PptxTextRun,
  ImageShape,
  ChartShape,
  ChartData,
  ChartSeries,
  TableShape,
  SlideTableRow,
  SlideTableCell,
  TableStyle,
  BasicShape,
  VideoShape,
  ShapeFill,
  ShapeOutline,
  SlideMaster,
  SlideLayout,
  Placeholder,
  SlideTransition,
  Theme,
  ThemeColors,
  ThemeFonts,
  PowerPointOperation,
  AddSlideOp,
  DeleteSlideOp,
  ReorderSlidesOp,
  UpdateSlideTextOp,
  InsertTextBoxOp,
  InsertImageOp,
  InsertShapeOp,
  InsertTableOp as PptxInsertTableOp,
  DeleteShapeOp,
  UpdateShapeOp,
  SetSlideNotesOp,
  SetSlideLayoutOp,
} from './pptx-ast';

// Operation types and utilities
export type {
  DocumentOperation,
  ContextualOperation,
  OperationBatch,
  BatchResult,
  HistoryEntry,
  IOperationExecutor,
} from './operations';

export {
  getDocumentTypeForOperation,
  isOperationValidForType,
  createOperationId,
  createHistoryEntry,
} from './operations';
