/**
 * PowerPoint Presentation AST Type Definitions
 *
 * Defines the structure for PowerPoint (.pptx) presentations that can be
 * manipulated through the LLM function calling interface.
 */

import type { BaseNode, Mark, DocumentMetadata } from './types';

/**
 * Root PowerPoint presentation structure
 */
export interface PowerPointPresentation {
  type: 'presentation';
  id: string;
  metadata: PresentationMetadata;
  slides: Slide[];
  slideMasters?: SlideMaster[];
  theme?: Theme;
}

/**
 * Presentation-specific metadata
 */
export interface PresentationMetadata extends DocumentMetadata {
  slideCount?: number;
  slideWidth?: number;
  slideHeight?: number;
}

/**
 * Slide within a presentation
 */
export interface Slide extends BaseNode {
  type: 'slide';
  index: number;
  layoutId?: SlideLayoutType;
  shapes: Shape[];
  notes?: string;
  transition?: SlideTransition;
  hidden?: boolean;
}

/**
 * Slide layout type identifiers
 */
export type SlideLayoutType =
  | 'title'
  | 'titleAndContent'
  | 'sectionHeader'
  | 'twoColumn'
  | 'comparison'
  | 'titleOnly'
  | 'blank'
  | 'contentWithCaption'
  | 'pictureWithCaption';

/**
 * Shape types on a slide
 */
export type Shape = TextBox | ImageShape | ChartShape | TableShape | BasicShape | VideoShape;

/**
 * Position specification
 */
export interface Position {
  x: number; // Percentage (0-100) or absolute in EMUs
  y: number;
}

/**
 * Size specification
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * Text box shape
 */
export interface TextBox extends BaseNode {
  type: 'textbox';
  position: Position;
  size: Size;
  content: TextParagraph[];
  fill?: ShapeFill;
  outline?: ShapeOutline;
  rotation?: number;
}

/**
 * Text paragraph within a text box
 */
export interface TextParagraph {
  type: 'text_paragraph';
  alignment?: 'left' | 'center' | 'right' | 'justify';
  bulletType?: 'none' | 'bullet' | 'number';
  level?: number;
  runs: TextRun[];
}

/**
 * Text run with formatting
 */
export interface TextRun {
  type: 'text';
  text: string;
  marks?: Mark[];
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

/**
 * Image shape
 */
export interface ImageShape extends BaseNode {
  type: 'image';
  position: Position;
  size: Size;
  src: string;
  alt?: string;
  rotation?: number;
}

/**
 * Chart shape
 */
export interface ChartShape extends BaseNode {
  type: 'chart';
  position: Position;
  size: Size;
  chartType: 'bar' | 'column' | 'line' | 'pie' | 'scatter' | 'area';
  data: ChartData;
  title?: string;
}

/**
 * Chart data
 */
export interface ChartData {
  categories: string[];
  series: ChartSeries[];
}

/**
 * Chart series
 */
export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

/**
 * Table shape on a slide
 */
export interface TableShape extends BaseNode {
  type: 'table';
  position: Position;
  size: Size;
  rows: SlideTableRow[];
  style?: TableStyle;
}

/**
 * Table row
 */
export interface SlideTableRow {
  cells: SlideTableCell[];
  height?: number;
}

/**
 * Table cell
 */
export interface SlideTableCell {
  text: string;
  colspan?: number;
  rowspan?: number;
  fill?: string;
  fontBold?: boolean;
}

/**
 * Table style
 */
export interface TableStyle {
  firstRow?: boolean;
  lastRow?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
  bandedRows?: boolean;
  bandedCols?: boolean;
}

/**
 * Basic shape (rectangle, oval, etc.)
 */
export interface BasicShape extends BaseNode {
  type: 'shape';
  shapeType: 'rect' | 'oval' | 'roundRect' | 'triangle' | 'diamond' | 'arrow' | 'line';
  position: Position;
  size: Size;
  fill?: ShapeFill;
  outline?: ShapeOutline;
  text?: TextParagraph[];
  rotation?: number;
}

/**
 * Video shape
 */
export interface VideoShape extends BaseNode {
  type: 'video';
  position: Position;
  size: Size;
  src: string;
  poster?: string;
}

/**
 * Shape fill properties
 */
export interface ShapeFill {
  type: 'solid' | 'gradient' | 'pattern' | 'none';
  color?: string;
  gradientStops?: { position: number; color: string }[];
}

/**
 * Shape outline properties
 */
export interface ShapeOutline {
  width?: number;
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

/**
 * Slide master definition
 */
export interface SlideMaster {
  id: string;
  name: string;
  layouts: SlideLayout[];
}

/**
 * Slide layout definition
 */
export interface SlideLayout {
  id: string;
  name: string;
  type: SlideLayoutType;
  placeholders: Placeholder[];
}

/**
 * Placeholder definition
 */
export interface Placeholder {
  type: 'title' | 'body' | 'chart' | 'table' | 'picture' | 'footer' | 'slideNumber' | 'date';
  position: Position;
  size: Size;
}

/**
 * Slide transition
 */
export interface SlideTransition {
  type: 'none' | 'fade' | 'push' | 'wipe' | 'split' | 'reveal' | 'random';
  duration?: number;
  direction?: 'left' | 'right' | 'up' | 'down';
}

/**
 * Presentation theme
 */
export interface Theme {
  name: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
}

/**
 * Theme colors
 */
export interface ThemeColors {
  primary: string;
  secondary: string;
  accent1: string;
  accent2: string;
  background1: string;
  background2: string;
  text1: string;
  text2: string;
}

/**
 * Theme fonts
 */
export interface ThemeFonts {
  heading: string;
  body: string;
}

/**
 * PowerPoint-specific edit operations
 */
export type PowerPointOperation =
  | AddSlideOp
  | DeleteSlideOp
  | ReorderSlidesOp
  | UpdateSlideTextOp
  | InsertTextBoxOp
  | InsertImageOp
  | InsertShapeOp
  | InsertTableOp
  | DeleteShapeOp
  | UpdateShapeOp
  | SetSlideNotesOp
  | SetSlideLayoutOp;

/**
 * Add slide operation
 */
export interface AddSlideOp {
  type: 'addSlide';
  position?: number;
  layoutId?: SlideLayoutType;
  title?: string;
  content?: string;
}

/**
 * Delete slide operation
 */
export interface DeleteSlideOp {
  type: 'deleteSlide';
  slideIndex: number;
}

/**
 * Reorder slides operation
 */
export interface ReorderSlidesOp {
  type: 'reorderSlides';
  fromIndex: number;
  toIndex: number;
}

/**
 * Update slide text operation
 */
export interface UpdateSlideTextOp {
  type: 'updateSlideText';
  slideIndex: number;
  shapeId: string;
  text: string;
}

/**
 * Insert text box operation
 */
export interface InsertTextBoxOp {
  type: 'insertTextBox';
  slideIndex: number;
  x: number; // Percentage (0-100)
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize?: number;
  fontBold?: boolean;
  alignment?: 'left' | 'center' | 'right';
}

/**
 * Insert image operation
 */
export interface InsertImageOp {
  type: 'insertImage';
  slideIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string; // URL or base64
  alt?: string;
}

/**
 * Insert shape operation
 */
export interface InsertShapeOp {
  type: 'insertShape';
  slideIndex: number;
  shapeType: 'rect' | 'oval' | 'roundRect' | 'triangle' | 'diamond' | 'arrow' | 'line';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  outline?: string;
  text?: string;
}

/**
 * Insert table operation
 */
export interface InsertTableOp {
  type: 'insertTable';
  slideIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  columns: number;
  data?: string[][];
}

/**
 * Delete shape operation
 */
export interface DeleteShapeOp {
  type: 'deleteShape';
  slideIndex: number;
  shapeId: string;
}

/**
 * Update shape operation
 */
export interface UpdateShapeOp {
  type: 'updateShape';
  slideIndex: number;
  shapeId: string;
  position?: Position;
  size?: Size;
  fill?: string;
  outline?: string;
}

/**
 * Set slide notes operation
 */
export interface SetSlideNotesOp {
  type: 'setSlideNotes';
  slideIndex: number;
  notes: string;
}

/**
 * Set slide layout operation
 */
export interface SetSlideLayoutOp {
  type: 'setSlideLayout';
  slideIndex: number;
  layoutId: SlideLayoutType;
}
