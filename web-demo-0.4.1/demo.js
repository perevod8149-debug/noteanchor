const steps = [
  {
    title: "Open a document",
    caption: "Start with a TXT or DOCX document.",
    sideNote:
      "Open a short text first, then move from exact phrase to note, search, and report.",
    cursorTarget: "toolbar-open",
    clickTarget: "toolbar-open",
    apply() {
      setDocumentMode("review");
      setNotesVisible([]);
      setPhraseState({ primary: false, secondary: false, translation: false, primaryFill: false });
      setSelectionTag(false);
      setAllNotes(false);
      setPrintReport(false);
      setFinalBanner(false);
      setNotesCount("0 notes");
      setAddNotePulse(false);
      setFocus("document");
    },
  },
  {
    title: "Select an exact phrase",
    caption: "Choose the word, phrase, sentence, or paragraph you want to comment on.",
    sideNote:
      "The selected phrase becomes the anchor for your note, so context is still there later.",
    cursorTarget: "phrase-primary",
    selectTarget: "phrase-primary",
    apply() {
      setDocumentMode("review");
      setNotesVisible([]);
      setPhraseState({ primary: true, secondary: false, translation: false, primaryFill: true });
      setSelectionTag(true);
      setAllNotes(false);
      setPrintReport(false);
      setFinalBanner(false);
      setNotesCount("0 notes");
      setAddNotePulse(false);
      setFocus("selection");
    },
  },
  {
    title: "Add a note",
    caption: "Write your comment beside the selected text.",
    sideNote:
      "The note is attached to the exact phrase you selected, not dropped into a separate document.",
    cursorTarget: "mock-add-note",
    clickTarget: "mock-add-note",
    apply() {
      setDocumentMode("review");
      setNotesVisible([]);
      setPhraseState({ primary: true, secondary: false, translation: false, primaryFill: false });
      setSelectionTag(true);
      setAllNotes(false);
      setPrintReport(false);
      setFinalBanner(false);
      setNotesCount("0 notes");
      setAddNotePulse(true);
      setFocus("add-note");
    },
  },
  {
    title: "Keep context visible",
    caption: "The note stays connected to the exact fragment.",
    sideNote:
      "One note stays active while another becomes a compact inactive card, so longer notes do not take over the screen.",
    cursorTarget: "note-primary",
    apply() {
      setDocumentMode("review");
      setNotesVisible(["primary", "secondary"]);
      setPhraseState({ primary: true, secondary: false, translation: false, primaryFill: false });
      setSelectionTag(true);
      setAllNotes(false);
      setPrintReport(false);
      setFinalBanner(false);
      setNotesCount("2 notes");
      setAddNotePulse(false);
      setFocus("notes");
    },
  },
  {
    title: "Find notes later",
    caption: "Use All notes to search and return to any comment.",
    sideNote:
      "Search gives you a quick way back to the phrase and note you need without scanning the whole document.",
    cursorTarget: "toolbar-all-notes",
    clickTarget: "toolbar-all-notes",
    secondaryCursorTarget: "all-notes-open",
    secondaryClickTarget: "all-notes-open",
    apply() {
      setDocumentMode("review");
      setNotesVisible(["primary", "secondary"]);
      setPhraseState({ primary: true, secondary: false, translation: false, primaryFill: false });
      setSelectionTag(true);
      setAllNotes(true);
      setPrintReport(false);
      setFinalBanner(false);
      setNotesCount("2 notes");
      setAddNotePulse(false);
      setFocus("all-notes");
    },
  },
  {
    title: "Create a report",
    caption: "Print report gives you a readable summary of selected text and notes.",
    sideNote:
      "The translation example keeps the original sentence visible and shows the note beside it before opening the report view.",
    cursorTarget: "toolbar-print-report",
    clickTarget: "toolbar-print-report",
    apply() {
      setDocumentMode("translation");
      setNotesVisible(["translation"]);
      setPhraseState({ primary: false, secondary: false, translation: true, primaryFill: false });
      setSelectionTag(false);
      setAllNotes(false);
      setPrintReport(true);
      setFinalBanner(false);
      setNotesCount("1 note");
      setAddNotePulse(false);
      setFocus("print-report");
    },
  },
  {
    title: "Keep files local",
    caption: "Your documents stay on your computer. Original files are not changed.",
    sideNote:
      "Save notes beside the document, come back later, and keep the source file itself untouched.",
    cursorTarget: null,
    apply() {
      setDocumentMode("translation");
      setNotesVisible(["translation"]);
      setPhraseState({ primary: false, secondary: false, translation: true, primaryFill: false });
      setSelectionTag(false);
      setAllNotes(false);
      setPrintReport(false);
      setFinalBanner(true);
      setNotesCount("1 note");
      setAddNotePulse(false);
      setFocus("final");
      hideCursor();
    },
  },
];

const STEP_DURATION_MS = 6800;

const stepCounter = document.getElementById("step-counter");
const stepTitle = document.getElementById("step-title");
const stepCaption = document.getElementById("step-caption");
const stepSideNote = document.getElementById("step-side-note");
const replayButton = document.getElementById("replay-demo");
const mockApp = document.getElementById("mock-app");
const addNoteButton = document.getElementById("mock-add-note");
const reviewDocument = document.getElementById("document-review");
const translationDocument = document.getElementById("document-translation");
const documentTitle = document.getElementById("document-title");
const documentType = document.getElementById("document-type");
const documentBadge = document.getElementById("document-badge");
const notesBadge = document.getElementById("notes-badge");
const phrasePrimary = document.getElementById("phrase-primary");
const phraseSecondary = document.getElementById("phrase-secondary");
const phraseTranslation = document.getElementById("phrase-translation");
const selectionTag = document.getElementById("selection-tag");
const notePrimary = document.getElementById("note-primary");
const noteSecondary = document.getElementById("note-secondary");
const noteTranslation = document.getElementById("note-translation");
const allNotesOverlay = document.getElementById("all-notes-overlay");
const printReportOverlay = document.getElementById("print-report-overlay");
const finalBanner = document.getElementById("final-banner");
const demoCursor = document.getElementById("demo-cursor");

const focusTargets = {
  document: reviewDocument,
  selection: phrasePrimary,
  "add-note": addNoteButton,
  notes: notePrimary,
  "all-notes": allNotesOverlay,
  "print-report": printReportOverlay,
  final: finalBanner,
};

const state = {
  stepIndex: 0,
  timer: null,
  subTimers: [],
};

function setDocumentMode(mode) {
  const isReview = mode === "review";
  reviewDocument.classList.toggle("hidden", !isReview);
  translationDocument.classList.toggle("hidden", isReview);
  documentTitle.textContent = isReview
    ? "sample-review-text.txt"
    : "sample-translation-text.txt";
  documentType.textContent = isReview ? "TXT document" : "TXT document for translation notes";
  documentBadge.textContent = isReview ? "Review notes" : "Translation notes";
}

function setPhraseState({ primary, secondary, translation, primaryFill }) {
  phrasePrimary.classList.toggle("is-selected", primary);
  phraseSecondary.classList.toggle("is-selected", secondary);
  phraseTranslation.classList.toggle("is-selected", translation);
  phraseTranslation.classList.toggle("is-relinked", translation);
  phrasePrimary.classList.toggle("phrase-selection-fill", primaryFill);
  phrasePrimary.style.setProperty("--selection-progress", primaryFill ? "100%" : "0%");
}

function setSelectionProgress(value) {
  phrasePrimary.classList.add("phrase-selection-fill");
  phrasePrimary.style.setProperty("--selection-progress", `${value}%`);
}

function clearSelectionProgress() {
  phrasePrimary.classList.remove("phrase-selection-fill");
  phrasePrimary.style.setProperty("--selection-progress", "0%");
}

function setSelectionTag(isVisible) {
  selectionTag.classList.toggle("hidden", !isVisible);
}

function setAddNotePulse(active) {
  addNoteButton.classList.toggle("is-pulsing", active);
}

function setNotesVisible(visibleNotes) {
  const hasPrimary = visibleNotes.includes("primary");
  const hasSecondary = visibleNotes.includes("secondary");
  const hasTranslation = visibleNotes.includes("translation");

  toggleNote(notePrimary, hasPrimary, true);
  toggleNote(noteSecondary, hasSecondary, false);
  toggleNote(noteTranslation, hasTranslation, true);
}

function toggleNote(noteElement, isVisible, isActive) {
  noteElement.classList.toggle("hidden", !isVisible);
  noteElement.classList.toggle("is-active", isVisible && isActive);
  noteElement.classList.toggle("is-inactive", isVisible && !isActive);
}

function setAllNotes(isVisible) {
  allNotesOverlay.classList.toggle("hidden", !isVisible);
}

function setPrintReport(isVisible) {
  printReportOverlay.classList.toggle("hidden", !isVisible);
}

function setFinalBanner(isVisible) {
  finalBanner.classList.toggle("hidden", !isVisible);
}

function setNotesCount(label) {
  notesBadge.textContent = label;
}

function setFocus(name) {
  Object.values(focusTargets).forEach((el) => el?.classList.remove("focus-callout"));
  focusTargets[name]?.classList.add("focus-callout");
}

function clearSubTimers() {
  state.subTimers.forEach((timer) => window.clearTimeout(timer));
  state.subTimers = [];
}

function schedule(delay, fn) {
  const timer = window.setTimeout(fn, delay);
  state.subTimers.push(timer);
}

function queueCursorMove(targetId, delay = 0, click = false) {
  if (!targetId) {
    return;
  }

  schedule(delay, () => {
    moveCursorTo(targetId);
    if (click) {
      schedule(380, triggerCursorClick);
    }
  });
}

function moveCursorTo(targetId) {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const shellRect = mockApp.getBoundingClientRect();
  const left = targetRect.left - shellRect.left + targetRect.width * 0.5;
  const top = targetRect.top - shellRect.top + targetRect.height * 0.55;

  demoCursor.classList.add("is-visible");
  demoCursor.style.left = `${left}px`;
  demoCursor.style.top = `${top}px`;
}

function triggerCursorClick() {
  demoCursor.classList.add("is-clicking");
  schedule(260, () => demoCursor.classList.remove("is-clicking"));
}

function hideCursor() {
  demoCursor.classList.remove("is-visible", "is-clicking");
}

function runStepAnimation(step) {
  hideCursor();

  if (step.selectTarget === "phrase-primary") {
    queueCursorMove("phrase-primary", 500, false);
    schedule(1100, () => setSelectionProgress(18));
    schedule(1450, () => setSelectionProgress(44));
    schedule(1800, () => setSelectionProgress(72));
    schedule(2150, () => setSelectionProgress(100));
    schedule(2450, () => {
      phrasePrimary.classList.add("is-selected");
      setSelectionTag(true);
    });
  } else {
    clearSelectionProgress();
  }

  if (step.cursorTarget && !step.selectTarget) {
    queueCursorMove(step.cursorTarget, 700, Boolean(step.clickTarget));
  }

  if (step.secondaryCursorTarget) {
    queueCursorMove(step.secondaryCursorTarget, 2600, Boolean(step.secondaryClickTarget));
  }
}

function renderStep(index) {
  clearSubTimers();
  const step = steps[index];
  state.stepIndex = index;
  step.apply();
  stepCounter.textContent = `Step ${index + 1} of ${steps.length}`;
  stepTitle.textContent = step.title;
  stepCaption.textContent = step.caption;
  stepSideNote.textContent = step.sideNote;
  runStepAnimation(step);
}

function clearPlayback() {
  if (state.timer) {
    window.clearTimeout(state.timer);
    state.timer = null;
  }
  clearSubTimers();
}

function playDemo() {
  clearPlayback();
  renderStep(0);

  let nextStep = 1;

  function queueNext() {
    if (nextStep >= steps.length) {
      return;
    }

    state.timer = window.setTimeout(() => {
      renderStep(nextStep);
      nextStep += 1;
      queueNext();
    }, STEP_DURATION_MS);
  }

  queueNext();
}

replayButton.addEventListener("click", playDemo);
window.addEventListener("load", playDemo);
