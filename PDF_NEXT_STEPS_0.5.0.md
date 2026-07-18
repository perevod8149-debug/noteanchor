# NoteAnchor PDF Next Steps 0.5.0 Draft

## Product goal

- Support local PDF correction notes for editors and translators after layout.
- Do not turn NoteAnchor into a full PDF editor.
- Keep the original PDF unchanged.

## Current prototype

- Controlled PDF page 1 rendering inside the main app PDF mode.
- Existing PDF page notes remain compatible in production.
- Production PDF point notes now work on page 1.
- Notes stored beside the file as `.pdf.notes.json`.
- Separate controlled-rendering spike completed successfully.
- Production PDF text-note creation is disabled in the main app.

## Why embedded viewer is limited

- NoteAnchor does not control the PDF text layer.
- Visual text selection inside the viewer is not captured by NoteAnchor.
- Page coordinates are not reliable in the current viewer path.
- Viewer UI behavior is external to NoteAnchor and depends on the WebView or PDF plugin.

## Controlled-rendering spike result

Manual testing confirmed that the isolated controlled-rendering spike already proves the following:

- app-controlled PDF page rendering works;
- click coordinate capture works;
- normalized coordinates work;
- visible marker rendering works;
- in-memory test marker list works;
- the spike is suitable as the technical basis for real PDF notes in 0.5.0.

This means the project no longer needs to ask whether controlled rendering is possible in principle. The answer is yes.

## Text-selection spike result

Manual testing now also confirms that the isolated PDF text-selection spike works reasonably well:

- page 1 renders with a selectable text layer;
- real PDF text can be selected on the rendered page;
- selected text can be captured into app state;
- selected text plus comment can be shown in an in-memory test note card;
- saved highlight rectangles can be redrawn on the page.

This changes the preferred future direction for PDF notes.

The user-facing note should be based on:

- selected PDF text;
- user comment.

Coordinates and highlight rectangles should remain internal anchoring data rather than the main visible note content.

## Text-selection spike limitations

- page 1 only;
- in-memory only;
- no production integration yet;
- no multi-page navigation yet;
- no persistence to `.pdf.notes.json` yet;
- no report or export yet;
- native browser selection currently disappears when the user presses the add-note button, then the saved highlight appears afterward;
- spike layout has improved, but should still be watched on smaller windows.

## Production integration result

Manual testing now confirms that the controlled-rendering approach is no longer only an isolated spike result.

Production PDF mode now supports the following:

- page 1 renders under app control in the normal PDF mode;
- clicking the rendered page opens the normal note editor;
- saving creates a real PDF point note;
- a visible marker appears on the rendered page;
- the point note appears in the right notes area;
- the point note appears in `All notes`;
- point notes persist in the normal `document.pdf.notes.json` flow;
- reopening the same PDF reloads the point note and marker;
- old PDF page notes still remain compatible.

## Production PDF text-note status

Production PDF text-note creation is currently disabled in the main app.

Reason:

- the production attempt based on pdf.js DOM text-layer hit-testing was not reliable enough;
- visible token boxes and hit targets did not consistently align with the PDF text the user saw;
- dragging over one visible word could resolve to the wrong token or an oversized selection.

Current production decision:

- keep production PDF mode focused on stable page notes and point notes;
- do not offer `Add note to selected text` in the main app;
- keep any future PDF text-note work in isolated spikes first;
- prefer a future approach based on pdf.js `textContent.items` geometry rather than DOM text-layer hit-testing.

Old PDF page notes still remain compatible. Older PDF text-note files should continue to load safely as note data, but production PDF mode no longer depends on rendering their text highlights.

## Stable baseline summary

The current stable production PDF baseline is:

- page 1 controlled PDF rendering in the normal app;
- PDF page-note compatibility in the normal sidecar note flow;
- PDF point-note creation and reload on page 1;
- visible PDF point markers;
- point-marker click activation for PDF point notes;
- older PDF text-note files load safely as data and should not crash the app;
- old PDF page-note compatibility in the same sidecar note flow;
- original PDF remains unchanged.

## Current preferred PDF direction

The preferred long-term direction is still:

- selected text plus comment should be the main value for future PDF text notes;
- coordinates and highlight rectangles should remain internal anchor data;
- point notes still matter for precise location-based corrections where text selection is not enough.

## UX issues to carry forward

- Production PDF text-note creation is disabled for now because DOM text-layer hit-testing was unreliable.
- Generic `Add note` in PDF mode still creates a legacy-compatible page note and may confuse users; it will likely need PDF-specific wording such as `Add page note`.
- A future PDF text-note shortcut through right-click or context menu would likely improve the workflow.
- Reliable PDF text-note work should return only after a separate geometry-based spike proves stable behavior.

## Target 0.5.0 direction

- Extend the new production controlled-rendering path beyond page 1.
- Keep `pdf.js` or `pdfjs-dist` as the leading candidate unless a later spike shows a clear reason to change.
- Control the page canvas and text layer from NoteAnchor rather than relying on the browser viewer alone.
- Store click or selection coordinates inside NoteAnchor when possible.

## Minimal real PDF note model

- File identity.
- Page number.
- Selected text if available.
- Page coordinates or rectangle if available.
- Comment.
- Created and updated timestamps.

## Possible storage shape

- Do not break existing TXT and DOCX notes.
- Consider PDF-specific anchor fields rather than forcing PDF into the same text-fragment model.
- Keep PDF notes compatible with sidecar storage beside the original file.

## Step-by-step implementation plan

1. Keep production PDF mode stable around page notes and point notes.
2. Continue isolated PDF text-note research outside the main production flow.
3. Add multiple pages or safe page navigation for stable PDF anchors.
4. Add area note support.
5. Improve marker activation and note-to-marker navigation.
6. Add an export report path for a layout designer or typesetter.
7. Decide whether the old page-note-only path should remain as a fallback or be folded into the richer model later.

## What to avoid

- Editing PDF contents directly.
- Embedding comments into the PDF in the early version.
- OCR as the first solution.
- Pulling in huge dependencies without a small technical spike first.

## Open questions

- Should PDF anchors be primarily text-based, coordinate-based, or hybrid?
- Are page thumbnails worth adding early?
- What export format is most useful for the handoff workflow: HTML, Markdown, PDF, or DOCX?
- Should an external PDF viewer fallback remain available even after controlled rendering exists?

## Suggested first 0.5.0 technical task

Use the current production page-note and point-note implementation as the stable baseline, while keeping PDF text-note work in isolated research until a reliable geometry-based approach is proven.

## Remaining limitations after the current stable PDF baseline

- Page 1 only.
- Production PDF text-note creation is disabled in the main app.
- Reliable future PDF text notes still require an isolated spike, preferably based on pdf.js `textContent.items` geometry rather than DOM text-layer hit-testing.
- No area notes yet.
- No multi-page navigation yet.
- No PDF report export yet.
- No right-click note creation yet.
- Original PDF is not modified.
