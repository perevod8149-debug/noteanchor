# NoteAnchor PDF Text Selection Spike

## Purpose

This spike tests whether NoteAnchor can move beyond PDF point notes and toward real PDF text notes.

The goal is to answer these questions:

- Can page 1 be rendered under app control with `pdf.js`?
- Can a selectable PDF text layer be rendered in the Tauri/Vite environment?
- Can actual selected PDF text be captured reliably?
- Can selected-text rectangles be turned into visible highlight overlays?
- Does this look suitable as the basis for future production PDF text notes?

This spike is isolated from production PDF mode.

## Confirmed result from manual testing

Manual runtime testing confirmed the following:

- `PDF text selection spike` opens from inside the Tauri app.
- `Ruthless.pdf` renders successfully with a real text layer.
- Real PDF text can be selected directly on the rendered page.
- Selected text is captured into React state.
- Clicking `Add note to selected text` opens an in-memory test note flow.
- The test note card shows selected PDF text plus comment.
- Saved highlight rectangles remain visible on the PDF page.

This is now the preferred direction for real PDF notes:

- selected text plus comment for the user-facing note;
- coordinates and rectangles kept as internal anchoring data.

## What was tested

- Open a local PDF through the Tauri file dialog.
- Render page 1 to canvas through `pdf.js`.
- Render a text layer above the canvas.
- Select text directly on the rendered PDF page.
- Capture:
  - `selectedText`
  - `pageNumber`
  - selection rectangle count
  - pixel rectangles
  - normalized rectangle coordinates
- Open a note draft from the selected PDF text.
- Save an in-memory test note with selected text plus comment.
- Keep highlight rectangles visible for saved notes.

## How to open the spike

Start the app in dev mode and use the dev-only toolbar entry:

- `PDF text selection spike`

The spike can also be opened by route:

- `#pdf-text-selection-spike`
- or `?pdf-text-selection-spike=1`

## Current expected workflow

1. Open a PDF file.
2. Wait for page 1 and the text layer to render.
3. Select a word, phrase, or line directly on the PDF page.
4. Confirm the spike shows that the text has been captured.
5. Click `Add note to selected text`.
6. Confirm the selected PDF text appears in the note draft.
7. Enter a comment.
8. Save the test note.
9. Confirm the note card shows selected text and comment.
10. Confirm highlight rectangles remain visible on the page.

## Current layout status

The spike layout was tightened so the main controls and diagnostics are easier to reach inside the Tauri window:

- the header area is shorter;
- the PDF stage and sidebar stay visible together;
- diagnostics are collapsible;
- internal scrolling is used where needed instead of pushing the whole page downward.

This still needs more real-window testing on different display sizes, but it is now much more usable for research sessions.

## Remaining issues

- Native browser selection disappears when the user presses `Add note to selected text`, then the saved highlight appears afterward.
- This is acceptable for the spike because the selected text is now captured into state before note creation, but the UX should be improved later.
- Layout may still need refinement on smaller windows.
- Text-layer behavior may vary across PDFs.
- Rectangle capture reliability still needs more testing with longer multi-line selections.

## What this spike does not do yet

- No persistence to real `.pdf.notes.json`
- No production integration
- No multi-page support
- No area-note mode
- No export or report
- No OCR
- No PDF editing

## Recommendation

This spike now gives a positive answer to the main research question.

Controlled PDF text selection appears suitable as the technical basis for future real PDF text notes in NoteAnchor, with this direction:

- selected text plus user comment as the visible note content;
- rectangles and coordinates retained internally for highlight redraw and anchoring.
