# NoteAnchor

## What it is

NoteAnchor is a local desktop app for active reading and contextual notes.

It lets you select an exact word, phrase, or sentence in a document and attach a note to it. Notes stay connected to the source passage, so you can return later and still see exactly what each note refers to.

Original documents are not modified.

## Main features

- Open TXT documents.
- Open DOCX files as plain text.
- Attach notes to selected words, phrases, or sentences.
- Review all notes in one place.
- Search within the document.
- Whole word search.
- Create a note from the current Find match.
- Reconnect a note if source text changes.
- Export notes.
- Save a print-ready report.
- Help button with usage guidance.

## Supported files

- TXT documents.
- DOCX files opened as plain text.

DOCX formatting is not preserved. DOCX images, headers, footers, footnotes, comments, tracked changes, and complex layout are not part of the current plain-text workflow. RTF, PDF, and image-based documents are not currently supported.

## Notes and storage

Notes are saved beside the source document.

- TXT example: `document.notes.json`
- DOCX example: `document.docx.notes.json`

Original source files are not changed by NoteAnchor.

## Export and print report

Export notes saves a Markdown export beside the source document.

- Example: `document.docx.notes-export.md`

Print report saves a print-ready report beside the source document.

- Example: `document.docx.notes-print.html`

Print report does not print directly from NoteAnchor. The saved report can be opened in a browser and printed from there.

## Current beta limitations

- DOCX opens as plain text.
- Formatting is not preserved.
- Very large documents may be slower.
- RTF is not currently supported.
- PDF and image-based documents are not currently supported.
- Word comments and tracked changes are not currently supported.

## App identity

- App name: NoteAnchor
- Version: 0.4.0
- Tauri identifier: com.noteanchor.desktop

## Installer and executable

Installer:

`C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype\src-tauri\target\release\bundle\nsis\NoteAnchor_0.4.0_x64-setup.exe`

Standalone executable:

`C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype\src-tauri\target\release\noteanchor.exe`

## Development

Project path:

`C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype`

Run the desktop app in development mode:

```powershell
cd C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype
$env:Path = "C:\Users\Andrew\Tools\node\node-v24.15.0-win-x64;" + $env:Path
npm.cmd run tauri:dev
```

Build:

```powershell
cd C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype
$env:Path = "C:\Users\Andrew\Tools\node\node-v24.15.0-win-x64;" + $env:Path
npm.cmd run build
npm.cmd run tauri:build
```

If the executable is locked:

```powershell
taskkill /IM noteanchor.exe /F
```

## Related documents

- `PRODUCT_POSITIONING.md`
- `BETA_PAGE_DRAFT.md`
- `LANDING_PAGE.md`
- `RELEASE_NOTES_0.4.0.md`
