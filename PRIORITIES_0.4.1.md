# NoteAnchor 0.4.1 Priorities Draft

## Basis

This draft is based on the first Windows 10 self-test / external-style beta scenario recorded in `TEST_FEEDBACK_0.4.0.md`.

## Priority 1 - Compact inactive note cards

### Problem

- Inactive note cards currently shorten the note/comment text but still show the selected/commented text fully.
- This is inefficient when the selected text is long, for example paragraph-level translation notes.

### Desired behavior

- Active note card may show full selected text and full note text.
- Inactive note card should show a shortened preview of the selected/commented text and a shortened preview of the note text.
- This should reduce vertical height and make long-document work easier.

### Risk

- Do not hide too much information.
- Make sure users can still identify the note before opening it.

### Testing

- Test short selected words.
- Test medium phrases.
- Test full paragraph selections.
- Test long note text, such as translation text.
- Test active/inactive switching.

## Priority 2 - Smarter Print report context logic

### Problem

- Print report currently repeats the commented text twice:

  1. as the main selected text;
  2. again after "Sentence or phrase".

- This is useful for short selections but redundant for long selections or paragraph selections.

### Desired behavior

- For short selections, show selected text plus sentence/phrase context.
- For long selections or full-paragraph selections, avoid repeating the same text.
- Consider labels such as "Selected text" and "Context" only when they add value.

### Risk

- Do not remove useful context for one-word or short-phrase notes.
- Do not break existing print report generation.

### Testing

- One-word selection.
- Short phrase selection.
- Full sentence selection.
- Full paragraph selection.
- Long translation-style note.
- TXT and DOCX plain-text documents.

## Priority 3 - Long document note positioning analysis

### Problem

- In a large 55-page document with images, note cards farther down the document appeared farther away from the commented text.
- This makes long-document work harder.

### Desired next step

- Investigate whether the issue is caused by layout measurement, scroll position, rendered paragraph height, connector-line calculation, image/blank-space extraction, or accumulated offset error.
- Do not make speculative layout changes without diagnosis.

### Risk

- Layout fixes can easily break note positioning in normal short documents.
- Must preserve existing note activation and connector behavior.

### Testing

- Short TXT.
- Long TXT.
- Small DOCX.
- Large DOCX plain-text extraction.
- Notes near top, middle, and bottom of document.
- Delete note and Link again scenarios.

## Priority 4 - Paragraph-level translation notes as a possible use case

### Observation

- Tester started using notes for paragraph-by-paragraph translation.
- This may be a strong real use case for literary translators, bilingual reading, or language-learning workflows.

### Current decision

- Do not create a separate translation mode yet.
- First improve compact note display and report output.
- Revisit later after more feedback.

### Possible future ideas

- Better display for long notes.
- Expand/collapse note cards.
- Export format suited for original + translation/comment pairs.
- Share package for sending source document plus notes.

## Not for 0.4.1 unless separately decided

- Cross-paragraph selection.
- RTF support.
- PDF support.
- Word comments/tracked changes support.
- Share package/export package.
- Full translation mode.
- Direct printing from inside NoteAnchor.

## Suggested 0.4.1 scope

1. Compact inactive note cards.
2. Smarter Print report context logic.
3. Long document positioning investigation.
4. Documentation note about paragraph-level notes / current one-paragraph selection limitation.

Do not propose implementing everything at once.
