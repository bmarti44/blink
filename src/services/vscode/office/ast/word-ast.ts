/**
 * Word Document AST Type Definitions
 *
 * Defines the structure for Word (.docx) documents that can be
 * manipulated through the LLM function calling interface.
 */

import type { BaseNode, Mark, DocumentMetadata } from './types';

/**
 * Root Word document structure
 */
export interface WordDocument {
  type: 'document';
  id: string;
  metadata: WordMetadata;
  body: Body;
  styles?: Style[];
}

/**
 * Word-specific metadata
 */
export interface WordMetadata extends DocumentMetadata {
  pageCount?: number;
  wordCount?: number;
  characterCount?: number;
}

/**
 * Document body containing block nodes
 */
export interface Body {
  type: 'body';
  children: BlockNode[];
}

/**
 * Block-level node types
 */
export type BlockNode = Paragraph | Table | List | Image | Section | PageBreak;

/**
 * Inline node types within paragraphs
 */
export type InlineNode = TextRun | InlineImage | HyperLink | Break;

/**
 * Paragraph element
 */
export interface Paragraph extends BaseNode {
  type: 'paragraph';
  styleId?: ParagraphStyle;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: {
    left?: number;
    right?: number;
    firstLine?: number;
  };
  spacing?: {
    before?: number;
    after?: number;
    lineHeight?: number;
  };
  children: InlineNode[];
}

/**
 * Paragraph style identifiers
 */
export type ParagraphStyle =
  | 'normal'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'title'
  | 'subtitle'
  | 'quote'
  | 'code';

/**
 * Text run with formatting
 */
export interface TextRun {
  type: 'text';
  text: string;
  marks?: Mark[];
}

/**
 * Line break
 */
export interface Break {
  type: 'break';
  breakType: 'line' | 'page' | 'column';
}

/**
 * Hyperlink
 */
export interface HyperLink {
  type: 'hyperlink';
  href: string;
  title?: string;
  children: TextRun[];
}

/**
 * Table element
 */
export interface Table extends BaseNode {
  type: 'table';
  rows: TableRow[];
  columnWidths?: number[];
  style?: {
    borders?: boolean;
    headerRow?: boolean;
    alternatingRows?: boolean;
  };
}

/**
 * Table row
 */
export interface TableRow {
  type: 'table_row';
  cells: TableCell[];
  isHeader?: boolean;
}

/**
 * Table cell
 */
export interface TableCell {
  type: 'table_cell';
  children: BlockNode[];
  colspan?: number;
  rowspan?: number;
  width?: number;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  backgroundColor?: string;
}

/**
 * List element
 */
export interface List extends BaseNode {
  type: 'list';
  listType: 'bullet' | 'number';
  items: ListItem[];
  start?: number;
}

/**
 * List item
 */
export interface ListItem {
  type: 'list_item';
  children: BlockNode[];
  level?: number;
}

/**
 * Block-level image
 */
export interface Image extends BaseNode {
  type: 'image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  alignment?: 'left' | 'center' | 'right';
}

/**
 * Inline image within text
 */
export interface InlineImage {
  type: 'inline_image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

/**
 * Document section (for headers/footers)
 */
export interface Section extends BaseNode {
  type: 'section';
  header?: Paragraph[];
  footer?: Paragraph[];
  children: BlockNode[];
}

/**
 * Page break
 */
export interface PageBreak extends BaseNode {
  type: 'page_break';
}

/**
 * Style definition
 */
export interface Style {
  id: string;
  name: string;
  basedOn?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

/**
 * Word-specific edit operations
 */
export type WordOperation =
  | InsertParagraphOp
  | DeleteParagraphOp
  | ReplaceParagraphOp
  | FormatTextOp
  | InsertTableOp
  | InsertListOp
  | ReplaceTextOp
  | ApplyStyleOp;

/**
 * Insert paragraph operation
 */
export interface InsertParagraphOp {
  type: 'insertParagraph';
  position: {
    type: 'after' | 'before' | 'start' | 'end';
    anchorId?: string;
  };
  content: string;
  styleId?: ParagraphStyle;
}

/**
 * Delete paragraph operation
 */
export interface DeleteParagraphOp {
  type: 'deleteParagraph';
  nodeId: string;
}

/**
 * Replace paragraph content operation
 */
export interface ReplaceParagraphOp {
  type: 'replaceParagraph';
  nodeId: string;
  content: string;
}

/**
 * Format text operation
 */
export interface FormatTextOp {
  type: 'formatText';
  paragraphId: string;
  startOffset: number;
  endOffset: number;
  marks: Mark[];
  action: 'add' | 'remove' | 'toggle';
}

/**
 * Insert table operation
 */
export interface InsertTableOp {
  type: 'insertTable';
  position: {
    type: 'after' | 'before';
    anchorId: string;
  };
  rows: number;
  columns: number;
  headers?: string[];
  data?: string[][];
}

/**
 * Insert list operation
 */
export interface InsertListOp {
  type: 'insertList';
  position: {
    type: 'after' | 'before';
    anchorId: string;
  };
  listType: 'bullet' | 'number';
  items: string[];
}

/**
 * Replace text operation (find/replace)
 */
export interface ReplaceTextOp {
  type: 'replaceText';
  find: string;
  replace: string;
  scope?: 'all' | 'selection' | 'paragraph';
  paragraphId?: string;
  caseSensitive?: boolean;
}

/**
 * Apply style operation
 */
export interface ApplyStyleOp {
  type: 'applyStyle';
  nodeId: string;
  styleId: ParagraphStyle;
}
