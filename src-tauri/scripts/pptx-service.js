#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Lazy load pptxgenjs to improve startup time
let PptxGenJS = null;

function getPptxGenJS() {
  if (!PptxGenJS) {
    PptxGenJS = require('pptxgenjs');
  }
  return PptxGenJS;
}

// Read a PowerPoint file and extract content
// Note: pptxgenjs is primarily for creation, so reading is limited
// For full read support, we parse the underlying XML
async function readPresentation(filePath) {
  const JSZip = require('jszip');

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);

  const slides = [];
  const textContent = [];

  // Find all slide XML files
  const slideFiles = Object.keys(zip.files)
    .filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1]);
      const numB = parseInt(b.match(/slide(\d+)/)[1]);
      return numA - numB;
    });

  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i];
    const content = await zip.file(slideFile).async('string');

    // Extract text from XML (simple regex extraction)
    const texts = [];
    const textMatches = content.matchAll(/<a:t>([^<]*)<\/a:t>/g);
    for (const match of textMatches) {
      if (match[1].trim()) {
        texts.push(match[1]);
      }
    }

    // Try to identify title (usually first text element with larger font)
    const title = texts[0] || '';
    const body = texts.slice(1).join('\n');

    slides.push({
      index: i,
      title,
      body,
      notes: '',
      shapes: [],
    });

    textContent.push(...texts);
  }

  // Try to read notes
  for (let i = 0; i < slideFiles.length; i++) {
    const notesFile = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    if (zip.files[notesFile]) {
      try {
        const notesContent = await zip.file(notesFile).async('string');
        const notesTexts = [];
        const matches = notesContent.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        for (const match of matches) {
          if (match[1].trim()) {
            notesTexts.push(match[1]);
          }
        }
        if (slides[i]) {
          slides[i].notes = notesTexts.join('\n');
        }
      } catch (e) {
        // Notes file might not exist
      }
    }
  }

  return {
    slides,
    slide_count: slides.length,
    text_content: textContent.join('\n'),
    title: slides[0]?.title || '',
    author: '',
  };
}

// Create or modify a PowerPoint file
async function applyEdits(filePath, edits) {
  const PptxGen = getPptxGenJS();

  // For now, we create a new presentation and apply edits
  // Full modification of existing files would require pptx-automizer
  let pres = new PptxGen();

  // If file exists, we need to read it first and recreate
  // This is a limitation - pptxgenjs is creation-focused
  let existingSlides = [];
  if (fs.existsSync(filePath)) {
    try {
      const existing = await readPresentation(filePath);
      existingSlides = existing.slides;
    } catch (e) {
      // Ignore read errors, start fresh
    }
  }

  // Recreate existing slides
  for (const slideData of existingSlides) {
    const slide = pres.addSlide();
    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 1,
        fontSize: 24,
        bold: true,
      });
    }
    if (slideData.body) {
      slide.addText(slideData.body, {
        x: 0.5,
        y: 1.75,
        w: 9,
        h: 4,
        fontSize: 14,
      });
    }
  }

  // Apply edits
  for (const edit of edits) {
    switch (edit.type) {
      case 'AddSlide': {
        const slide = pres.addSlide();
        // Layout is handled by pptxgenjs differently
        break;
      }

      case 'SetSlideTitle': {
        const idx = edit.index || 0;
        // pptxgenjs doesn't support modifying existing slides easily
        // This is a limitation - we'd need pptx-automizer for this
        if (pres.slides[idx]) {
          pres.slides[idx].addText(edit.title, {
            x: 0.5,
            y: 0.5,
            w: 9,
            h: 1,
            fontSize: 24,
            bold: true,
          });
        }
        break;
      }

      case 'SetSlideBody': {
        const idx = edit.index || 0;
        if (pres.slides[idx]) {
          pres.slides[idx].addText(edit.body, {
            x: 0.5,
            y: 1.75,
            w: 9,
            h: 4,
            fontSize: 14,
          });
        }
        break;
      }

      case 'AddTextBox': {
        const slideIdx = edit.slide || 0;
        if (pres.slides[slideIdx]) {
          const pos = edit.position || {};
          pres.slides[slideIdx].addText(edit.text, {
            x: pos.left_inches || 1,
            y: pos.top_inches || 1,
            w: pos.width_inches || 4,
            h: pos.height_inches || 1,
            fontSize: 12,
          });
        }
        break;
      }

      case 'AddShape': {
        const slideIdx = edit.slide || 0;
        if (pres.slides[slideIdx]) {
          const pos = edit.position || {};
          const shapeType = edit.shape_type || 'rectangle';

          // Map shape types
          const shapeMap = {
            rectangle: 'rect',
            oval: 'ellipse',
            ellipse: 'ellipse',
            triangle: 'triangle',
            arrow: 'rightArrow',
          };

          pres.slides[slideIdx].addShape(shapeMap[shapeType] || 'rect', {
            x: pos.left_inches || 1,
            y: pos.top_inches || 1,
            w: pos.width_inches || 2,
            h: pos.height_inches || 2,
            fill: { color: '0088CC' },
          });
        }
        break;
      }

      case 'SetSpeakerNotes': {
        const idx = edit.index || 0;
        if (pres.slides[idx]) {
          pres.slides[idx].addNotes(edit.notes);
        }
        break;
      }

      case 'DeleteSlide': {
        // pptxgenjs doesn't support deleting slides
        // We'd need to rebuild without that slide
        break;
      }
    }
  }

  // If no slides were added, add a blank one
  if (pres.slides.length === 0) {
    pres.addSlide();
  }

  // Save the file
  await pres.writeFile({ fileName: filePath });

  return { success: true };
}

// CLI interface
async function main() {
  const [, , command, ...args] = process.argv;

  try {
    if (command === 'read') {
      const filePath = args[0];
      if (!filePath) {
        throw new Error('File path required');
      }
      const result = await readPresentation(filePath);
      console.log(JSON.stringify(result));
    } else if (command === 'edit') {
      const inputJson = args[0];
      if (!inputJson) {
        throw new Error('Input JSON required');
      }

      const input = JSON.parse(inputJson);
      const filePath = input.path;
      const edits = typeof input.edits === 'string' ? JSON.parse(input.edits) : input.edits;

      const result = await applyEdits(filePath, edits);
      console.log(JSON.stringify(result));
    } else if (command === 'create') {
      // Create a new empty presentation
      const filePath = args[0];
      if (!filePath) {
        throw new Error('File path required');
      }

      const PptxGen = getPptxGenJS();
      const pres = new PptxGen();
      pres.addSlide(); // Add one blank slide
      await pres.writeFile({ fileName: filePath });
      console.log(JSON.stringify({ success: true, path: filePath }));
    } else if (command === 'version') {
      console.log(JSON.stringify({ version: '1.0.0', node: process.version }));
    } else {
      console.error(JSON.stringify({ error: `Unknown command: ${command}` }));
      process.exit(1);
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }));
    process.exit(1);
  }
}

main();
