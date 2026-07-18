# NoteAnchor 0.4.0 Beta Test Feedback

## Tester 1 - Windows 10 self-test / first external-style scenario

### Environment

- Windows 10 laptop.
- Browser: Opera.
- VPN was used.
- Installer was downloaded from Google Drive.
- Windows Defender showed a warning, but still allowed download, installation, and launch.

### Installation result

- Download worked.
- Installation worked.
- App launched successfully.

### Document tested

- Large English document.
- About 55 pages.
- Contains photos/images.
- Only about 2 pages were actually annotated/translated during the test.

### Observed workflow

- A phrase in the document was split across two paragraphs.
- NoteAnchor correctly showed the current limitation: selection can only be inside one paragraph.
- Tester then started adding paragraph-by-paragraph translation into notes.
- This revealed a possible useful scenario: using NoteAnchor for paragraph-level translation notes or bilingual reading/translation work.

### Observed UI behavior

- When a note is active, both the commented text and the note text are shown fully.
- When a note is inactive, the commented text is still shown fully, while the note text is shortened with ellipsis.
- This becomes inefficient when the selected/commented text is long.
- Desired behavior: inactive note cards should also show only a shortened preview of the commented text. Full selected text and full note text should be shown only for the active note.

### All notes

- All notes currently shows all notes fully.
- This may be acceptable for short notes, but for paragraph-level translation notes it may become too long and may need a compact/expanded display later.

### Print report issue

- In Print report, the commented text appears twice:

  1. once as the large/bold selected text;
  2. again after the label "Sentence or phrase".

- This is redundant when the selected text is already a full sentence or paragraph.
- Reason: showing "Sentence or phrase" is useful when the user selects only one word or a few words, because it provides context.
- But when the selected text is long, the context duplicates the selected text.
- Desired future behavior: make Print report smarter:

  1. for short selections, show selected text plus sentence/phrase context;
  2. for long selections or full-paragraph selections, show the selected/commented text only once.

### Large document layout issue

- In a large document, the farther down the document the notes are, the farther the note cards appear from the commented text.
- This makes note-card compactness and positioning more important.
- It may require layout optimization for long documents.

### Initial interpretation

- This test confirms that installation and launch work on Windows 10 with a Defender warning.
- It reveals three likely 0.4.1 priorities:

  1. compact inactive note cards;
  2. smarter Print report context logic;
  3. better handling or explanation of long documents and long paragraph-level notes.

- It also reveals a potentially important use case: paragraph-level translation or bilingual reading notes.

## Follow-up observation - All notes panel header scrolls away

### Issue

- When the All notes panel contains many notes and the user scrolls down, the top controls scroll away and disappear.
- This includes:

  - All notes title;
  - Close button;
  - Search notes field;
  - explanatory text / search area.

### Expected behavior

- The All notes panel header/search area should remain visible while the note list scrolls.
- The note list itself may scroll, but the controls should stay in place.

### Why it matters

- With many notes, especially paragraph-level translation notes, the user may scroll far down the note list and still needs quick access to Search and Close.

## Follow-up tester feedback - PDF correction workflow for translator/editor use

### Tester profile

- Works as a translator and editor.
- Usually uses Microsoft Word comments/notes for editing.

### Reported use case

- The tester said that when a text has already been typeset/layouted as a PDF, there is often a need to mark a small number of corrections and communicate them to the layout designer/typesetter.
- She thinks NoteAnchor could be very useful for this scenario if it supported PDF.

### Why this matters

- This is not a general request for PDF only because PDF is common.
- It points to a concrete professional workflow:

  - final or near-final PDF after layout;
  - a small number of corrections;
  - comments tied to exact locations or fragments;
  - comments sent back to the layout person.

### Interpretation

- This supports PDF as a possible future high-value direction, especially for editors and translators.
- It should not be treated as an immediate 0.4.1 implementation task.
