# NoteAnchor PDF Note Model 0.5.0 Draft

## 1. Purpose

The goal of this document is to define a practical data model for real PDF notes in NoteAnchor 0.5.0.

The target workflow is local correction notes for PDF documents, especially for editors and translators working with already layouted PDFs. NoteAnchor should not become a full PDF editor, and the original PDF should remain unchanged.

## 2. Compatibility with current notes

Existing TXT and DOCX notes must not break.

Existing simple PDF page notes from 0.4.x must also remain usable. They should either:

- continue to load exactly as they do now; or
- be safely interpreted as page notes without coordinates.

The safest rule is:

- keep the same sidecar storage pattern;
- preserve old fields when reading old PDF notes;
- interpret old PDF notes as page-level anchors if no richer PDF anchor data exists.

This compatibility requirement still applies after the first production PDF point-note integration:

- old PDF page notes continue to load and display as page notes;
- new PDF point notes live in the same `document.pdf.notes.json` flow;
- no destructive rewrite of older PDF notes is required.

This compatibility requirement also still applies if older experimental PDF text-note files exist:

- old PDF page notes continue to load and display as page notes;
- production PDF point notes continue to load and display as point notes;
- older PDF text notes may still live in the same `document.pdf.notes.json` flow;
- no destructive rewrite of older PDF notes is required.

## 3. Current note model summary

Current note structure in the app is defined in [src/App.tsx](C:/Users/Andrew/Documents/Codex/2026-06-09-note-anchor-prototype/src/App.tsx:31).

Current fields:

- `id: number`
- `paragraphIndex: number`
- `startOffset: number`
- `endOffset: number`
- `noteKind?: 'pdf-page'`
- `pdfPageNumber?: number`
- `selectedText: string`
- `previousSelectedText?: string`
- `context: string`
- `comment: string`

Important observations:

- TXT and DOCX notes use `paragraphIndex`, `startOffset`, and `endOffset` as their text anchor.
- PDF prototype notes currently reuse the same general note shape, but add:
  - `noteKind: 'pdf-page'`
  - `pdfPageNumber`
- Current PDF page anchor creation is defined in [src/App.tsx](C:/Users/Andrew/Documents/Codex/2026-06-09-note-anchor-prototype/src/App.tsx:1207).
- Current PDF page notes are represented as:
  - `selectedText: "Page N"`
  - `context: "PDF page N"`
  - `paragraphIndex: pageNumber - 1`
  - `startOffset: 0`
  - `endOffset: 1`

Current production PDF point notes now also exist in the main app and use:

- `documentType: 'pdf'`
- `anchorType: 'point'`
- `pdfPageNumber`
- `xRatio`
- `yRatio`
- optional pixel coordinates such as `x` and `y`
- `pageWidth`
- `pageHeight`
- `selectedText: ''`
- `context` as a human-readable page/position summary

Older experimental PDF text notes may also exist in saved files and use:

- `documentType: 'pdf'`
- `anchorType: 'text'`
- `pdfPageNumber`
- `selectedText`
- `context`
- `pdfHighlightRects`
- first-rectangle normalized fields such as `xRatio`, `yRatio`, `widthRatio`, `heightRatio`
- optional pixel fields such as `x`, `y`, `width`, `height`
- `pageWidth`
- `pageHeight`

Current stable production behavior around these PDF text-note fields is:

- production PDF text-note creation is disabled in the main app;
- older saved PDF text-note records should still load safely as note data;
- production PDF mode should not depend on DOM text-layer hit-testing for new text notes;
- the original PDF is not modified.

Fields not currently present in the main note model:

- no `createdAt`
- no `updatedAt`
- no timestamp metadata yet

## 4. Proposed PDF note anchor types

### A. Page note

- Attached to a page only.
- Useful for general comments about a whole page or a broad issue.

### B. Point note

- Attached to one x/y point on a page.
- Useful for marking a small correction or precise spot.

### C. Area note

- Attached to a rectangle on a page.
- Useful for marking a word, phrase, paragraph, image, or layout problem.

### D. Text note, future

- Attached to selected PDF text if reliable text layer support is added later.
- May still also carry coordinate or area data as a fallback.

Note: older experimental PDF text notes may already exist in saved files, but production creation is currently disabled. Future work should come back through a more reliable geometry-based approach.

## 5. Proposed PDF note fields

Proposed PDF note object shape:

```ts
type PdfAnchorType = 'page' | 'point' | 'area' | 'text'

type PdfNote = {
  id: number
  documentType: 'pdf'
  anchorType: PdfAnchorType
  pageNumber: number
  comment: string
  createdAt?: string
  updatedAt?: string
  pageLabel?: string
  pageWidth?: number
  pageHeight?: number
  xRatio?: number
  yRatio?: number
  widthRatio?: number
  heightRatio?: number
  pdfHighlightRects?: Array<{
    xRatio: number
    yRatio: number
    widthRatio: number
    heightRatio: number
  }>
  x?: number
  y?: number
  width?: number
  height?: number
  selectedText?: string
  context?: string
  color?: string
  status?: string
  sourceVersion?: string
  noteKind?: 'pdf-page'
  pdfPageNumber?: number
}
```

Recommended field meanings:

- `id`
  - existing note id pattern
- `documentType: 'pdf'`
  - explicit signal that this note belongs to the PDF model
- `anchorType`
  - `page`, `point`, `area`, or future `text`
- `pageNumber`
  - required primary page reference
- `comment`
  - user note text
- `createdAt`, `updatedAt`
  - recommended new metadata for PDF notes and likely useful later for all note types
- `pageLabel`
  - optional visible page label if the PDF viewer later exposes one
- `pageWidth`, `pageHeight`
  - optional reference dimensions for the page used when the anchor was created
- `xRatio`, `yRatio`, `widthRatio`, `heightRatio`
  - preferred normalized anchor coordinates
- `pdfHighlightRects`
  - preferred multi-rectangle highlight storage for PDF text notes
- `x`, `y`, `width`, `height`
  - optional pixel values from the render where the note was created
- `selectedText`
  - used by older experimental PDF text notes and likely still needed for any future text-note model
- `context`
  - optional nearby text or human-readable anchor summary
- `color`, `status`
  - optional future UX fields
- `sourceVersion`
  - optional marker such as `0.5.0-pdf-note-model`
- `noteKind`, `pdfPageNumber`
  - legacy compatibility fields for 0.4.x page notes

## 6. Coordinate strategy

Normalized coordinates are important because:

- zoom may change;
- page render scale may change;
- different screens may render the page differently.

Preferred storage strategy:

- treat normalized coordinates as the canonical PDF anchor data;
- treat pixel coordinates as optional convenience/debug data from the current render.

Conversions:

- current pixel click to normalized position:
  - `xRatio = x / pageWidth`
  - `yRatio = y / pageHeight`
  - `widthRatio = width / pageWidth`
  - `heightRatio = height / pageHeight`

- normalized position to current pixel position:
  - `x = xRatio * currentRenderedPageWidth`
  - `y = yRatio * currentRenderedPageHeight`
  - `width = widthRatio * currentRenderedPageWidth`
  - `height = heightRatio * currentRenderedPageHeight`

This strategy keeps anchors stable even if the page is redrawn at a different zoom level.

## 7. Storage file

Recommended storage path should remain:

- `document.pdf.notes.json`

This keeps the same path pattern already used by the production PDF prototype and avoids unnecessary file-path churn.

This is also the path used by the current production point-note implementation.

This is also the path that older experimental PDF text notes already use.

## 8. Example JSON

### Page note

```json
{
  "id": 101,
  "documentType": "pdf",
  "anchorType": "page",
  "pageNumber": 3,
  "comment": "General page note about spacing.",
  "createdAt": "2026-06-23T10:15:00.000Z",
  "updatedAt": "2026-06-23T10:15:00.000Z",
  "pageLabel": "3"
}
```

### Point note

```json
{
  "id": 102,
  "documentType": "pdf",
  "anchorType": "point",
  "pageNumber": 3,
  "comment": "Comma needed here.",
  "createdAt": "2026-06-23T10:16:00.000Z",
  "updatedAt": "2026-06-23T10:16:00.000Z",
  "pageWidth": 820,
  "pageHeight": 1160,
  "xRatio": 0.4125,
  "yRatio": 0.2879,
  "x": 338,
  "y": 334
}
```

### Area note

```json
{
  "id": 103,
  "documentType": "pdf",
  "anchorType": "area",
  "pageNumber": 4,
  "comment": "Paragraph alignment looks off.",
  "createdAt": "2026-06-23T10:17:00.000Z",
  "updatedAt": "2026-06-23T10:17:00.000Z",
  "pageWidth": 820,
  "pageHeight": 1160,
  "xRatio": 0.1400,
  "yRatio": 0.4380,
  "widthRatio": 0.5200,
  "heightRatio": 0.0850,
  "x": 115,
  "y": 508,
  "width": 426,
  "height": 99
}
```

### Future text note

```json
{
  "id": 104,
  "documentType": "pdf",
  "anchorType": "text",
  "pageNumber": 4,
  "comment": "Use the earlier phrasing for consistency.",
  "createdAt": "2026-06-23T10:18:00.000Z",
  "updatedAt": "2026-06-23T10:18:00.000Z",
  "selectedText": "modest boldness",
  "context": "The phrase appears in the middle of the paragraph.",
  "pdfHighlightRects": [
    {
      "xRatio": 0.2620,
      "yRatio": 0.4010,
      "widthRatio": 0.1280,
      "heightRatio": 0.0220
    }
  ],
  "xRatio": 0.2620,
  "yRatio": 0.4010,
  "widthRatio": 0.1280,
  "heightRatio": 0.0220
}
```

## 9. Migration / backward compatibility

Old PDF page notes should be interpreted conservatively.

Recommended rule:

- if a note has no `anchorType` but has a valid PDF page field such as `pdfPageNumber`, treat it as `anchorType: 'page'`;
- preserve old fields;
- do not auto-destructively rewrite old files unless explicitly needed.

Compatibility example:

- old note:
  - `noteKind: 'pdf-page'`
  - `pdfPageNumber: 2`
  - `selectedText: 'Page 2'`
  - `context: 'PDF page 2'`

- interpretation in 0.5.0 reader:
  - still a valid PDF note
  - treated as page-level anchor

This allows 0.4.x PDF notes to continue loading without migration pressure.

It also allows mixed PDF note sets later, for example:

- older page notes in the same file;
- newer point notes added after the controlled-rendering integration.

## 10. UI implications

- page note
  - card only
  - show page number or page label

- point note
  - marker dot on page
  - card in notes area

- area note
  - rectangle or box overlay on page
  - card in notes area

- text note
  - text highlight plus card

## 10A. Confirmed current production state

Manual runtime testing now confirms the following stable production behavior:

- PDF page notes work in normal NoteAnchor PDF mode;
- PDF point notes work in normal NoteAnchor PDF mode;
- older PDF text-note files should load safely without crashing the app;
- old PDF page notes still remain compatible;
- the original PDF is not modified.

This means the note model must safely account for mixed PDF note sets in one file:

- old page notes;
- production point notes;
- older experimental text notes.

In all cases, the note card should still remain part of the existing notes workflow and `All notes` flow.

## 11. Export implications

The eventual report for a layout designer should include:

- page number;
- marker or area reference;
- optional screenshot or thumbnail later;
- selected text if available;
- comment.

Point and area anchors matter because layout correction workflows often need a visible physical location on the page, not only extracted text.

## 12. Open questions

- Which exact page dimensions should be stored:
  - viewport at creation time,
  - original PDF page dimensions,
  - or both?
- Should page labels be stored separately from page numbers?
- Should multiple colors or statuses be supported early?
- How should the app distinguish `Add note` versus `Add page note` in PDF mode to reduce user confusion while production text notes remain disabled?
- Should a future context-menu path be added for PDF text notes after a reliable text-selection approach exists?

## 13. Recommended first implementation step

Recommended next safe task:

- build on the current stable production point-note step;
- keep current page notes compatible;
- extend from page 1 to safe multi-page behavior for stable anchors first;
- keep PDF text-note work in isolated spikes until the geometry-based approach is trustworthy;
- do not add area notes until the current page/point workflow is stable.

The production steps now complete are:

- page note compatibility stayed intact;
- point markers became real in production PDF mode;
- area anchors can follow after the base model is stable.
