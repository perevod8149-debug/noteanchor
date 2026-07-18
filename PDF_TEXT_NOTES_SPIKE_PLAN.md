# NoteAnchor PDF Text Notes Spike Plan

## 1. Purpose

The purpose of this spike is to explore reliable PDF text-note creation without using DOM text-layer hit-testing.

The spike should:

- stay isolated from production PDF mode;
- use pdf.js `textContent.items` geometry as the source of truth;
- determine whether accurate word and phrase selection is feasible;
- help decide whether future PDF text notes can return safely.

## 2. Non-goals

This spike should not try to do everything at once.

Non-goals:

- no production integration at first;
- no multi-page production support;
- no right-click note creation;
- no area notes;
- no PDF export or report;
- no editing of the original PDF;
- no Word-like comments embedded inside the PDF.

## 3. Why the old approach failed

The previous production PDF text-note attempt failed because it relied on pdf.js DOM text-layer hit-testing.

Observed problems:

- the DOM text layer did not reliably align with the visible PDF canvas text;
- native browser selection could expand into page-wide selection;
- character-offset and token-snapping logic based on DOM spans was unreliable;
- debug token boxes showed geometry mismatch between what the user saw and what the code hit-tested;
- dragging over one visible word could select a different token.

Conclusion:

- the DOM text layer is not acceptable as the source of truth for production PDF note anchoring;
- any future reliable PDF text-note system should compute geometry from pdf.js content data, not from DOM text-layer spans.

## 4. Proposed spike architecture

The spike should be isolated and intentionally narrow.

Core flow:

1. Load a PDF with pdf.js.
2. Render the target page canvas.
3. Call `page.getTextContent()`.
4. Inspect `textContent.items`.
5. Compute item and text geometry from each item transform plus the viewport transform.
6. Build an internal list of text runs.
7. Draw an optional debug overlay from computed geometry.
8. Hit-test against the computed geometry, not against DOM text-layer spans.

Each internal text run should include:

- text;
- page number;
- x;
- y;
- width;
- height;
- transform-derived coordinates;
- normalized coordinates.

The spike may still render a text layer for visual comparison if useful, but the text layer should not be the source of hit testing.

## 5. Selection model for the spike

Start with the smallest practical selection model:

- page 1 only;
- single-line only;
- word-token selection;
- user drags across visible text;
- the drag rectangle is hit-tested against computed text item or word geometry;
- selection snaps to complete word tokens;
- multi-line selections are rejected.

This keeps the first experiment focused on whether visible word and phrase selection can be made trustworthy.

## 6. Word-token geometry options

There are a few possible ways to derive useful word geometry from `textContent.items`.

### Option A - Split each item into tokens

- split each `textContent.items` string into word-like tokens;
- estimate token width from the item width;
- assign proportional token rectangles inside the item bounds.

Pros:

- simple;
- likely fast enough for a spike.

Cons:

- can be inaccurate when one item contains uneven spacing or proportional font changes.

### Option B - Use canvas text measurement

- split large text runs into tokens;
- measure token widths with canvas text measurement as an approximation;
- map measured token widths into the rendered item bounds.

Pros:

- may be more accurate than simple proportional splitting.

Cons:

- still approximate;
- depends on matching the rendered font behavior closely enough.

### Option C - Per-character approximation only if needed

- derive character-level geometry only when token-level geometry is too coarse;
- use this only as a fallback path.

Pros:

- can help with tighter phrase boundaries.

Cons:

- more complexity;
- more risk of rebuilding the same kind of fragile behavior that failed before.

Recommended spike bias:

- prefer whole-word snapping over fragile character-perfect selection;
- keep the user-visible result as complete words and phrases, not clipped fragments;
- only go deeper than token-level geometry if the token approach clearly fails.

## 7. Success criteria

The spike is useful only if it passes practical visual tests.

Success means:

- dragging over a visible word selects that visible word, not another word;
- dragging over a visible phrase selects the visible phrase;
- highlight boxes align with the visible canvas text;
- no page-wide selection occurs;
- no cut-off word endings;
- no unrelated words are selected;
- the result feels stable enough to test further.

TXT and DOCX behavior is irrelevant to spike success because this work must remain isolated.

## 8. Failure criteria

The spike should be stopped, redesigned, or narrowed further if:

- computed `textContent.items` geometry still does not align with the rendered canvas closely enough;
- token positions are too inaccurate for practical use;
- word selection depends on fragile PDF-specific quirks;
- the implementation becomes too complex for an MVP;
- debugging shows the geometry model is fundamentally inconsistent across common PDFs.

If that happens, production should remain limited to PDF page notes and point notes.

## 9. Proposed file and folder structure

Use a separate spike folder so the experiment stays contained.

Suggested structure:

- `pdf-textcontent-geometry-spike/`
  - `PdfTextContentGeometrySpike.tsx`
  - `pdf-textcontent-geometry-spike.css`
  - `README_PDF_TEXTCONTENT_GEOMETRY_SPIKE.md`

This keeps the new research separate from:

- production PDF mode;
- the earlier DOM text-layer text-selection spike;
- the controlled point-note spike.

## 10. Production integration rules

If the spike succeeds:

- create a backup before integration;
- keep production PDF page notes stable;
- keep production PDF point notes stable;
- integrate behind a clear experimental flag or guarded code path first;
- document limitations clearly;
- do not remove the fallback decision path too early.

If the spike fails:

- keep production PDF page notes and point notes only;
- do not revive DOM text-layer selection in production;
- record the failure clearly so the team does not repeat the same path later.

## 11. Manual test plan

The spike should be judged with a practical manual checklist.

Test cases:

- word in the middle of a line;
- word after quote or punctuation;
- phrase with several words;
- line with proportional font;
- line with punctuation;
- attempted multi-line drag;
- click saved highlight if persistence is added later;
- reload saved note if persistence is added later.

Minimum visual questions:

- does the selected word match what the user actually dragged over;
- do highlight boxes sit on the visible words;
- does the spike avoid selecting unrelated text;
- does the result still work on more than one sample PDF.

## 12. Recommended next implementation prompt

Future Codex prompt for creating the spike:

> Create an isolated PDF text-notes spike using pdf.js `textContent.items` geometry as the source of truth instead of DOM text-layer hit-testing. Keep it separate from production. Start with page 1 only, single-line only, and whole-word token selection. Render the PDF canvas, compute token geometry from `page.getTextContent()`, draw a debug overlay, let the user drag across visible text, snap to complete visible word tokens, reject multi-line selections, and show the captured selected text plus highlight boxes. Do not change production PDF behavior.

## 13. Practical recommendation

The next safe move is not to revive production PDF text notes directly.

The next safe move is:

- build a new isolated spike;
- prove whether `textContent.items` geometry is visually trustworthy;
- decide on production only after that result is clear.
