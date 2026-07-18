# NoteAnchor 0.4.2 Priorities Draft

## Current confirmed working state

- TXT notes work.
- DOCX plain-text notes work.
- PDF opens in the app.
- PDF page notes can be added.
- PDF notes are saved beside the PDF as `.pdf.notes.json`.
- PDF notes reload after reopening the same PDF.
- PDF notes appear in the right notes area and in `All notes`.
- Original PDF is not modified.
- Delete now requires confirmation, so accidental single-click deletion is prevented.
- The previous `asset.localhost refused to connect` runtime failure was removed by replacing the asset/iframe approach with a blob/object approach.

## Must keep stable

- TXT workflow.
- DOCX plain-text workflow.
- Existing `.notes.json` format.
- `All notes`.
- `Print report` for TXT and DOCX.
- Delete confirmation.

## 0.4.2 candidate tasks

- Package the current successful fixes into a stabilization release.
- Document PDF as experimental and page-based.
- Verify PDF runtime behavior on one-page and multi-page PDFs.
- Keep delete confirmation in the shared note flow.
- Fix only obvious UI regressions that block normal use.

## Do not include in 0.4.2

- Full PDF text selection anchoring.
- Coordinate anchoring.
- PDF report export.
- Word comments integration.
- Major architecture rewrite.

## Release criteria for 0.4.2

- Build passes.
- TXT manual test passes.
- DOCX manual test passes.
- PDF page-note manual test passes.
- Delete confirmation test passes.
- Notes reload correctly after reopening the same document.

## Risk notes

- PDF support is currently useful only as an experimental prototype and should be described that way.
- The embedded PDF viewer is partly controlled by the WebView or PDF plugin rather than by NoteAnchor itself.
- One-page and multi-page PDF behavior still needs careful manual checking before release wording becomes stronger.
- Stabilization should avoid broad refactors that could put TXT and DOCX behavior at risk.
- Existing note storage compatibility should be treated as a hard requirement.
