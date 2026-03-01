/**
 * LLM Function Calling Schemas for Document Operations
 *
 * OpenAI-compatible function calling schemas for document manipulation.
 * These schemas enable LLMs to understand and execute document operations
 * through a well-defined interface.
 */

/**
 * Tool definition type (OpenAI-compatible)
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    strict?: boolean;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
  };
}

/**
 * Word document operation schemas
 */
export const WORD_OPERATIONS: { tools: ToolDefinition[] } = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'insertParagraph',
        description: 'Insert a new paragraph at the specified location in a Word document',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            position: {
              type: 'object',
              description: 'Where to insert the paragraph',
              properties: {
                type: { type: 'string', enum: ['after', 'before', 'start', 'end'] },
                anchorId: { type: 'string', description: 'ID of the element to position relative to' }
              },
              required: ['type']
            },
            content: { type: 'string', description: 'Text content of the paragraph' },
            styleId: {
              type: 'string',
              enum: ['normal', 'heading1', 'heading2', 'heading3', 'heading4', 'title', 'subtitle', 'quote', 'code'],
              description: 'Paragraph style to apply'
            }
          },
          required: ['position', 'content'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'formatText',
        description: 'Apply formatting to a range of text within a paragraph',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            paragraphId: { type: 'string', description: 'ID of the paragraph containing the text' },
            startOffset: { type: 'integer', minimum: 0, description: 'Start position in characters' },
            endOffset: { type: 'integer', minimum: 0, description: 'End position in characters' },
            marks: {
              type: 'array',
              description: 'Formatting marks to apply',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight'] },
                  attrs: { type: 'object', description: 'Additional attributes like href for links' }
                },
                required: ['type']
              }
            },
            action: { type: 'string', enum: ['add', 'remove', 'toggle'], description: 'How to apply the formatting' }
          },
          required: ['paragraphId', 'startOffset', 'endOffset', 'marks', 'action'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertTable',
        description: 'Insert a table at the specified location',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            position: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['after', 'before'] },
                anchorId: { type: 'string' }
              },
              required: ['type', 'anchorId']
            },
            rows: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of rows' },
            columns: { type: 'integer', minimum: 1, maximum: 26, description: 'Number of columns' },
            headers: { type: 'array', items: { type: 'string' }, description: 'Header row content' },
            data: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Table data rows'
            }
          },
          required: ['position', 'rows', 'columns'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteNode',
        description: 'Delete a paragraph, table, or other block element from the document',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'ID of the node to delete' }
          },
          required: ['nodeId'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replaceText',
        description: 'Find and replace text within the document',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            find: { type: 'string', description: 'Text to find' },
            replace: { type: 'string', description: 'Replacement text' },
            scope: { type: 'string', enum: ['all', 'selection', 'paragraph'], description: 'Scope of replacement' },
            paragraphId: { type: 'string', description: 'Paragraph ID if scope is "paragraph"' },
            caseSensitive: { type: 'boolean', description: 'Whether search is case sensitive' }
          },
          required: ['find', 'replace'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertList',
        description: 'Insert a bulleted or numbered list',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            position: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['after', 'before'] },
                anchorId: { type: 'string' }
              },
              required: ['type', 'anchorId']
            },
            listType: { type: 'string', enum: ['bullet', 'number'], description: 'Type of list' },
            items: { type: 'array', items: { type: 'string' }, description: 'List items' }
          },
          required: ['position', 'listType', 'items'],
          additionalProperties: false
        }
      }
    }
  ]
};

/**
 * Excel workbook operation schemas
 */
export const EXCEL_OPERATIONS: { tools: ToolDefinition[] } = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'setCellValue',
        description: 'Set the value of a cell or range of cells in an Excel worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            ref: { type: 'string', description: 'Cell reference like A1 or range like A1:C3' },
            value: {
              description: 'Value to set - can be string, number, boolean, or 2D array for ranges',
              oneOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'array', items: { type: 'array' } }
              ]
            },
            dataType: {
              type: 'string',
              enum: ['auto', 'string', 'number', 'date', 'boolean'],
              description: 'Data type hint for the value'
            }
          },
          required: ['sheetName', 'ref', 'value'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setCellFormula',
        description: 'Set a formula in a cell',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            ref: { type: 'string', description: 'Cell reference like A1' },
            formula: { type: 'string', description: 'Formula starting with = like =SUM(A1:A10)' }
          },
          required: ['sheetName', 'ref', 'formula'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'formatRange',
        description: 'Apply formatting to a range of cells',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            range: { type: 'string', description: 'Cell range like A1:C10' },
            format: {
              type: 'object',
              description: 'Formatting options to apply',
              properties: {
                numberFormat: { type: 'string', description: 'Number format like #,##0.00 or mm/dd/yyyy' },
                bold: { type: 'boolean' },
                italic: { type: 'boolean' },
                backgroundColor: { type: 'string', description: 'Hex color like #FF0000' },
                textColor: { type: 'string', description: 'Hex color for text' },
                horizontalAlignment: { type: 'string', enum: ['left', 'center', 'right'] },
                fontSize: { type: 'number' }
              }
            }
          },
          required: ['sheetName', 'range', 'format'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertRows',
        description: 'Insert rows at a position in the worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            rowIndex: { type: 'integer', minimum: 1, description: 'Row number (1-based)' },
            count: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of rows to insert' },
            position: { type: 'string', enum: ['above', 'below'], description: 'Insert above or below the row' }
          },
          required: ['sheetName', 'rowIndex', 'count'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertColumns',
        description: 'Insert columns at a position in the worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            columnRef: { type: 'string', description: 'Column letter like A or B' },
            count: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of columns to insert' },
            position: { type: 'string', enum: ['before', 'after'], description: 'Insert before or after the column' }
          },
          required: ['sheetName', 'columnRef', 'count'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteRows',
        description: 'Delete rows from a worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            startRow: { type: 'integer', minimum: 1, description: 'First row to delete (1-based)' },
            count: { type: 'integer', minimum: 1, description: 'Number of rows to delete' }
          },
          required: ['sheetName', 'startRow', 'count'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteColumns',
        description: 'Delete columns from a worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the worksheet' },
            startColumn: { type: 'string', description: 'First column to delete (letter)' },
            count: { type: 'integer', minimum: 1, description: 'Number of columns to delete' }
          },
          required: ['sheetName', 'startColumn', 'count'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'createSheet',
        description: 'Create a new worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name for the new sheet' },
            position: { type: 'integer', minimum: 0, description: 'Position to insert the sheet' }
          },
          required: ['name'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteSheet',
        description: 'Delete a worksheet',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            sheetName: { type: 'string', description: 'Name of the sheet to delete' }
          },
          required: ['sheetName'],
          additionalProperties: false
        }
      }
    }
  ]
};

/**
 * PowerPoint presentation operation schemas
 */
export const PPTX_OPERATIONS: { tools: ToolDefinition[] } = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'addSlide',
        description: 'Add a new slide to the presentation',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            position: { type: 'integer', minimum: 0, description: 'Position to insert the slide (0-based)' },
            layoutId: {
              type: 'string',
              enum: ['title', 'titleAndContent', 'sectionHeader', 'twoColumn', 'blank', 'titleOnly'],
              description: 'Slide layout to use'
            },
            title: { type: 'string', description: 'Title text for the slide' },
            content: { type: 'string', description: 'Body content for the slide' }
          },
          required: ['position'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'updateSlideText',
        description: 'Update text content in a slide shape',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            slideIndex: { type: 'integer', minimum: 0, description: 'Slide index (0-based)' },
            shapeId: { type: 'string', description: 'ID of the shape to update' },
            text: { type: 'string', description: 'New text content' }
          },
          required: ['slideIndex', 'shapeId', 'text'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertTextBox',
        description: 'Insert a text box on a slide',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            slideIndex: { type: 'integer', minimum: 0, description: 'Slide index (0-based)' },
            x: { type: 'number', description: 'X position as percentage (0-100)' },
            y: { type: 'number', description: 'Y position as percentage (0-100)' },
            width: { type: 'number', description: 'Width as percentage' },
            height: { type: 'number', description: 'Height as percentage' },
            text: { type: 'string', description: 'Text content' },
            fontSize: { type: 'number', description: 'Font size in points' },
            fontBold: { type: 'boolean', description: 'Whether text is bold' }
          },
          required: ['slideIndex', 'x', 'y', 'width', 'height', 'text'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteSlide',
        description: 'Delete a slide from the presentation',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            slideIndex: { type: 'integer', minimum: 0, description: 'Index of the slide to delete (0-based)' }
          },
          required: ['slideIndex'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reorderSlides',
        description: 'Move a slide to a new position',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            fromIndex: { type: 'integer', minimum: 0, description: 'Current position of the slide' },
            toIndex: { type: 'integer', minimum: 0, description: 'New position for the slide' }
          },
          required: ['fromIndex', 'toIndex'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setSlideNotes',
        description: 'Set speaker notes for a slide',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            slideIndex: { type: 'integer', minimum: 0, description: 'Slide index (0-based)' },
            notes: { type: 'string', description: 'Speaker notes content' }
          },
          required: ['slideIndex', 'notes'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertShape',
        description: 'Insert a shape on a slide',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            slideIndex: { type: 'integer', minimum: 0, description: 'Slide index (0-based)' },
            shapeType: {
              type: 'string',
              enum: ['rect', 'oval', 'roundRect', 'triangle', 'diamond', 'arrow', 'line'],
              description: 'Type of shape to insert'
            },
            x: { type: 'number', description: 'X position as percentage' },
            y: { type: 'number', description: 'Y position as percentage' },
            width: { type: 'number', description: 'Width as percentage' },
            height: { type: 'number', description: 'Height as percentage' },
            fill: { type: 'string', description: 'Fill color (hex)' },
            text: { type: 'string', description: 'Text inside the shape' }
          },
          required: ['slideIndex', 'shapeType', 'x', 'y', 'width', 'height'],
          additionalProperties: false
        }
      }
    }
  ]
};

/**
 * Get all document operation schemas
 */
export function getAllOperationSchemas(): { tools: ToolDefinition[] } {
  return {
    tools: [
      ...WORD_OPERATIONS.tools,
      ...EXCEL_OPERATIONS.tools,
      ...PPTX_OPERATIONS.tools
    ]
  };
}

/**
 * Get schemas for a specific document type
 */
export function getOperationSchemasForType(documentType: 'word' | 'excel' | 'powerpoint'): { tools: ToolDefinition[] } {
  switch (documentType) {
    case 'word':
      return WORD_OPERATIONS;
    case 'excel':
      return EXCEL_OPERATIONS;
    case 'powerpoint':
      return PPTX_OPERATIONS;
  }
}
