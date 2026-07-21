# NoteAnchor

NoteAnchor is a local Windows app for notes beside PDF, DOCX, and TXT documents.

Website: [https://noteanchor.app/](https://noteanchor.app/)

Current release: [NoteAnchor v0.4.2](https://github.com/perevod8149-debug/noteanchor/releases/tag/v0.4.2)

Download:

- [EXE installer](https://github.com/perevod8149-debug/noteanchor/releases/download/v0.4.2/NoteAnchor_0.4.2_x64-setup.exe)
- [MSI package](https://github.com/perevod8149-debug/noteanchor/releases/download/v0.4.2/NoteAnchor_0.4.2_x64_en-US.msi)

## What It Does

NoteAnchor keeps long contextual notes beside the source document instead of forcing them into the page itself. Notes stay connected to selected text, a PDF page, or a supported rendered page location, while the original document remains unchanged.

## Supported Document Types

- TXT notes for plain text documents.
- DOCX notes with DOCX content opened as plain text.
- PDF notes where the current PDF workflow can render and interpret the document reliably.

## PDF Notes And Limits

- Text Notes require selectable PDF text.
- Point Notes work for supported image-based or scanned PDFs when NoteAnchor can render the page and provide reliable page coordinates.
- Page Notes can be used for broader PDF page comments.
- Preview-only fallback PDFs can be viewed, but Text Notes and Point Notes are unavailable there.
- OCR is not included.
- PDF support is guarded and is not identical across every PDF.

## Local Workflow And Privacy

- Documents stay on your Windows computer.
- Notes are saved separately beside the source file.
- Original PDF, DOCX, and TXT files are not changed by NoteAnchor.
- The current workflow does not require document upload.

## Notes Storage

Notes are saved beside the source document.

- TXT example: `document.notes.json`
- DOCX example: `document.docx.notes.json`
- PDF example: `document.pdf.notes.json`

## Current Limitations

- Original DOCX files are not changed. NoteAnchor uses a simplified reading view, so complex DOCX layout may not appear exactly as in Word.
- Some PDFs remain limited or preview-only.
- Text Notes require usable text selection or rendered text support.
- Point Notes require a supported rendered PDF page.
- The current Windows release is not code-signed yet, so Windows SmartScreen may appear.

## Development

Project path:

`C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype`

Run the desktop app in development mode:

```powershell
cd C:\Users\Andrew\Documents\Codex\2026-06-09-note-anchor-prototype
npm run tauri:dev
```

Build checks:

```powershell
npm run build
cargo check -q --manifest-path src-tauri\Cargo.toml
```
