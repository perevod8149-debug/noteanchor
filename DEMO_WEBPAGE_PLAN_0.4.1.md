# NoteAnchor 0.4.1 Demo Webpage Plan

## Purpose

The page should help testers and early users understand the product quickly by showing the workflow in motion:

open document -> select text -> add note -> see note card -> open All notes -> export/print report.

## Core message

NoteAnchor is a local Windows app for contextual notes attached to exact text fragments in TXT and DOCX documents. The original document stays unchanged, and notes are saved beside it.

## Page structure

### 1. Hero section

- Product name
- One-sentence value proposition
- Download beta button
- Short privacy/local note

### 2. Motion demo section

- Embedded video or GIF placeholder
- Caption explaining what happens in the demo

### 3. Use cases

- Review/editing notes
- Translation-style notes
- Research/reading notes

### 4. Privacy and file handling

- Local app
- No upload of documents
- Original documents unchanged
- Notes saved as `.notes.json` beside the document

### 5. Current limitations

- Windows only
- TXT and DOCX plain-text support
- No PDF yet
- No cross-paragraph selection yet
- Unsigned installer may trigger warnings

### 6. Download / tester instructions

- Link placeholder for `NoteAnchor_0.4.1_x64-setup.exe`
- Mention Google Drive warning and Windows SmartScreen in concise terms

## Motion demo storyboard

Create a 60-75 second screen-recording demo with these steps.

### Scene 1 - Open NoteAnchor

- Show app starting
- Show clean interface

### Scene 2 - Open sample-review-text.txt

- Click Open `.txt`
- Choose sample file
- Show document loaded

### Scene 3 - Add a short editing note

- Select phrase `modest boldness` or `timeless new character`
- Click `Add note`
- Type note: `Too vague - rewrite this phrase.`
- Save
- Show note card beside the text

### Scene 4 - Add a translation-style note

- Open `sample-translation-text.txt`
- Select one sentence or paragraph
- Add note with a short translation/paraphrase
- Show inactive cards staying compact

### Scene 5 - All notes

- Click `All notes`
- Search for a word
- Open a note from the list

### Scene 6 - Print report

- Click `Print report`
- Show readable report with selected text and note
- Emphasize that long selected paragraphs are not duplicated

### Scene 7 - Privacy/local closing frame

- Text overlay:
  `Documents stay on your computer. Original files are not changed.`

## Recommended demo recording settings

- Keep video under 75 seconds.
- Use one small TXT sample file first.
- Use 1280x720 or similar.
- Avoid showing personal files or paths.
- Use sample files from `tester-demo-0.4.1`.
- Record with Windows built-in screen recording or OBS.
- Export as MP4 first; GIF only if small enough.

## Assets needed

- screenshot or video of main app
- `sample-review-text.txt`
- `sample-translation-text.txt`
- Google Drive download link
- optional app icon

## Next step

First record the motion demo video manually.

Then create a simple static landing page that embeds the video.
