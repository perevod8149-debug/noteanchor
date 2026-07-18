# NoteAnchor PDF Controlled Rendering Spike

## What was tested

This spike tests whether NoteAnchor can render a local PDF page under app control instead of relying on the embedded browser PDF viewer.

The spike focuses on a small research question:

- load a local PDF file;
- render page 1 through `pdf.js`;
- show the rendered page in a controlled canvas;
- capture click coordinates relative to the page;
- place visible markers;
- store test note data in memory with page number, pixel coordinates, normalized coordinates, and comment text;
- redraw markers from stored state.

## How to open the spike

Run the app in dev mode as usual, then open the special route:

- `http://127.0.0.1:4173/?pdf-controlled-spike=1` when using the dev server
- or append `?pdf-controlled-spike=1` to the local app URL during development

The main app route remains unchanged.

## Files included

- `pdf-controlled-spike/PdfControlledSpike.tsx`
- `pdf-controlled-spike/pdf-controlled-spike.css`
- `pdf-controlled-spike/README_PDF_CONTROLLED_SPIKE.md`
- `src/main.tsx` route switch for the isolated spike

## What currently works in the spike

- A local PDF can be chosen through the Tauri file dialog.
- The spike can be opened from inside the Tauri app window.
- Page 1 is rendered through `pdf.js`, not through the embedded browser PDF viewer.
- The rendered page appears inside a controlled canvas container.
- Click coordinates are captured relative to the rendered page.
- Normalized coordinates are calculated as ratios.
- Visible markers are drawn from stored in-memory state.
- Manual testing confirmed that `Ruthless.pdf` renders successfully in the controlled spike.
- Saved test markers remain visible after they are added.
- Multiple test markers can remain visible at the same time.
- Each saved test note keeps:
  - page number;
  - x coordinate;
  - y coordinate;
  - x ratio;
  - y ratio;
  - comment text.

## What remains unsolved

- This spike renders only page 1.
- There is no real PDF text selection yet.
- There is no multi-page navigation yet.
- There is no persistence to the real `.pdf.notes.json` format.
- There is no production integration yet.
- There is no export or layout-designer handoff format yet.
- There is no PDF report export yet.
- There is no coordinate anchor schema decision yet.

## Suitability for NoteAnchor 0.5.0

This is now a confirmed basis for real PDF note work in 0.5.0.

The main reason is control:

- NoteAnchor can own the rendered surface;
- NoteAnchor can own click coordinates;
- NoteAnchor can redraw markers from saved state.
- NoteAnchor can show an in-memory test marker list tied to those coordinates.

That solves a core limitation of the current embedded PDF viewer path, where selection and viewer behavior are mostly outside the app's control.

## Practical conclusion

The spike is successful, but it is still only a rendering and coordinate experiment.

Before replacing the current experimental PDF mode, the next step should be a slightly deeper controlled-rendering prototype with:

- page navigation or multiple pages;
- a clear PDF note anchor model;
- marker reload from temporary saved data;
- evaluation of whether text-layer selection is realistic enough for editor and translator workflows.
