import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type {
  OnProgressParameters,
  PDFPageProxy,
} from 'pdfjs-dist/types/src/display/api'
import { TextLayerBuilder } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import './pdf-text-selection-spike.css'

type RenderedPageState = {
  height: number
  pageNumber: number
  width: number
}

type PendingRenderState = {
  byteLength: number
  fileName: string
  filePath: string
  page: PDFPageProxy
  pageNumber: number
  textItemCount: number
  viewport: ReturnType<PDFPageProxy['getViewport']>
  workerMode: string
}

type SelectionRect = {
  height: number
  heightRatio: number
  width: number
  widthRatio: number
  x: number
  xRatio: number
  y: number
  yRatio: number
}

type PendingTextSelection = {
  pageNumber: number
  rects: SelectionRect[]
  selectedText: string
}

type SpikeTextNote = PendingTextSelection & {
  comment: string
  id: number
}

type SelectionSpikeDiagnostics = {
  byteLength?: number
  errorMessage?: string
  errorName?: string
  fileName?: string
  filePath?: string
  selectedText?: string
  selectionRectCount?: number
  stage: string
  textItemCount?: number
  textLayerLoaded: boolean
  workerMode: string
}

const getFileNameFromPath = (filePath: string) =>
  filePath.split(/[/\\]/).filter(Boolean).pop() ?? filePath

const getErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: 'UnknownError',
  }
}

const normalizeSelectedText = (value: string) =>
  value.replace(/\s+/g, ' ').trim()

const rangeNodeBelongsToContainer = (node: Node | null, container: HTMLElement | null) => {
  if (!node || !container) {
    return false
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement ? container.contains(node.parentElement) : false
  }

  return container.contains(node)
}

const domRectToSelectionRect = (
  rect: DOMRect,
  containerRect: DOMRect,
): SelectionRect | null => {
  const x = rect.left - containerRect.left
  const y = rect.top - containerRect.top
  const width = rect.width
  const height = rect.height

  if (width <= 0 || height <= 0) {
    return null
  }

  return {
    height,
    heightRatio: containerRect.height > 0 ? height / containerRect.height : 0,
    width,
    widthRatio: containerRect.width > 0 ? width / containerRect.width : 0,
    x,
    xRatio: containerRect.width > 0 ? x / containerRect.width : 0,
    y,
    yRatio: containerRect.height > 0 ? y / containerRect.height : 0,
  }
}

let hasConfiguredPdfJsWorker = false

const ensurePdfJsWorker = () => {
  if (hasConfiguredPdfJsWorker) {
    return 'vite-worker-port'
  }

  if (typeof window !== 'undefined' && 'Worker' in window) {
    GlobalWorkerOptions.workerPort = new PdfJsWorker()
    hasConfiguredPdfJsWorker = true
    return 'vite-worker-port'
  }

  return 'no-worker-available'
}

export default function PdfTextSelectionSpike() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerHostRef = useRef<HTMLDivElement | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [diagnostics, setDiagnostics] = useState<SelectionSpikeDiagnostics>({
    stage: 'idle',
    textLayerLoaded: false,
    workerMode: 'unconfigured',
  })
  const [pdfPath, setPdfPath] = useState('')
  const [renderedPage, setRenderedPage] = useState<RenderedPageState | null>(null)
  const [pendingRender, setPendingRender] = useState<PendingRenderState | null>(null)
  const [currentSelection, setCurrentSelection] = useState<PendingTextSelection | null>(null)
  const [draftSelection, setDraftSelection] = useState<PendingTextSelection | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [notes, setNotes] = useState<SpikeTextNote[]>([])
  const [statusMessage, setStatusMessage] = useState(
    'Select a local PDF to test controlled rendering with selectable PDF text.',
  )

  const fileName = useMemo(
    () => (pdfPath ? getFileNameFromPath(pdfPath) : ''),
    [pdfPath],
  )

  const clearBrowserSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
  }, [])

  const readCurrentSelection = useCallback(() => {
    const selection = window.getSelection()
    const textLayerHost = textLayerHostRef.current
    const pageNumber = renderedPage?.pageNumber ?? 1

    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !textLayerHost
    ) {
      return
    }

    const range = selection.getRangeAt(0)

    if (
      !rangeNodeBelongsToContainer(range.commonAncestorContainer, textLayerHost) &&
      !rangeNodeBelongsToContainer(selection.anchorNode, textLayerHost) &&
      !rangeNodeBelongsToContainer(selection.focusNode, textLayerHost)
    ) {
      return
    }

    const selectedText = normalizeSelectedText(selection.toString())

    if (!selectedText) {
      return
    }

    const containerRect = textLayerHost.getBoundingClientRect()
    const rects = Array.from(range.getClientRects())
      .map((rect) => domRectToSelectionRect(rect, containerRect))
      .filter((rect): rect is SelectionRect => rect !== null)

    const normalizedRects = rects.length
      ? rects
      : (() => {
          const fallbackRect = domRectToSelectionRect(
            range.getBoundingClientRect(),
            containerRect,
          )

          return fallbackRect ? [fallbackRect] : []
        })()

    if (!normalizedRects.length) {
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        selectedText,
        selectionRectCount: 0,
      }))
      return
    }

    setCurrentSelection({
      pageNumber,
      rects: normalizedRects,
      selectedText,
    })
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      selectedText,
      selectionRectCount: normalizedRects.length,
    }))
  }, [renderedPage?.pageNumber])

  const renderPdfPage = useCallback(async (filePath: string) => {
    setIsLoading(true)
    setLoadError('')
    setStatusMessage('Loading PDF page 1 with text-layer diagnostics...')
    setCurrentSelection(null)
    setDraftSelection(null)
    setNoteDraft('')
    setNotes([])
    setRenderedPage(null)
    setPendingRender(null)

    try {
      const nextFileName = getFileNameFromPath(filePath)
      const workerMode = ensurePdfJsWorker()
      setPdfPath(filePath)

      setDiagnostics({
        fileName: nextFileName,
        filePath,
        stage: 'reading-file',
        textLayerLoaded: false,
        workerMode,
      })

      const bytes = await readFile(filePath)
      const pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      const byteLength = pdfBytes.byteLength

      setDiagnostics({
        byteLength,
        fileName: nextFileName,
        filePath,
        stage: 'loading-document',
        textLayerLoaded: false,
        workerMode,
      })

      const loadingTask = getDocument({
        data: pdfBytes,
        useWorkerFetch: false,
        verbosity: 1,
      })

      loadingTask.onProgress = (progressData: OnProgressParameters) => {
        console.info('[PDF text selection spike] pdf.js load progress:', progressData)
      }

      const pdfDocument = await loadingTask.promise
      const page = await pdfDocument.getPage(1)
      const textContent = await page.getTextContent({
        disableNormalization: true,
        includeMarkedContent: true,
      })
      const baseViewport = page.getViewport({ scale: 1 })
      const preferredWidth = 820
      const scale = Math.max(0.8, Math.min(1.6, preferredWidth / baseViewport.width))
      const viewport = page.getViewport({ scale })

      setRenderedPage({
        height: Math.ceil(viewport.height),
        pageNumber: 1,
        width: Math.ceil(viewport.width),
      })
      setPendingRender({
        byteLength,
        fileName: nextFileName,
        filePath,
        page,
        pageNumber: 1,
        textItemCount: textContent.items.length,
        viewport,
        workerMode,
      })
      setDiagnostics({
        byteLength,
        fileName: nextFileName,
        filePath,
        stage: 'page-ready-for-render',
        textItemCount: textContent.items.length,
        textLayerLoaded: false,
        workerMode,
      })
      setStatusMessage(`Loaded page 1 of ${nextFileName}. Rendering page and text layer...`)
    } catch (error) {
      const { message, name } = getErrorDetails(error)
      console.error('[PDF text selection spike] render failure', { error, filePath })
      setLoadError(message)
      setRenderedPage(null)
      setPendingRender(null)
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        errorMessage: message,
        errorName: name,
        fileName: currentDiagnostics.fileName ?? getFileNameFromPath(filePath),
        filePath,
        stage: `${currentDiagnostics.stage}-failed`,
        textLayerLoaded: false,
      }))
      setStatusMessage(`PDF text-selection spike failed for this file. ${name}: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!pendingRender || !renderedPage) {
      return
    }

    const canvas = canvasRef.current
    const textLayerHost = textLayerHostRef.current

    if (!canvas || !textLayerHost) {
      return
    }

    let cancelled = false
    const textLayerBuilder = new TextLayerBuilder({
      onAppend: (div: HTMLDivElement) => {
        textLayerHost.replaceChildren(div)
      },
      pdfPage: pendingRender.page,
    })

    const renderToCanvasAndTextLayer = async () => {
      try {
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          stage: 'rendering-page-and-text-layer',
          textLayerLoaded: false,
        }))

        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('Could not create a 2D canvas context for PDF rendering.')
        }

        canvas.width = Math.ceil(pendingRender.viewport.width)
        canvas.height = Math.ceil(pendingRender.viewport.height)
        canvas.style.width = `${Math.ceil(pendingRender.viewport.width)}px`
        canvas.style.height = `${Math.ceil(pendingRender.viewport.height)}px`

        textLayerHost.replaceChildren()

        await pendingRender.page.render({
          canvas,
          viewport: pendingRender.viewport,
        }).promise

        await textLayerBuilder.render({
          images: null as never,
          viewport: pendingRender.viewport,
        })

        if (cancelled) {
          textLayerBuilder.cancel()
          return
        }

        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          stage: 'render-complete',
          textLayerLoaded: true,
        }))
        setStatusMessage(
          `Rendered page 1 of ${pendingRender.fileName} with a selectable text layer. Select text, then click Add note to selected text.`,
        )
      } catch (error) {
        const { message, name } = getErrorDetails(error)
        console.error('[PDF text selection spike] render failure', {
          error,
          filePath: pendingRender.filePath,
        })
        setLoadError(message)
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          errorMessage: message,
          errorName: name,
          stage: `${currentDiagnostics.stage}-failed`,
          textLayerLoaded: false,
        }))
        setStatusMessage(`Controlled PDF text layer failed for this file. ${name}: ${message}`)
      }
    }

    void renderToCanvasAndTextLayer()

    return () => {
      cancelled = true
      textLayerBuilder.cancel()
      textLayerHost.replaceChildren()
    }
  }, [pendingRender, renderedPage])

  useEffect(() => {
    const handleSelectionChange = () => {
      readCurrentSelection()
    }

    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [readCurrentSelection])

  const handleSelectPdf = useCallback(async () => {
    setLoadError('')
    setStatusMessage('Opening file dialog...')
    setDiagnostics({
      stage: 'opening-file-dialog',
      textLayerLoaded: false,
      workerMode: hasConfiguredPdfJsWorker ? 'vite-worker-port' : 'unconfigured',
    })

    try {
      const { isTauri } = await import('@tauri-apps/api/core')

      if (!isTauri()) {
        setStatusMessage('The PDF text-selection spike can open files only inside the Tauri app.')
        return
      }

      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        title: 'Open PDF for text-selection spike',
        directory: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        multiple: false,
      })

      if (!selected || Array.isArray(selected)) {
        setStatusMessage('No file selected.')
        setDiagnostics({
          stage: 'no-file-selected',
          textLayerLoaded: false,
          workerMode: hasConfiguredPdfJsWorker ? 'vite-worker-port' : 'unconfigured',
        })
        return
      }

      await renderPdfPage(selected)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown file dialog error.'
      setLoadError(message)
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        errorMessage: message,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        stage: 'file-dialog-failed',
        textLayerLoaded: false,
      }))
      setStatusMessage(`Failed to open PDF: ${message}`)
    }
  }, [renderPdfPage])

  const handleAddNoteToSelectedText = useCallback(() => {
    if (!currentSelection) {
      return
    }

    setDraftSelection(currentSelection)
    setNoteDraft('')
    setStatusMessage(
      `Selected PDF text captured from page ${currentSelection.pageNumber}. Add a comment to save the test note.`,
    )
  }, [currentSelection])

  const handleClearCapturedSelection = useCallback(() => {
    setCurrentSelection(null)
    setDraftSelection(null)
    setNoteDraft('')
    clearBrowserSelection()
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      selectedText: '',
      selectionRectCount: 0,
    }))
    setStatusMessage('Captured PDF text cleared. Select new text on page 1 to continue.')
  }, [clearBrowserSelection])

  const handleSaveNote = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!draftSelection) {
        return
      }

      const nextNote: SpikeTextNote = {
        ...draftSelection,
        comment: noteDraft.trim() || 'Test note',
        id: Date.now() + notes.length,
      }

      setNotes((currentNotes) => [...currentNotes, nextNote])
      setDraftSelection(null)
      setNoteDraft('')
      setCurrentSelection(null)
      clearBrowserSelection()
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        selectedText: '',
        selectionRectCount: 0,
      }))
      setStatusMessage(
        `Saved text note from page ${nextNote.pageNumber} with ${nextNote.rects.length} highlight rectangle(s).`,
      )
    },
    [clearBrowserSelection, draftSelection, noteDraft, notes.length],
  )

  const handleCancelDraft = useCallback(() => {
    setDraftSelection(null)
    setNoteDraft('')
    setStatusMessage('Text-note draft cleared. Select text on the PDF page to try again.')
  }, [])

  const handleBackToNoteAnchor = useCallback(() => {
    if (window.location.hash === '#pdf-text-selection-spike') {
      history.replaceState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      return
    }

    const searchParams = new URLSearchParams(window.location.search)

    if (searchParams.get('pdf-text-selection-spike') === '1') {
      searchParams.delete('pdf-text-selection-spike')
      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      history.replaceState(null, '', nextUrl)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [])

  const highlightGroups = useMemo(() => {
    const savedHighlights = notes.map((note) => ({
      className: 'pdf-text-selection-spike-highlight saved',
      key: `saved-${note.id}`,
      rects: note.rects,
    }))

    const selectedHighlights = currentSelection
      ? [
          {
            className: 'pdf-text-selection-spike-highlight selected',
            key: 'current-selection',
            rects: currentSelection.rects,
          },
        ]
      : []

    return [...savedHighlights, ...selectedHighlights]
  }, [currentSelection, notes])

  return (
    <main className="pdf-text-selection-spike-page">
      <section className="pdf-text-selection-spike-hero">
        <div className="pdf-text-selection-spike-hero-main">
          <div>
            <p className="pdf-text-selection-spike-kicker">
              Controlled PDF text-selection spike - not production PDF mode
            </p>
            <h1>NoteAnchor PDF text-selection research</h1>
            <p className="pdf-text-selection-spike-summary">
              This isolated spike tests selected text plus comment as the future PDF-note
              direction. Coordinates and highlight rectangles remain internal anchoring data.
            </p>
          </div>
          <div className="pdf-text-selection-spike-actions">
            <button
              className="pdf-text-selection-spike-button"
              disabled={isLoading}
              onClick={() => void handleSelectPdf()}
              type="button"
            >
              {isLoading ? 'Loading PDF...' : 'Open PDF for text-selection spike'}
            </button>
            <button
              className="pdf-text-selection-spike-button secondary"
              onClick={handleBackToNoteAnchor}
              type="button"
            >
              Back to NoteAnchor
            </button>
          </div>
        </div>
        <p className="pdf-text-selection-spike-status">{statusMessage}</p>
        {loadError ? <p className="pdf-text-selection-spike-error">{loadError}</p> : null}
      </section>

      <section className="pdf-text-selection-spike-layout">
        <div className="pdf-text-selection-spike-stage">
          <div className="pdf-text-selection-spike-stage-header">
            <div>
              <h2>Rendered PDF page with text layer</h2>
              <p>Select actual PDF text on page 1, then click Add note to selected text.</p>
            </div>
            <div className="pdf-text-selection-spike-file-meta">
              <span>{fileName || 'No PDF selected yet'}</span>
              <span>{renderedPage ? `Page ${renderedPage.pageNumber}` : 'Page -'}</span>
            </div>
          </div>

          <div className="pdf-text-selection-spike-stage-actions">
            <button
              className="pdf-text-selection-spike-button"
              disabled={!currentSelection}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleAddNoteToSelectedText}
              type="button"
            >
              Add note to selected text
            </button>
            <button
              className="pdf-text-selection-spike-button secondary"
              disabled={!currentSelection && !draftSelection}
              onClick={handleClearCapturedSelection}
              type="button"
            >
              Clear captured text
            </button>
            <span className="pdf-text-selection-spike-stage-hint">
              {draftSelection
                ? `Draft ready from page ${draftSelection.pageNumber}`
                : currentSelection
                  ? `${currentSelection.rects.length} selection rectangle(s) captured`
                  : 'No PDF text selection captured yet'}
            </span>
          </div>

          <div className="pdf-text-selection-spike-canvas-shell">
            {renderedPage ? (
              <div
                className="pdf-text-selection-spike-page-wrap"
                style={{
                  height: `${renderedPage.height}px`,
                  width: `${renderedPage.width}px`,
                }}
              >
                <canvas
                  ref={canvasRef}
                  className="pdf-text-selection-spike-canvas"
                />
                <div
                  aria-hidden="true"
                  className="pdf-text-selection-spike-highlights"
                >
                  {highlightGroups.flatMap((group) =>
                    group.rects.map((rect, index) => (
                      <div
                        key={`${group.key}-${index}`}
                        className={group.className}
                        style={{
                          height: `${rect.height}px`,
                          left: `${rect.x}px`,
                          top: `${rect.y}px`,
                          width: `${rect.width}px`,
                        }}
                      />
                    )),
                  )}
                </div>
                <div
                  ref={textLayerHostRef}
                  className="pdf-text-selection-spike-text-layer-host"
                />
              </div>
            ) : (
              <div className="pdf-text-selection-spike-empty">
                Select a PDF file to render page 1 and test selectable PDF text.
              </div>
            )}
          </div>
        </div>

        <aside className="pdf-text-selection-spike-sidebar">
          <section className="pdf-text-selection-spike-panel primary">
            <div className="pdf-text-selection-spike-panel-heading">
              <h2>Selected PDF text</h2>
              {currentSelection && !draftSelection ? (
                <span className="pdf-text-selection-spike-badge">Captured</span>
              ) : null}
            </div>
            <div className="pdf-text-selection-spike-panel-scroll">
              {draftSelection ? (
                <form className="pdf-text-selection-spike-form" onSubmit={handleSaveNote}>
                  <div className="pdf-text-selection-spike-form-body">
                    <div className="pdf-text-selection-spike-selected-text">
                      {draftSelection.selectedText}
                    </div>
                    <dl className="pdf-text-selection-spike-selection-meta">
                      <div>
                        <dt>Page</dt>
                        <dd>{draftSelection.pageNumber}</dd>
                      </div>
                      <div>
                        <dt>Rectangles</dt>
                        <dd>{draftSelection.rects.length}</dd>
                      </div>
                    </dl>
                    <label className="pdf-text-selection-spike-label" htmlFor="pdf-text-spike-comment">
                      Comment
                    </label>
                    <textarea
                      id="pdf-text-spike-comment"
                      className="pdf-text-selection-spike-textarea"
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder="Comment"
                      rows={3}
                      value={noteDraft}
                    />
                    <div className="pdf-text-selection-spike-form-actions">
                      <button className="pdf-text-selection-spike-button" type="submit">
                        Save test note
                      </button>
                      <button
                        className="pdf-text-selection-spike-button secondary"
                        onClick={handleCancelDraft}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              ) : currentSelection ? (
                <div className="pdf-text-selection-spike-current-selection">
                  <div className="pdf-text-selection-spike-selected-text">
                    {currentSelection.selectedText}
                  </div>
                  <div className="pdf-text-selection-spike-selection-summary">
                    Page {currentSelection.pageNumber} - {currentSelection.rects.length} rectangle(s)
                  </div>
                </div>
              ) : (
                <p className="pdf-text-selection-spike-muted">
                  No selected PDF text yet. Try selecting a word, phrase, or line directly on the
                  rendered text layer.
                </p>
              )}

              <div className="pdf-text-selection-spike-subsection">
                <h3>Test notes</h3>
                {notes.length ? (
                  <ol className="pdf-text-selection-spike-notes">
                    {notes.map((note) => (
                      <li key={note.id} className="pdf-text-selection-spike-note">
                        <strong>{note.selectedText}</strong>
                        <span>{note.comment}</span>
                        <span>
                          Page {note.pageNumber} - {note.rects.length} rectangle(s)
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="pdf-text-selection-spike-muted">
                    Saved text notes will appear here and keep their highlight rectangles on the
                    page.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="pdf-text-selection-spike-panel diagnostics-panel">
            <div className="pdf-text-selection-spike-panel-heading">
              <h2>Diagnostics</h2>
              <span className="pdf-text-selection-spike-badge subtle">{diagnostics.stage}</span>
            </div>
            <ul className="pdf-text-selection-spike-list compact">
              <li>Text layer loaded: {diagnostics.textLayerLoaded ? 'yes' : 'no'}</li>
              <li>Text items: {diagnostics.textItemCount ?? 0}</li>
              <li>Selected text: {diagnostics.selectedText || '(none)'}</li>
              <li>Selection rectangles: {diagnostics.selectionRectCount ?? 0}</li>
            </ul>
            <details className="pdf-text-selection-spike-diagnostics">
              <summary>Technical details</summary>
              <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
            </details>
          </section>
        </aside>
      </section>
    </main>
  )
}
