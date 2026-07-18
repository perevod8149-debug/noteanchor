# NoteAnchor PDF Prototype Notes 0.4.1

## Purpose

This document records the current state of the limited PDF prototype in NoteAnchor 0.4.1.

The prototype goal is narrow:

- open a PDF in the app;
- show the PDF in the main reading area;
- allow simple PDF notes without modifying the original PDF;
- save notes beside the PDF as `.pdf.notes.json`;
- keep the original PDF unchanged.

This is not yet a full PDF annotation system.

## What currently works

- A PDF can be opened from the desktop file picker.
- The previous `asset.localhost refused to connect` error is gone.
- The app can render page 1 in production PDF mode under app control.
- Clicking the rendered PDF page opens the normal note editor.
- Saving creates a real PDF point note in production PDF mode.
- A visible point marker appears on the rendered page.
- PDF notes appear in the right notes area.
- PDF notes appear in `All notes`.
- PDF notes are saved beside the PDF as `document.pdf.notes.json`.
- PDF notes reload when the same PDF is reopened.
- Existing older PDF page notes remain compatible.
- Older experimental PDF text-note files should still load safely without crashing the app.
- The original PDF is not modified.

## What does not work yet

- Production point notes are currently limited to page 1.
- Production PDF text-note creation is disabled in the main app.
- No area notes exist yet.
- No multi-page controlled navigation exists yet.
- `Print report` is not enabled for PDF prototype mode.
- `Export notes` is not enabled for PDF prototype mode.
- `Find in text` is not enabled for PDF prototype mode.
- `Link again` is not used for PDF notes.

## Manual test observations

- A one-page PDF named `Ruthless.pdf` opened successfully in the app.
- Controlled rendering worked in the normal PDF mode.
- Clicking the rendered PDF page opened the normal note editor.
- Saving created a real PDF point note.
- A visible point marker appeared on the PDF page.
- PDF notes appeared in the right notes area and in `All notes`.
- PDF notes were saved beside the PDF as `Ruthless.pdf.notes.json`.
- Point notes were labeled as `PDF point note - page 1`.
- Reopening the same PDF reloaded point notes.
- Delete confirmation worked.
- TXT and DOCX behavior remained preserved.
- Clicking and releasing on the PDF page still created a point note.
- Older experimental PDF text-note files should still load safely without crashing the app.

## Current stable production baseline

- Production PDF text-note creation is disabled in the main app.
- No `Add note to selected text` UI appears in production PDF mode.
- PDF page notes remain supported.
- PDF point notes remain supported.
- Original PDF files are not modified.
- TXT and DOCX behavior remains intact.

## Current technical approach

- Native side:
  - `.pdf` is accepted by the existing desktop open command.
  - PDF open returns metadata and an experimental warning.
- Frontend side:
  - the PDF file is read through `@tauri-apps/plugin-fs`;
  - page 1 is rendered through `pdf.js` / `pdfjs-dist` under app control;
  - clicking the rendered page captures normalized point coordinates;
  - saving the note persists a PDF point note through the existing `.pdf.notes.json` flow;
  - page-note compatibility remains in the same sidecar flow;
  - any future PDF text-note work should move through isolated geometry-based spikes rather than production DOM text-layer hit-testing;
  - an embedded viewer path still exists as a fallback for preview failure.

## Known limitations of the current embedded viewer approach

- The embedded PDF viewer is a WebView/browser capability, not a NoteAnchor PDF engine.
- Viewer UI behavior such as zoom, thumbnails, and internal controls comes from the embedded PDF viewer.
- Text selection inside the viewer does not pass through NoteAnchor's text-anchoring logic.
- Reliable programmatic page navigation is not guaranteed in the current prototype.
- Because total page count is not currently known, the app should behave conservatively and not pretend it can safely validate all page jumps.
- If the embedded viewer fails on a specific machine or PDF, a fallback mode may still be needed later.

## Current production PDF point-note behavior

- Production PDF point notes now use controlled rendering in the main app.
- Point markers are visible on the rendered page.
- Point notes appear in the right notes area and in `All notes`.
- Point notes are saved in the normal `document.pdf.notes.json` file beside the PDF.
- Older page-only PDF notes still remain compatible and continue to load.

## Current production PDF text-note status

- Production PDF text-note creation is disabled in the main app.
- The earlier production attempt based on pdf.js DOM text-layer hit-testing was not reliable enough.
- Older PDF text-note files may still exist in `.pdf.notes.json` and should load safely as note data.
- Future reliable PDF text notes should be researched through isolated spikes, preferably using pdf.js `textContent.items` geometry rather than DOM text-layer hit-testing.

## Current UI behavior

- PDF mode is clearly marked as experimental.
- The banner explains that production PDF text notes are disabled and that page notes or point notes should be used.
- PDF point notes are labeled clearly in the right notes area and in `All notes`.
- Existing PDF page notes are still labeled clearly as page notes.
- The page field remains available for legacy-compatible page-note attachment.

## Current UX issues to keep in view

- Generic `Add note` in PDF mode still creates a page note, which is technically correct but may confuse users. It will likely need PDF-specific wording such as `Add page note`.
- A future right-click or context-menu path for PDF text notes would likely make the workflow more natural once reliable text-note anchoring exists.
- Reliable PDF text notes still need a separate isolated spike based on geometry data rather than DOM text-layer hit-testing.

## File behavior

- Original PDF files are not modified.
- PDF notes are stored beside the PDF.
- Example:
  - `Ruthless.pdf`
  - `Ruthless.pdf.notes.json`

## Suggested next technical directions

1. Extend controlled rendering beyond page 1.
2. Add safe multi-page navigation and page count awareness.
3. Keep production PDF mode stable around page notes and point notes while PDF text-note research moves to isolated spikes.
4. Add area notes after point-note and text-note behavior is stable.
5. Decide whether the embedded fallback path should remain long term.

## Practical conclusion

The current PDF prototype has moved beyond a foothold and now supports a small real production workflow.

It already supports:

- opening PDFs;
- rendering page 1 under app control;
- attaching and saving real point notes on page 1;
- showing visible markers for saved point notes;
- reloading point notes from the normal sidecar notes file;
- loading older PDF text-note files safely without crashing the app;
- keeping older PDF page notes compatible.

It does not yet support reliable production PDF text notes, multi-page notes, area notes, PDF report/export, or right-click PDF note creation.
