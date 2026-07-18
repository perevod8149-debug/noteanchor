# NoteAnchor 0.4.0 Beta Release Notes

## What this version is

NoteAnchor is a local desktop app for active reading and contextual notes. It lets you attach notes to exact words, phrases, or sentences in a document, return to those passages later, and review notes in context.

Original documents are not modified. Notes are stored beside the source document in separate NoteAnchor files.

## Main features

- Open TXT documents.
- Open DOCX files as plain text.
- Attach notes to selected words, phrases, or sentences.
- Review all notes in one place.
- Search within the text.
- Use Whole word search.
- Create a note from the current Find match.
- Reconnect a note if the source text changes.
- Export notes.
- Save a print-ready report.
- Help button with usage guidance.

## Supported document types

- TXT documents.
- DOCX files opened as plain text.

DOCX formatting is not preserved. DOCX images, headers, footers, footnotes, and complex layout are not part of the current plain-text workflow.

## Where notes are stored

Notes are saved beside the source document.

- TXT example: `document.notes.json`
- DOCX example: `document.docx.notes.json`
- Export example: `document.docx.notes-export.md`
- Print report example: `document.docx.notes-print.html`

Original source files are not changed by NoteAnchor.

## Print report

Print report does not print directly from NoteAnchor. It saves a print-ready report beside the source document. The saved report can be opened in a browser and printed from there. This keeps printing outside the desktop app and makes the workflow more reliable.

## Current beta limitations

- DOCX opens as plain text.
- Formatting is not preserved.
- Very large documents may be slower.
- RTF is not currently supported.
- PDF and image-based documents are not currently supported.
- Word comments and tracked changes are not currently supported.

## Suggested use

NoteAnchor may be useful for:

- editors and proofreaders reviewing drafts;
- researchers and analysts collecting observations from source texts;
- writers and authors working through drafts or reference material;
- literary translators marking difficult phrases, stylistic choices, and possible alternatives;
- people learning to read in a new language.

For people learning to read in a new language, NoteAnchor can serve as a vocabulary notebook with context: collect useful words and expressions together with the original sentence while reading real texts.

## Test notes

- TXT workflow has been tested.
- DOCX plain-text workflow has been tested with several small and large documents.
- Notes, export, print report, Find, Whole word Find, All notes, and Link again have been manually checked.
- This is still a beta and should be tested with copies or non-critical documents first.

## Installer and app identity

- App name: NoteAnchor
- Version: 0.4.0
- Tauri identifier: com.noteanchor.desktop

Installer location:

`C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype\src-tauri\target\release\bundle\nsis\NoteAnchor_0.4.0_x64-setup.exe`

Standalone executable:

`C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype\src-tauri\target\release\noteanchor.exe`

## Short summary

NoteAnchor 0.4.0 beta is a local desktop app for attaching contextual notes to exact passages in TXT documents and DOCX files opened as plain text. It keeps original files unchanged, stores notes beside the source document, and supports export, print-ready reports, Find, Whole word search, All notes review, and note reconnection when source text changes.
