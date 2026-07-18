import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type {
  OnProgressParameters,
  PDFPageProxy,
} from 'pdfjs-dist/types/src/display/api'
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import './pdf-controlled-spike.css'

type SpikeNote = {
  comment: string
  id: number
  pageNumber: number
  x: number
  xRatio: number
  y: number
  yRatio: number
}

type PendingMarker = Omit<SpikeNote, 'comment' | 'id'>

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
  viewport: ReturnType<PDFPageProxy['getViewport']>
  workerMode: string
}

type SpikeDiagnostics = {
  byteLength?: number
  errorMessage?: string
  errorName?: string
  fileName?: string
  filePath?: string
  stage: string
  workerMode: string
}

const formatRatio = (value: number) => value.toFixed(4)

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

export default function PdfControlledSpike() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [diagnostics, setDiagnostics] = useState<SpikeDiagnostics>({
    stage: 'idle',
    workerMode: 'unconfigured',
  })
  const [pdfPath, setPdfPath] = useState('')
  const [renderedPage, setRenderedPage] = useState<RenderedPageState | null>(null)
  const [pendingRender, setPendingRender] = useState<PendingRenderState | null>(null)
  const [pendingMarker, setPendingMarker] = useState<PendingMarker | null>(null)
  const [pendingComment, setPendingComment] = useState('')
  const [notes, setNotes] = useState<SpikeNote[]>([])
  const [statusMessage, setStatusMessage] = useState(
    'Select a local PDF to test controlled page rendering.',
  )

  const fileName = useMemo(
    () => (pdfPath ? getFileNameFromPath(pdfPath) : ''),
    [pdfPath],
  )

  const renderPdfPage = useCallback(async (filePath: string) => {
    setIsLoading(true)
    setLoadError('')
    setStatusMessage('Loading PDF page 1 through pdf.js...')
    setPendingMarker(null)
    setPendingComment('')
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
        workerMode,
      })

      const bytes = await readFile(filePath)
      const pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      const byteLength = pdfBytes.byteLength

      console.info('[PDF controlled spike] selected file:', filePath)
      console.info('[PDF controlled spike] byte length:', byteLength)
      console.info('[PDF controlled spike] worker mode:', workerMode)

      setDiagnostics({
        byteLength,
        fileName: nextFileName,
        filePath,
        stage: 'loading-document',
        workerMode,
      })

      const loadingTask = getDocument({
        data: pdfBytes,
        useWorkerFetch: false,
        verbosity: 1,
      })

      loadingTask.onProgress = (progressData: OnProgressParameters) => {
        console.info('[PDF controlled spike] pdf.js load progress:', progressData)
      }

      const pdfDocument = await loadingTask.promise

      console.info('[PDF controlled spike] document loaded, pages:', pdfDocument.numPages)

      setDiagnostics({
        byteLength,
        fileName: nextFileName,
        filePath,
        stage: 'loading-page-1',
        workerMode,
      })

      const page = await pdfDocument.getPage(1)
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
        viewport,
        workerMode,
      })
      setDiagnostics({
        byteLength,
        fileName: nextFileName,
        filePath,
        stage: 'page-ready-for-canvas-render',
        workerMode,
      })
      setStatusMessage(`Loaded page 1 of ${nextFileName}. Rendering to canvas...`)
    } catch (error) {
      const { message, name } = getErrorDetails(error)
      console.error('[PDF controlled spike] render failure', {
        error,
        filePath,
      })
      setLoadError(message)
      setRenderedPage(null)
      setPendingRender(null)
      setDiagnostics((currentDiagnostics) => {
        const fallbackFileName = currentDiagnostics.fileName ?? getFileNameFromPath(filePath)
        return {
          ...currentDiagnostics,
        errorMessage: message,
        errorName: name,
        fileName: fallbackFileName,
        filePath,
        stage: `${currentDiagnostics.stage}-failed`,
        }
      })
      setStatusMessage(`Controlled PDF rendering failed for this file. ${name}: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!pendingRender || !renderedPage) {
      return
    }

    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const renderToCanvas = async () => {
      try {
        console.info('[PDF controlled spike] canvas mounted, rendering page', pendingRender.pageNumber)
        setDiagnostics({
          byteLength: pendingRender.byteLength,
          fileName: pendingRender.fileName,
          filePath: pendingRender.filePath,
          stage: 'rendering-page-1',
          workerMode: pendingRender.workerMode,
        })

        if (!canvas.getContext('2d')) {
          throw new Error('Could not create a 2D canvas context for PDF rendering.')
        }

        canvas.width = Math.ceil(pendingRender.viewport.width)
        canvas.height = Math.ceil(pendingRender.viewport.height)
        canvas.style.width = `${Math.ceil(pendingRender.viewport.width)}px`
        canvas.style.height = `${Math.ceil(pendingRender.viewport.height)}px`

        await pendingRender.page.render({
          canvas,
          viewport: pendingRender.viewport,
        }).promise

        setDiagnostics({
          byteLength: pendingRender.byteLength,
          fileName: pendingRender.fileName,
          filePath: pendingRender.filePath,
          stage: 'render-complete',
          workerMode: pendingRender.workerMode,
        })
        setStatusMessage(
          `Rendered page ${pendingRender.pageNumber} of ${pendingRender.fileName} under app control. Click on the page to place a test note marker.`,
        )
      } catch (error) {
        const { message, name } = getErrorDetails(error)
        console.error('[PDF controlled spike] canvas render failure', {
          error,
          filePath: pendingRender.filePath,
          stage: 'rendering-page-1',
        })
        setLoadError(message)
        setDiagnostics({
          byteLength: pendingRender.byteLength,
          errorMessage: message,
          errorName: name,
          fileName: pendingRender.fileName,
          filePath: pendingRender.filePath,
          stage: 'rendering-page-1-failed',
          workerMode: pendingRender.workerMode,
        })
        setStatusMessage(`Controlled PDF rendering failed for this file. ${name}: ${message}`)
      }
    }

    void renderToCanvas()
  }, [pendingRender, renderedPage])

  const handleSelectPdf = useCallback(async () => {
    setLoadError('')
    setStatusMessage('Opening file dialog...')
    setDiagnostics({
      stage: 'opening-file-dialog',
      workerMode: hasConfiguredPdfJsWorker ? 'vite-worker-port' : 'unconfigured',
    })

    try {
      const { isTauri } = await import('@tauri-apps/api/core')

      if (!isTauri()) {
        setStatusMessage('The controlled PDF spike can open files only inside the Tauri app.')
        return
      }

      const { open } = await import('@tauri-apps/plugin-dialog')
      console.info('[PDF controlled spike] dialog plugin imported')

      const selected = await open({
        title: 'Open PDF for controlled rendering spike',
        directory: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        multiple: false,
      })

      console.info('[PDF controlled spike] selected path:', selected)

      if (!selected || Array.isArray(selected)) {
        setStatusMessage('No file selected.')
        setDiagnostics({
          stage: 'no-file-selected',
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
      }))
      setStatusMessage(`Failed to open PDF: ${message}`)
    }
  }, [renderPdfPage])

  const handleCanvasClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!renderedPage) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const xRatio = rect.width > 0 ? x / rect.width : 0
      const yRatio = rect.height > 0 ? y / rect.height : 0

      setPendingMarker({
        pageNumber: renderedPage.pageNumber,
        x,
        xRatio,
        y,
        yRatio,
      })
      setPendingComment('')
      setStatusMessage(
        `Captured click at x ${Math.round(x)}, y ${Math.round(y)} on page ${renderedPage.pageNumber}. Add a comment to save the test marker.`,
      )
    },
    [renderedPage],
  )

  const handleSaveNote = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!pendingMarker) {
        return
      }

      const nextNote: SpikeNote = {
        ...pendingMarker,
        comment: pendingComment.trim() || 'Test note',
        id: Date.now() + notes.length,
      }

      setNotes((currentNotes) => [...currentNotes, nextNote])
      setPendingMarker(null)
      setPendingComment('')
      setStatusMessage(
        `Saved test marker on page ${nextNote.pageNumber} at (${Math.round(nextNote.x)}, ${Math.round(nextNote.y)}).`,
      )
    },
    [notes.length, pendingComment, pendingMarker],
  )

  const handleCancelPendingMarker = useCallback(() => {
    setPendingMarker(null)
    setPendingComment('')
    setStatusMessage('Pending marker cleared. Click on the page to place a new test note marker.')
  }, [])

  const markers = useMemo(() => {
    const persistedMarkers = notes.map((note) => ({
      key: `saved-${note.id}`,
      label: note.comment,
      xRatio: note.xRatio,
      yRatio: note.yRatio,
    }))

    const transientMarker = pendingMarker
      ? [
          {
            key: 'pending-marker',
            label: 'Pending marker',
            xRatio: pendingMarker.xRatio,
            yRatio: pendingMarker.yRatio,
          },
        ]
      : []

    return [...persistedMarkers, ...transientMarker]
  }, [notes, pendingMarker])

  const handleBackToNoteAnchor = useCallback(() => {
    if (window.location.hash === '#pdf-controlled-spike') {
      history.replaceState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      return
    }

    const searchParams = new URLSearchParams(window.location.search)

    if (searchParams.get('pdf-controlled-spike') === '1') {
      searchParams.delete('pdf-controlled-spike')
      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      history.replaceState(null, '', nextUrl)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }
  }, [])

  return (
    <main className="pdf-controlled-spike-page">
      <section className="pdf-controlled-spike-hero">
        <p className="pdf-controlled-spike-kicker">
          Controlled PDF rendering spike - not production PDF mode
        </p>
        <h1>NoteAnchor PDF rendering research</h1>
        <p className="pdf-controlled-spike-summary">
          This isolated spike tests whether NoteAnchor can render page 1 of a local PDF under app
          control, capture click coordinates, and redraw markers from in-memory note state.
        </p>
        <div className="pdf-controlled-spike-actions">
          <button
            className="pdf-controlled-spike-button"
            disabled={isLoading}
            onClick={() => void handleSelectPdf()}
            type="button"
          >
            {isLoading ? 'Loading PDF...' : 'Open PDF for spike'}
          </button>
          <button
            className="pdf-controlled-spike-button secondary"
            onClick={handleBackToNoteAnchor}
            type="button"
          >
            Back to NoteAnchor
          </button>
        </div>
        <p className="pdf-controlled-spike-status">{statusMessage}</p>
        {loadError ? <p className="pdf-controlled-spike-error">{loadError}</p> : null}
      </section>

      <section className="pdf-controlled-spike-layout">
        <div className="pdf-controlled-spike-stage">
          <div className="pdf-controlled-spike-stage-header">
            <div>
              <h2>Rendered page</h2>
              <p>Click on the PDF page to place a test note marker.</p>
            </div>
            <div className="pdf-controlled-spike-file-meta">
              <span>{fileName || 'No PDF selected yet'}</span>
              <span>{renderedPage ? `Page ${renderedPage.pageNumber}` : 'Page -'}</span>
            </div>
          </div>

          <div className="pdf-controlled-spike-canvas-shell">
            {renderedPage ? (
              <div
                className="pdf-controlled-spike-canvas-wrap"
                onClick={handleCanvasClick}
                style={{
                  height: `${renderedPage.height}px`,
                  width: `${renderedPage.width}px`,
                }}
              >
                <canvas ref={canvasRef} className="pdf-controlled-spike-canvas" />
                {markers.map((marker, index) => (
                  <div
                    key={marker.key}
                    className={`pdf-controlled-spike-marker ${
                      marker.key === 'pending-marker' ? 'is-pending' : ''
                    }`}
                    style={{
                      left: `${marker.xRatio * 100}%`,
                      top: `${marker.yRatio * 100}%`,
                    }}
                    title={`${index + 1}. ${marker.label}`}
                  />
                ))}
              </div>
            ) : (
              <div className="pdf-controlled-spike-empty">
                Select a PDF file to render page 1 under app control.
              </div>
            )}
          </div>
        </div>

        <aside className="pdf-controlled-spike-sidebar">
          <section className="pdf-controlled-spike-panel">
            <h2>Captured point</h2>
            {pendingMarker ? (
              <form className="pdf-controlled-spike-form" onSubmit={handleSaveNote}>
                <div className="pdf-controlled-spike-form-body">
                  <dl className="pdf-controlled-spike-coordinates">
                    <div>
                      <dt>Page</dt>
                      <dd>{pendingMarker.pageNumber}</dd>
                    </div>
                    <div>
                      <dt>X / Y</dt>
                      <dd>
                        {Math.round(pendingMarker.x)} / {Math.round(pendingMarker.y)}
                      </dd>
                    </div>
                    <div>
                      <dt>X ratio</dt>
                      <dd>{formatRatio(pendingMarker.xRatio)}</dd>
                    </div>
                    <div>
                      <dt>Y ratio</dt>
                      <dd>{formatRatio(pendingMarker.yRatio)}</dd>
                    </div>
                  </dl>

                  <label className="pdf-controlled-spike-label" htmlFor="pdf-spike-comment">
                    Comment
                  </label>
                  <textarea
                    id="pdf-spike-comment"
                    className="pdf-controlled-spike-textarea"
                    onChange={(event) => setPendingComment(event.target.value)}
                    placeholder="Comment"
                    rows={2}
                    value={pendingComment}
                  />
                  <div className="pdf-controlled-spike-form-actions">
                    <button className="pdf-controlled-spike-button" type="submit">
                      Save test marker
                    </button>
                    <button
                      className="pdf-controlled-spike-button secondary"
                      onClick={handleCancelPendingMarker}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <p className="pdf-controlled-spike-muted">
                No point captured yet. Click on the rendered page to inspect pixel and normalized
                coordinates.
              </p>
            )}

            <div className="pdf-controlled-spike-subsection">
              <h3>Test notes</h3>
              {notes.length ? (
                <ol className="pdf-controlled-spike-notes">
                  {notes.map((note) => (
                    <li key={note.id} className="pdf-controlled-spike-note">
                      <strong>Page {note.pageNumber}</strong>
                      <span>{note.comment}</span>
                      <span>
                        px: {Math.round(note.x)}, {Math.round(note.y)}
                      </span>
                      <span>
                        ratio: {formatRatio(note.xRatio)}, {formatRatio(note.yRatio)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="pdf-controlled-spike-muted">
                  Saved markers will appear here and stay visible on the rendered page.
                </p>
              )}
            </div>
          </section>

          <section className="pdf-controlled-spike-panel">
            <h2>Research scope</h2>
            <ul className="pdf-controlled-spike-list">
              <li>Page 1 rendering only</li>
              <li>Click coordinates relative to the rendered PDF page</li>
              <li>Visible markers re-rendered from in-memory state</li>
              <li>No change to production TXT, DOCX, or current PDF mode</li>
            </ul>
          </section>
        </aside>
      </section>

      <section className="pdf-controlled-spike-footer">
        <details className="pdf-controlled-spike-diagnostics">
          <summary>Technical details</summary>
          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>
      </section>
    </main>
  )
}
