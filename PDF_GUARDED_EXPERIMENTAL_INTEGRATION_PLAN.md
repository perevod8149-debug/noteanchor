# PDF Guarded Experimental Integration Plan

## 1. Current Spike Capabilities

Current isolated PDF spike already demonstrates:

- controlled PDF text selection from `single-line` to limited `paragraph-like` selection
- fragment-based grouping of notes
- multiple comments per fragment group
- spike-only persistence between reopenings
- fragment activation from right column to document
- reverse activation from document to right column
- comment edit/delete with confirm-delete
- fragment markers/count badges on the PDF

These behaviors are useful evidence that the interaction model is viable.

## 2. Integration Candidates

The parts most worth considering for guarded experimental integration are:

- controlled PDF text selection for a limited selection range
- fragment identity based on token-backed selection keys
- grouped fragment notes in the PDF note workspace
- basic note creation flow from selected PDF text
- two-way activation:
  - note/group -> document
  - document fragment -> note/group

These are the strongest product behaviors already validated in the spike.

## 3. Not Ready For Integration Yet

The following should stay out of the first production integration attempt:

- spike-only `localStorage` persistence model
- spike debug panels and geometry diagnostics
- spike-specific visual helpers and temporary overlay affordances
- broad paragraph selection beyond a conservative limit
- any spike layout shortcuts that are not aligned with production UI
- marker/badge behavior unless it can be added without destabilizing the main viewer

Also not ready yet:

- cross-page PDF text-note flows
- data migration for any older PDF note experiments
- full parity with every spike affordance

## 4. Guardrails

First experimental integration should be fenced by strict limits:

- behind an explicit experimental mode / feature flag
- PDF only
- no production migration of prior spike data
- no reuse of spike `localStorage` format
- no multi-page text-note workflow in the first pass
- limited selection only:
  - `single-line`
  - short multi-line selection only if the exact limit stays reliable
- no cross-page note jumping in the first pass
- no requirement to ship full spike badge/debug affordances
- backup required before touching production files

If any of these guardrails starts expanding mid-implementation, stop and split the work.

## 5. Minimal First Integration Scope

Safest first integration scope:

**experimental PDF text notes with grouped fragments on one rendered page, using basic create + activate only**

Specifically:

- controlled PDF text selection
- create note from selected text
- group notes by fragment
- display grouped notes in the production notes workspace
- click group -> activate fragment
- click saved fragment -> activate group

Do **not** require in first pass:

- edit/delete
- count badges
- paragraph-like selection at the spike maximum
- cross-page behavior
- migration of previous experimental note data

Reason:
this gives the smallest end-to-end production slice that proves whether spike selection and fragment grouping survive contact with the real app.

## 6. Pre-Integration Backup And Regression Checklist

Before starting:

- create a fresh source backup checkpoint
- keep the current production baseline restorable
- document the exact experimental scope before editing production files

Files most likely to touch in a first guarded integration:

- `src/App.tsx`
- `src/App.css`

Manual regression checks that must pass:

- TXT notes still work
- DOCX notes still work
- existing PDF page notes still work
- existing PDF point notes still work
- delete confirmation still works
- PDF viewer layout remains stable
- no sideways document shift on activation
- no accidental writes to real spike storage paths or `.notes.json` formats from the spike model

Stop conditions during integration:

- PDF selection becomes unreliable in the production viewer
- note activation destabilizes layout or scrolling
- TXT/DOCX/PDF page-note behavior regresses
- integration requires widening scope beyond the guarded slice above

