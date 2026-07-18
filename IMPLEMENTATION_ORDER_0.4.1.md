# NoteAnchor 0.4.1 Implementation Order Draft

## Principle

- Do not implement everything at once.
- Start with low-risk UI improvements that directly address the first beta feedback.
- Avoid speculative layout fixes until the long-document positioning issue is diagnosed.
- Preserve existing TXT, DOCX plain-text, notes storage, Export notes, Print report, Help, All notes, Find, Whole word Find, and Link again behavior unless a task explicitly touches them.

## Task 1 - Compact inactive note cards

### Priority

High

### Risk

Small to medium

### Why first

- Directly addresses the Windows 10 test feedback.
- Helps long selected text and paragraph-level translation notes.
- Should be mostly UI display logic, not storage or document parsing.

### Scope

- Inactive note cards should show shortened preview of selected/commented text.
- Inactive note cards should show shortened preview of note/comment text.
- Active note card may continue showing full selected text and full note text.
- Do not change saved note data.
- Do not change note anchoring.
- Do not change Link again.

### Acceptance checks

- Short word selections still identifiable.
- Medium phrase selections still identifiable.
- Full paragraph selections no longer make inactive cards huge.
- Long translation-style notes do not make inactive cards huge.
- Active note still expands/shows full content.
- Switching active note still works.
- Connector lines still point to the correct note cards.

## Task 2 - Smarter Print report context logic

### Priority

High

### Risk

Medium

### Why second

- Print report currently duplicates selected/commented text.
- The fix is valuable, but needs careful logic for short vs long selections.

### Scope

- Avoid repeating the same text when selected text and sentence/phrase context are effectively the same or when selection is long.
- Keep useful context for one-word and short-phrase selections.
- Do not remove Print report.
- Do not restore direct printing from inside the app.
- Do not change Export notes unless strictly necessary.

### Acceptance checks

- One-word selection: report shows selected text and useful context.
- Short phrase selection: report shows selected text and useful context.
- Full sentence selection: report does not awkwardly duplicate the same sentence.
- Full paragraph selection: report does not duplicate the paragraph.
- Long translation-style note displays clearly.
- TXT and DOCX plain-text reports still save correctly.

## Task 3 - Help / documentation note about one-paragraph selection

### Priority

Medium

### Risk

Small

### Why third

- The Windows 10 test hit the one-paragraph selection limitation.
- This limitation is acceptable for now, but should be explained clearly.

### Scope

- Add or improve wording in Help or README explaining that current selections must stay within one paragraph.
- Explain that if a phrase crosses paragraphs, the user should create separate notes for each paragraph for now.
- Do not implement cross-paragraph selection in 0.4.1 unless separately decided.

### Acceptance checks

- Help remains readable.
- README remains factual.
- No promise of cross-paragraph support.
- Existing Help layout remains usable.

## Task 4 - Long document positioning investigation

### Priority

Medium

### Risk

High if changed without diagnosis

### Why not first

- The issue may involve measurement, scrolling, connector lines, extracted DOCX layout, or accumulated offset.
- A speculative fix could break positioning in normal documents.

### Scope

- Investigation only at first.
- Add diagnostic observations or a report if useful.
- Compare short TXT, long TXT, small DOCX, and large DOCX.
- Check notes near top, middle, and bottom.
- Do not change layout behavior until cause is understood.

### Acceptance checks for investigation

- Identify whether the offset grows with document length.
- Identify whether the issue appears in TXT, DOCX, or only DOCX.
- Identify whether images/blank extracted areas contribute.
- Identify whether connector recalculation is involved.
- Produce a short diagnosis before any fix.

## Task 5 - Paragraph-level translation notes use case

### Priority

Observe for now

### Risk

Medium to high if turned into a feature too early

### Why not implement now

- The use case is promising, but one test is not enough.
- It may need better note display, export format, or share package.
- These should not be rushed into 0.4.1.

### Possible future directions

- Expand/collapse note cards.
- Original + translation export format.
- Share package containing source file plus notes.
- Better support for long notes.

## Not in first 0.4.1 coding pass

- Cross-paragraph selection.
- RTF support.
- PDF support.
- Word comments/tracked changes support.
- Share package/export package.
- Full translation mode.
- Direct printing from inside NoteAnchor.

## Recommended first Codex implementation task

Recommend starting with:
Task 1 - Compact inactive note cards

### Why

- It is the safest useful code change.
- It directly addresses the translation-note and long-document usability problem.
- It should not require changing storage, parsing, or document opening logic.
