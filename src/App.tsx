import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from 'react'
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist'
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api'
import { TextLayerBuilder } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import './App.css'

const initialRecentOpenDiagnosticState: RecentOpenDiagnosticState = {
  active: false,
  failedAt: '',
  fileExists: 'unknown',
  normalizedPath: '',
  openCommitted: false,
  pdfBytesLoaded: false,
  pdfDocumentCreated: false,
  pdfNumPagesResolved: false,
  rawPath: '',
  recoveredNotesLoaded: false,
  recoveryDialogTriggered: false,
  resolvedPageCount: null,
  source: '',
  status: '',
}

const initialPdfStickyDiagnosticState: PdfStickyDiagnosticState = {
  gapToTopBar: null,
  pagePaddingTop: '',
  scrollContainer: '',
  stickyHost: '',
  stickyTop: '',
  stickyViewportTop: null,
  topBarBottom: null,
  viewerPaddingTop: '',
  workspaceScrollTop: 0,
}

const pdfReadingPositionStorageSuffix = '.pdf-reading-position.v1'
const pdfReadingPositionSaveDelayMs = 180
const appVersion = '0.4.2'
const pdfSidebarLongNoteCharacterThreshold = 280
// Guarded PDF text-note availability is decided per document and per page below.
// Do not disable the entire flow in production builds, or the installer diverges
// from the manually verified guarded release behavior.
const ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES = true

type NoteKind = 'pdf-page'
type PdfAnchorType = 'page' | 'point' | 'area' | 'text'
type PdfDocumentType = 'pdf'
type PdfTextLayerStatus = 'pending' | 'available' | 'empty'

type DocumentKind = 'sample' | 'txt' | 'docx' | 'pdf' | 'empty'

type Note = {
  id: number
  paragraphIndex: number
  startOffset: number
  endOffset: number
  documentType?: PdfDocumentType
  anchorType?: PdfAnchorType
  noteKind?: NoteKind
  pdfPageNumber?: number
  xRatio?: number
  yRatio?: number
  widthRatio?: number
  heightRatio?: number
  x?: number
  y?: number
  width?: number
  height?: number
  pageWidth?: number
  pageHeight?: number
  pdfHighlightRects?: PdfHighlightRect[]
  pdfSelectionKey?: string
  pdfTextAnchorItemIndex?: number
  pdfTextAnchorLeftRatio?: number
  pdfTextAnchorTopRatio?: number
  pdfTextAnchorTokenIndex?: number
  selectedText: string
  previousSelectedText?: string
  context: string
  comment: string
}

type NoteAnchor = Omit<Note, 'id' | 'comment' | 'previousSelectedText'>

type ConnectorLine = {
  id: number
  x1: number
  x2: number
  y1: number
  y2: number
}

type NoteCardPosition = {
  id: number
  left: number
  top: number
  width: number
}

type WorkspaceCanvasSize = {
  height: number
  width: number
}

type ModalPosition = {
  left: number
  top: number
}

type DocumentMetadata = {
  documentId: string
  documentKind: DocumentKind
  fileName: string
  source: 'sample' | 'browser-file' | 'desktop-file' | 'empty'
  documentContentHash?: string
  documentPath?: string
  fileSize?: number
  fileLastModified?: number
  notesFilePath?: string
  storageKey: string
}

type OpenedDesktopTextFile = {
  contentHash: string
  documentKind: 'txt' | 'docx' | 'pdf'
  encoding: string
  text: string
  warning?: string | null
  sizeBytes: number
  modifiedAt?: number | null
}

type DesktopNotesFileCandidate = {
  contents: string
  notesFilePath: string
}

type ExtractNotesOptions = {
  allowPathMismatch?: boolean
}

type ExtractedNotesResult = {
  loadFailed?: boolean
  message?: string
  notes: Note[]
  rawNotesCount: number
  validNotesCount: number
}

type ResolvedAnchorStatus = 'exact' | 'recovered' | 'review'

type ResolvedNoteAnchor = {
  endOffset: number
  paragraphIndex: number
  startOffset: number
  status: ResolvedAnchorStatus
}

type DocumentFindMatch = {
  endOffset: number
  index: number
  paragraphIndex: number
  startOffset: number
}

type RecentDocumentEntry = {
  documentPath: string
  fileName: string
  lastOpenedAt: string
  notesFilePath?: string
}

type PdfReadingPositionState = {
  documentPath?: string
  pageNumber: number
  pageScrollRatio: number
  savedAt?: string
}

type MissingRecentDocumentState = {
  documentPath: string
  fileName: string
}

type ExportFeedbackState = {
  fileName?: string
  filePath?: string
  kind: 'error' | 'success'
  message: string
}

type PrintPreviewNote = {
  comment: string
  id: number
  isFragmentMissing: boolean
  noteNumber: number
  previousSelectedText?: string
  selectedText: string
  sentenceOrPhrase?: string
}

type PrintPreviewState = {
  documentType: string
  fileName: string
  notes: PrintPreviewNote[]
  printedAt: string
}

type PdfRenderedPageState = {
  filePath: string
  height: number
  pageNumber: number
  requestId: number
  sessionKey: number
  width: number
}

type PdfPendingRenderState = {
  fileName: string
  filePath: string
  page: PDFPageProxy
  pageNumber: number
  requestId: number
  sessionKey: number
  viewport: ReturnType<PDFPageProxy['getViewport']>
}

type PdfCurrentPageNoteCardPosition = {
  id: number
  top: number
}

type PdfHighlightRect = {
  heightRatio: number
  widthRatio: number
  xRatio: number
  yRatio: number
}

type PdfRecoveryDiagnosticState = {
  dialogAccepted: boolean | null
  recoveredLegacyPdfTextNotesCount: number
  recoveredNotesCount: number
  recoveredPdfTextNotesCount: number
  status: string
}

type PdfRefreshDiagnosticState = {
  applied: boolean
  blockedReason: string
  requested: boolean
}

type PdfTextHighlightDiagnosticState = {
  lastRefreshApplied: boolean
  lastSaveApplied: boolean
}

type RecentOpenDiagnosticState = {
  active: boolean
  failedAt: string
  fileExists: 'yes' | 'no' | 'unknown'
  normalizedPath: string
  openCommitted: boolean
  pdfBytesLoaded: boolean
  pdfDocumentCreated: boolean
  pdfNumPagesResolved: boolean
  rawPath: string
  recoveredNotesLoaded: boolean
  recoveryDialogTriggered: boolean
  resolvedPageCount: number | null
  source: '' | 'open' | 'recent'
  status: string
}

type PdfSelectionDiagnosticState = {
  currentTokenFound: boolean
  moveActive: boolean
  resetReason: string
  spanBuilt: boolean
  startRequested: boolean
  startTokenFound: boolean
}

type PdfStickyDiagnosticState = {
  gapToTopBar: number | null
  pagePaddingTop: string
  scrollContainer: string
  stickyHost: string
  stickyTop: string
  stickyViewportTop: number | null
  topBarBottom: number | null
  viewerPaddingTop: string
  workspaceScrollTop: number
}

const initialPdfRecoveryDiagnosticState: PdfRecoveryDiagnosticState = {
  dialogAccepted: null,
  recoveredLegacyPdfTextNotesCount: 0,
  recoveredNotesCount: 0,
  recoveredPdfTextNotesCount: 0,
  status: '',
}

const initialPdfRefreshDiagnosticState: PdfRefreshDiagnosticState = {
  applied: false,
  blockedReason: '',
  requested: false,
}

const initialPdfTextHighlightDiagnosticState: PdfTextHighlightDiagnosticState = {
  lastRefreshApplied: false,
  lastSaveApplied: false,
}

const initialPdfSelectionDiagnosticState: PdfSelectionDiagnosticState = {
  currentTokenFound: false,
  moveActive: false,
  resetReason: '',
  spanBuilt: false,
  startRequested: false,
  startTokenFound: false,
}

type DesktopVisibleSaveStatus = {
  message: 'Saving...' | 'Saved'
}

type InvalidSidecarRecoveryState = {
  invalidNotesFilePath: string
  mode: 'memory-only' | 'replace-confirm'
}

type PdfTextToken = {
  angleDegrees: number
  centerX: number
  centerY: number
  endOffset: number
  height: number
  index: number
  itemIndex: number
  pageNumber: number
  startOffset: number
  text: string
  width: number
  x: number
  y: number
}

type PdfTextItemGeometry = {
  angleDegrees: number
  height: number
  index: number
  pageNumber: number
  text: string
  viewportHeight: number
  viewportWidth: number
  width: number
  x: number
  y: number
}

type PdfTokenLineCluster = {
  averageHeight: number
  bottom: number
  centerY: number
  lineId: string
  top: number
  tokens: PdfTextToken[]
}

type PdfTokenLineClusterLayoutMetrics = {
  lineSpanRatio: number
  maxGap: number
  zoneCount: number
}

type PdfTokenLineZone = {
  left: number
  right: number
  tokenCount: number
}

type PdfPageTextAnalysisState = {
  hasRenderableTextItems: boolean
  isPdfTextPageLayoutGuarded: boolean
  isPdfTextSingleLineOnlyLayout: boolean
  pdfParallelTextLineIds: Set<string>
  pdfSuspiciousTextLineIds: Set<string>
  tokenLines: PdfTokenLineCluster[]
}

type PdfPageTextAnalysisCacheEntry = PdfPageTextAnalysisState & {
  cacheKey: string
  pageNumber: number
  textLayerStatus: PdfTextLayerStatus
  tokens: PdfTextToken[]
}

type PendingPdfTextSelection = {
  anchor: NoteAnchor
  tokenKeys: string[]
}

type PendingNoteOpenScroll = {
  noteId: number
  source: string
}

const nearbyAnchorRecoveryDistance = 500
const anchorContextWindow = 36
const recentDocumentsStorageKey = 'noteanchor.recent-documents.v1'
const recentDocumentsLimit = 10
const experimentalPdfTextSelectionLineLimit = 5
const experimentalPdfTextLayoutGuardMessage =
  'Text notes are unavailable on this page layout. Use Point mode or Add note for page notes.'
const previewOnlyPdfNotesMessage =
  'Preview-only fallback: NoteAnchor could not render this PDF page directly, so it is shown in the embedded PDF viewer. Only page or document notes are available here. Text notes and point notes are unavailable. Use Add note for a page or document note.'
const singleLineOnlyPdfTextMessage =
  'Text notes on this page are limited to one line. Use Point mode or Add note for longer notes.'
const invalidSidecarProtectedStatusMessage =
  'Invalid notes file - new notes are in memory only. The existing notes file will not be overwritten automatically.'
let hasConfiguredPdfJsWorker = false

const normalizeAnchorSearchText = (value: string) =>
  value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

const pdfMojibakeDirectReplacements: Array<[string | RegExp, string]> = [
  ['â€™', '\u2019'],
  ['â€˜', '\u2018'],
  ['â€œ', '\u201c'],
  ['â€\u009d', '\u201d'],
  ['â€\x9d', '\u201d'],
  ['â€"', '\u201d'],
  ['â€¦', '\u2026'],
  ['â€”', '\u2014'],
  ['â€“', '\u2013'],
  ['Â\xa0', ' '],
  [/Â(?=\s|$|[.,;:!?)}\]])/g, ''],
]

const pdfMojibakeMarkerPattern =
  /â€™|â€˜|â€œ|â€\u009d|â€"|â€¦|â€”|â€“|Â|Ã|Ð|Ñ|Ë|Ä|Å|Ê|Î|Ï|Ò|Ó|Ô|Õ|Ö|Ø|Ù|Ú|Û|Ü|Ý|Þ|ß|ê|ì|í|î|ï/u

const countPdfMojibakeMarkers = (value: string) => {
  const matches = value.match(new RegExp(pdfMojibakeMarkerPattern, 'gu'))
  return matches?.length ?? 0
}

const applyPdfMojibakeDirectReplacements = (value: string) =>
  pdfMojibakeDirectReplacements.reduce(
    (currentValue, [pattern, replacement]) => currentValue.replace(pattern, replacement),
    value,
  )

const tryDecodePdfUtf8Mojibake = (value: string) => {
  if (
    typeof TextDecoder === 'undefined' ||
    !pdfMojibakeMarkerPattern.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) > 0xff)
  ) {
    return value
  }

  try {
    const bytes = Uint8Array.from(Array.from(value, (character) => character.charCodeAt(0)))
    const decodedValue = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

    if (!decodedValue || decodedValue.includes('\ufffd')) {
      return value
    }

    return countPdfMojibakeMarkers(decodedValue) + 1 < countPdfMojibakeMarkers(value)
      ? decodedValue
      : value
  } catch {
    return value
  }
}

const normalizeExperimentalPdfSelectedText = (value: string) => {
  const decodedValue = tryDecodePdfUtf8Mojibake(value)

  return applyPdfMojibakeDirectReplacements(decodedValue)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const isRenderablePdfTextItem = (
  item: TextItem | TextMarkedContent,
): item is TextItem => 'str' in item && typeof item.str === 'string' && item.str.trim().length > 0

const getPdfTextTokenKey = (token: Pick<PdfTextToken, 'pageNumber' | 'itemIndex' | 'startOffset' | 'endOffset'>) =>
  `${token.pageNumber}-${token.itemIndex}-${token.startOffset}-${token.endOffset}`

const getPdfTextSelectionKey = (pageNumber: number, tokenKeys: string[]) =>
  `pdf-text::${pageNumber}::${tokenKeys.join('|')}`

const collectPdfTokenSpans = (value: string) => {
  const spans: Array<{ startOffset: number; endOffset: number; text: string }> = []
  const matcher = /\S+/g
  let match: RegExpExecArray | null

  while ((match = matcher.exec(value)) !== null) {
    spans.push({
      endOffset: match.index + match[0].length,
      startOffset: match.index,
      text: match[0],
    })
  }

  return spans
}

let pdfTokenMeasureContext: CanvasRenderingContext2D | null = null

const getPdfTokenMeasureContext = () => {
  if (typeof document === 'undefined') {
    return null
  }

  if (pdfTokenMeasureContext) {
    return pdfTokenMeasureContext
  }

  const canvas = document.createElement('canvas')
  pdfTokenMeasureContext = canvas.getContext('2d')
  return pdfTokenMeasureContext
}

const getApproximatePdfMeasureFont = (height: number) => {
  const fontSize = Math.max(10, Math.round(height * 0.92))
  return `${fontSize}px "Times New Roman", Georgia, serif`
}

const measurePdfTokenHorizontalBounds = (
  fullText: string,
  startOffset: number,
  endOffset: number,
  renderedWidth: number,
  renderedHeight: number,
) => {
  const textLength = fullText.length

  if (!textLength || renderedWidth <= 0) {
    return null
  }

  const context = getPdfTokenMeasureContext()

  if (!context) {
    return null
  }

  try {
    context.font = getApproximatePdfMeasureFont(renderedHeight)

    const fullWidth = context.measureText(fullText).width

    if (!Number.isFinite(fullWidth) || fullWidth <= 0) {
      return null
    }

    const startWidth = context.measureText(fullText.slice(0, startOffset)).width
    const endWidth = context.measureText(fullText.slice(0, endOffset)).width
    const widthScale = renderedWidth / fullWidth
    const rawLeft = startWidth * widthScale
    const rawRight = endWidth * widthScale
    const rightPadding = Math.min(2, Math.max(0.75, renderedHeight * 0.05))
    const left = Math.max(0, rawLeft)
    const right = Math.min(renderedWidth, rawRight + rightPadding)

    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
      return null
    }

    return { left, right }
  } catch {
    return null
  }
}

const computePdfTextItemGeometry = (
  item: TextItem,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  index: number,
  pageNumber: number,
): PdfTextItemGeometry | null => {
  const transform = Util.transform(viewport.transform, item.transform)
  let angle = Math.atan2(transform[1], transform[0])

  if (!Number.isFinite(angle)) {
    angle = 0
  }

  const width = Math.abs(item.width * viewport.scale)
  const height = Math.hypot(transform[2], transform[3])

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const isEffectivelyHorizontal =
    Math.abs(angle) < 0.001 || Math.abs(Math.abs(angle) - Math.PI) < 0.001

  const x = isEffectivelyHorizontal ? transform[4] : transform[4] + height * Math.sin(angle)
  const y = isEffectivelyHorizontal ? transform[5] - height : transform[5] - height * Math.cos(angle)

  return {
    angleDegrees: (angle * 180) / Math.PI,
    height,
    index,
    pageNumber,
    text: item.str,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
    width,
    x,
    y,
  }
}

const computePdfTextTokens = (item: PdfTextItemGeometry, indexBase: number): PdfTextToken[] => {
  const textLength = item.text.length

  if (!textLength || item.width <= 0) {
    return []
  }

  const tokenSpans = collectPdfTokenSpans(item.text)

  return tokenSpans
    .map((tokenSpan) => {
      const measuredBounds = measurePdfTokenHorizontalBounds(
        item.text,
        tokenSpan.startOffset,
        tokenSpan.endOffset,
        item.width,
        item.height,
      )
      const startRatio = tokenSpan.startOffset / textLength
      const endRatio = tokenSpan.endOffset / textLength
      const fallbackLeft = item.width * startRatio
      const fallbackRight = item.width * endRatio
      const tokenLeft = measuredBounds?.left ?? fallbackLeft
      const tokenRight = measuredBounds?.right ?? fallbackRight
      const x = item.x + tokenLeft
      const width = Math.max(tokenRight - tokenLeft, 0)

      if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
        return null
      }

      return {
        angleDegrees: item.angleDegrees,
        centerX: x + width / 2,
        centerY: item.y + item.height / 2,
        endOffset: tokenSpan.endOffset,
        height: item.height,
        index: indexBase,
        itemIndex: item.index,
        pageNumber: item.pageNumber,
        startOffset: tokenSpan.startOffset,
        text: tokenSpan.text,
        width,
        x,
        y: item.y,
      }
    })
    .filter((token): token is PdfTextToken => token !== null)
    .map((token, tokenIndex) => ({
      ...token,
      index: indexBase + tokenIndex,
    }))
}

const buildPdfTokenLineClusters = (tokens: PdfTextToken[]): PdfTokenLineCluster[] => {
  if (!tokens.length) {
    return []
  }

  const sortedTokens = [...tokens].sort((left, right) => {
    if (left.centerY === right.centerY) {
      if (left.x === right.x) {
        return left.itemIndex - right.itemIndex
      }

      return left.x - right.x
    }

    return left.centerY - right.centerY
  })

  const lineTolerance = Math.max(
    3,
    sortedTokens.reduce((max, token) => Math.max(max, token.height * 0.28), 0),
  )
  const clusters: Array<{
    averageHeight: number
    bottom: number
    centerY: number
    top: number
    tokens: PdfTextToken[]
  }> = []

  const getVerticalGap = (
    clusterTop: number,
    clusterBottom: number,
    tokenTop: number,
    tokenBottom: number,
  ) => {
    if (tokenBottom < clusterTop) {
      return clusterTop - tokenBottom
    }

    if (tokenTop > clusterBottom) {
      return tokenTop - clusterBottom
    }

    return 0
  }

  for (const token of sortedTokens) {
    const tokenTop = token.y
    const tokenBottom = token.y + token.height
    const cluster = clusters
      .filter((entry) => {
        const verticalGap = getVerticalGap(entry.top, entry.bottom, tokenTop, tokenBottom)
        const centerDistance = Math.abs(entry.centerY - token.centerY)
        const allowedCenterDistance = Math.max(entry.averageHeight, token.height) * 0.55

        return verticalGap <= lineTolerance && centerDistance <= allowedCenterDistance
      })
      .sort((left, right) => Math.abs(left.centerY - token.centerY) - Math.abs(right.centerY - token.centerY))[0]

    if (cluster) {
      cluster.tokens.push(token)
      cluster.centerY =
        cluster.tokens.reduce((sum, currentToken) => sum + currentToken.centerY, 0) /
        cluster.tokens.length
      cluster.top = Math.min(cluster.top, tokenTop)
      cluster.bottom = Math.max(cluster.bottom, tokenBottom)
      cluster.averageHeight =
        cluster.tokens.reduce((sum, currentToken) => sum + currentToken.height, 0) /
        cluster.tokens.length
    } else {
      clusters.push({
        averageHeight: token.height,
        bottom: tokenBottom,
        centerY: token.centerY,
        top: tokenTop,
        tokens: [token],
      })
    }
  }

  return clusters.map((cluster) => ({
    averageHeight: cluster.averageHeight,
    bottom: cluster.bottom,
    centerY: cluster.centerY,
    lineId: `${cluster.tokens[0]?.pageNumber ?? 1}:${Math.round(cluster.top)}:${Math.round(cluster.centerY)}`,
    top: cluster.top,
    tokens: [...cluster.tokens].sort((left, right) => {
      if (left.x === right.x) {
        return left.itemIndex - right.itemIndex
      }

      return left.x - right.x
    }),
  }))
}

const getPdfTokenLineClusterLayoutMetrics = (
  line: PdfTokenLineCluster,
  pageWidth: number,
): PdfTokenLineClusterLayoutMetrics => {
  if (!line.tokens.length || pageWidth <= 0) {
    return {
      lineSpanRatio: 0,
      maxGap: 0,
      zoneCount: 0,
    }
  }

  const tokens = [...line.tokens].sort((left, right) => left.x - right.x)
  const firstToken = tokens[0]
  const lastToken = tokens[tokens.length - 1]
  const lineLeft = firstToken.x
  const lineRight = lastToken.x + lastToken.width
  const lineSpanRatio = Math.max(0, Math.min(1, (lineRight - lineLeft) / pageWidth))
  const averageTokenHeight =
    tokens.reduce((sum, token) => sum + token.height, 0) / tokens.length
  const zoneBreakThreshold = Math.max(72, averageTokenHeight * 4)
  let maxGap = 0
  let zoneCount = 1

  for (let index = 1; index < tokens.length; index += 1) {
    const previousToken = tokens[index - 1]
    const currentToken = tokens[index]
    const gap = Math.max(0, currentToken.x - (previousToken.x + previousToken.width))

    if (gap > maxGap) {
      maxGap = gap
    }

    if (gap >= zoneBreakThreshold) {
      zoneCount += 1
    }
  }

  return {
    lineSpanRatio,
    maxGap,
    zoneCount,
  }
}

const getPdfTokenLineZones = (line: PdfTokenLineCluster): PdfTokenLineZone[] => {
  if (!line.tokens.length) {
    return []
  }

  const tokens = [...line.tokens].sort((left, right) => left.x - right.x)
  const averageTokenHeight =
    tokens.reduce((sum, token) => sum + token.height, 0) / tokens.length
  const zoneBreakThreshold = Math.max(34, averageTokenHeight * 1.9)
  const zones: PdfTokenLineZone[] = []
  let currentZone: PdfTokenLineZone | null = null

  for (const token of tokens) {
    const tokenLeft = token.x
    const tokenRight = token.x + token.width

    if (!currentZone) {
      currentZone = {
        left: tokenLeft,
        right: tokenRight,
        tokenCount: 1,
      }
      continue
    }

    const gap = Math.max(0, tokenLeft - currentZone.right)

    if (gap >= zoneBreakThreshold) {
      zones.push(currentZone)
      currentZone = {
        left: tokenLeft,
        right: tokenRight,
        tokenCount: 1,
      }
      continue
    }

    currentZone.right = Math.max(currentZone.right, tokenRight)
    currentZone.tokenCount += 1
  }

  if (currentZone) {
    zones.push(currentZone)
  }

  return zones
}

const isPdfTokenLineClusterSuspicious = (
  line: PdfTokenLineCluster,
  pageWidth: number,
) => {
  return getPdfTokenLineClusterSuspicionReasons(line, pageWidth).length > 0
}

const getPdfTokenLineClusterSuspicionReasons = (
  line: PdfTokenLineCluster,
  pageWidth: number,
) => {
  const metrics = getPdfTokenLineClusterLayoutMetrics(line, pageWidth)
  const reasons: string[] = []

  if (metrics.maxGap >= 96) {
    reasons.push(`maxGap=${Math.round(metrics.maxGap)}`)
  }

  if (metrics.zoneCount >= 3) {
    reasons.push(`zoneCount=${metrics.zoneCount}`)
  }

  if (metrics.zoneCount >= 2 && metrics.maxGap >= 72 && metrics.lineSpanRatio >= 0.62) {
    reasons.push(
      `multiZone span=${metrics.lineSpanRatio.toFixed(2)} gap=${Math.round(metrics.maxGap)}`,
    )
  }

  return reasons
}

const findNearestPdfTokenLine = (lines: PdfTokenLineCluster[], y: number) => {
  if (!lines.length) {
    return null
  }

  const containingLines = lines.filter((line) => {
    const verticalMargin = Math.max(2, line.averageHeight * 0.18)
    return y >= line.top - verticalMargin && y <= line.bottom + verticalMargin
  })

  const candidates = containingLines.length ? containingLines : lines

  const getDistanceToBand = (line: PdfTokenLineCluster) => {
    if (y < line.top) {
      return line.top - y
    }

    if (y > line.bottom) {
      return y - line.bottom
    }

    return 0
  }

  return candidates.reduce((best, line) => {
    const bestBandDistance = getDistanceToBand(best)
    const lineBandDistance = getDistanceToBand(line)

    if (lineBandDistance !== bestBandDistance) {
      return lineBandDistance < bestBandDistance ? line : best
    }

    return Math.abs(line.centerY - y) < Math.abs(best.centerY - y) ? line : best
  })
}

const isPointInsidePdfToken = (
  token: Pick<PdfTextToken, 'height' | 'width' | 'x' | 'y'>,
  point: { x: number; y: number },
) => {
  const horizontalPadding = Math.min(1.5, Math.max(0.25, token.width * 0.04))
  const verticalPadding = Math.min(1.5, Math.max(0.25, token.height * 0.06))

  return (
    point.x >= token.x - horizontalPadding &&
    point.x <= token.x + token.width + horizontalPadding &&
    point.y >= token.y - verticalPadding &&
    point.y <= token.y + token.height + verticalPadding
  )
}

const findIntersectingPdfTokenInLine = (
  line: PdfTokenLineCluster,
  point: { x: number; y: number },
) => line.tokens.find((token) => isPointInsidePdfToken(token, point)) ?? null

const isRenderedPdfCanvasEffectivelyBlank = (
  canvas: HTMLCanvasElement,
  sampleStep = 24,
) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context || canvas.width <= 0 || canvas.height <= 0) {
    return false
  }

  const { width, height } = canvas
  const imageData = context.getImageData(0, 0, width, height).data
  let visibleSampleCount = 0
  let nonWhiteSampleCount = 0

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const index = (y * width + x) * 4
      const red = imageData[index]
      const green = imageData[index + 1]
      const blue = imageData[index + 2]
      const alpha = imageData[index + 3]

      if (alpha > 8) {
        visibleSampleCount += 1

        if (red < 247 || green < 247 || blue < 247) {
          nonWhiteSampleCount += 1
        }
      }
    }
  }

  return visibleSampleCount === 0 || nonWhiteSampleCount === 0
}

const filterNotesByQuery = (
  notes: Note[],
  queryText: string,
  wholeWord: boolean,
) => {
  const query = queryText.trim().toLowerCase()

  if (!query) {
    return notes
  }

  return notes.filter((note) => {
    const searchableValues = [
      note.selectedText,
      note.previousSelectedText ?? '',
      note.comment,
    ]

    return searchableValues.some((value) =>
      findMatchesInParagraph(value, query, wholeWord).length > 0,
    )
  })
}

const findSearchMatchIndex = (value: string, queryText: string, wholeWord: boolean) => {
  const query = queryText.trim().toLowerCase()

  if (!query) {
    return -1
  }

  const firstMatch = findMatchesInParagraph(value, query, wholeWord)[0]
  return firstMatch?.startOffset ?? -1
}

const buildSearchSnippet = (
  value: string,
  queryText: string,
  wholeWord: boolean,
  surroundingCharacters = 34,
) => {
  const matchIndex = findSearchMatchIndex(value, queryText, wholeWord)
  const queryLength = queryText.trim().length

  if (matchIndex < 0 || queryLength === 0) {
    return value
  }

  const snippetStart = Math.max(0, matchIndex - surroundingCharacters)
  const snippetEnd = Math.min(
    value.length,
    matchIndex + queryLength + surroundingCharacters,
  )
  const prefix = snippetStart > 0 ? '...' : ''
  const suffix = snippetEnd < value.length ? '...' : ''

  return `${prefix}${value.slice(snippetStart, snippetEnd)}${suffix}`
}

const ensureUniqueNoteIds = (notes: Note[]) => {
  const seenIds = new Set<number>()
  let nextId =
    notes.reduce((highestId, note) => Math.max(highestId, note.id), 0) + 1

  return notes.map((note) => {
    if (!seenIds.has(note.id)) {
      seenIds.add(note.id)
      return note
    }

    while (seenIds.has(nextId)) {
      nextId += 1
    }

    const uniqueId = nextId
    nextId += 1
    seenIds.add(uniqueId)

    return {
      ...note,
      id: uniqueId,
    }
  })
}

const getNextNoteId = (notes: Note[]) =>
  notes.reduce((highestId, note) => Math.max(highestId, note.id), 0) + 1

const workspaceTopSafeMargin = 40
const workspaceBottomSafeMargin = 120

const isWordCharacter = (value: string) => /[\p{L}\p{N}]/u.test(value)

const isWholeWordMatch = (
  paragraph: string,
  startOffset: number,
  endOffset: number,
) => {
  const previousCharacter =
    startOffset > 0 ? paragraph[startOffset - 1] : ''
  const nextCharacter =
    endOffset < paragraph.length ? paragraph[endOffset] : ''

  return (
    (!previousCharacter || !isWordCharacter(previousCharacter)) &&
    (!nextCharacter || !isWordCharacter(nextCharacter))
  )
}

const findMatchesInParagraph = (
  paragraph: string,
  query: string,
  wholeWord: boolean,
) => {
  const normalizedParagraph = paragraph.toLowerCase()
  const matches: Array<{ endOffset: number; startOffset: number }> = []
  let searchIndex = normalizedParagraph.indexOf(query)

  while (searchIndex !== -1) {
    const endOffset = searchIndex + query.length

    if (!wholeWord || isWholeWordMatch(paragraph, searchIndex, endOffset)) {
      matches.push({
        endOffset,
        startOffset: searchIndex,
      })
    }

    searchIndex = normalizedParagraph.indexOf(query, searchIndex + 1)
  }

  return matches
}

const isElementVisibleInWorkspace = (
  workspaceElement: HTMLElement | null,
  element: HTMLElement | null,
  topPadding = workspaceTopSafeMargin,
  bottomPadding = workspaceBottomSafeMargin,
) => {
  if (!workspaceElement || !element) {
    return false
  }

  const workspaceRect = workspaceElement.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  return (
    elementRect.top >= workspaceRect.top + topPadding &&
    elementRect.bottom <= workspaceRect.bottom - bottomPadding
  )
}

const buildNormalizedAnchorMap = (value: string) => {
  let normalizedText = ''
  const normalizedToOriginalIndex: number[] = []
  let previousWasWhitespace = false

  Array.from(value).forEach((character, index) => {
    const normalizedCharacter =
      character === '\u2018' || character === '\u2019'
        ? "'"
        : character === '\u201c' || character === '\u201d'
          ? '"'
          : character === '\u2013' || character === '\u2014'
            ? '-'
            : character

    if (/\s/.test(normalizedCharacter)) {
      if (!previousWasWhitespace) {
        normalizedText += ' '
        normalizedToOriginalIndex.push(index)
      }
      previousWasWhitespace = true
      return
    }

    previousWasWhitespace = false
    normalizedText += normalizedCharacter
    normalizedToOriginalIndex.push(index)
  })

  return {
    normalizedText,
    normalizedToOriginalIndex,
  }
}

const collectAnchorMatches = (paragraph: string, selectedText: string) => {
  const matches: Array<{ endOffset: number; startOffset: number }> = []
  let searchIndex = paragraph.indexOf(selectedText)

  while (searchIndex !== -1) {
    matches.push({
      endOffset: searchIndex + selectedText.length,
      startOffset: searchIndex,
    })
    searchIndex = paragraph.indexOf(selectedText, searchIndex + 1)
  }

  return matches
}

const getAnchorContextScore = (
  paragraph: string,
  note: Note,
  startOffset: number,
  endOffset: number,
) => {
  const savedPrefix = normalizeAnchorSearchText(
    note.context.slice(
      Math.max(0, note.startOffset - anchorContextWindow),
      note.startOffset,
    ),
  )
  const savedSuffix = normalizeAnchorSearchText(
    note.context.slice(
      note.endOffset,
      Math.min(note.context.length, note.endOffset + anchorContextWindow),
    ),
  )
  const currentPrefix = normalizeAnchorSearchText(
    paragraph.slice(
      Math.max(0, startOffset - anchorContextWindow),
      startOffset,
    ),
  )
  const currentSuffix = normalizeAnchorSearchText(
    paragraph.slice(
      endOffset,
      Math.min(paragraph.length, endOffset + anchorContextWindow),
    ),
  )

  let score = 0

  if (savedPrefix && currentPrefix) {
    score += currentPrefix.endsWith(savedPrefix)
      ? 2
      : currentPrefix.includes(savedPrefix)
        ? 1
        : 0
  }

  if (savedSuffix && currentSuffix) {
    score += currentSuffix.startsWith(savedSuffix)
      ? 2
      : currentSuffix.includes(savedSuffix)
        ? 1
        : 0
  }

  return score
}

const pickBestAnchorMatch = (
  matches: Array<{ endOffset: number; startOffset: number }>,
  note: Note,
  paragraph: string,
) => {
  const nearbyMatches = matches.filter(
    (match) =>
      Math.abs(match.startOffset - note.startOffset) <=
      nearbyAnchorRecoveryDistance,
  )

  if (!nearbyMatches.length) {
    return null
  }

  return [...nearbyMatches].sort((first, second) => {
    const firstDistance = Math.abs(first.startOffset - note.startOffset)
    const secondDistance = Math.abs(second.startOffset - note.startOffset)

    if (firstDistance !== secondDistance) {
      return firstDistance - secondDistance
    }

    const firstScore = getAnchorContextScore(
      paragraph,
      note,
      first.startOffset,
      first.endOffset,
    )
    const secondScore = getAnchorContextScore(
      paragraph,
      note,
      second.startOffset,
      second.endOffset,
    )

    if (firstScore !== secondScore) {
      return secondScore - firstScore
    }

    return first.startOffset - second.startOffset
  })[0]
}

const emptyDocumentMetadata: DocumentMetadata = {
  documentId: 'empty-document',
  documentKind: 'empty',
  fileName: 'No document open',
  source: 'empty',
  storageKey: 'noteanchor.empty-document.notes.v1',
}

const isStructuredNote = (value: unknown): value is Note => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.id !== 'number' ||
    typeof candidate.paragraphIndex !== 'number' ||
    typeof candidate.startOffset !== 'number' ||
    typeof candidate.endOffset !== 'number' ||
    typeof candidate.selectedText !== 'string' ||
    typeof candidate.context !== 'string' ||
    typeof candidate.comment !== 'string'
  ) {
    return false
  }

  if (
    'previousSelectedText' in candidate &&
    candidate.previousSelectedText !== undefined &&
    typeof candidate.previousSelectedText !== 'string'
  ) {
    return false
  }

  if (
    'documentType' in candidate &&
    candidate.documentType !== undefined &&
    candidate.documentType !== 'pdf'
  ) {
    return false
  }

  if (
    'anchorType' in candidate &&
    candidate.anchorType !== undefined &&
    !['page', 'point', 'area', 'text'].includes(String(candidate.anchorType))
  ) {
    return false
  }

  if (
    'noteKind' in candidate &&
    candidate.noteKind !== undefined &&
    candidate.noteKind !== 'pdf-page'
  ) {
    return false
  }

  if (
    'pdfPageNumber' in candidate &&
    candidate.pdfPageNumber !== undefined &&
    (!Number.isInteger(candidate.pdfPageNumber) ||
      Number(candidate.pdfPageNumber) < 1)
  ) {
    return false
  }

  const numericPdfFields = [
    'xRatio',
    'yRatio',
    'widthRatio',
    'heightRatio',
    'x',
    'y',
    'width',
    'height',
    'pageWidth',
    'pageHeight',
    'pdfTextAnchorItemIndex',
    'pdfTextAnchorLeftRatio',
    'pdfTextAnchorTopRatio',
    'pdfTextAnchorTokenIndex',
  ] as const

  for (const fieldName of numericPdfFields) {
    if (
      fieldName in candidate &&
      candidate[fieldName] !== undefined &&
      typeof candidate[fieldName] !== 'number'
    ) {
      return false
    }
  }

  if (
    'pdfHighlightRects' in candidate &&
    candidate.pdfHighlightRects !== undefined
  ) {
    if (!Array.isArray(candidate.pdfHighlightRects)) {
      return false
    }

    const hasInvalidRect = candidate.pdfHighlightRects.some((rect) => {
      if (!rect || typeof rect !== 'object') {
        return true
      }

      const rectCandidate = rect as Record<string, unknown>
      return (
        typeof rectCandidate.xRatio !== 'number' ||
        typeof rectCandidate.yRatio !== 'number' ||
        typeof rectCandidate.widthRatio !== 'number' ||
        typeof rectCandidate.heightRatio !== 'number'
      )
    })

    if (hasInvalidRect) {
      return false
    }
  }

  if (
    'pdfSelectionKey' in candidate &&
    candidate.pdfSelectionKey !== undefined &&
    typeof candidate.pdfSelectionKey !== 'string'
  ) {
    return false
  }

  return (
    Number.isInteger(candidate.paragraphIndex) &&
    Number.isInteger(candidate.startOffset) &&
    Number.isInteger(candidate.endOffset) &&
    candidate.paragraphIndex >= 0 &&
    candidate.startOffset >= 0 &&
    candidate.endOffset > candidate.startOffset
  )
}

const doesNoteMatchCurrentParagraph = (
  note: Note,
  paragraphs: string[],
) => {
  if (getPdfAnchorType(note) || isPdfDocumentLevelNote(note)) {
    return true
  }

  const paragraph = paragraphs[note.paragraphIndex]

  if (typeof paragraph !== 'string') {
    return false
  }

  return paragraph.slice(note.startOffset, note.endOffset) === note.selectedText
}

const resolveNoteAnchor = (
  note: Note,
  paragraphs: string[],
): ResolvedNoteAnchor => {
  if (isPdfDocumentLevelNote(note)) {
    return {
      endOffset: note.endOffset,
      paragraphIndex: note.paragraphIndex,
      startOffset: note.startOffset,
      status: 'exact',
    }
  }

  if (getPdfAnchorType(note)) {
    const pdfPageIndex = Math.max(0, (note.pdfPageNumber ?? 1) - 1)

    return {
      endOffset: note.endOffset,
      paragraphIndex: pdfPageIndex,
      startOffset: note.startOffset,
      status: 'exact',
    }
  }

  const paragraph = paragraphs[note.paragraphIndex]

  if (typeof paragraph !== 'string') {
    return {
      endOffset: note.endOffset,
      paragraphIndex: note.paragraphIndex,
      startOffset: note.startOffset,
      status: 'review',
    }
  }

  if (
    note.startOffset >= 0 &&
    note.endOffset <= paragraph.length &&
    paragraph.slice(note.startOffset, note.endOffset) === note.selectedText
  ) {
    return {
      endOffset: note.endOffset,
      paragraphIndex: note.paragraphIndex,
      startOffset: note.startOffset,
      status: 'exact',
    }
  }

  const exactMatch = pickBestAnchorMatch(
    collectAnchorMatches(paragraph, note.selectedText),
    note,
    paragraph,
  )

  if (exactMatch) {
    return {
      endOffset: exactMatch.endOffset,
      paragraphIndex: note.paragraphIndex,
      startOffset: exactMatch.startOffset,
      status: 'recovered',
    }
  }

  const normalizedSelectedText = normalizeAnchorSearchText(note.selectedText)

  if (!normalizedSelectedText) {
    return {
      endOffset: note.endOffset,
      paragraphIndex: note.paragraphIndex,
      startOffset: note.startOffset,
      status: 'review',
    }
  }

  const {
    normalizedText: normalizedParagraph,
    normalizedToOriginalIndex,
  } = buildNormalizedAnchorMap(paragraph)
  const normalizedMatches: Array<{ endOffset: number; startOffset: number }> = []
  let normalizedSearchIndex = normalizedParagraph.indexOf(normalizedSelectedText)

  while (normalizedSearchIndex !== -1) {
    const normalizedEndIndex =
      normalizedSearchIndex + normalizedSelectedText.length - 1
    const originalStart = normalizedToOriginalIndex[normalizedSearchIndex]
    const originalEnd =
      (normalizedToOriginalIndex[normalizedEndIndex] ?? originalStart) + 1

    if (
      typeof originalStart === 'number' &&
      typeof originalEnd === 'number' &&
      originalEnd > originalStart
    ) {
      normalizedMatches.push({
        endOffset: originalEnd,
        startOffset: originalStart,
      })
    }

    normalizedSearchIndex = normalizedParagraph.indexOf(
      normalizedSelectedText,
      normalizedSearchIndex + 1,
    )
  }

  const normalizedMatch = pickBestAnchorMatch(
    normalizedMatches,
    note,
    paragraph,
  )

  if (!normalizedMatch) {
    return {
      endOffset: note.endOffset,
      paragraphIndex: note.paragraphIndex,
      startOffset: note.startOffset,
      status: 'review',
    }
  }

  return {
    endOffset: normalizedMatch.endOffset,
    paragraphIndex: note.paragraphIndex,
    startOffset: normalizedMatch.startOffset,
    status: 'recovered',
  }
}

const loadSavedNotes = (
  storageKey: string,
  documentId: string,
) => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const savedValue = window.localStorage.getItem(storageKey)

    if (!savedValue) {
      return []
    }

    const parsed = JSON.parse(savedValue) as unknown
    const savedNotes =
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).documentId === documentId
        ? (parsed as Record<string, unknown>).notes
        : null

    if (!Array.isArray(savedNotes)) {
      window.localStorage.removeItem(storageKey)
      return []
    }

    return savedNotes.filter((note): note is Note => isStructuredNote(note))
  } catch {
    window.localStorage.removeItem(storageKey)
    return []
  }
}

const createPdfReadingPositionStorageKey = (storageKey: string) =>
  `${storageKey}${pdfReadingPositionStorageSuffix}`

const isPdfReadingPositionState = (
  value: unknown,
): value is PdfReadingPositionState => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  const { documentPath, pageNumber, pageScrollRatio, savedAt } = candidate

  return (
    (typeof documentPath === 'string' || typeof documentPath === 'undefined') &&
    Number.isInteger(pageNumber) &&
    typeof pageNumber === 'number' &&
    pageNumber >= 1 &&
    typeof pageScrollRatio === 'number' &&
    Number.isFinite(pageScrollRatio) &&
    pageScrollRatio >= 0 &&
    pageScrollRatio <= 1 &&
    (typeof savedAt === 'string' || typeof savedAt === 'undefined')
  )
}

const loadPdfReadingPosition = (
  storageKey: string,
): PdfReadingPositionState | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const readingPositionStorageKey =
    createPdfReadingPositionStorageKey(storageKey)

  try {
    const savedValue = window.localStorage.getItem(readingPositionStorageKey)

    if (!savedValue) {
      return null
    }

    const parsed = JSON.parse(savedValue) as unknown

    if (!isPdfReadingPositionState(parsed)) {
      window.localStorage.removeItem(readingPositionStorageKey)
      return null
    }

    return parsed
  } catch {
    window.localStorage.removeItem(readingPositionStorageKey)
    return null
  }
}

const savePdfReadingPosition = (
  storageKey: string,
  state: PdfReadingPositionState,
) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    createPdfReadingPositionStorageKey(storageKey),
    JSON.stringify(state),
  )
}

const splitTextIntoParagraphs = (text: string) => {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  if (!normalizedText) {
    return []
  }

  const paragraphChunks = normalizedText.includes('\n\n')
    ? normalizedText.split(/\n\s*\n/)
    : normalizedText.split('\n')

  return paragraphChunks
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}

const createDocumentIdFromFileName = (fileName: string) =>
  fileName
    .replace(/\.(txt|docx|pdf)$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled-text-file'

const createFileDocumentMetadata = (file: File): DocumentMetadata => {
  const safeId = [
    createDocumentIdFromFileName(file.name),
    file.size,
    file.lastModified,
  ].join('-')
  const documentKind: DocumentKind = isPdfDocumentPath(file.name)
    ? 'pdf'
    : isDocxDocumentPath(file.name)
      ? 'docx'
      : 'txt'

  return {
    documentId: `file-${safeId}`,
    documentKind,
    fileName: file.name,
    source: 'browser-file',
    fileSize: file.size,
    fileLastModified: file.lastModified,
    storageKey: `noteanchor.file.${safeId}.notes.v1`,
  }
}

const hasValidPdfPageNumber = (note: Pick<Note, 'pdfPageNumber'>) =>
  Number.isInteger(note.pdfPageNumber) && (note.pdfPageNumber ?? 0) >= 1

const ensurePdfJsWorker = () => {
  if (hasConfiguredPdfJsWorker) {
    return
  }

  if (typeof window !== 'undefined' && 'Worker' in window) {
    GlobalWorkerOptions.workerPort = new PdfJsWorker()
    hasConfiguredPdfJsWorker = true
  }
}

const getPdfAnchorType = (
  note: Pick<Note, 'anchorType' | 'noteKind' | 'pdfPageNumber'>,
): PdfAnchorType | null => {
  if (!hasValidPdfPageNumber(note)) {
    return null
  }

  if (note.anchorType) {
    return note.anchorType
  }

  if (note.noteKind === 'pdf-page') {
    return 'page'
  }

  return null
}

const isPdfDocumentLevelNote = (
  note: Pick<
    Note,
    | 'anchorType'
    | 'documentType'
    | 'heightRatio'
    | 'noteKind'
    | 'pdfHighlightRects'
    | 'pdfPageNumber'
    | 'pdfSelectionKey'
    | 'pdfTextAnchorItemIndex'
    | 'pdfTextAnchorLeftRatio'
    | 'pdfTextAnchorTokenIndex'
    | 'pdfTextAnchorTopRatio'
    | 'widthRatio'
    | 'xRatio'
    | 'yRatio'
  >,
) =>
  note.documentType === 'pdf' &&
  !getPdfAnchorType(note) &&
  note.anchorType === undefined &&
  note.noteKind === undefined &&
  note.pdfPageNumber === undefined &&
  note.xRatio === undefined &&
  note.yRatio === undefined &&
  note.widthRatio === undefined &&
  note.heightRatio === undefined &&
  note.pdfSelectionKey === undefined &&
  note.pdfHighlightRects === undefined &&
  note.pdfTextAnchorItemIndex === undefined &&
  note.pdfTextAnchorLeftRatio === undefined &&
  note.pdfTextAnchorTopRatio === undefined &&
  note.pdfTextAnchorTokenIndex === undefined

const isPdfPageNote = (note: Pick<Note, 'anchorType' | 'noteKind' | 'pdfPageNumber'>) =>
  getPdfAnchorType(note) === 'page'

const isPdfPointNote = (note: Pick<Note, 'anchorType' | 'noteKind' | 'pdfPageNumber'>) =>
  getPdfAnchorType(note) === 'point'

const getPdfNoteDisplayLabel = (
  note: Pick<Note, 'anchorType' | 'context' | 'noteKind' | 'pdfPageNumber' | 'selectedText'>,
) => {
  if (isPdfPreviewFallbackLegacyPageNote(note)) {
    return null
  }

  const anchorType = getPdfAnchorType(note)
  const pageNumber = note.pdfPageNumber

  if (!anchorType || !pageNumber) {
    return null
  }

  if (anchorType === 'page') {
    return `PDF page note - page ${pageNumber}`
  }

  if (anchorType === 'point') {
    return `PDF point note - page ${pageNumber}`
  }

  if (anchorType === 'area') {
    return `PDF area note - page ${pageNumber}`
  }

  return `PDF text note - page ${pageNumber}`
}

const isPdfPreviewFallbackLegacyPageNote = (
  note: Pick<
    Note,
    'anchorType' | 'context' | 'noteKind' | 'pdfPageNumber' | 'selectedText'
  >,
) =>
  note.anchorType === undefined &&
  note.noteKind === undefined &&
  getPdfAnchorType(note) === 'page' &&
  note.pdfPageNumber === 1 &&
  note.selectedText === 'Page 1' &&
  note.context === 'PDF page 1'

const getPdfPointContext = (pageNumber: number, x: number, y: number) =>
  `Point on page ${pageNumber} at x ${Math.round(x)}, y ${Math.round(y)}`

const createPdfPointAnchor = ({
  pageHeight,
  pageNumber,
  pageWidth,
  x,
  xRatio,
  y,
  yRatio,
}: {
  pageHeight: number
  pageNumber: number
  pageWidth: number
  x: number
  xRatio: number
  y: number
  yRatio: number
}): NoteAnchor => {
  const sortOffset = Math.max(0, Math.round(yRatio * 1_000_000))

  return {
    context: getPdfPointContext(pageNumber, x, y),
    documentType: 'pdf',
    anchorType: 'point',
    endOffset: sortOffset + 1,
    pageHeight,
    pageWidth,
    paragraphIndex: Math.max(0, pageNumber - 1),
    pdfPageNumber: pageNumber,
    selectedText: '',
    startOffset: sortOffset,
    x,
    xRatio,
    y,
    yRatio,
  }
}


const getNotePreviewText = (
  note: Note,
) =>
  isPdfDocumentLevelNote(note) || isPdfPreviewFallbackLegacyPageNote(note)
    ? 'Document note'
    : note.selectedText.trim() || note.context || getPdfNoteDisplayLabel(note) || ''

const isPdfSidebarLongNote = (comment: string) =>
  comment.trim().length > pdfSidebarLongNoteCharacterThreshold

const getPdfTextNoteSortPosition = (
  note: Pick<
    Note,
    | 'pdfHighlightRects'
    | 'pdfTextAnchorLeftRatio'
    | 'pdfTextAnchorTopRatio'
    | 'pdfTextAnchorTokenIndex'
    | 'pdfTextAnchorItemIndex'
    | 'startOffset'
  >,
): {
  isCurrentAnchor: boolean
  itemIndex: number
  tokenIndex: number
  x: number
  y: number
} => {
  const hasCurrentAnchor =
    typeof note.pdfTextAnchorTopRatio === 'number' &&
    typeof note.pdfTextAnchorLeftRatio === 'number'

  if (hasCurrentAnchor) {
    const currentAnchorTopRatio = note.pdfTextAnchorTopRatio!
    const currentAnchorLeftRatio = note.pdfTextAnchorLeftRatio!

    return {
      isCurrentAnchor: true,
      itemIndex:
        typeof note.pdfTextAnchorItemIndex === 'number' ? note.pdfTextAnchorItemIndex : Number.MAX_SAFE_INTEGER,
      tokenIndex:
        typeof note.pdfTextAnchorTokenIndex === 'number' ? note.pdfTextAnchorTokenIndex : Number.MAX_SAFE_INTEGER,
      x: currentAnchorLeftRatio,
      y: currentAnchorTopRatio,
    }
  }

  const rects = note.pdfHighlightRects ?? []

  if (rects.length) {
    const topY = rects.reduce(
      (minimumY, rect) => Math.min(minimumY, rect.yRatio),
      Number.POSITIVE_INFINITY,
    )
    const topBandTolerance = 0.0025
    const topBandRects = rects.filter((rect) => Math.abs(rect.yRatio - topY) <= topBandTolerance)
    const leftMostRect = (topBandRects.length ? topBandRects : rects).reduce((bestRect, rect) => {
      if (!bestRect) {
        return rect
      }

      if (rect.xRatio !== bestRect.xRatio) {
        return rect.xRatio < bestRect.xRatio ? rect : bestRect
      }

      if (rect.yRatio !== bestRect.yRatio) {
        return rect.yRatio < bestRect.yRatio ? rect : bestRect
      }

      if (rect.widthRatio !== bestRect.widthRatio) {
        return rect.widthRatio < bestRect.widthRatio ? rect : bestRect
      }

      return rect.heightRatio < bestRect.heightRatio ? rect : bestRect
    }, null as PdfHighlightRect | null)

    if (leftMostRect) {
      return {
        isCurrentAnchor: false,
        itemIndex: Number.MAX_SAFE_INTEGER,
        tokenIndex: Number.MAX_SAFE_INTEGER,
        x: leftMostRect.xRatio,
        y: topY,
      }
    }

    return {
      isCurrentAnchor: false,
      itemIndex: Number.MAX_SAFE_INTEGER,
      tokenIndex: Number.MAX_SAFE_INTEGER,
      x: 0,
      y: topY,
    }
  }

  const fallbackOffset = Math.max(0, note.startOffset)
  const fallbackRatio = fallbackOffset / 1_000_000

  return {
    isCurrentAnchor: false,
    itemIndex: Number.MAX_SAFE_INTEGER,
    tokenIndex: Number.MAX_SAFE_INTEGER,
    x: 0,
    y: fallbackRatio,
  }
}

const getPdfNoteVerticalAnchorRatio = (
  note: Pick<
    Note,
    | 'anchorType'
    | 'noteKind'
    | 'pdfHighlightRects'
    | 'pdfPageNumber'
    | 'pdfTextAnchorTopRatio'
    | 'yRatio'
  >,
) => {
  const anchorType = getPdfAnchorType(note)

  if (anchorType === 'point') {
    return typeof note.yRatio === 'number' && Number.isFinite(note.yRatio)
      ? Math.min(Math.max(note.yRatio, 0), 1)
      : null
  }

  if (anchorType !== 'text') {
    return null
  }

  const rects = note.pdfHighlightRects ?? []

  if (rects.length) {
    const topY = rects.reduce(
      (minimumY, rect) => Math.min(minimumY, rect.yRatio),
      Number.POSITIVE_INFINITY,
    )
    const topBandTolerance = 0.0025
    const topBandRects = rects.filter((rect) => Math.abs(rect.yRatio - topY) <= topBandTolerance)
    const anchorRect = (topBandRects.length ? topBandRects : rects).reduce((bestRect, rect) => {
      if (!bestRect) {
        return rect
      }

      if (rect.xRatio !== bestRect.xRatio) {
        return rect.xRatio < bestRect.xRatio ? rect : bestRect
      }

      if (rect.yRatio !== bestRect.yRatio) {
        return rect.yRatio < bestRect.yRatio ? rect : bestRect
      }

      return rect.heightRatio < bestRect.heightRatio ? rect : bestRect
    }, null as PdfHighlightRect | null)

    if (anchorRect) {
      return Math.min(
        Math.max(anchorRect.yRatio + anchorRect.heightRatio / 2, 0),
        1,
      )
    }
  }

  return typeof note.pdfTextAnchorTopRatio === 'number' &&
    Number.isFinite(note.pdfTextAnchorTopRatio)
    ? Math.min(Math.max(note.pdfTextAnchorTopRatio, 0), 1)
    : null
}

const compareNotesInDocumentOrder = (first: Note, second: Note) => {
  const firstPdfAnchorType = getPdfAnchorType(first)
  const secondPdfAnchorType = getPdfAnchorType(second)

  if (firstPdfAnchorType === 'text' && secondPdfAnchorType === 'text') {
    const firstPageNumber = first.pdfPageNumber ?? 0
    const secondPageNumber = second.pdfPageNumber ?? 0

    if (firstPageNumber !== secondPageNumber) {
      return firstPageNumber - secondPageNumber
    }

    const firstPosition = getPdfTextNoteSortPosition(first)
    const secondPosition = getPdfTextNoteSortPosition(second)

    if (firstPosition.isCurrentAnchor !== secondPosition.isCurrentAnchor) {
      return firstPosition.isCurrentAnchor ? -1 : 1
    }

    if (firstPosition.y !== secondPosition.y) {
      return firstPosition.y - secondPosition.y
    }

    if (firstPosition.itemIndex !== secondPosition.itemIndex) {
      return firstPosition.itemIndex - secondPosition.itemIndex
    }

    if (firstPosition.tokenIndex !== secondPosition.tokenIndex) {
      return firstPosition.tokenIndex - secondPosition.tokenIndex
    }

    if (firstPosition.x !== secondPosition.x) {
      return firstPosition.x - secondPosition.x
    }

    if (first.startOffset !== second.startOffset) {
      return first.startOffset - second.startOffset
    }

    if (first.selectedText !== second.selectedText) {
      return first.selectedText.localeCompare(second.selectedText)
    }

    return first.id - second.id
  }

  if (first.paragraphIndex !== second.paragraphIndex) {
    return first.paragraphIndex - second.paragraphIndex
  }

  if (first.startOffset !== second.startOffset) {
    return first.startOffset - second.startOffset
  }

  return first.id - second.id
}

const isLegacyPdfTextNote = (
  note: Pick<
    Note,
    | 'anchorType'
    | 'noteKind'
    | 'pdfHighlightRects'
    | 'pdfSelectionKey'
    | 'pdfTextAnchorLeftRatio'
    | 'pdfTextAnchorTopRatio'
    | 'selectedText'
  >,
) => {
  if (getPdfAnchorType(note) !== 'text') {
    return false
  }

  if (
    !note.pdfSelectionKey ||
    !note.pdfHighlightRects?.length ||
    typeof note.pdfTextAnchorTopRatio !== 'number' ||
    typeof note.pdfTextAnchorLeftRatio !== 'number'
  ) {
    return true
  }

  return normalizeExperimentalPdfSelectedText(note.selectedText) !== note.selectedText.trim()
}

const getPdfTextNotesDiagnostics = (notes: Note[]) => {
  const pdfTextNotes = notes.filter((note) => getPdfAnchorType(note) === 'text')
  const legacyPdfTextNotes = pdfTextNotes.filter((note) => isLegacyPdfTextNote(note))
  const currentAnchoredPdfTextNotes = pdfTextNotes.filter((note) => !isLegacyPdfTextNote(note))

  return {
    currentAnchoredPdfTextNotesCount: currentAnchoredPdfTextNotes.length,
    legacyPdfTextNotesCount: legacyPdfTextNotes.length,
    pdfTextNotesCount: pdfTextNotes.length,
    totalNotesCount: notes.length,
  }
}

const createNotesFilePathFromDocumentPath = (documentPath: string) =>
  /\.txt$/i.test(documentPath)
    ? documentPath.replace(/\.txt$/i, '.notes.json')
    : `${documentPath}.notes.json`

const createNotesExportFilePathFromDocumentPath = (documentPath: string) =>
  /\.txt$/i.test(documentPath)
    ? documentPath.replace(/\.txt$/i, '.notes-export.md')
    : `${documentPath}.notes-export.md`

const getShortDesktopNotesStatus = (status: string) => {
  if (!status) {
    return ''
  }

  if (status === 'Saving notes...') {
    return 'Saving...'
  }

  if (status === 'Removing notes file...') {
    return 'Clearing...'
  }

  if (status.startsWith('Notes saved to:')) {
    return 'Saved'
  }

  if (status.startsWith('Notes file removed:')) {
    return 'Cleared'
  }

  if (status.startsWith('Notes are currently in memory only.')) {
    return 'In memory only'
  }

  if (status.startsWith('Notes file:')) {
    return ''
  }

  return status
}

const getCompactHeaderStatus = (status: string) => {
  if (!status) {
    return ''
  }

  if (status.startsWith('Opened ') && status.includes(' and restored ')) {
    const restoredMatch = status.match(/restored (\d+) note/)

    if (restoredMatch) {
      const restoredCount = Number.parseInt(restoredMatch[1], 10)
      return `Restored ${restoredCount} note${restoredCount === 1 ? '' : 's'}`
    }

    return 'Opened'
  }

  if (status.startsWith('Opened ')) {
    return 'Opened'
  }

  if (status === 'Opening desktop file dialog...') {
    return 'Opening...'
  }

  return status
}

const isAlertStatusMessage = (status: string) =>
  /error|failed|invalid|memory only|will not be overwritten automatically|appears to have changed|created before document change tracking/i.test(
    status,
  )

const isImportantNonSaveStatusMessage = (status: string) =>
  /appears to have changed|created before document change tracking|ignored |multiple possible notes files|renamed-document|recovery|invalid|memory only|will not be overwritten automatically|failed|error/i.test(
    status,
  )

const getBridgeErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

const getFileNameFromPath = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || filePath
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const getParentPathFromPath = (filePath: string) => {
  const normalizedPath = normalizeDesktopFilePath(filePath)
  const fileName = getFileNameFromPath(normalizedPath)
  const parentPath = normalizedPath.slice(
    0,
    Math.max(0, normalizedPath.length - fileName.length - 1),
  )

  return parentPath || normalizedPath
}

const isDocxDocumentPath = (filePath?: string) =>
  typeof filePath === 'string' && /\.docx$/i.test(filePath)

const isPdfDocumentPath = (filePath?: string) =>
  typeof filePath === 'string' && /\.pdf$/i.test(filePath)

const isLikelyTauriRuntimeWindow = () => {
  if (typeof window === 'undefined') {
    return false
  }

  const tauriWindow = window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_INTERNALS__)
}

const detectBrowserSelectedDocumentKind = async (
  file: File,
): Promise<'txt' | 'docx' | 'pdf' | 'unsupported'> => {
  if (isPdfDocumentPath(file.name) || file.type === 'application/pdf') {
    return 'pdf'
  }

  if (
    isDocxDocumentPath(file.name) ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }

  if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
    return 'txt'
  }

  const fileHeader = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const pdfHeader = [0x25, 0x50, 0x44, 0x46, 0x2d]

  if (pdfHeader.every((byte, index) => fileHeader[index] === byte)) {
    return 'pdf'
  }

  return 'unsupported'
}

const escapeMarkdownText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()#+\-!|>])/g, '\\$1')

const trimSentenceBoundary = (value: string) => value.replace(/^\s+|\s+$/g, '')

const extractSentenceOrPhrase = (
  text: string,
  startOffset: number,
  endOffset: number,
) => {
  const sourceText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  if (!sourceText) {
    return ''
  }

  const boundedStart = Math.max(0, Math.min(startOffset, sourceText.length))
  const boundedEnd = Math.max(boundedStart, Math.min(endOffset, sourceText.length))
  const sentenceBoundaryPattern = /[.!?\n]/
  const phraseBoundaryPattern = /[;:\n]/

  const findSegment = (boundaryPattern: RegExp) => {
    let segmentStart = 0

    for (let index = boundedStart - 1; index >= 0; index -= 1) {
      if (boundaryPattern.test(sourceText[index])) {
        segmentStart = index + 1
        break
      }
    }

    let segmentEnd = sourceText.length

    for (let index = boundedEnd; index < sourceText.length; index += 1) {
      if (boundaryPattern.test(sourceText[index])) {
        segmentEnd = index + 1
        break
      }
    }

    return trimSentenceBoundary(sourceText.slice(segmentStart, segmentEnd))
  }

  const sentence = findSegment(sentenceBoundaryPattern)

  if (sentence && sentence.length < sourceText.length) {
    return sentence
  }

  const phrase = findSegment(phraseBoundaryPattern)

  if (phrase && phrase.length < sourceText.length) {
    return phrase
  }

  if (sourceText.length <= 260) {
    return sourceText
  }

  const excerptStart = Math.max(0, boundedStart - 90)
  const excerptEnd = Math.min(sourceText.length, boundedEnd + 90)
  const prefix = excerptStart > 0 ? '...' : ''
  const suffix = excerptEnd < sourceText.length ? '...' : ''

  return `${prefix}${trimSentenceBoundary(sourceText.slice(excerptStart, excerptEnd))}${suffix}`
}

const formatMarkdownBlock = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

const normalizeDesktopFilePath = (filePath: string) => {
  const trimmedPath = filePath.trim()

  if (!trimmedPath.startsWith('file://')) {
    const withoutLeadingSlash = trimmedPath.replace(/^\/([a-zA-Z]:)/, '$1')
    return withoutLeadingSlash.replace(/\//g, '\\')
  }

  try {
    const parsedUrl = new URL(trimmedPath)
    const normalizedHost = parsedUrl.hostname.toLowerCase()
    const decodedPath = decodeURIComponent(parsedUrl.pathname)
    const withoutLeadingSlash = decodedPath.replace(/^\/([a-zA-Z]:)/, '$1')
    const windowsPath = withoutLeadingSlash.replace(/\//g, '\\')

    if (!normalizedHost || normalizedHost === 'localhost') {
      return windowsPath
    }

    return `\\\\${parsedUrl.hostname}${windowsPath}`
  } catch {
    const decodedPath = decodeURIComponent(trimmedPath.replace(/^file:\/\//i, ''))
    const withoutLeadingSlash = decodedPath.replace(/^\/([a-zA-Z]:)/, '$1')

    return withoutLeadingSlash.replace(/\//g, '\\')
  }
}

const readDesktopDocumentBytes = async (documentPath: string) => {
  const { invoke } = await import('@tauri-apps/api/core')
  const bytes = await invoke<number[]>('read_document_bytes', {
    documentPath: normalizeDesktopFilePath(documentPath),
  })

  return Uint8Array.from(bytes)
}

const getDocumentTypeLabel = (document: DocumentMetadata) => {
  if (document.source === 'desktop-file' && isPdfDocumentPath(document.documentPath)) {
    return 'PDF (limited in this version)'
  }

  if (document.source === 'desktop-file' && isDocxDocumentPath(document.documentPath)) {
    return 'DOCX plain text'
  }

  if (/\.txt$/i.test(document.fileName)) {
    return 'TXT'
  }

  return 'Text'
}

const getPrintableSentenceOrPhrase = (
  note: Note,
  resolvedAnchor: ResolvedNoteAnchor | undefined,
  paragraphs: string[],
) => {
  if (isPdfPageNote(note)) {
    return ''
  }

  if (
    resolvedAnchor &&
    resolvedAnchor.status !== 'review' &&
    typeof paragraphs[resolvedAnchor.paragraphIndex] === 'string'
  ) {
    const paragraph = paragraphs[resolvedAnchor.paragraphIndex]
    return extractSentenceOrPhrase(
      paragraph,
      resolvedAnchor.startOffset,
      resolvedAnchor.endOffset,
    )
  }

  if (note.context?.trim()) {
    return extractSentenceOrPhrase(note.context, note.startOffset, note.endOffset)
  }

  return ''
}

const printableContextExtraLengthThreshold = 24
const printableLongSelectionThreshold = 120

const getPrintableContextForDisplay = (
  selectedText: string,
  sentenceOrPhrase: string | undefined,
) => {
  const trimmedContext = sentenceOrPhrase?.trim()
  if (!trimmedContext) {
    return undefined
  }

  const normalizedSelectedText = normalizeAnchorSearchText(selectedText)
  const normalizedContext = normalizeAnchorSearchText(trimmedContext)

  if (!normalizedSelectedText || !normalizedContext) {
    return trimmedContext
  }

  if (normalizedSelectedText === normalizedContext) {
    return undefined
  }

  if (
    normalizedSelectedText.length >= printableLongSelectionThreshold &&
    normalizedContext.includes(normalizedSelectedText) &&
    normalizedContext.length - normalizedSelectedText.length <= printableContextExtraLengthThreshold
  ) {
    return undefined
  }

  return trimmedContext
}

const buildPrintableNotesHtml = (preview: PrintPreviewState) => {
  const renderedNotes = preview.notes
    .map((note) => {
      const sentenceOrPhrase = getPrintableContextForDisplay(
        note.selectedText,
        note.sentenceOrPhrase,
      )
      const previousSelectedText = note.previousSelectedText?.trim()

      return `
        <section class="note-report-card">
          <div class="note-report-number">Note ${note.noteNumber}</div>
          <div class="note-report-fragment">&ldquo;${escapeHtml(note.selectedText)}&rdquo;</div>
          ${
            sentenceOrPhrase
              ? `<div class="note-report-sentence"><strong>Sentence or phrase:</strong> ${escapeHtml(sentenceOrPhrase)}</div>`
              : ''
          }
          ${
            previousSelectedText
              ? `<div class="note-report-meta-line"><strong>Previously linked to:</strong> &ldquo;${escapeHtml(previousSelectedText)}&rdquo;</div>`
              : ''
          }
          ${
            note.isFragmentMissing
              ? '<div class="note-report-warning">Text fragment not found</div>'
              : ''
          }
          <div class="note-report-comment">${escapeHtml(note.comment || '(empty)')}</div>
        </section>
      `
    })
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`NoteAnchor - Notes report - ${preview.fileName}`)}</title>
    <style>
      :root {
        color: #202632;
        background: #ffffff;
        font-family: Inter, "Segoe UI", Arial, sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        color: #202632;
        background: #ffffff;
      }
      .report-shell {
        max-width: 880px;
        margin: 0 auto;
      }
      .report-header {
        display: grid;
        gap: 10px;
        margin-bottom: 24px;
        padding-bottom: 18px;
        border-bottom: 2px solid #d8dde3;
      }
      .report-app-name {
        color: #65707c;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .report-title {
        margin: 0;
        color: #1f2833;
        font-size: 28px;
        line-height: 1.2;
      }
      .report-meta {
        display: grid;
        gap: 6px;
        color: #4d5966;
        font-size: 14px;
        line-height: 1.5;
      }
      .notes-report-list {
        display: grid;
        gap: 16px;
      }
      .note-report-card {
        break-inside: avoid;
        display: grid;
        gap: 8px;
        padding: 16px 18px;
        border: 1px solid #d8dde3;
        border-left: 4px solid #9f7d22;
        border-radius: 8px;
        background: #fffef9;
      }
      .note-report-number {
        color: #65707c;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .note-report-fragment {
        color: #1f2833;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.35;
      }
      .note-report-sentence,
      .note-report-meta-line {
        color: #4d5966;
        font-size: 14px;
        line-height: 1.55;
      }
      .note-report-warning {
        color: #8a5b21;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.45;
      }
      .note-report-comment {
        padding: 12px 14px;
        border-radius: 6px;
        background: #f5f7f9;
        color: #2f3844;
        font-size: 15px;
        line-height: 1.6;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div class="report-shell">
      <header class="report-header">
        <div class="report-app-name">NoteAnchor</div>
        <h1 class="report-title">Notes report</h1>
        <div class="report-meta">
          <div><strong>Document:</strong> ${escapeHtml(preview.fileName)}</div>
          <div><strong>Document type:</strong> ${escapeHtml(preview.documentType)}</div>
          <div><strong>Generated:</strong> ${escapeHtml(preview.printedAt)}</div>
          <div><strong>Notes:</strong> ${preview.notes.length}</div>
        </div>
      </header>
      <main class="notes-report-list">
        ${renderedNotes}
      </main>
    </div>
  </body>
</html>`
}

const createDesktopDocumentMetadata = (
  filePath: string,
  documentKind: 'txt' | 'docx' | 'pdf',
  fileSize?: number,
  fileLastModified?: number,
  documentContentHash?: string,
): DocumentMetadata => {
  const safeId = filePath
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return {
    documentId: `desktop-file-${safeId || 'untitled-text-file'}`,
    documentKind,
    fileName: getFileNameFromPath(filePath),
    source: 'desktop-file',
    documentContentHash,
    documentPath: filePath,
    fileSize,
    fileLastModified,
    notesFilePath: createNotesFilePathFromDocumentPath(filePath),
    storageKey: `noteanchor.desktop-file.${safeId || 'untitled-text-file'}.notes.v1`,
  }
}

const createDesktopNotesPayload = (
  document: Pick<
    DocumentMetadata,
    | 'documentContentHash'
    | 'documentPath'
    | 'fileLastModified'
    | 'fileName'
    | 'fileSize'
    | 'notesFilePath'
  >,
  notes: Note[],
) =>
  JSON.stringify(
    {
      documentPath: document.documentPath,
      documentFileName: document.fileName,
      documentContentHash: document.documentContentHash,
      documentSizeBytes: document.fileSize,
      documentModifiedAt: document.fileLastModified,
      notesFilePath: document.notesFilePath,
      savedAt: new Date().toISOString(),
      notes,
    },
    null,
    2,
  )

const createPdfPageAnchor = (pageNumber: number): NoteAnchor => ({
  context: `PDF page ${pageNumber}`,
  documentType: 'pdf',
  endOffset: 1,
  anchorType: 'page',
  noteKind: 'pdf-page',
  paragraphIndex: Math.max(0, pageNumber - 1),
  pdfPageNumber: pageNumber,
  selectedText: `Page ${pageNumber}`,
  startOffset: 0,
})

const createPdfDocumentAnchor = (): NoteAnchor => ({
  context: 'PDF document',
  documentType: 'pdf',
  endOffset: 1,
  paragraphIndex: 0,
  selectedText: 'Document note',
  startOffset: 0,
})

const isRecentDocumentEntry = (value: unknown): value is RecentDocumentEntry => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.documentPath === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.lastOpenedAt === 'string' &&
    (typeof candidate.notesFilePath === 'string' ||
      typeof candidate.notesFilePath === 'undefined')
  )
}

const loadRecentDocuments = () => {
  if (typeof window === 'undefined') {
    return [] as RecentDocumentEntry[]
  }

  try {
    const savedValue = window.localStorage.getItem(recentDocumentsStorageKey)

    if (!savedValue) {
      return []
    }

    const parsed = JSON.parse(savedValue) as unknown

    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(recentDocumentsStorageKey)
      return []
    }

    return parsed
      .filter((entry): entry is RecentDocumentEntry => isRecentDocumentEntry(entry))
      .map((entry) => ({
        ...entry,
        documentPath: normalizeDesktopFilePath(entry.documentPath),
        notesFilePath:
          typeof entry.notesFilePath === 'string'
            ? normalizeDesktopFilePath(entry.notesFilePath)
            : undefined,
      }))
  } catch {
    window.localStorage.removeItem(recentDocumentsStorageKey)
    return []
  }
}

const upsertRecentDocument = (
  recentDocuments: RecentDocumentEntry[],
  nextEntry: RecentDocumentEntry,
) => {
  const normalizedPath = normalizeDesktopFilePath(nextEntry.documentPath)
  const dedupedEntries = recentDocuments.filter(
    (entry) =>
      normalizeDesktopFilePath(entry.documentPath).toLowerCase() !==
      normalizedPath.toLowerCase(),
  )

  return [
    {
      ...nextEntry,
      documentPath: normalizedPath,
    },
    ...dedupedEntries,
  ].slice(0, recentDocumentsLimit)
}

const formatRecentOpenedAt = (value: string) => {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsedDate)
}

const extractNotesFromPayload = (
  payloadText: string,
  paragraphs: string[],
  documentPath: string,
  documentSizeBytes?: number,
  documentModifiedAt?: number,
  documentContentHash?: string,
  options?: ExtractNotesOptions,
): ExtractedNotesResult => {
  try {
    const parsed = JSON.parse(payloadText) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return {
        loadFailed: true,
        message: 'Ignored invalid .notes.json beside this document.',
        notes: [] as Note[],
        rawNotesCount: 0,
        validNotesCount: 0,
      }
    }

    const candidate = parsed as Record<string, unknown>
    const savedNotes = candidate.notes
    const savedDocumentContentHash = candidate.documentContentHash
    const savedDocumentPath = candidate.documentPath
    const savedDocumentSizeBytes = candidate.documentSizeBytes
    const savedDocumentModifiedAt = candidate.documentModifiedAt

    if (
      !options?.allowPathMismatch &&
      typeof savedDocumentPath === 'string' &&
      savedDocumentPath !== documentPath
    ) {
      return {
        loadFailed: true,
        message: 'Ignored .notes.json because it points to a different document.',
        notes: [] as Note[],
        rawNotesCount: 0,
        validNotesCount: 0,
      }
    }

    if (!Array.isArray(savedNotes)) {
      return {
        loadFailed: true,
        message: 'Ignored invalid .notes.json beside this document.',
        notes: [] as Note[],
        rawNotesCount: 0,
        validNotesCount: 0,
      }
    }

    const validNotes = savedNotes.filter((note): note is Note =>
      isStructuredNote(note),
    )
    const rawNotesCount = savedNotes.length
    const validNotesCount = validNotes.length

    const hasSavedSourceMetadata =
      typeof savedDocumentContentHash === 'string' ||
      typeof savedDocumentSizeBytes === 'number' ||
      typeof savedDocumentModifiedAt === 'number'
    const notesMatchCurrentParagraphs = validNotes.every((note) =>
      doesNoteMatchCurrentParagraph(note, paragraphs),
    )
    const sourceMetadataChanged =
      (typeof savedDocumentContentHash === 'string' &&
        typeof documentContentHash === 'string' &&
        savedDocumentContentHash !== documentContentHash) ||
      (typeof savedDocumentSizeBytes === 'number' &&
        typeof documentSizeBytes === 'number' &&
        savedDocumentSizeBytes !== documentSizeBytes) ||
      (typeof savedDocumentModifiedAt === 'number' &&
        typeof documentModifiedAt === 'number' &&
        savedDocumentModifiedAt !== documentModifiedAt)

    if (!validNotesCount && rawNotesCount > 0) {
      return {
        loadFailed: true,
        message:
          'Notes file was found but notes could not be loaded safely. Existing file was not overwritten.',
        notes: [],
        rawNotesCount,
        validNotesCount,
      }
    }

    const hasPartiallyInvalidNotes = validNotesCount < rawNotesCount
    const shouldWarnAboutAnchorMismatch =
      validNotesCount > 0 && !notesMatchCurrentParagraphs

    return {
      message: sourceMetadataChanged || shouldWarnAboutAnchorMismatch
        ? 'This document appears to have changed since these notes were saved. Some notes may need review.'
        : hasPartiallyInvalidNotes
          ? 'Some notes could not be loaded safely and were skipped.'
        : hasSavedSourceMetadata
          ? notesMatchCurrentParagraphs
            ? undefined
            : undefined
          : 'These notes were saved before document change tracking was added.',
      notes: validNotes,
      rawNotesCount,
      validNotesCount,
    }
  } catch {
    return {
      loadFailed: true,
      message: 'Ignored invalid .notes.json beside this document.',
      notes: [] as Note[],
      rawNotesCount: 0,
      validNotesCount: 0,
    }
  }
}

const getSavedDocumentContentHash = (payloadText: string) => {
  try {
    const parsed = JSON.parse(payloadText) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const candidate = parsed as Record<string, unknown>
    return typeof candidate.documentContentHash === 'string'
      ? candidate.documentContentHash
      : null
  } catch {
    return null
  }
}

function App() {
  const documentRef = useRef<HTMLElement | null>(null)
  const documentViewerRef = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const highlightRefs = useRef(new Map<number, HTMLElement>())
  const marginLayoutFrameRef = useRef<number | null>(null)
  const marginNotesRef = useRef<HTMLElement | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const modalDragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const noteCardRefs = useRef(new Map<number, HTMLElement>())
  const findMatchRefs = useRef(new Map<number, HTMLElement>())
  const connectorFrameRef = useRef<number | null>(null)
  const selectionActionsRef = useRef<HTMLDivElement | null>(null)
  const pdfToolbarRef = useRef<HTMLDivElement | null>(null)
  const pdfPageControlsRef = useRef<HTMLDivElement | null>(null)
  const pdfCurrentPageStageRef = useRef<HTMLDivElement | null>(null)
  const pdfSidebarNoteListRef = useRef<HTMLDivElement | null>(null)
  const notesListScrollRef = useRef<HTMLDivElement | null>(null)
  const pdfPageSpinIntentRef = useRef(false)
  const pdfLoadRequestIdRef = useRef(0)
  const pdfRenderRequestIdRef = useRef(0)
  const pdfDocumentProxyRef = useRef<PDFDocumentProxy | null>(null)
  const pdfDocumentLoadingTaskRef = useRef<ReturnType<typeof getDocument> | null>(null)
  const pdfDocumentIdentityRef = useRef<{
    filePath: string
    sessionKey: number
  } | null>(null)
  const currentPdfDocumentPathRef = useRef('')
  const currentPdfOpenSessionKeyRef = useRef(0)
  const currentPdfPageRef = useRef(1)
  const pdfReadingSaveTimerRef = useRef<number | null>(null)
  const pendingPdfReadingRestoreRef = useRef<{
    documentPath: string
    pageNumber: number
    pageScrollRatio: number
    sessionKey: number
  } | null>(null)
  const appliedPdfReadingRestoreRef = useRef<{
    documentPath: string
    sessionKey: number
  } | null>(null)
  const suppressPdfReadingPersistRef = useRef(false)
  const lastSyncedActivePdfNoteRef = useRef('')
  const shouldBlockDesktopNotesPersistRef = useRef(false)
  const skipNextDesktopNotesPersistRef = useRef(false)
  const currentDesktopDocumentPathRef = useRef('')
  const desktopNotesPersistRequestIdRef = useRef(0)
  const desktopSaveStatusTimersRef = useRef<{
    clearTimer: number | null
    saveStartedAt: number | null
    savedDelayTimer: number | null
  }>({
    clearTimer: null,
    saveStartedAt: null,
    savedDelayTimer: null,
  })
  const desktopDocumentTransitionRef = useRef<{
    active: boolean
    targetDocumentPath: string
  }>({
    active: false,
    targetDocumentPath: '',
  })
  const topBarRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const pdfTextLayerHostRef = useRef<HTMLDivElement | null>(null)
  const pdfViewportHostRef = useRef<HTMLDivElement | null>(null)
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null)
  const [connectorLines, setConnectorLines] = useState<ConnectorLine[]>([])
  const [noteCardPositions, setNoteCardPositions] = useState<NoteCardPosition[]>(
    [],
  )
  const [noteListHeight, setNoteListHeight] = useState(0)
  const [pdfCurrentPageNoteCardPositions, setPdfCurrentPageNoteCardPositions] = useState<
    PdfCurrentPageNoteCardPosition[]
  >([])
  const [pdfCurrentPageNoteListHeight, setPdfCurrentPageNoteListHeight] = useState(0)
  const [expandedPdfSidebarNoteIds, setExpandedPdfSidebarNoteIds] = useState<number[]>([])
  const [workspaceCanvasSize, setWorkspaceCanvasSize] = useState<WorkspaceCanvasSize>({
    height: 0,
    width: 0,
  })
  const [topBarHeight, setTopBarHeight] = useState(0)
  const [currentDocument, setCurrentDocument] = useState(emptyDocumentMetadata)
  const [currentParagraphs, setCurrentParagraphs] = useState<string[]>([])
  const [pdfBlobUrl, setPdfBlobUrl] = useState('')
  const [pdfPageInput, setPdfPageInput] = useState('1')
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)
  const [pdfPageCount, setPdfPageCount] = useState(1)
  const [pdfOpenSessionKey, setPdfOpenSessionKey] = useState(0)
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pdfRenderedPage, setPdfRenderedPage] = useState<PdfRenderedPageState | null>(null)
  const [pdfPendingRender, setPdfPendingRender] = useState<PdfPendingRenderState | null>(null)
  const [pdfRenderError, setPdfRenderError] = useState('')
  const [pdfDocumentReadyKey, setPdfDocumentReadyKey] = useState('')
  const [pdfViewportWidth, setPdfViewportWidth] = useState(820)
  const [pdfInteractionMode, setPdfInteractionMode] = useState<'point' | 'text'>('point')
  const pdfInteractionModeWasUserChosenRef = useRef(false)
  const [, setPdfTextTokens] = useState<PdfTextToken[]>([])
  const [pdfTextLayerStatus, setPdfTextLayerStatus] =
    useState<PdfTextLayerStatus>('pending')
  const [pdfPageTextAnalysis, setPdfPageTextAnalysis] =
    useState<PdfPageTextAnalysisState | null>(null)
  const [pendingPdfTextSelection, setPendingPdfTextSelection] =
    useState<PendingPdfTextSelection | null>(null)
  const [pendingPdfPointAnchor, setPendingPdfPointAnchor] = useState<NoteAnchor | null>(null)
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<number | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editorAnchor, setEditorAnchor] = useState<NoteAnchor | null>(null)
  const [editorSelectedText, setEditorSelectedText] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [selectedAnchor, setSelectedAnchor] = useState<NoteAnchor | null>(null)
  const [selectionMessage, setSelectionMessage] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isDeleteNotesConfirmOpen, setIsDeleteNotesConfirmOpen] = useState(false)
  const [deleteNotesConfirmText, setDeleteNotesConfirmText] = useState('')
  const [isDebugToolsOpen, setIsDebugToolsOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isRecentDocumentsOpen, setIsRecentDocumentsOpen] = useState(false)
  const [missingRecentDocument, setMissingRecentDocument] =
    useState<MissingRecentDocumentState | null>(null)
  const [exportFeedback, setExportFeedback] = useState<ExportFeedbackState | null>(
    null,
  )
  const [printPreview, setPrintPreview] = useState<PrintPreviewState | null>(null)
  const [printSaveFeedback, setPrintSaveFeedback] = useState<ExportFeedbackState | null>(
    null,
  )
  const [isPrintSavePending, setIsPrintSavePending] = useState(false)
  const [isNotesListOpen, setIsNotesListOpen] = useState(false)
  const [notesSearchText, setNotesSearchText] = useState('')
  const [isWholeWordNotesSearch, setIsWholeWordNotesSearch] = useState(false)
  const [pdfNotesListFilter, setPdfNotesListFilter] = useState<'all' | 'current-page'>('all')
  const [documentSearchText, setDocumentSearchText] = useState('')
  const [activeFindMatchIndex, setActiveFindMatchIndex] = useState<number>(-1)
  const [noteDraft, setNoteDraft] = useState('')
  const [bridgeStatus, setBridgeStatus] = useState('')
  const [desktopOpenStatus, setDesktopOpenStatus] = useState('')
  const [desktopNotesStatus, setDesktopNotesStatus] = useState('')
  const [desktopVisibleSaveStatus, setDesktopVisibleSaveStatus] =
    useState<DesktopVisibleSaveStatus | null>(null)
  const [invalidSidecarRecovery, setInvalidSidecarRecovery] =
    useState<InvalidSidecarRecoveryState | null>(null)
  const [isInvalidSidecarRecoveryPending, setIsInvalidSidecarRecoveryPending] =
    useState(false)
  const [initialPdfRecoveryDiagnosticForRef] = useState<PdfRecoveryDiagnosticState>(
    initialPdfRecoveryDiagnosticState,
  )
  const [initialPdfRefreshDiagnosticForRef] = useState<PdfRefreshDiagnosticState>(
    initialPdfRefreshDiagnosticState,
  )
  const [initialPdfTextHighlightDiagnosticForRef] = useState<PdfTextHighlightDiagnosticState>(
    initialPdfTextHighlightDiagnosticState,
  )
  const [initialPdfSelectionDiagnosticForRef] = useState<PdfSelectionDiagnosticState>(
    initialPdfSelectionDiagnosticState,
  )
  const pdfRecoveryDiagnosticRef = useRef<PdfRecoveryDiagnosticState>(
    initialPdfRecoveryDiagnosticForRef,
  )
  const pdfRefreshDiagnosticRef = useRef<PdfRefreshDiagnosticState>(
    initialPdfRefreshDiagnosticForRef,
  )
  const pdfTextHighlightDiagnosticRef = useRef<PdfTextHighlightDiagnosticState>(
    initialPdfTextHighlightDiagnosticForRef,
  )
  const pdfSelectionDiagnosticRef = useRef<PdfSelectionDiagnosticState>(
    initialPdfSelectionDiagnosticForRef,
  )
  const pdfPageTextAnalysisCacheRef = useRef<Map<string, PdfPageTextAnalysisCacheEntry>>(
    new Map(),
  )

  const clearPdfPageTextAnalysisCache = useCallback(() => {
    pdfPageTextAnalysisCacheRef.current.clear()
  }, [])

  const buildPdfPageTextAnalysisCacheKey = useCallback(
    (
      filePath: string,
      sessionKey: number,
      pageNumber: number,
      viewportWidth: number,
      viewportHeight: number,
    ) =>
      [
        normalizeDesktopFilePath(filePath),
        sessionKey,
        pageNumber,
        viewportWidth.toFixed(3),
        viewportHeight.toFixed(3),
      ].join('::'),
    [],
  )

  const computePdfPageTextAnalysis = useCallback(
    (
      tokens: PdfTextToken[],
      pageWidth: number,
      hasRenderableTextItems: boolean,
    ): PdfPageTextAnalysisState => {
      const tokenLines = buildPdfTokenLineClusters(tokens)
      const pdfSuspiciousTextLineIds = new Set(
        tokenLines
          .filter((line) => isPdfTokenLineClusterSuspicious(line, pageWidth))
          .map((line) => line.lineId),
      )
      const twoZoneCandidates = tokenLines
        .map((line) => {
          const zones = getPdfTokenLineZones(line)

          if (zones.length !== 2) {
            return null
          }

          const [leftZone, rightZone] = zones
          const gap = Math.max(0, rightZone.left - leftZone.right)
          const totalSpan = rightZone.right - leftZone.left
          const leftStartRatio = leftZone.left / pageWidth
          const rightStartRatio = rightZone.left / pageWidth
          const gapRatio = gap / pageWidth

          if (
            leftZone.tokenCount < 1 ||
            rightZone.tokenCount < 1 ||
            gap < Math.max(28, pageWidth * 0.035) ||
            totalSpan < pageWidth * 0.36
          ) {
            return null
          }

          return {
            gapRatio,
            leftStartRatio,
            lineId: line.lineId,
            rightStartRatio,
            strongColumnCandidate:
              leftStartRatio <= 0.26 &&
              rightStartRatio >= 0.5 &&
              gapRatio >= 0.08 &&
              totalSpan >= pageWidth * 0.58,
          }
        })
        .filter((candidate): candidate is {
          gapRatio: number
          leftStartRatio: number
          lineId: string
          rightStartRatio: number
          strongColumnCandidate: boolean
        } => Boolean(candidate))

      let pdfParallelTextLineIds = new Set<string>()

      if (twoZoneCandidates.length >= 2) {
        const strongColumnCandidates = twoZoneCandidates.filter(
          (candidate) => candidate.strongColumnCandidate,
        )

        if (strongColumnCandidates.length >= 2) {
          pdfParallelTextLineIds = new Set(
            strongColumnCandidates.map((candidate) => candidate.lineId),
          )
        } else {
          const matchingCandidates = twoZoneCandidates.filter((candidate) => {
            const similarLines = twoZoneCandidates.filter((otherCandidate) =>
              Math.abs(otherCandidate.leftStartRatio - candidate.leftStartRatio) <= 0.1 &&
              Math.abs(otherCandidate.rightStartRatio - candidate.rightStartRatio) <= 0.1 &&
              Math.abs(otherCandidate.gapRatio - candidate.gapRatio) <= 0.05,
            )

            return similarLines.length >= 2
          })

          if (matchingCandidates.length >= 2) {
            pdfParallelTextLineIds = new Set(
              matchingCandidates.map((candidate) => candidate.lineId),
            )
          }
        }
      }

      const pdfSuspiciousTextLineCount = pdfSuspiciousTextLineIds.size
      const pdfSuspiciousTextLineRatio =
        tokenLines.length > 0 ? pdfSuspiciousTextLineCount / tokenLines.length : 0
      const pdfParallelTextLineCount = pdfParallelTextLineIds.size
      const pdfParallelTextLineRatio =
        tokenLines.length > 0 ? pdfParallelTextLineCount / tokenLines.length : 0

      return {
        hasRenderableTextItems,
        isPdfTextPageLayoutGuarded:
          tokenLines.length > 0 &&
          (pdfSuspiciousTextLineCount >= 4 || pdfSuspiciousTextLineRatio >= 0.24),
        isPdfTextSingleLineOnlyLayout:
          tokenLines.length > 0 &&
          (pdfParallelTextLineCount >= 2 || pdfParallelTextLineRatio >= 0.08),
        pdfParallelTextLineIds,
        pdfSuspiciousTextLineIds,
        tokenLines,
      }
    },
    [],
  )
  const [recentOpenDiagnostic, setRecentOpenDiagnostic] = useState<RecentOpenDiagnosticState>(
    initialRecentOpenDiagnosticState,
  )
  const [initialPdfStickyDiagnosticForRef] = useState<PdfStickyDiagnosticState>(
    initialPdfStickyDiagnosticState,
  )
  const pdfStickyDiagnosticRef = useRef<PdfStickyDiagnosticState>(
    initialPdfStickyDiagnosticForRef,
  )
  const [isBridgePending, setIsBridgePending] = useState(false)
  const [isDesktopOpenPending, setIsDesktopOpenPending] = useState(false)
  const [isDraggingEditor, setIsDraggingEditor] = useState(false)
  const [modalPosition, setModalPosition] = useState<ModalPosition | null>(null)
  const [isWholeWordFind, setIsWholeWordFind] = useState(true)
  const [pendingNoteOpenScroll, setPendingNoteOpenScroll] =
    useState<PendingNoteOpenScroll | null>(null)
  const [recentDocuments, setRecentDocuments] = useState<RecentDocumentEntry[]>(
    () => loadRecentDocuments(),
  )
  const [notes, setNotes] = useState<Note[]>([])
  const pdfTextDragStateRef = useRef<{
    hasMoved: boolean
    pointerId: number
    startPoint: { x: number; y: number }
    startLineIndex: number
    startLineId: string
    startTokenKey: string
  } | null>(null)

  const setPdfRecoveryDiagnostic = (value: SetStateAction<PdfRecoveryDiagnosticState>) => {
    pdfRecoveryDiagnosticRef.current =
      typeof value === 'function'
        ? (value as (current: PdfRecoveryDiagnosticState) => PdfRecoveryDiagnosticState)(
            pdfRecoveryDiagnosticRef.current,
          )
        : value
  }

  const setPdfRefreshDiagnostic = (value: SetStateAction<PdfRefreshDiagnosticState>) => {
    pdfRefreshDiagnosticRef.current =
      typeof value === 'function'
        ? (value as (current: PdfRefreshDiagnosticState) => PdfRefreshDiagnosticState)(
            pdfRefreshDiagnosticRef.current,
          )
        : value
  }

  const setPdfTextHighlightDiagnostic = (
    value: SetStateAction<PdfTextHighlightDiagnosticState>,
  ) => {
    pdfTextHighlightDiagnosticRef.current =
      typeof value === 'function'
        ? (value as (
            current: PdfTextHighlightDiagnosticState,
          ) => PdfTextHighlightDiagnosticState)(pdfTextHighlightDiagnosticRef.current)
        : value
  }

  const setPdfSelectionDiagnostic = (value: SetStateAction<PdfSelectionDiagnosticState>) => {
    pdfSelectionDiagnosticRef.current =
      typeof value === 'function'
        ? (value as (current: PdfSelectionDiagnosticState) => PdfSelectionDiagnosticState)(
            pdfSelectionDiagnosticRef.current,
          )
        : value
  }

  const setPdfStickyDiagnostic = (value: SetStateAction<PdfStickyDiagnosticState>) => {
    pdfStickyDiagnosticRef.current =
      typeof value === 'function'
        ? (value as (current: PdfStickyDiagnosticState) => PdfStickyDiagnosticState)(
            pdfStickyDiagnosticRef.current,
          )
        : value
  }

  const selectedPreview = useMemo(() => {
    if (selectedText.length <= 90) {
      return selectedText
    }

    return `${selectedText.slice(0, 90)}...`
  }, [selectedText])

  const editorPreviewText = useMemo(() => {
    const rawPreview = editorSelectedText.trim() || editorAnchor?.context || ''

    if (rawPreview.length <= 90) {
      return rawPreview
    }

    return `${rawPreview.slice(0, 90)}...`
  }, [editorAnchor, editorSelectedText])

  const shouldQuoteEditorPreview = Boolean(editorSelectedText.trim())
  const normalizedNotesSearchQuery = notesSearchText.trim()
  const renderSearchHighlightedText = useCallback((value: string) => {
    if (!normalizedNotesSearchQuery) {
      return value
    }

    const matchIndex = findSearchMatchIndex(
      value,
      normalizedNotesSearchQuery,
      isWholeWordNotesSearch,
    )

    if (matchIndex < 0) {
      return value
    }

    const matchLength = normalizedNotesSearchQuery.length

    return (
      <>
        {value.slice(0, matchIndex)}
        <mark className="notes-search-highlight">
          {value.slice(matchIndex, matchIndex + matchLength)}
        </mark>
        {value.slice(matchIndex + matchLength)}
      </>
    )
  }, [isWholeWordNotesSearch, normalizedNotesSearchQuery])

  const notesInDocumentOrder = useMemo(
    () =>
      [...notes].sort(compareNotesInDocumentOrder),
    [notes],
  )

  const resolvedAnchorsById = useMemo(
    () =>
      new Map(
        notes.map((note) => [note.id, resolveNoteAnchor(note, currentParagraphs)] as const),
      ),
    [currentParagraphs, notes],
  )

  const noteCardPositionById = useMemo(
    () =>
      new Map(noteCardPositions.map((position) => [position.id, position] as const)),
    [noteCardPositions],
  )
  const pdfCurrentPageNoteCardTopById = useMemo(
    () =>
      new Map(pdfCurrentPageNoteCardPositions.map((position) => [position.id, position.top] as const)),
    [pdfCurrentPageNoteCardPositions],
  )
  const expandedPdfSidebarNoteIdSet = useMemo(
    () => new Set(expandedPdfSidebarNoteIds),
    [expandedPdfSidebarNoteIds],
  )

  const documentTitle =
    currentDocument.source === 'empty'
      ? ''
      : currentDocument.fileName

  const hasOpenDocument = currentDocument.source !== 'empty'
  const isDesktopDocument = currentDocument.source === 'desktop-file'
  const isPdfDesktopDocument = currentDocument.documentKind === 'pdf'
  const isDocxDesktopDocument = currentDocument.documentKind === 'docx'
  const hasUserOpenedDocument =
    currentDocument.source === 'desktop-file' ||
    currentDocument.source === 'browser-file'
  const canCloseDocument =
    currentDocument.source === 'desktop-file' ||
    currentDocument.source === 'browser-file'
  const canDeleteNotes = hasUserOpenedDocument && notes.length > 0
  const canExportNotes =
    currentDocument.source === 'desktop-file' &&
    Boolean(currentDocument.documentPath) &&
    !isPdfDesktopDocument &&
    notes.length > 0
  const canPrintNotes = hasOpenDocument && notes.length > 0 && !isPdfDesktopDocument
  const hasValidSelection = Boolean(selectedAnchor && selectedText)
  const parsedPdfPageInput = Number.parseInt(pdfPageInput, 10)
  const currentPdfPage = Math.min(Math.max(1, pdfCurrentPage), Math.max(1, pdfPageCount))
  const canGoToPreviousPdfPage = isPdfDesktopDocument && currentPdfPage > 1
  const canGoToNextPdfPage =
    isPdfDesktopDocument && currentPdfPage < Math.max(1, pdfPageCount)
  const pdfViewerSrc = pdfBlobUrl
  const pdfViewerEmbeddedSrc =
    pdfViewerSrc && isPdfDesktopDocument
      ? `${pdfViewerSrc}#page=${currentPdfPage}`
      : pdfViewerSrc
  const isPdfPreviewOnlyFallback =
    isPdfDesktopDocument && Boolean(pdfRenderError && pdfViewerSrc && !pdfRenderedPage)
  const canUsePdfPointNotes = isPdfDesktopDocument && Boolean(pdfRenderedPage)
  const canUsePdfTextNotes =
    isPdfDesktopDocument && Boolean(pdfRenderedPage) && pdfTextLayerStatus === 'available'
  const renderNoteGuidanceNotice = useCallback(
    ({
      action,
      available,
      label,
      unavailable,
    }: {
      action: string
      available: string
      label: string
      unavailable?: string
    }) => (
      <div className="note-guidance-notice">
        <div className="note-guidance-label">{label}</div>
        <div className="note-guidance-line note-guidance-line-available">
          <span className="note-guidance-line-title">Available:</span>{' '}
          <span>{available}</span>
        </div>
        {unavailable ? (
          <div className="note-guidance-line note-guidance-line-unavailable">
            <span className="note-guidance-line-title">Unavailable:</span>{' '}
            <span>{unavailable}</span>
          </div>
        ) : null}
        <div className="note-guidance-line">{action}</div>
      </div>
    ),
    [],
  )
  const pageFilteredNotesInDocumentOrder = useMemo(() => {
    if (!isPdfDesktopDocument) {
      return notesInDocumentOrder
    }

    if (isPdfPreviewOnlyFallback) {
      return notesInDocumentOrder
    }

    if (pdfNotesListFilter === 'all') {
      return notesInDocumentOrder
    }

    return notesInDocumentOrder.filter((note) => note.pdfPageNumber === currentPdfPage)
  }, [
    currentPdfPage,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    notesInDocumentOrder,
    pdfNotesListFilter,
  ])
  const sidebarNotesInDocumentOrder = useMemo(() => {
    if (!isPdfDesktopDocument || isPdfPreviewOnlyFallback) {
      return notesInDocumentOrder
    }

    return notesInDocumentOrder.filter((note) => note.pdfPageNumber === currentPdfPage)
  }, [
    currentPdfPage,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    notesInDocumentOrder,
  ])
  const pdfPageAnchor = isPdfDesktopDocument
    ? isPdfPreviewOnlyFallback
      ? createPdfDocumentAnchor()
      : createPdfPageAnchor(currentPdfPage)
    : null
  const currentDesktopDocumentPath =
    isDesktopDocument && currentDocument.documentPath
      ? currentDocument.documentPath
      : ''
  const currentDesktopNotesPath =
    isDesktopDocument && currentDocument.notesFilePath
      ? currentDocument.notesFilePath
      : ''
  const currentDesktopExportPath =
    isDesktopDocument && currentDocument.documentPath && !isPdfDesktopDocument
      ? createNotesExportFilePathFromDocumentPath(currentDocument.documentPath)
      : ''
  const hasRecentDocuments = recentDocuments.length > 0
  const recentDocumentsPreview = useMemo(
    () => recentDocuments.slice(0, 5),
    [recentDocuments],
  )
  const desktopNotesStatusLabel = getShortDesktopNotesStatus(desktopNotesStatus)
  const shouldPreferVisibleSaveStatus =
    Boolean(desktopVisibleSaveStatus) &&
    !isImportantNonSaveStatusMessage(desktopOpenStatus) &&
    !isAlertStatusMessage(desktopNotesStatusLabel)
  const effectiveDesktopNotesStatusLabel = shouldPreferVisibleSaveStatus
    ? desktopVisibleSaveStatus?.message ?? desktopNotesStatusLabel
    : desktopNotesStatusLabel
  const statusMessages = [
    desktopOpenStatus,
    effectiveDesktopNotesStatusLabel,
    bridgeStatus,
  ].filter(Boolean)
  const headerStatusMessage = statusMessages[statusMessages.length - 1] ?? ''
  const isHeaderStatusError = isAlertStatusMessage(headerStatusMessage)
  const hasInvalidSidecarRecoveryActions =
    Boolean(invalidSidecarRecovery) &&
    isDesktopDocument &&
    currentDocument.source === 'desktop-file' &&
    Boolean(currentDocument.documentPath)
  const compactHeaderStatusMessage = isHeaderStatusError
    ? ''
    : getCompactHeaderStatus(headerStatusMessage)
  const fileStatusSummary = currentDocument.source === 'empty'
    ? 'Open document to start'
    : isDesktopDocument
      ? isPdfDesktopDocument
        ? 'PDF (limited in this version)'
        : isDocxDesktopDocument
        ? 'Native notes'
        : 'Native notes enabled'
      : 'Temporary browser storage'
  const fileStatusLine = compactHeaderStatusMessage
    ? `${fileStatusSummary} · ${compactHeaderStatusMessage}`
    : fileStatusSummary
  const visibleFileStatusLine = shouldPreferVisibleSaveStatus
    ? effectiveDesktopNotesStatusLabel
    : fileStatusLine
  const pdfViewerRemountKey = `${currentDocument.documentId}-pdf-${pdfOpenSessionKey}`
  const notesListTitle = isPdfDesktopDocument
    ? !isPdfPreviewOnlyFallback && pdfNotesListFilter === 'current-page'
      ? `Notes for page ${currentPdfPage}`
      : 'All notes'
    : 'Notes'
  const isDeleteNotesConfirmationValid =
    deleteNotesConfirmText.trim().toUpperCase() === 'DELETE'
  const activeNote = useMemo(
    () => (activeNoteId === null ? null : notes.find((note) => note.id === activeNoteId) ?? null),
    [activeNoteId, notes],
  )
  const activeResolvedAnchorStatus = activeNote
    ? resolvedAnchorsById.get(activeNote.id)?.status ?? 'review'
    : null
  const currentPdfReadingPositionStorageKey =
    isPdfDesktopDocument
      ? createPdfReadingPositionStorageKey(currentDocument.storageKey)
      : ''

  const clearScheduledPdfReadingPersist = useCallback(() => {
    if (pdfReadingSaveTimerRef.current !== null) {
      window.clearTimeout(pdfReadingSaveTimerRef.current)
      pdfReadingSaveTimerRef.current = null
    }
  }, [])

  const getActivePdfReadingScrollContainer = useCallback(() => {
    const pdfViewportHostElement = pdfViewportHostRef.current

    if (
      pdfViewportHostElement &&
      pdfViewportHostElement.scrollHeight > pdfViewportHostElement.clientHeight + 1
    ) {
      return pdfViewportHostElement
    }

    return workspaceRef.current
  }, [])

  const resetPdfReadingScrollContainers = useCallback(() => {
    documentViewerRef.current?.scrollTo({ top: 0 })
    workspaceRef.current?.scrollTo({ top: 0 })
    pdfViewportHostRef.current?.scrollTo({ top: 0 })
  }, [])

  const computePdfReadingPositionSnapshot = useCallback((): PdfReadingPositionState | null => {
    if (
      !isPdfDesktopDocument ||
      !currentDocument.documentPath ||
      !currentPdfReadingPositionStorageKey
    ) {
      return null
    }

    const pdfStageElement = pdfCurrentPageStageRef.current
    const scrollContainer = getActivePdfReadingScrollContainer()

    if (!pdfStageElement || !scrollContainer) {
      return null
    }

    const stageRect = pdfStageElement.getBoundingClientRect()
    const scrollContainerRect = scrollContainer.getBoundingClientRect()

    if (stageRect.height <= 0 || scrollContainer.clientHeight <= 0) {
      return null
    }

    const pageOffsetWithinContainer = Math.max(
      0,
      scrollContainerRect.top - stageRect.top,
    )
    const maxScrollableOffsetWithinPage = Math.max(
      0,
      stageRect.height - scrollContainer.clientHeight,
    )
    const pageScrollRatio =
      maxScrollableOffsetWithinPage <= 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              pageOffsetWithinContainer / maxScrollableOffsetWithinPage,
            ),
          )

    return {
      documentPath: normalizeDesktopFilePath(currentDocument.documentPath),
      pageNumber: Math.max(1, currentPdfPage),
      pageScrollRatio,
      savedAt: new Date().toISOString(),
    }
  }, [
    currentDocument.documentPath,
    currentPdfPage,
    currentPdfReadingPositionStorageKey,
    getActivePdfReadingScrollContainer,
    isPdfDesktopDocument,
  ])

  const persistPdfReadingPositionNow = useCallback(() => {
    if (
      suppressPdfReadingPersistRef.current ||
      !isPdfDesktopDocument ||
      !currentPdfReadingPositionStorageKey
    ) {
      return
    }

    const snapshot = computePdfReadingPositionSnapshot()

    if (!snapshot) {
      return
    }

    try {
      savePdfReadingPosition(currentDocument.storageKey, snapshot)
    } catch {
      // Keep reading-position persistence best-effort only.
    }
  }, [
    computePdfReadingPositionSnapshot,
    currentDocument.storageKey,
    currentPdfReadingPositionStorageKey,
    isPdfDesktopDocument,
  ])

  const flushPdfReadingPositionPersist = useCallback(() => {
    if (pdfReadingSaveTimerRef.current === null) {
      return
    }

    clearScheduledPdfReadingPersist()
    persistPdfReadingPositionNow()
  }, [clearScheduledPdfReadingPersist, persistPdfReadingPositionNow])

  const schedulePdfReadingPositionPersist = useCallback(() => {
    if (
      suppressPdfReadingPersistRef.current ||
      !isPdfDesktopDocument ||
      !currentPdfReadingPositionStorageKey
    ) {
      return
    }

    clearScheduledPdfReadingPersist()
    pdfReadingSaveTimerRef.current = window.setTimeout(() => {
      pdfReadingSaveTimerRef.current = null
      persistPdfReadingPositionNow()
    }, pdfReadingPositionSaveDelayMs)
  }, [
    clearScheduledPdfReadingPersist,
    currentPdfReadingPositionStorageKey,
    isPdfDesktopDocument,
    persistPdfReadingPositionNow,
  ])

  const clearCachedPdfDocument = useCallback(() => {
    const loadingTask = pdfDocumentLoadingTaskRef.current
    pdfDocumentLoadingTaskRef.current = null

    if (loadingTask) {
      void loadingTask.destroy().catch(() => {
        // Ignore teardown races during document replacement.
      })
    }

    pdfDocumentProxyRef.current = null
    clearPdfPageTextAnalysisCache()
    pdfDocumentIdentityRef.current = null
    setPdfDocumentReadyKey('')
  }, [clearPdfPageTextAnalysisCache])

  const teardownActivePdfBeforeDocumentReplacement = useCallback(() => {
    if (!isPdfDesktopDocument) {
      return
    }

    flushPdfReadingPositionPersist()
    clearScheduledPdfReadingPersist()
    pdfLoadRequestIdRef.current += 1
    pdfRenderRequestIdRef.current += 1
    clearCachedPdfDocument()
    currentPdfDocumentPathRef.current = ''
    currentPdfPageRef.current = 1
    pendingPdfReadingRestoreRef.current = null
    appliedPdfReadingRestoreRef.current = null
    suppressPdfReadingPersistRef.current = false

    setPdfPendingRender(null)
    setPdfRenderedPage(null)
    setPdfRenderError('')
    setPdfTextTokens([])
    setPdfTextLayerStatus('pending')
    setPdfPageTextAnalysis(null)
    setPendingPdfTextSelection(null)
    setPendingPdfPointAnchor(null)
    setPdfBlobUrl('')
    setPdfPageCount(1)
    setPdfCurrentPage(1)
    setPdfPageInput('1')
    pdfInteractionModeWasUserChosenRef.current = false
    setPdfInteractionMode('point')
    window.getSelection()?.removeAllRanges()
    pdfTextLayerHostRef.current?.replaceChildren()

    const canvas = pdfCanvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = '0px'
      canvas.style.height = '0px'
    }

    resetPdfReadingScrollContainers()
  }, [
    clearCachedPdfDocument,
    clearScheduledPdfReadingPersist,
    flushPdfReadingPositionPersist,
    isPdfDesktopDocument,
    resetPdfReadingScrollContainers,
  ])
  const isActiveNoteUnresolved = activeResolvedAnchorStatus === 'review'
  const canReconnectActiveNote = Boolean(
    activeNote &&
      !getPdfAnchorType(activeNote) &&
      isActiveNoteUnresolved &&
      selectedAnchor &&
      selectedText,
  )
  const anchorStatusCounts = useMemo(() => {
    const counts = {
      exact: 0,
      recovered: 0,
      unresolved: 0,
    }

    notes.forEach((note) => {
      const status = resolvedAnchorsById.get(note.id)?.status

      if (status === 'exact') {
        counts.exact += 1
        return
      }

      if (status === 'recovered') {
        counts.recovered += 1
        return
      }

      counts.unresolved += 1
    })

    return counts
  }, [notes, resolvedAnchorsById])
  const pdfPointMarkers = useMemo(() => {
    if (!isPdfDesktopDocument) {
      return []
    }

    const savedMarkers = notes
      .filter(
        (note) =>
          isPdfPointNote(note) &&
          note.pdfPageNumber === currentPdfPage &&
          typeof note.xRatio === 'number' &&
          typeof note.yRatio === 'number',
      )
      .map((note) => ({
        isPending: false,
        noteId: note.id,
        xRatio: note.xRatio ?? 0,
        yRatio: note.yRatio ?? 0,
      }))

    const pendingMarker =
      pendingPdfPointAnchor &&
      isPdfPointNote(pendingPdfPointAnchor) &&
      pendingPdfPointAnchor.pdfPageNumber === currentPdfPage &&
      typeof pendingPdfPointAnchor.xRatio === 'number' &&
      typeof pendingPdfPointAnchor.yRatio === 'number'
        ? [
            {
              isPending: true,
              noteId: null,
              xRatio: pendingPdfPointAnchor.xRatio ?? 0,
              yRatio: pendingPdfPointAnchor.yRatio ?? 0,
            },
          ]
        : []

    return [...savedMarkers, ...pendingMarker]
  }, [currentPdfPage, isPdfDesktopDocument, notes, pendingPdfPointAnchor])
  const pdfTokenLines = pdfPageTextAnalysis?.tokenLines ?? []
  const pdfSuspiciousTextLineIds = pdfPageTextAnalysis?.pdfSuspiciousTextLineIds ?? new Set()
  const isPdfTextSingleLineOnlyLayout =
    pdfPageTextAnalysis?.isPdfTextSingleLineOnlyLayout ?? false
  const isPdfTextPageLayoutGuarded = pdfPageTextAnalysis?.isPdfTextPageLayoutGuarded ?? false
  const canSelectPdfTextMode =
    canUsePdfTextNotes && !isPdfTextPageLayoutGuarded && !isPdfPreviewOnlyFallback
  const showPdfPointOnlyStatusNotice =
    ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES &&
    !isPdfPreviewOnlyFallback &&
    pdfInteractionMode !== 'text' &&
    ((!canUsePdfTextNotes && canUsePdfPointNotes) || isPdfTextPageLayoutGuarded)
  const experimentalPdfTextNotes = useMemo(
    () =>
      ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES
        ? notes.filter(
            (note) =>
              getPdfAnchorType(note) === 'text' &&
              note.pdfPageNumber === currentPdfPage &&
              Array.isArray(note.pdfHighlightRects) &&
              note.pdfHighlightRects.length > 0,
          )
        : [],
    [currentPdfPage, notes],
  )
  const existingExperimentalPdfSelectionNote = useMemo(() => {
    if (!pendingPdfTextSelection?.anchor.pdfSelectionKey) {
      return null
    }

    return notes.find(
      (note) =>
        getPdfAnchorType(note) === 'text' &&
        note.pdfSelectionKey === pendingPdfTextSelection.anchor.pdfSelectionKey,
      ) ?? null
  }, [notes, pendingPdfTextSelection])
  const currentExperimentalPdfTextSelectionAnchor = useMemo(() => {
    if (pendingPdfTextSelection?.anchor.pdfSelectionKey) {
      return pendingPdfTextSelection.anchor
    }

    if (
      selectedAnchor?.anchorType === 'text' &&
      selectedAnchor.documentType === 'pdf' &&
      typeof selectedAnchor.pdfSelectionKey === 'string' &&
      Array.isArray(selectedAnchor.pdfHighlightRects) &&
      selectedAnchor.pdfHighlightRects.length > 0
    ) {
      return selectedAnchor
    }

    return null
  }, [pendingPdfTextSelection, selectedAnchor])
  const filteredNotesInDocumentOrder = useMemo(() => {
    return filterNotesByQuery(
      pageFilteredNotesInDocumentOrder,
      notesSearchText,
      isWholeWordNotesSearch,
    )
  }, [isWholeWordNotesSearch, notesSearchText, pageFilteredNotesInDocumentOrder])
  const shouldShowPdfCurrentPageEmptyState =
    isPdfDesktopDocument &&
    !isPdfPreviewOnlyFallback &&
    pdfNotesListFilter === 'current-page' &&
    !notesSearchText.trim() &&
    notesInDocumentOrder.length > 0 &&
    pageFilteredNotesInDocumentOrder.length === 0
  const shouldShowPdfSidebarCurrentPageEmptyState =
    isPdfDesktopDocument &&
    !isPdfPreviewOnlyFallback &&
    notesInDocumentOrder.length > 0 &&
    sidebarNotesInDocumentOrder.length === 0
  const shouldUseAlignedPdfCurrentPageNotes =
    isPdfDesktopDocument &&
    !isPdfPreviewOnlyFallback &&
    pdfCurrentPageNoteCardPositions.length === sidebarNotesInDocumentOrder.length &&
    sidebarNotesInDocumentOrder.length > 0
  const documentFindMatches = useMemo(() => {
    const query = documentSearchText.trim().toLowerCase()

    if (!query) {
      return [] as DocumentFindMatch[]
    }

    const matches: DocumentFindMatch[] = []

    currentParagraphs.forEach((paragraph, paragraphIndex) => {
      findMatchesInParagraph(paragraph, query, isWholeWordFind).forEach(({ endOffset, startOffset }) => {
        matches.push({
          endOffset,
          index: matches.length,
          paragraphIndex,
          startOffset,
        })
      })
    })

    return matches
  }, [currentParagraphs, documentSearchText, isWholeWordFind])
  const findMatchesByParagraph = useMemo(() => {
    const matchesByParagraph = new Map<number, DocumentFindMatch[]>()

    documentFindMatches.forEach((match) => {
      const paragraphMatches = matchesByParagraph.get(match.paragraphIndex) ?? []
      paragraphMatches.push(match)
      matchesByParagraph.set(match.paragraphIndex, paragraphMatches)
    })

    return matchesByParagraph
  }, [documentFindMatches])
  const documentFindCounterText =
    documentFindMatches.length === 0
      ? '0 matches'
      : `${Math.max(1, activeFindMatchIndex + 1)} of ${documentFindMatches.length}`
  const activeFindMatchAnchor = useMemo(() => {
    if (
      activeFindMatchIndex < 0 ||
      activeFindMatchIndex >= documentFindMatches.length
    ) {
      return null
    }

    const activeMatch = documentFindMatches[activeFindMatchIndex]
    const paragraphText = currentParagraphs[activeMatch.paragraphIndex]

    if (typeof paragraphText !== 'string') {
      return null
    }

    const matchedText = paragraphText.slice(
      activeMatch.startOffset,
      activeMatch.endOffset,
    )

    if (!matchedText) {
      return null
    }

    return {
      context: paragraphText,
      endOffset: activeMatch.endOffset,
      paragraphIndex: activeMatch.paragraphIndex,
      selectedText: matchedText,
      startOffset: activeMatch.startOffset,
    } satisfies NoteAnchor
  }, [activeFindMatchIndex, currentParagraphs, documentFindMatches])
  const addNoteAnchor = isPdfDesktopDocument
    ? isPdfPreviewOnlyFallback
      ? pdfPageAnchor
      : currentExperimentalPdfTextSelectionAnchor && pdfInteractionMode === 'text'
        ? currentExperimentalPdfTextSelectionAnchor
        : pdfInteractionMode === 'point'
          ? pdfPageAnchor
          : null
    : selectedAnchor ?? activeFindMatchAnchor
  const canAddNote = Boolean(addNoteAnchor)
  const shouldShowTextDocumentGuidanceInHeader =
    hasOpenDocument &&
    !isPdfDesktopDocument &&
    !hasValidSelection &&
    !activeFindMatchAnchor
  const selectionSummaryText = selectionMessage
    ? selectionMessage
    : isPdfDesktopDocument
      ? pendingPdfTextSelection
        ? `Selected PDF text: "${selectedPreview}"`
        : pendingPdfPointAnchor
          ? `Point note ready on page ${pendingPdfPointAnchor.pdfPageNumber ?? currentPdfPage}.`
          : 'No selection'
      : hasValidSelection
        ? `Selected: "${selectedPreview}"`
        : activeFindMatchAnchor
          ? `Current match: "${activeFindMatchAnchor.selectedText}"`
          : hasOpenDocument
            ? 'Text notes available. Select a fragment or use Find to add a note.'
            : 'No selection'
  const changedTextWarningMessage =
    statusMessages.find((status) =>
      /appears to have changed since these notes were saved/i.test(status),
    ) ?? ''
  const missingTrackingMessage =
    statusMessages.find((status) =>
      /saved before document change tracking was added/i.test(status),
    ) ?? ''

  useEffect(() => {
    currentDesktopDocumentPathRef.current =
      currentDocument.source === 'desktop-file' && currentDocument.documentPath
        ? normalizeDesktopFilePath(currentDocument.documentPath)
        : ''
  }, [currentDocument.documentPath, currentDocument.source])

  useEffect(() => {
    setExpandedPdfSidebarNoteIds([])
  }, [currentDocument.documentId])

  useEffect(() => {
    const validExpandedNoteIds = new Set(
      notes
        .filter((note) => isPdfSidebarLongNote(note.comment))
        .map((note) => note.id),
    )

    setExpandedPdfSidebarNoteIds((currentIds) =>
      currentIds.filter((noteId) => validExpandedNoteIds.has(noteId)),
    )
  }, [notes])

  useEffect(() => {
    currentPdfDocumentPathRef.current =
      isPdfDesktopDocument && currentDocument.documentPath
        ? normalizeDesktopFilePath(currentDocument.documentPath)
        : ''
    currentPdfOpenSessionKeyRef.current = pdfOpenSessionKey
    currentPdfPageRef.current = pdfCurrentPage
  }, [
    currentDocument.documentPath,
    isPdfDesktopDocument,
    pdfCurrentPage,
    pdfOpenSessionKey,
  ])

  useEffect(() => {
    if (!isPdfDesktopDocument) {
      clearScheduledPdfReadingPersist()
      pendingPdfReadingRestoreRef.current = null
      appliedPdfReadingRestoreRef.current = null
      suppressPdfReadingPersistRef.current = false
      return
    }

    return () => {
      clearScheduledPdfReadingPersist()
    }
  }, [clearScheduledPdfReadingPersist, isPdfDesktopDocument])

  useEffect(() => {
    const timing = desktopSaveStatusTimersRef.current

    const clearTimers = () => {
      if (timing.clearTimer !== null) {
        window.clearTimeout(timing.clearTimer)
        timing.clearTimer = null
      }
      if (timing.savedDelayTimer !== null) {
        window.clearTimeout(timing.savedDelayTimer)
        timing.savedDelayTimer = null
      }
    }

    const showSavedForNoticeWindow = () => {
      setDesktopVisibleSaveStatus({ message: 'Saved' })
      timing.clearTimer = window.setTimeout(() => {
        setDesktopVisibleSaveStatus((current) =>
          current?.message === 'Saved' ? null : current,
        )
        timing.clearTimer = null
      }, 2400)
    }

    if (desktopNotesStatus === 'Saving notes...') {
      clearTimers()
      timing.saveStartedAt = Date.now()
      setDesktopVisibleSaveStatus({ message: 'Saving...' })
      return
    }

    if (desktopNotesStatus.startsWith('Notes saved to:')) {
      clearTimers()
      const elapsed =
        timing.saveStartedAt === null ? 0 : Date.now() - timing.saveStartedAt
      timing.saveStartedAt = null

      if (elapsed < 350) {
        timing.savedDelayTimer = window.setTimeout(() => {
          showSavedForNoticeWindow()
          timing.savedDelayTimer = null
        }, 350 - elapsed)
      } else {
        showSavedForNoticeWindow()
      }
      return
    }

    if (
      !desktopNotesStatus ||
      desktopNotesStatus.startsWith('Notes save error:') ||
      desktopNotesStatus.startsWith('Notes are currently in memory only.') ||
      desktopNotesStatus === 'Removing notes file...' ||
      desktopNotesStatus.startsWith('Notes file removed:')
    ) {
      clearTimers()
      timing.saveStartedAt = null
      setDesktopVisibleSaveStatus(null)
    }

    return () => {
      clearTimers()
    }
  }, [desktopNotesStatus])

  useEffect(() => {
    if (!isPdfDesktopDocument || !currentDocument.documentPath) {
      pdfLoadRequestIdRef.current += 1
      pdfRenderRequestIdRef.current += 1
      clearCachedPdfDocument()
      setPdfRecoveryDiagnostic({
        dialogAccepted: null,
        recoveredLegacyPdfTextNotesCount: 0,
        recoveredNotesCount: 0,
        recoveredPdfTextNotesCount: 0,
        status: '',
      })
      setPdfRefreshDiagnostic({
        applied: false,
        blockedReason: '',
        requested: false,
      })
      setPdfTextHighlightDiagnostic({
        lastRefreshApplied: false,
        lastSaveApplied: false,
      })
      setPdfSelectionDiagnostic({
        currentTokenFound: false,
        moveActive: false,
        resetReason: '',
        spanBuilt: false,
        startRequested: false,
        startTokenFound: false,
      })
      setPdfStickyDiagnostic(initialPdfStickyDiagnosticState)
      setPdfBlobUrl('')
      return
    }

    let cancelled = false
    let nextBlobUrl = ''

    void readDesktopDocumentBytes(currentDocument.documentPath)
      .then((bytes) => {
        if (cancelled) {
          return
        }

        nextBlobUrl = URL.createObjectURL(
          new Blob([bytes], { type: 'application/pdf' }),
        )
        setPdfBlobUrl(nextBlobUrl)
      })
      .catch((error) => {
        console.error('[NoteAnchor PDF] preview load failed:', error)
        if (cancelled) {
          return
        }

        setPdfBlobUrl('')
        setDesktopOpenStatus(
          'Opened PDF, but in-app preview is unavailable. Document notes still work.',
        )
      })

    return () => {
      cancelled = true
      if (nextBlobUrl) {
        URL.revokeObjectURL(nextBlobUrl)
      }
    }
  }, [clearCachedPdfDocument, currentDocument.documentPath, isPdfDesktopDocument])

  useEffect(() => {
    if (!isPdfDesktopDocument || !currentDocument.documentPath) {
      pdfLoadRequestIdRef.current += 1
      pdfRenderRequestIdRef.current += 1
      clearCachedPdfDocument()
      setPdfNotesListFilter('all')
      setPdfCurrentPage(1)
      setPdfPageCount(1)
      setPdfPageInput('1')
      setPdfRenderedPage(null)
      setPdfPendingRender(null)
      setPdfRenderError('')
      setPdfTextTokens([])
      setPdfTextLayerStatus('pending')
      setPdfPageTextAnalysis(null)
      setPendingPdfTextSelection(null)
      pdfInteractionModeWasUserChosenRef.current = false
      setPdfInteractionMode('point')
      setPendingPdfPointAnchor(null)
      return
    }

    let cancelled = false
    const filePath = currentDocument.documentPath ?? ''
    const targetFilePath = normalizeDesktopFilePath(filePath)
    const targetSessionKey = pdfOpenSessionKey
    const loadRequestId = ++pdfLoadRequestIdRef.current
    let loadingTask: ReturnType<typeof getDocument> | null = null

    const isStaleLoadRequest = () =>
      cancelled ||
      loadRequestId !== pdfLoadRequestIdRef.current ||
      currentPdfDocumentPathRef.current !== targetFilePath ||
      currentPdfOpenSessionKeyRef.current !== targetSessionKey

    const renderControlledPdfPage = async () => {
      const isTrackingRecentPdfOpen =
        recentOpenDiagnostic.source === 'recent' &&
        recentOpenDiagnostic.normalizedPath.toLowerCase() ===
          normalizeDesktopFilePath(currentDocument.documentPath ?? '').toLowerCase()
      let failureStep = 'render setup'

      try {
        ensurePdfJsWorker()
        setPdfRenderedPage(null)
        setPdfPendingRender(null)
        setPdfRenderError('')
        setPdfTextTokens([])
        setPdfTextLayerStatus('pending')
        setPdfPageTextAnalysis(null)
        setPendingPdfTextSelection(null)
        setPendingPdfPointAnchor(null)
        window.getSelection()?.removeAllRanges()

        if (!filePath) {
          throw new Error('Current PDF file path is unavailable.')
        }

        if (isTrackingRecentPdfOpen) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            status: 'Recent open started controlled PDF render.',
          }))
        }

        failureStep = 'pdf bytes read'
        const pdfBytes = await readDesktopDocumentBytes(filePath)
        if (!cancelled && isTrackingRecentPdfOpen) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            pdfBytesLoaded: true,
            status: 'Recent open loaded PDF bytes for controlled render.',
          }))
        }
        failureStep = 'pdf document creation'
        loadingTask = getDocument({
          data: pdfBytes,
          useWorkerFetch: false,
          verbosity: 0,
        })
        pdfDocumentLoadingTaskRef.current = loadingTask
        const pdfDocument = await loadingTask.promise

        if (pdfDocumentLoadingTaskRef.current === loadingTask) {
          pdfDocumentLoadingTaskRef.current = null
        }

        if (!isStaleLoadRequest() && isTrackingRecentPdfOpen) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            pdfDocumentCreated: true,
            status: 'Recent open created the PDF document handle.',
          }))
        }
        const nextPdfPageCount = Math.max(1, pdfDocument.numPages)
        const requestedPageNumber = Math.min(
          Math.max(1, pdfCurrentPage),
          nextPdfPageCount,
        )
        const resolvedPageNumber = Math.min(
          Math.max(1, requestedPageNumber),
          nextPdfPageCount,
        )

        if (!isStaleLoadRequest()) {
          pdfDocumentProxyRef.current = pdfDocument
          pdfDocumentIdentityRef.current = {
            filePath: targetFilePath,
            sessionKey: targetSessionKey,
          }
          setPdfDocumentReadyKey(`${targetFilePath}::${targetSessionKey}`)
          setPdfPageCount(nextPdfPageCount)
          setPdfCurrentPage(resolvedPageNumber)
          setPdfPageInput(String(resolvedPageNumber))
          if (isTrackingRecentPdfOpen) {
            setRecentOpenDiagnostic((current) => ({
              ...current,
              pdfNumPagesResolved: true,
              resolvedPageCount: nextPdfPageCount,
              status: `Recent open resolved PDF page count: ${nextPdfPageCount}.`,
            }))
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown controlled PDF render error.'

        console.error('[NoteAnchor PDF] controlled render failed:', error)

        if (isStaleLoadRequest()) {
          return
        }

        setPdfRenderedPage(null)
        setPdfPendingRender(null)
        setPdfTextTokens([])
        setPdfTextLayerStatus('empty')
        setPdfPageTextAnalysis(null)
        setPendingPdfTextSelection(null)
        setPendingPdfPointAnchor(null)
        setPdfRenderError(errorMessage)
        if (
          recentOpenDiagnostic.source === 'recent' &&
          recentOpenDiagnostic.normalizedPath.toLowerCase() ===
            normalizeDesktopFilePath(currentDocument.documentPath ?? '').toLowerCase()
        ) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            failedAt: failureStep,
            status: `Recent open render failed at ${failureStep}: ${errorMessage}`,
          }))
        }
      }
    }

    void renderControlledPdfPage()

    return () => {
      cancelled = true
      if (loadingTask && pdfDocumentLoadingTaskRef.current === loadingTask) {
        pdfDocumentLoadingTaskRef.current = null
        void loadingTask.destroy().catch(() => {
          // Ignore teardown races during document replacement.
        })
      }
    }
  }, [
    clearCachedPdfDocument,
    currentDocument.documentPath,
    recentOpenDiagnostic.normalizedPath,
    recentOpenDiagnostic.source,
    pdfOpenSessionKey,
    isPdfDesktopDocument,
  ])

  useEffect(() => {
    if (!isPdfDesktopDocument || !currentDocument.documentPath) {
      return
    }

    const filePath = currentDocument.documentPath ?? ''
    const fileName = currentDocument.fileName
    const targetFilePath = normalizeDesktopFilePath(filePath)
    const targetSessionKey = pdfOpenSessionKey
    const targetReadyKey = `${targetFilePath}::${targetSessionKey}`
    const cachedPdfDocument = pdfDocumentProxyRef.current
    const cachedPdfDocumentIdentity = pdfDocumentIdentityRef.current

    if (
      !cachedPdfDocument ||
      !cachedPdfDocumentIdentity ||
      cachedPdfDocumentIdentity.filePath !== targetFilePath ||
      cachedPdfDocumentIdentity.sessionKey !== targetSessionKey ||
      pdfDocumentReadyKey !== targetReadyKey
    ) {
      return
    }

    let cancelled = false
    const pageRequestId = ++pdfLoadRequestIdRef.current
    const isTrackingRecentPdfOpen =
      recentOpenDiagnostic.source === 'recent' &&
      recentOpenDiagnostic.normalizedPath.toLowerCase() ===
        normalizeDesktopFilePath(currentDocument.documentPath ?? '').toLowerCase()

    const isStalePageRequest = (pageNumber: number) =>
      cancelled ||
      pageRequestId !== pdfLoadRequestIdRef.current ||
      currentPdfDocumentPathRef.current !== targetFilePath ||
      currentPdfOpenSessionKeyRef.current !== targetSessionKey ||
      currentPdfPageRef.current !== pageNumber

    const prepareControlledPdfPage = async () => {
      let failureStep = 'pdf page fetch'

      try {
        setPdfRenderedPage(null)
        setPdfPendingRender(null)
        setPdfRenderError('')
        setPdfTextTokens([])
        setPdfTextLayerStatus('pending')
        setPdfPageTextAnalysis(null)
        setPendingPdfTextSelection(null)
        setPendingPdfPointAnchor(null)
        window.getSelection()?.removeAllRanges()

        const nextPdfPageCount = Math.max(1, cachedPdfDocument.numPages)
        const requestedPageNumber = Math.min(
          Math.max(1, pdfCurrentPage),
          nextPdfPageCount,
        )
        const resolvedPageNumber = Math.min(
          Math.max(1, requestedPageNumber),
          nextPdfPageCount,
        )

        if (!isStalePageRequest(resolvedPageNumber)) {
          setPdfPageCount(nextPdfPageCount)
          setPdfCurrentPage(resolvedPageNumber)
          setPdfPageInput(String(resolvedPageNumber))
        }

        const page = await cachedPdfDocument.getPage(resolvedPageNumber)
        const baseViewport = page.getViewport({ scale: 1 })
        const preferredWidth = Math.max(440, pdfViewportWidth - 32)
        const scale = Math.max(0.68, Math.min(1.85, preferredWidth / baseViewport.width))
        const viewport = page.getViewport({ scale })

        if (isStalePageRequest(resolvedPageNumber)) {
          return
        }

        if (isTrackingRecentPdfOpen) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            status: `Recent open queued page ${resolvedPageNumber} for controlled render.`,
          }))
        }

        setPdfRenderedPage({
          filePath,
          height: Math.ceil(viewport.height),
          pageNumber: resolvedPageNumber,
          requestId: pageRequestId,
          sessionKey: targetSessionKey,
          width: Math.ceil(viewport.width),
        })
        setPdfPendingRender({
          fileName,
          filePath,
          page,
          pageNumber: resolvedPageNumber,
          requestId: pageRequestId,
          sessionKey: targetSessionKey,
          viewport,
        })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown controlled PDF render error.'

        console.error('[NoteAnchor PDF] controlled page fetch failed:', error)

        const pageNumberForError = Math.min(
          Math.max(1, currentPdfPage),
          Math.max(1, cachedPdfDocument.numPages),
        )

        if (isStalePageRequest(pageNumberForError)) {
          return
        }

        setPdfRenderedPage(null)
        setPdfPendingRender(null)
        setPdfTextTokens([])
        setPdfTextLayerStatus('empty')
        setPdfPageTextAnalysis(null)
        setPendingPdfTextSelection(null)
        setPendingPdfPointAnchor(null)
        setPdfRenderError(errorMessage)

        if (isTrackingRecentPdfOpen) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            failedAt: failureStep,
            status: `Recent open render failed at ${failureStep}: ${errorMessage}`,
          }))
        }
      }
    }

    void prepareControlledPdfPage()

    return () => {
      cancelled = true
    }
  }, [
    currentDocument.documentPath,
    currentDocument.fileName,
    currentPdfPage,
    isPdfDesktopDocument,
    pdfDocumentReadyKey,
    pdfOpenSessionKey,
    pdfViewportWidth,
    recentOpenDiagnostic.normalizedPath,
    recentOpenDiagnostic.source,
  ])

  useEffect(() => {
    if (
      !isPdfDesktopDocument ||
      !currentDocument.documentPath ||
      !pdfRenderedPage ||
      isPdfPreviewOnlyFallback
    ) {
      return
    }

    const pendingRestore = pendingPdfReadingRestoreRef.current
    const normalizedPath = normalizeDesktopFilePath(currentDocument.documentPath)

    if (
      !pendingRestore ||
      pendingRestore.documentPath !== normalizedPath ||
      pendingRestore.sessionKey !== pdfOpenSessionKey ||
      pendingRestore.pageNumber !== currentPdfPage
    ) {
      return
    }

    const appliedRestore = appliedPdfReadingRestoreRef.current

    if (
      appliedRestore &&
      appliedRestore.documentPath === normalizedPath &&
      appliedRestore.sessionKey === pdfOpenSessionKey
    ) {
      return
    }

    const scrollContainer = getActivePdfReadingScrollContainer()
    const pdfStageElement = pdfCurrentPageStageRef.current

    if (!scrollContainer || !pdfStageElement) {
      return
    }

    let frameId = 0

    suppressPdfReadingPersistRef.current = true
    frameId = requestAnimationFrame(() => {
      const latestScrollContainer = getActivePdfReadingScrollContainer()
      const latestPdfStageElement = pdfCurrentPageStageRef.current

      if (!latestScrollContainer || !latestPdfStageElement) {
        suppressPdfReadingPersistRef.current = false
        return
      }

      const stageRect = latestPdfStageElement.getBoundingClientRect()
      const scrollContainerRect = latestScrollContainer.getBoundingClientRect()
      const stageTopInContent =
        stageRect.top - scrollContainerRect.top + latestScrollContainer.scrollTop
      const maxScrollableOffsetWithinPage = Math.max(
        0,
        stageRect.height - latestScrollContainer.clientHeight,
      )
      const pageOffsetWithinContainer =
        Math.min(
          maxScrollableOffsetWithinPage,
          Math.max(
            0,
            pendingRestore.pageScrollRatio * maxScrollableOffsetWithinPage,
          ),
        )
      const nextScrollTop = Math.min(
        Math.max(
          0,
          stageTopInContent + pageOffsetWithinContainer,
        ),
        Math.max(
          0,
          latestScrollContainer.scrollHeight - latestScrollContainer.clientHeight,
        ),
      )

      latestScrollContainer.scrollTo({ top: nextScrollTop })
      pendingPdfReadingRestoreRef.current = null
      appliedPdfReadingRestoreRef.current = {
        documentPath: normalizedPath,
        sessionKey: pdfOpenSessionKey,
      }

      requestAnimationFrame(() => {
        suppressPdfReadingPersistRef.current = false
        schedulePdfReadingPositionPersist()
      })
    })

    return () => {
      cancelAnimationFrame(frameId)
      suppressPdfReadingPersistRef.current = false
    }
  }, [
    currentDocument.documentPath,
    currentPdfPage,
    getActivePdfReadingScrollContainer,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    pdfOpenSessionKey,
    pdfRenderedPage,
    schedulePdfReadingPositionPersist,
  ])

  useEffect(() => {
    if (
      !isPdfDesktopDocument ||
      !currentDocument.documentPath ||
      isPdfPreviewOnlyFallback
    ) {
      return
    }

    const handleScroll = () => {
      schedulePdfReadingPositionPersist()
    }

    const workspaceElement = workspaceRef.current
    const viewportHostElement = pdfViewportHostRef.current

    workspaceElement?.addEventListener('scroll', handleScroll)
    viewportHostElement?.addEventListener('scroll', handleScroll)

    return () => {
      workspaceElement?.removeEventListener('scroll', handleScroll)
      viewportHostElement?.removeEventListener('scroll', handleScroll)
    }
  }, [
    currentDocument.documentPath,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    schedulePdfReadingPositionPersist,
  ])

  useEffect(() => {
    if (
      !isPdfDesktopDocument ||
      !currentDocument.documentPath ||
      !pdfRenderedPage ||
      isPdfPreviewOnlyFallback
    ) {
      return
    }

    schedulePdfReadingPositionPersist()
  }, [
    currentDocument.documentPath,
    currentPdfPage,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    pdfRenderedPage,
    schedulePdfReadingPositionPersist,
  ])

  useEffect(() => {
    if (isPdfDesktopDocument) {
      setPdfNotesListFilter('current-page')
      return
    }

    setPdfNotesListFilter('all')
  }, [currentDocument.documentId, isPdfDesktopDocument])

  useEffect(() => {
    if (!isPdfDesktopDocument || isPdfPreviewOnlyFallback) {
      return
    }

    if (canSelectPdfTextMode) {
      if (!pdfInteractionModeWasUserChosenRef.current && pdfInteractionMode !== 'text') {
        setPdfInteractionMode('text')
        setPendingPdfPointAnchor(null)
        setSelectionMessage('')
      }
      return
    }

    if (pdfInteractionMode !== 'text') {
      return
    }

    setPdfInteractionMode('point')
    setPendingPdfTextSelection(null)
    setSelectionMessage('')
  }, [
    canSelectPdfTextMode,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    pdfInteractionMode,
  ])

  useEffect(() => {
    if (!pdfPendingRender || !pdfRenderedPage) {
      return
    }

    if (
      pdfPendingRender.requestId !== pdfRenderedPage.requestId ||
      pdfPendingRender.sessionKey !== pdfRenderedPage.sessionKey ||
      normalizeDesktopFilePath(pdfPendingRender.filePath) !==
        normalizeDesktopFilePath(pdfRenderedPage.filePath)
    ) {
      return
    }

    const canvas = pdfCanvasRef.current
    const textLayerHost = pdfTextLayerHostRef.current

    if (!canvas || !textLayerHost) {
      return
    }

    let cancelled = false
    const renderRequestId = ++pdfRenderRequestIdRef.current
    const targetFilePath = normalizeDesktopFilePath(pdfPendingRender.filePath)
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    const isStaleRenderRequest = () =>
      cancelled ||
      renderRequestId !== pdfRenderRequestIdRef.current ||
      currentPdfDocumentPathRef.current !== targetFilePath ||
      currentPdfOpenSessionKeyRef.current !== pdfPendingRender.sessionKey ||
      currentPdfPageRef.current !== pdfPendingRender.pageNumber

    // Keep the pdf.js text layer for future isolated research, but production
    // PDF notes no longer use DOM text-layer hit-testing for text-note creation.
    const textLayerBuilder = new TextLayerBuilder({
      onAppend: (div: HTMLDivElement) => {
        if (isStaleRenderRequest()) {
          return
        }
        textLayerHost.replaceChildren(div)
      },
      pdfPage: pdfPendingRender.page,
    })

    const renderPageToCanvas = async () => {
      try {
        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('Could not create a 2D canvas context for PDF rendering.')
        }

        canvas.width = Math.ceil(pdfPendingRender.viewport.width)
        canvas.height = Math.ceil(pdfPendingRender.viewport.height)
        canvas.style.width = `${Math.ceil(pdfPendingRender.viewport.width)}px`
        canvas.style.height = `${Math.ceil(pdfPendingRender.viewport.height)}px`
        textLayerHost.replaceChildren()

        renderTask = pdfPendingRender.page.render({
          canvas,
          viewport: pdfPendingRender.viewport,
        })

        await renderTask.promise

        if (isStaleRenderRequest()) {
          return
        }

        const pageTextAnalysisCacheKey = buildPdfPageTextAnalysisCacheKey(
          pdfPendingRender.filePath,
          pdfPendingRender.sessionKey,
          pdfPendingRender.pageNumber,
          pdfPendingRender.viewport.width,
          pdfPendingRender.viewport.height,
        )
        const cachedPageTextAnalysis =
          pdfPageTextAnalysisCacheRef.current.get(pageTextAnalysisCacheKey) ?? null
        let textContentItems: Array<TextItem | TextMarkedContent> = []
        let nextPageTextAnalysis: PdfPageTextAnalysisCacheEntry | null = null

        try {
          await textLayerBuilder.render({
            images: null as never,
            viewport: pdfPendingRender.viewport,
          })

          if (cachedPageTextAnalysis) {
            nextPageTextAnalysis = cachedPageTextAnalysis
          } else {
            const textContent = await pdfPendingRender.page.getTextContent({
              disableNormalization: true,
              includeMarkedContent: true,
            })
            textContentItems = textContent.items
          }
        } catch (textLayerError) {
          console.warn('[NoteAnchor PDF] text layer unavailable for rendered page:', textLayerError)
        }

        if (isStaleRenderRequest()) {
          return
        }

        if (!nextPageTextAnalysis) {
          const hasRenderableTextItems = textContentItems.some(isRenderablePdfTextItem)
          const nextTokens: PdfTextToken[] = []

          if (ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && hasRenderableTextItems) {
            const itemGeometries = textContentItems
              .filter(isRenderablePdfTextItem)
              .map((item, itemIndex) =>
                computePdfTextItemGeometry(
                  item,
                  pdfPendingRender.viewport,
                  itemIndex,
                  pdfPendingRender.pageNumber,
                ),
              )
              .filter((item): item is PdfTextItemGeometry => item !== null)
            let tokenIndex = 0

            itemGeometries.forEach((itemGeometry) => {
              const itemTokens = computePdfTextTokens(itemGeometry, tokenIndex)
              nextTokens.push(...itemTokens)
              tokenIndex += itemTokens.length
            })
          }

          nextPageTextAnalysis = {
            cacheKey: pageTextAnalysisCacheKey,
            pageNumber: pdfPendingRender.pageNumber,
            textLayerStatus:
              ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && nextTokens.length > 0
                ? 'available'
                : 'empty',
            tokens: nextTokens,
            ...computePdfPageTextAnalysis(
              nextTokens,
              pdfPendingRender.viewport.width,
              hasRenderableTextItems,
            ),
          }
          pdfPageTextAnalysisCacheRef.current.set(
            pageTextAnalysisCacheKey,
            nextPageTextAnalysis,
          )
        }

        const hasRenderableTextItems = nextPageTextAnalysis.hasRenderableTextItems
        const renderedCanvasLooksBlank = isRenderedPdfCanvasEffectivelyBlank(canvas)

        if (renderedCanvasLooksBlank && hasRenderableTextItems) {
          throw new Error(
            'Controlled PDF render produced a blank page for this document. Falling back to embedded PDF preview.',
          )
        }

        if (ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES) {
          if (!isStaleRenderRequest()) {
            setPdfTextTokens(nextPageTextAnalysis.tokens)
            setPdfTextLayerStatus(nextPageTextAnalysis.textLayerStatus)
            setPdfPageTextAnalysis(nextPageTextAnalysis)
          }
        } else if (!isStaleRenderRequest()) {
          setPdfTextTokens([])
          setPdfTextLayerStatus('empty')
          setPdfPageTextAnalysis(null)
        }

        if (isStaleRenderRequest()) {
          return
        }

        setPdfRenderError('')
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown canvas render error.'

        console.error('[NoteAnchor PDF] canvas render failed:', error)

        if (isStaleRenderRequest()) {
          return
        }

        setPdfRenderedPage(null)
        setPdfPendingRender(null)
        setPdfTextTokens([])
        setPdfTextLayerStatus('empty')
        setPdfPageTextAnalysis(null)
        setPendingPdfPointAnchor(null)
        setPdfRenderError(errorMessage)
      }
    }

    void renderPageToCanvas()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayerBuilder.cancel()
      textLayerHost.replaceChildren()
    }
  }, [
    buildPdfPageTextAnalysisCacheKey,
    computePdfPageTextAnalysis,
    pdfPendingRender,
    pdfRenderedPage,
  ])

  useEffect(() => {
    if (!isPdfDesktopDocument || !activeNote || !getPdfAnchorType(activeNote)) {
      lastSyncedActivePdfNoteRef.current = ''
      return
    }

    const nextPage = activeNote.pdfPageNumber ?? 1
    const nextPageText = String(nextPage)
    const nextSyncKey = `${activeNote.id}:${nextPage}`

    if (lastSyncedActivePdfNoteRef.current === nextSyncKey) {
      return
    }

    lastSyncedActivePdfNoteRef.current = nextSyncKey

    if (currentPdfPage !== nextPage) {
      setPdfCurrentPage(nextPage)
    }

    if (pdfPageInput !== nextPageText) {
      setPdfPageInput(nextPageText)
    }
  }, [activeNote, currentPdfPage, isPdfDesktopDocument, pdfPageInput])

  const navigatePdfPage = useCallback((direction: -1 | 1) => {
    if (!isPdfDesktopDocument) {
      return
    }

    const nextPage = Math.min(
      Math.max(1, currentPdfPage + direction),
      Math.max(1, pdfPageCount),
    )

    if (nextPage === currentPdfPage) {
      return
    }

    pendingPdfReadingRestoreRef.current = null
    appliedPdfReadingRestoreRef.current = null
    suppressPdfReadingPersistRef.current = false
    resetPdfReadingScrollContainers()
    setPdfCurrentPage(nextPage)
    setPdfPageInput(String(nextPage))
  }, [
    currentPdfPage,
    isPdfDesktopDocument,
    pdfPageCount,
    resetPdfReadingScrollContainers,
  ])

  const applyPdfPageJump = useCallback(() => {
    if (!isPdfDesktopDocument) {
      return
    }

    if (!Number.isInteger(parsedPdfPageInput)) {
      setPdfPageInput(String(currentPdfPage))
      return
    }

    const clampedPage = Math.min(
      Math.max(1, parsedPdfPageInput),
      Math.max(1, pdfPageCount),
    )

    pendingPdfReadingRestoreRef.current = null
    appliedPdfReadingRestoreRef.current = null
    suppressPdfReadingPersistRef.current = false
    resetPdfReadingScrollContainers()
    setPdfCurrentPage(clampedPage)
    setPdfPageInput(String(clampedPage))
  }, [
    currentPdfPage,
    isPdfDesktopDocument,
    parsedPdfPageInput,
    pdfPageCount,
    resetPdfReadingScrollContainers,
  ])

  const handlePdfPageInputBlur = useCallback(() => {
    pdfPageSpinIntentRef.current = false

    if (!isPdfDesktopDocument) {
      return
    }

    applyPdfPageJump()
  }, [applyPdfPageJump, isPdfDesktopDocument])

  const handlePdfPageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setPdfPageInput(nextValue)

    if (!isPdfDesktopDocument || !pdfPageSpinIntentRef.current) {
      return
    }

    pdfPageSpinIntentRef.current = false

    const parsedNextPage = Number.parseInt(nextValue, 10)

    if (!Number.isInteger(parsedNextPage)) {
      return
    }

    const clampedPage = Math.min(
      Math.max(1, parsedNextPage),
      Math.max(1, pdfPageCount),
    )

    setPdfCurrentPage(clampedPage)
    setPdfPageInput(String(clampedPage))
  }, [isPdfDesktopDocument, pdfPageCount])

  const handlePdfPageInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      pdfPageSpinIntentRef.current = false
      navigatePdfPage(event.key === 'ArrowUp' ? 1 : -1)
      return
    }

    pdfPageSpinIntentRef.current = false

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    applyPdfPageJump()
  }, [applyPdfPageJump, navigatePdfPage])

  const handlePdfPageInputPointerDown = useCallback((
    event: ReactPointerEvent<HTMLInputElement>,
  ) => {
    const target = event.currentTarget
    const bounds = target.getBoundingClientRect()
    const spinnerZoneWidth = 22

    pdfPageSpinIntentRef.current = event.clientX >= bounds.right - spinnerZoneWidth
  }, [])

  const buildPendingPdfTextSelection = useCallback(
    (tokens: PdfTextToken[]): PendingPdfTextSelection | null => {
      if (!pdfRenderedPage || !tokens.length) {
        return null
      }

      const orderedTokens = [...tokens].sort((left, right) => left.index - right.index)
      const firstToken = orderedTokens[0]
      const lastToken = orderedTokens[orderedTokens.length - 1]
      const tokenKeys = orderedTokens.map((token) => getPdfTextTokenKey(token))
      const selectedText = normalizeExperimentalPdfSelectedText(
        orderedTokens.map((token) => token.text).join(' '),
      )

      if (!selectedText) {
        return null
      }

      const topMostToken = orderedTokens.reduce((bestToken, token) => {
        if (!bestToken) {
          return token
        }

        if (token.y !== bestToken.y) {
          return token.y < bestToken.y ? token : bestToken
        }

        if (token.x !== bestToken.x) {
          return token.x < bestToken.x ? token : bestToken
        }

        return token.index < bestToken.index ? token : bestToken
      }, null as PdfTextToken | null)

      const anchor: NoteAnchor = {
        anchorType: 'text',
        context: `PDF page ${pdfRenderedPage.pageNumber}: ${selectedText}`,
        documentType: 'pdf',
        endOffset: lastToken.index + 1,
        pageHeight: pdfRenderedPage.height,
        pageWidth: pdfRenderedPage.width,
        paragraphIndex: Math.max(0, pdfRenderedPage.pageNumber - 1),
        pdfHighlightRects: orderedTokens.map((token) => ({
          heightRatio: token.height / pdfRenderedPage.height,
          widthRatio: token.width / pdfRenderedPage.width,
          xRatio: token.x / pdfRenderedPage.width,
          yRatio: token.y / pdfRenderedPage.height,
        })),
        pdfPageNumber: pdfRenderedPage.pageNumber,
        pdfSelectionKey: getPdfTextSelectionKey(pdfRenderedPage.pageNumber, tokenKeys),
        pdfTextAnchorItemIndex: topMostToken?.itemIndex,
        pdfTextAnchorLeftRatio:
          topMostToken ? topMostToken.x / pdfRenderedPage.width : undefined,
        pdfTextAnchorTopRatio:
          topMostToken ? topMostToken.y / pdfRenderedPage.height : undefined,
        pdfTextAnchorTokenIndex: topMostToken?.index,
        selectedText,
        startOffset: firstToken.index,
      }

      return {
        anchor,
        tokenKeys,
      }
    },
    [pdfRenderedPage],
  )

  const commitPendingPdfTextSelection = useCallback(
    (nextSelection: PendingPdfTextSelection | null, message = '') => {
      setPendingPdfTextSelection(nextSelection)
      setSelectionMessage(message)
      setPendingPdfPointAnchor(null)

      if (!nextSelection) {
        setSelectedText('')
        setSelectedAnchor(null)
        return
      }

      setSelectedText(nextSelection.anchor.selectedText)
      setSelectedAnchor(nextSelection.anchor)
    },
    [],
  )

  const clearTemporarySelectionState = useCallback(() => {
    setSelectedText('')
    setSelectedAnchor(null)
    setSelectionMessage('')
    setPendingPdfTextSelection(null)
  }, [])

  const clearNativeSelection = useCallback((clearNativeSelectionLater = false) => {
    window.getSelection()?.removeAllRanges()

    if (clearNativeSelectionLater) {
      requestAnimationFrame(() => {
        window.getSelection()?.removeAllRanges()
      })
    }
  }, [])

  const clearTemporarySelection = useCallback((clearNativeSelectionLater = false) => {
    clearTemporarySelectionState()
    clearNativeSelection(clearNativeSelectionLater)
  }, [clearNativeSelection, clearTemporarySelectionState])

  const handlePdfPointCanvasClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES &&
        pdfInteractionMode === 'text'
      ) {
        return
      }

      if (!pdfRenderedPage) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const xRatio = rect.width > 0 ? x / rect.width : 0
      const yRatio = rect.height > 0 ? y / rect.height : 0
      const nextAnchor = createPdfPointAnchor({
        pageHeight: pdfRenderedPage.height,
        pageNumber: pdfRenderedPage.pageNumber,
        pageWidth: pdfRenderedPage.width,
        x,
        xRatio,
        y,
        yRatio,
      })

      setPendingDeleteNoteId(null)
      setPendingPdfPointAnchor(nextAnchor)
      setEditingNoteId(null)
      setEditorAnchor(nextAnchor)
      setEditorSelectedText('')
      setNoteDraft('')
      setIsEditorOpen(true)
      setDesktopOpenStatus(
        `Point selected on PDF page ${pdfRenderedPage.pageNumber}. Add a comment to save the note.`,
      )
      clearTemporarySelection(true)
    },
    [clearTemporarySelection, pdfInteractionMode, pdfRenderedPage],
  )

  const handlePdfPointMarkerActivate = useCallback((
    event: ReactMouseEvent<HTMLDivElement>,
    noteId: number,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setPendingPdfPointAnchor(null)
    clearTemporarySelection(true)
    activateNote(noteId, true)
  }, [clearTemporarySelection])

  const handlePdfTextModeChange = useCallback((nextMode: 'point' | 'text') => {
    if (isPdfPreviewOnlyFallback) {
      setDesktopOpenStatus(previewOnlyPdfNotesMessage)
      return
    }

    if (nextMode === 'point') {
      if (!canUsePdfPointNotes) {
        setDesktopOpenStatus('Point notes are unavailable until the PDF page is rendered.')
        return
      }

      pdfInteractionModeWasUserChosenRef.current = true
      setPdfInteractionMode(nextMode)
      setPendingDeleteNoteId(null)
      clearTemporarySelection(true)
      setDesktopOpenStatus(
        canSelectPdfTextMode
          ? `Point mode selected. Click the page to place a point note, or switch to Text mode for fragment notes.`
          : canUsePdfTextNotes
            ? experimentalPdfTextLayoutGuardMessage
            : 'Point mode selected. Click the page to place a point note.',
      )
      return
    }

    if (!canSelectPdfTextMode) {
      setPendingPdfPointAnchor(null)
      setDesktopOpenStatus(
        isPdfTextPageLayoutGuarded
          ? experimentalPdfTextLayoutGuardMessage
          : canUsePdfPointNotes
            ? 'This rendered PDF page has no selectable text layer. Use Point mode or Add note for page notes.'
            : 'Text notes are unavailable until the PDF page is rendered.',
      )
      return
    }

    pdfInteractionModeWasUserChosenRef.current = true
    setPdfInteractionMode(nextMode)
    setPendingDeleteNoteId(null)
    setPendingPdfPointAnchor(null)
    setSelectionMessage('')
    setDesktopOpenStatus(
      isPdfTextPageLayoutGuarded
        ? experimentalPdfTextLayoutGuardMessage
        : isPdfTextSingleLineOnlyLayout
          ? singleLineOnlyPdfTextMessage
        : `PDF text-note mode is active on page ${currentPdfPage}. Drag across up to five adjacent lines to select a fragment.`,
    )
  }, [
    canSelectPdfTextMode,
    canUsePdfPointNotes,
    canUsePdfTextNotes,
    clearTemporarySelection,
    currentPdfPage,
    experimentalPdfTextLayoutGuardMessage,
    isPdfPreviewOnlyFallback,
    isPdfTextPageLayoutGuarded,
    isPdfTextSingleLineOnlyLayout,
  ])

  const handlePdfTextSelectionPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    setPdfSelectionDiagnostic({
      currentTokenFound: false,
      moveActive: false,
      resetReason: '',
      spanBuilt: false,
      startRequested: true,
      startTokenFound: false,
    })

    if (
      !ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES ||
      pdfInteractionMode !== 'text' ||
      event.button !== 0 ||
      !pdfTokenLines.length
    ) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: 'Text mode is inactive or no PDF text tokens are available.',
      }))
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const line = findNearestPdfTokenLine(pdfTokenLines, point.y)

    if (!line) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: 'No nearest text line was found at pointer down.',
      }))
      return
    }

    if (
      isPdfTextPageLayoutGuarded ||
      pdfSuspiciousTextLineIds.has(line.lineId)
    ) {
      event.preventDefault()
      clearNativeSelection(true)
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: experimentalPdfTextLayoutGuardMessage,
      }))
      commitPendingPdfTextSelection(null, experimentalPdfTextLayoutGuardMessage)
      return
    }

    const token = findIntersectingPdfTokenInLine(line, point)

    if (!token) {
      clearTemporarySelection(true)
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: 'Pointer down did not hit a text token.',
      }))
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    clearNativeSelection(true)
    setPendingPdfPointAnchor(null)
    const lineIndex = pdfTokenLines.findIndex((currentLine) => currentLine.lineId === line.lineId)
    pdfTextDragStateRef.current = {
      hasMoved: false,
      pointerId: event.pointerId,
      startPoint: point,
      startLineIndex: lineIndex,
      startLineId: line.lineId,
      startTokenKey: getPdfTextTokenKey(token),
    }
    setPdfSelectionDiagnostic((current) => ({
      ...current,
      resetReason: '',
      spanBuilt: false,
      startTokenFound: true,
    }))
  }, [
    clearTemporarySelection,
    clearNativeSelection,
    commitPendingPdfTextSelection,
    isPdfTextPageLayoutGuarded,
    pdfInteractionMode,
    pdfSuspiciousTextLineIds,
    pdfTokenLines,
  ])

  const handlePdfTextSelectionPointerMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      !ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES ||
      pdfInteractionMode !== 'text' ||
      !pdfTextDragStateRef.current ||
      pdfTextDragStateRef.current.pointerId !== event.pointerId
    ) {
      return
    }

    setPdfSelectionDiagnostic((current) => ({
      ...current,
      moveActive: true,
    }))

    const rect = event.currentTarget.getBoundingClientRect()
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const dragDistance = Math.hypot(
      point.x - pdfTextDragStateRef.current.startPoint.x,
      point.y - pdfTextDragStateRef.current.startPoint.y,
    )

    if (dragDistance < 4) {
      return
    }

    pdfTextDragStateRef.current.hasMoved = true
    const line = findNearestPdfTokenLine(pdfTokenLines, point.y)
    const anchoredLineIndex = pdfTextDragStateRef.current.startLineIndex
    const anchoredLine =
      anchoredLineIndex >= 0 ? pdfTokenLines[anchoredLineIndex] ?? null : null

    if (!line || !anchoredLine) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: 'Pointer move did not resolve to a current text line.',
      }))
      return
    }

    const currentLineIndex = pdfTokenLines.findIndex(
      (currentLine) => currentLine.lineId === line.lineId,
    )
    const linesSpannedCount = Math.abs(currentLineIndex - anchoredLineIndex) + 1

    if (
      isPdfTextPageLayoutGuarded ||
      pdfSuspiciousTextLineIds.has(line.lineId) ||
      pdfSuspiciousTextLineIds.has(anchoredLine.lineId)
    ) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: experimentalPdfTextLayoutGuardMessage,
      }))
      commitPendingPdfTextSelection(null, experimentalPdfTextLayoutGuardMessage)
      return
    }

    if (isPdfTextSingleLineOnlyLayout && linesSpannedCount > 1) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: singleLineOnlyPdfTextMessage,
      }))
      commitPendingPdfTextSelection(null, singleLineOnlyPdfTextMessage)
      return
    }

    if (linesSpannedCount > experimentalPdfTextSelectionLineLimit) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: 'Selection exceeded the current five-line limit.',
      }))
      commitPendingPdfTextSelection(
        null,
        'PDF text notes currently support up to five adjacent lines on the rendered page.',
      )
      return
    }

    const involvedLines =
      currentLineIndex >= anchoredLineIndex
        ? pdfTokenLines.slice(anchoredLineIndex, currentLineIndex + 1)
        : pdfTokenLines.slice(currentLineIndex, anchoredLineIndex + 1)

    if (involvedLines.some((currentLine) => pdfSuspiciousTextLineIds.has(currentLine.lineId))) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        resetReason: experimentalPdfTextLayoutGuardMessage,
      }))
      commitPendingPdfTextSelection(null, experimentalPdfTextLayoutGuardMessage)
      return
    }

    const startIndex = anchoredLine.tokens.findIndex(
      (token) => getPdfTextTokenKey(token) === pdfTextDragStateRef.current?.startTokenKey,
    )
    const endToken = findIntersectingPdfTokenInLine(line, point)

    if (startIndex < 0 || !endToken) {
      if (!endToken) {
        commitPendingPdfTextSelection(null)
      }
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        currentTokenFound: Boolean(endToken),
        resetReason: startIndex < 0
          ? 'The saved start token was lost before selection move completed.'
          : 'Pointer move did not hit a text token.',
      }))
      return
    }

    const endIndex = line.tokens.findIndex(
      (token) => getPdfTextTokenKey(token) === getPdfTextTokenKey(endToken),
    )

    if (endIndex < 0) {
      setPdfSelectionDiagnostic((current) => ({
        ...current,
        currentTokenFound: true,
        resetReason: 'Current token could not be matched inside the active line.',
      }))
      return
    }

    const isSingleLine = linesSpannedCount === 1
    const isTwoLine = linesSpannedCount === 2
    const isThreeLine = linesSpannedCount === 3
    const isFourOrFiveLine = linesSpannedCount >= 4 && linesSpannedCount <= experimentalPdfTextSelectionLineLimit
    const isForwardAcrossLines = currentLineIndex >= anchoredLineIndex
    const [rangeStart, rangeEnd] =
      startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
    const middleLineTokens = isSingleLine || isTwoLine
      ? []
      : isForwardAcrossLines
        ? pdfTokenLines
            .slice(anchoredLineIndex + 1, currentLineIndex)
            .flatMap((lineCluster) => lineCluster.tokens)
        : pdfTokenLines
            .slice(currentLineIndex + 1, anchoredLineIndex)
            .flatMap((lineCluster) => lineCluster.tokens)
    const rangeTokens = isSingleLine
      ? anchoredLine.tokens.slice(rangeStart, rangeEnd + 1)
      : isTwoLine
        ? isForwardAcrossLines
          ? [
              ...anchoredLine.tokens.slice(startIndex),
              ...line.tokens.slice(0, endIndex + 1),
            ]
          : [
              ...line.tokens.slice(endIndex),
              ...anchoredLine.tokens.slice(0, startIndex + 1),
            ]
        : isForwardAcrossLines
          ? [
              ...anchoredLine.tokens.slice(startIndex),
              ...middleLineTokens,
              ...line.tokens.slice(0, endIndex + 1),
            ]
          : [
              ...line.tokens.slice(endIndex),
              ...middleLineTokens,
              ...anchoredLine.tokens.slice(0, startIndex + 1),
            ]

    const nextSelection = buildPendingPdfTextSelection(rangeTokens)
    setPdfSelectionDiagnostic((current) => ({
      ...current,
      currentTokenFound: true,
      resetReason: nextSelection ? '' : 'Selection span was built, but anchor generation returned empty.',
      spanBuilt: rangeTokens.length > 0 && Boolean(nextSelection),
    }))
    const nextMessage = isSingleLine
      ? ''
      : isTwoLine
        ? 'Two-line PDF text selection ready.'
        : isThreeLine
          ? 'Three-line PDF text selection ready.'
          : isFourOrFiveLine
            ? `PDF text selection across ${linesSpannedCount} lines ready.`
            : ''

    commitPendingPdfTextSelection(nextSelection, nextMessage)
  }, [
    buildPendingPdfTextSelection,
    commitPendingPdfTextSelection,
    isPdfTextPageLayoutGuarded,
    isPdfTextSingleLineOnlyLayout,
    pdfInteractionMode,
    pdfSuspiciousTextLineIds,
    pdfTokenLines,
  ])

  const handlePdfTextSelectionPointerEnd = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      !pdfTextDragStateRef.current ||
      pdfTextDragStateRef.current.pointerId !== event.pointerId
    ) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (!pdfTextDragStateRef.current.hasMoved) {
      commitPendingPdfTextSelection(null)
      clearNativeSelection(true)
    }

    pdfTextDragStateRef.current = null
    setPdfSelectionDiagnostic((current) => ({
      ...current,
      moveActive: false,
    }))
  }, [clearNativeSelection, commitPendingPdfTextSelection])

  const clampModalPosition = useCallback((left: number, top: number) => {
    const modalElement = modalRef.current
    const viewportPadding = 16
    const toolbarGap = 8
    const modalWidth = modalElement?.offsetWidth ?? 440
    const modalHeight = modalElement?.offsetHeight ?? 360
    const topBarHeight = topBarRef.current?.offsetHeight ?? 0
    const minTop = Math.max(viewportPadding, topBarHeight + toolbarGap)
    const maxLeft = Math.max(viewportPadding, window.innerWidth - modalWidth - viewportPadding)
    const maxTop = Math.max(minTop, window.innerHeight - modalHeight - viewportPadding)

    return {
      left: Math.min(Math.max(viewportPadding, left), maxLeft),
      top: Math.min(Math.max(minTop, top), maxTop),
    }
  }, [])

  const closeNoteEditor = useCallback(() => {
    setIsEditorOpen(false)
    setEditingNoteId(null)
    setEditorAnchor(null)
    setEditorSelectedText('')
    setNoteDraft('')
    setPendingPdfPointAnchor(null)
    setModalPosition(null)
    setIsDraggingEditor(false)
    modalDragOffsetRef.current = null
  }, [])

  const closeDeleteNotesConfirm = useCallback(() => {
    setIsDeleteNotesConfirmOpen(false)
    setDeleteNotesConfirmText('')
  }, [])

  const closeHelp = useCallback(() => {
    setIsHelpOpen(false)
  }, [])

  const closePrintPreview = useCallback(() => {
    setPrintPreview(null)
    setPrintSaveFeedback(null)
    setIsPrintSavePending(false)
  }, [])

  useLayoutEffect(() => {
    if (!isEditorOpen) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      const modalElement = modalRef.current

      if (!modalElement) {
        return
      }

      const nextLeft = (window.innerWidth - modalElement.offsetWidth) / 2
      const nextTop = (window.innerHeight - modalElement.offsetHeight) / 2
      setModalPosition(clampModalPosition(nextLeft, nextTop))
    })

    return () => cancelAnimationFrame(frameId)
  }, [clampModalPosition, isEditorOpen, editingNoteId])

  useEffect(() => {
    if (!isDraggingEditor) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragOffset = modalDragOffsetRef.current

      if (!dragOffset) {
        return
      }

      setModalPosition(
        clampModalPosition(
          event.clientX - dragOffset.x,
          event.clientY - dragOffset.y,
        ),
      )
    }

    const handlePointerUp = () => {
      setIsDraggingEditor(false)
      modalDragOffsetRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [clampModalPosition, isDraggingEditor])

  useLayoutEffect(() => {
    const topBarElement = topBarRef.current

    if (!topBarElement) {
      return
    }

    const updateTopBarHeight = () => {
      setTopBarHeight(topBarElement.offsetHeight)
    }

    updateTopBarHeight()

    const resizeObserver = new ResizeObserver(() => {
      updateTopBarHeight()
    })

    resizeObserver.observe(topBarElement)
    window.addEventListener('resize', updateTopBarHeight)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateTopBarHeight)
    }
  }, [])

  useLayoutEffect(() => {
    if (!isPdfDesktopDocument) {
      return
    }

    const viewportHostElement = pdfViewportHostRef.current

    if (!viewportHostElement) {
      return
    }

    const updatePdfViewportWidth = () => {
      const nextWidth = Math.floor(viewportHostElement.clientWidth)

      if (nextWidth > 0) {
        setPdfViewportWidth((currentWidth) =>
          currentWidth === nextWidth ? currentWidth : nextWidth,
        )
      }
    }

    updatePdfViewportWidth()

    const resizeObserver = new ResizeObserver(() => {
      updatePdfViewportWidth()
    })

    resizeObserver.observe(viewportHostElement)
    window.addEventListener('resize', updatePdfViewportWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updatePdfViewportWidth)
    }
  }, [isPdfDesktopDocument])

  useLayoutEffect(() => {
    if (!isPdfDesktopDocument) {
      setPdfStickyDiagnostic(initialPdfStickyDiagnosticState)
      return
    }

    const workspaceElement = workspaceRef.current
    const documentViewerElement = documentViewerRef.current
    const documentPageElement = documentRef.current
    const pdfPageControlsElement = pdfPageControlsRef.current
    const topBarElement = topBarRef.current

    if (
      !workspaceElement ||
      !documentViewerElement ||
      !documentPageElement ||
      !pdfPageControlsElement
    ) {
      return
    }

    const updateStickyDiagnostic = () => {
      const workspaceStyles = window.getComputedStyle(workspaceElement)
      const viewerStyles = window.getComputedStyle(documentViewerElement)
      const pageStyles = window.getComputedStyle(documentPageElement)
      const controlsStyles = window.getComputedStyle(pdfPageControlsElement)
      const controlsRect = pdfPageControlsElement.getBoundingClientRect()
      const topBarRect = topBarElement?.getBoundingClientRect() ?? null

      setPdfStickyDiagnostic({
        gapToTopBar: topBarRect ? Math.round(controlsRect.top - topBarRect.bottom) : null,
        pagePaddingTop: pageStyles.paddingTop,
        scrollContainer: 'workspace',
        stickyHost:
          documentPageElement.className || documentPageElement.tagName.toLowerCase(),
        stickyTop: controlsStyles.top,
        stickyViewportTop: Math.round(controlsRect.top),
        topBarBottom: topBarRect ? Math.round(topBarRect.bottom) : null,
        viewerPaddingTop: viewerStyles.paddingTop || workspaceStyles.paddingTop,
        workspaceScrollTop: Math.round(workspaceElement.scrollTop),
      })
    }

    updateStickyDiagnostic()

    const resizeObserver = new ResizeObserver(() => {
      updateStickyDiagnostic()
    })

    resizeObserver.observe(workspaceElement)
    resizeObserver.observe(documentViewerElement)
    resizeObserver.observe(documentPageElement)
    resizeObserver.observe(pdfPageControlsElement)
    if (topBarElement) {
      resizeObserver.observe(topBarElement)
    }

    workspaceElement.addEventListener('scroll', updateStickyDiagnostic, { passive: true })
    window.addEventListener('resize', updateStickyDiagnostic)

    return () => {
      resizeObserver.disconnect()
      workspaceElement.removeEventListener('scroll', updateStickyDiagnostic)
      window.removeEventListener('resize', updateStickyDiagnostic)
    }
  }, [isPdfDesktopDocument, pdfRenderedPage, topBarHeight])

  useEffect(() => {
    if (!isEditorOpen || !modalPosition) {
      return
    }

    const handleResize = () => {
      setModalPosition((currentPosition) =>
        currentPosition
          ? clampModalPosition(currentPosition.left, currentPosition.top)
          : currentPosition,
      )
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [clampModalPosition, isEditorOpen, modalPosition])

  const resetDocumentNotes = useCallback(() => {
    setNotes([])
    setActiveNoteId(null)
    setConnectorLines([])
    setNoteCardPositions([])
    setNoteListHeight(0)
    setSelectedText('')
    setSelectedAnchor(null)
    setSelectionMessage('')
    setIsNotesListOpen(false)
    setDocumentSearchText('')
    setActiveFindMatchIndex(-1)
    setIsDeleteNotesConfirmOpen(false)
    setDeleteNotesConfirmText('')
    setModalPosition(null)
    setIsDraggingEditor(false)
    setPendingNoteOpenScroll(null)
    highlightRefs.current.clear()
    noteCardRefs.current.clear()
    findMatchRefs.current.clear()
    window.getSelection()?.removeAllRanges()
    modalDragOffsetRef.current = null
    closeNoteEditor()
  }, [closeNoteEditor])

  const updateSelectedText = useCallback(() => {
    if (isEditorOpen) {
      return
    }

    const documentElement = documentRef.current
    const selection = window.getSelection()

    if (!documentElement || !selection || selection.isCollapsed) {
      clearTemporarySelectionState()
      return
    }

    const selected = selection.toString().trim()
    const range = selection.getRangeAt(0)

    const getParagraphElement = (node: Node | null) => {
      if (!node) {
        return null
      }

      const element =
        node instanceof Element
          ? node
          : node.parentNode instanceof Element
            ? node.parentNode
            : null

      return element?.closest<HTMLParagraphElement>('[data-paragraph-index]') ?? null
    }

    const startParagraph = getParagraphElement(range.startContainer)
    const endParagraph = getParagraphElement(range.endContainer)

    if (!startParagraph || !endParagraph || !documentElement.contains(startParagraph)) {
      clearTemporarySelectionState()
      return
    }

    if (startParagraph !== endParagraph) {
      setSelectedText('')
      setSelectedAnchor(null)
      setSelectionMessage('Please select text within one paragraph.')
      return
    }

    const paragraphIndex = Number(startParagraph.dataset.paragraphIndex)

    if (!Number.isInteger(paragraphIndex)) {
      clearTemporarySelectionState()
      return
    }

    const startRange = range.cloneRange()
    startRange.selectNodeContents(startParagraph)
    startRange.setEnd(range.startContainer, range.startOffset)

    const endRange = range.cloneRange()
    endRange.selectNodeContents(startParagraph)
    endRange.setEnd(range.endContainer, range.endOffset)

    let startOffset = startRange.toString().length
    let endOffset = endRange.toString().length
    const paragraphText = currentParagraphs[paragraphIndex]

    while (startOffset < endOffset && /\s/.test(paragraphText[startOffset])) {
      startOffset += 1
    }

    while (endOffset > startOffset && /\s/.test(paragraphText[endOffset - 1])) {
      endOffset -= 1
    }

    const anchoredText = paragraphText.slice(startOffset, endOffset)

    if (selected && anchoredText) {
      setSelectedText(anchoredText)
      setSelectedAnchor({
        paragraphIndex,
        startOffset,
        endOffset,
        selectedText: anchoredText,
        context: paragraphText,
      })
      setSelectionMessage('')
      return
    }

    clearTemporarySelectionState()
  }, [clearTemporarySelectionState, currentParagraphs, isEditorOpen])

  useEffect(() => {
    if (isPdfDesktopDocument) {
      return
    }

    const handleSelectionChange = () => {
      requestAnimationFrame(updateSelectedText)
    }

    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [isPdfDesktopDocument, updateSelectedText])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target

      if (!(target instanceof Node)) {
        return
      }

      const clickedDocument = documentRef.current?.contains(target)
      const clickedActions = selectionActionsRef.current?.contains(target)
      const clickedPdfToolbar = pdfToolbarRef.current?.contains(target)
      const clickedMarginNotes = marginNotesRef.current?.contains(target)
      const clickedModal = modalRef.current?.contains(target)

      if (
        clickedDocument &&
        !clickedActions &&
        !clickedPdfToolbar &&
        !clickedMarginNotes &&
        !clickedModal &&
        !isPdfDesktopDocument
      ) {
        clearTemporarySelectionState()
      }

      if (
        !clickedDocument &&
        !clickedActions &&
        !clickedPdfToolbar &&
        !clickedMarginNotes &&
        !clickedModal
      ) {
        setPdfSelectionDiagnostic((current) => ({
          ...current,
          currentTokenFound: false,
          moveActive: false,
          resetReason: 'Selection was cleared by a global outside click.',
          spanBuilt: false,
        }))
        clearTemporarySelection()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [clearTemporarySelection, clearTemporarySelectionState, isPdfDesktopDocument])

  useEffect(() => {
    if (!isHelpOpen && !printPreview) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (printPreview) {
        closePrintPreview()
        return
      }

      closeHelp()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeHelp, closePrintPreview, isHelpOpen, printPreview])

  const updateConnectorLines = useCallback(() => {
    if (isPdfDesktopDocument) {
      setConnectorLines([])
      setWorkspaceCanvasSize({
        height: 0,
        width: 0,
      })
      return
    }

    const workspaceElement = workspaceRef.current

    if (!workspaceElement) {
      setConnectorLines([])
      setWorkspaceCanvasSize({
        height: 0,
        width: 0,
      })
      return
    }

    const workspaceRect = workspaceElement.getBoundingClientRect()
    const scrollLeft = workspaceElement.scrollLeft
    const scrollTop = workspaceElement.scrollTop
    const activeNote = activeNoteId === null
      ? null
      : notes.find((note) => note.id === activeNoteId) ?? null

    const nextLines =
      activeNote === null
        ? []
        : (() => {
            const highlightElement = highlightRefs.current.get(activeNote.id)
            const cardElement = noteCardRefs.current.get(activeNote.id)

            if (!highlightElement || !cardElement) {
              return []
            }

            const highlightRect = highlightElement.getBoundingClientRect()
            const cardRect = cardElement.getBoundingClientRect()

            return [
              {
                id: activeNote.id,
                x1: highlightRect.right - workspaceRect.left + scrollLeft,
                y1:
                  highlightRect.top +
                  highlightRect.height / 2 -
                  workspaceRect.top +
                  scrollTop,
                x2: cardRect.left - workspaceRect.left + scrollLeft,
                y2: cardRect.top + 18 - workspaceRect.top + scrollTop,
              },
            ]
          })()

    setWorkspaceCanvasSize({
      height: Math.max(workspaceElement.clientHeight, workspaceElement.scrollHeight),
      width: Math.max(workspaceElement.clientWidth, workspaceElement.scrollWidth),
    })
    setConnectorLines(nextLines)
  }, [activeNoteId, isPdfDesktopDocument, notes])

  const updateMarginCardPositions = useCallback(() => {
    if (isPdfDesktopDocument) {
      setNoteCardPositions([])
      setNoteListHeight(0)
      return
    }

    const marginElement = marginNotesRef.current

    if (!marginElement) {
      setNoteCardPositions([])
      setNoteListHeight(0)
      return
    }

    const marginRect = marginElement.getBoundingClientRect()
    const marginStyle = window.getComputedStyle(marginElement)
    const marginPaddingLeft = Number.parseFloat(marginStyle.paddingLeft) || 0
    const marginPaddingRight = Number.parseFloat(marginStyle.paddingRight) || 0
    const marginPaddingTop = Number.parseFloat(marginStyle.paddingTop) || 0
    const availableWidth = Math.max(
      0,
      marginElement.clientWidth - marginPaddingLeft - marginPaddingRight,
    )
    const nextPositions: NoteCardPosition[] = []
    const overlapGap = 8
    const connectorAttachOffset = 18
    const activeCardLift = 30

    const paragraphTopByIndex = new Map<number, number>()

    currentParagraphs.forEach((_, paragraphIndex) => {
      const paragraphElement = documentRef.current?.querySelector<HTMLElement>(
        `[data-paragraph-index="${paragraphIndex}"]`,
      )

      if (!paragraphElement) {
        return
      }

      const paragraphRect = paragraphElement.getBoundingClientRect()
      paragraphTopByIndex.set(
        paragraphIndex,
        paragraphRect.top - marginRect.top + marginPaddingTop,
      )
    })

    const sortedParagraphTops = [...paragraphTopByIndex.entries()].sort(
      (first, second) => first[0] - second[0],
    )
    const getApproximateParagraphTop = (paragraphIndex: number) => {
      const exactTop = paragraphTopByIndex.get(paragraphIndex)

      if (typeof exactTop === 'number') {
        return exactTop
      }

      if (!sortedParagraphTops.length) {
        return 0
      }

      const nearestEarlier = [...sortedParagraphTops]
        .reverse()
        .find(([index]) => index <= paragraphIndex)

      if (nearestEarlier) {
        return nearestEarlier[1]
      }

      return sortedParagraphTops[0][1]
    }

    const measuredCards = notesInDocumentOrder
      .map((note) => {
        const resolvedAnchor = resolvedAnchorsById.get(note.id)
        const highlightElement = highlightRefs.current.get(note.id)
        const cardElement = noteCardRefs.current.get(note.id)
        const cardHeight = cardElement?.getBoundingClientRect().height || 96
        const highlightRect = highlightElement?.getBoundingClientRect()
        const paragraphTop = getApproximateParagraphTop(
          resolvedAnchor?.paragraphIndex ?? note.paragraphIndex,
        )
        const baseTargetTop = highlightRect
          ? highlightRect.top +
              highlightRect.height / 2 -
              marginRect.top +
              marginPaddingTop -
              connectorAttachOffset
          : paragraphTop
        const targetTop =
          note.id === activeNoteId ? baseTargetTop - activeCardLift : baseTargetTop

        return {
          hasHighlight: Boolean(highlightRect),
          targetTop,
          height: cardHeight,
          id: note.id,
        }
      })
      .sort((first, second) => first.targetTop - second.targetTop)

    const placeSequentially = (
      cards: typeof measuredCards,
      startTop = 0,
    ) => {
      const placements = new Map<number, number>()
      let previousBottom = startTop

      cards.forEach((card) => {
        const top = Math.max(0, card.targetTop, previousBottom)
        placements.set(card.id, top)
        previousBottom = top + card.height + overlapGap
      })

      return placements
    }

    const placements = placeSequentially(measuredCards)

    measuredCards.forEach((card) => {
      nextPositions.push({
        id: card.id,
        left: marginPaddingLeft,
        top: placements.get(card.id) ?? 0,
        width: availableWidth,
      })
    })

    const lastBottom = nextPositions.reduce((maxBottom, position) => {
      const card = measuredCards.find((entry) => entry.id === position.id)
      const height = card?.height ?? 0
      return Math.max(maxBottom, position.top + height)
    }, 0)

    setNoteCardPositions(nextPositions)
    setNoteListHeight(
      Math.max(
        marginElement.clientHeight,
        lastBottom + marginPaddingTop + 12,
      ),
    )
  }, [currentParagraphs, isPdfDesktopDocument, notesInDocumentOrder, resolvedAnchorsById])

  const updatePdfCurrentPageNoteCardPositions = useCallback(() => {
    if (
      !isPdfDesktopDocument ||
      isPdfPreviewOnlyFallback ||
      !sidebarNotesInDocumentOrder.length
    ) {
      setPdfCurrentPageNoteCardPositions([])
      setPdfCurrentPageNoteListHeight(0)
      return
    }

    const notesScrollElement = pdfSidebarNoteListRef.current
    const pdfStageElement = pdfCurrentPageStageRef.current

    if (!notesScrollElement || !pdfStageElement) {
      setPdfCurrentPageNoteCardPositions([])
      setPdfCurrentPageNoteListHeight(0)
      return
    }

    const notesScrollRect = notesScrollElement.getBoundingClientRect()
    const pdfStageRect = pdfStageElement.getBoundingClientRect()

    if (pdfStageRect.height <= 0 || notesScrollElement.clientWidth <= 0) {
      setPdfCurrentPageNoteCardPositions([])
      setPdfCurrentPageNoteListHeight(0)
      return
    }

    const anchorAttachOffset = 18
    const overlapGap = 10
    let previousBottom = 0
    let hasAnchoredCard = false

    const measuredNotes = sidebarNotesInDocumentOrder.map((note, noteIndex) => {
      const cardElement = noteCardRefs.current.get(note.id)
      const measuredCardHeight = cardElement?.getBoundingClientRect().height ?? 0
      const cardHeight = Math.max(96, Math.ceil(measuredCardHeight))
      const anchorRatio = getPdfNoteVerticalAnchorRatio(note)
      const anchorViewportY =
        anchorRatio === null
          ? null
          : pdfStageRect.top + anchorRatio * pdfStageRect.height
      const targetTop =
        anchorViewportY === null
          ? 0
          : anchorViewportY -
            notesScrollRect.top +
            notesScrollElement.scrollTop -
            anchorAttachOffset

      return {
        anchorRatio,
        anchorViewportY,
        id: note.id,
        originalIndex: noteIndex,
        targetTop,
        cardHeight,
      }
    })

    const unanchoredNotes = measuredNotes.filter((note) => note.anchorViewportY === null)
    const anchoredNotes = measuredNotes
      .filter((note) => note.anchorViewportY !== null)
      .sort((first, second) => {
        const firstRatio = first.anchorRatio ?? Number.POSITIVE_INFINITY
        const secondRatio = second.anchorRatio ?? Number.POSITIVE_INFINITY

        if (firstRatio !== secondRatio) {
          return firstRatio - secondRatio
        }

        return first.originalIndex - second.originalIndex
      })

    if (anchoredNotes.length) {
      hasAnchoredCard = true
    }

    const nextPositions = [...unanchoredNotes, ...anchoredNotes].map((note, noteIndex) => {
      const top = Math.max(
        0,
        Math.round(note.targetTop),
        noteIndex > 0 ? previousBottom + overlapGap : 0,
      )

      previousBottom = top + note.cardHeight

      return {
        id: note.id,
        top,
      }
    })

    if (!hasAnchoredCard) {
      setPdfCurrentPageNoteCardPositions([])
      setPdfCurrentPageNoteListHeight(0)
      return
    }

    setPdfCurrentPageNoteCardPositions(nextPositions)
    setPdfCurrentPageNoteListHeight(
      Math.max(notesScrollElement.clientHeight, previousBottom + 8),
    )
  }, [
    activeNoteId,
    expandedPdfSidebarNoteIds,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    sidebarNotesInDocumentOrder,
  ])

  const pruneDeletedNoteLayout = useCallback(() => {
    const validNoteIds = new Set(notes.map((note) => note.id))

    Array.from(highlightRefs.current.keys()).forEach((noteId) => {
      if (!validNoteIds.has(noteId)) {
        highlightRefs.current.delete(noteId)
      }
    })

    Array.from(noteCardRefs.current.keys()).forEach((noteId) => {
      if (!validNoteIds.has(noteId)) {
        noteCardRefs.current.delete(noteId)
      }
    })

    setConnectorLines((currentLines) =>
      currentLines.filter((line) => validNoteIds.has(line.id)),
    )
    setNoteCardPositions((currentPositions) =>
      currentPositions.filter((position) => validNoteIds.has(position.id)),
    )
  }, [notes])

  useLayoutEffect(() => {
    pruneDeletedNoteLayout()

    if (marginLayoutFrameRef.current !== null) {
      cancelAnimationFrame(marginLayoutFrameRef.current)
    }

    marginLayoutFrameRef.current = requestAnimationFrame(() => {
      marginLayoutFrameRef.current = null
      updateMarginCardPositions()
    })

    return () => {
      if (marginLayoutFrameRef.current !== null) {
        cancelAnimationFrame(marginLayoutFrameRef.current)
        marginLayoutFrameRef.current = null
      }
    }
  }, [
    activeNoteId,
    notes,
    pruneDeletedNoteLayout,
    updateMarginCardPositions,
  ])

  useLayoutEffect(() => {
    if (
      !isPdfDesktopDocument ||
      isPdfPreviewOnlyFallback
    ) {
      setPdfCurrentPageNoteCardPositions([])
      setPdfCurrentPageNoteListHeight(0)
      return
    }

    let frameId: number | null = null
    const workspaceElement = workspaceRef.current
    const notesScrollElement = pdfSidebarNoteListRef.current
    const pdfStageElement = pdfCurrentPageStageRef.current

    const scheduleUpdate = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      frameId = requestAnimationFrame(() => {
        frameId = null
        updatePdfCurrentPageNoteCardPositions()
      })
    }

    scheduleUpdate()

    window.addEventListener('resize', scheduleUpdate)
    workspaceElement?.addEventListener('scroll', scheduleUpdate)
    pdfViewportHostRef.current?.addEventListener('scroll', scheduleUpdate)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleUpdate()
          })
        : null

    if (resizeObserver) {
      if (notesScrollElement) {
        resizeObserver.observe(notesScrollElement)
      }

      if (pdfStageElement) {
        resizeObserver.observe(pdfStageElement)
      }
    }

    return () => {
      window.removeEventListener('resize', scheduleUpdate)
      workspaceElement?.removeEventListener('scroll', scheduleUpdate)
      pdfViewportHostRef.current?.removeEventListener('scroll', scheduleUpdate)

      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      resizeObserver?.disconnect()
    }
  }, [
    activeNoteId,
    currentPdfPage,
    expandedPdfSidebarNoteIds,
    isPdfDesktopDocument,
    isPdfPreviewOnlyFallback,
    pdfRenderedPage,
    sidebarNotesInDocumentOrder,
    updatePdfCurrentPageNoteCardPositions,
  ])

  useLayoutEffect(() => {
    if (connectorFrameRef.current !== null) {
      cancelAnimationFrame(connectorFrameRef.current)
    }

    connectorFrameRef.current = requestAnimationFrame(() => {
      connectorFrameRef.current = null
      updateConnectorLines()
    })

    return () => {
      if (connectorFrameRef.current !== null) {
        cancelAnimationFrame(connectorFrameRef.current)
        connectorFrameRef.current = null
      }
    }
  }, [activeNoteId, noteCardPositions, notes, updateConnectorLines])

  useEffect(() => {
    const workspaceElement = workspaceRef.current

    window.addEventListener('resize', updateMarginCardPositions)
    workspaceElement?.addEventListener('scroll', updateMarginCardPositions)
    workspaceElement?.addEventListener('scroll', updateConnectorLines)

    return () => {
      window.removeEventListener('resize', updateMarginCardPositions)
      workspaceElement?.removeEventListener('scroll', updateMarginCardPositions)
      workspaceElement?.removeEventListener('scroll', updateConnectorLines)
    }
  }, [updateConnectorLines, updateMarginCardPositions])

  useEffect(() => {
    if (
      currentDocument.source === 'desktop-file' ||
      currentDocument.source === 'empty'
    ) {
      return
    }

    try {
      if (!notes.length) {
        window.localStorage.removeItem(currentDocument.storageKey)
        return
      }

      window.localStorage.setItem(
        currentDocument.storageKey,
        JSON.stringify({
          documentId: currentDocument.documentId,
          fileName: currentDocument.fileName,
          fileSize: currentDocument.fileSize,
          fileLastModified: currentDocument.fileLastModified,
          notes,
        }),
      )
    } catch {
      // Keep the prototype usable if browser storage is unavailable.
    }
  }, [currentDocument, notes])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (!recentDocuments.length) {
        window.localStorage.removeItem(recentDocumentsStorageKey)
        return
      }

      window.localStorage.setItem(
        recentDocumentsStorageKey,
        JSON.stringify(recentDocuments),
      )
    } catch {
      // Ignore local recent-list persistence failures.
    }
  }, [recentDocuments])

  useEffect(() => {
    if (
      currentDocument.source !== 'desktop-file' ||
      !currentDocument.documentPath ||
      !currentDocument.notesFilePath
    ) {
      return
    }

    if (skipNextDesktopNotesPersistRef.current) {
      skipNextDesktopNotesPersistRef.current = false
      return
    }

    if (desktopDocumentTransitionRef.current.active) {
      return
    }

    if (shouldBlockDesktopNotesPersistRef.current) {
      console.warn(
        '[NoteAnchor notes] desktop notes persistence blocked to protect an existing notes file after load failure.',
      )
      setDesktopNotesStatus(
        'Notes are currently in memory only. The existing .notes.json was rejected and will not be overwritten automatically.',
      )
      setDesktopOpenStatus(invalidSidecarProtectedStatusMessage)
      return
    }

    const targetDocumentPath = normalizeDesktopFilePath(currentDocument.documentPath)
    const requestId = ++desktopNotesPersistRequestIdRef.current

    const persistDesktopNotes = async () => {
      try {
        const { invoke, isTauri } = await import('@tauri-apps/api/core')

        if (!isTauri()) {
          return
        }

        setDesktopNotesStatus(notes.length ? 'Saving notes...' : 'Removing notes file...')
        console.info('[NoteAnchor notes] desktop document path:', currentDocument.documentPath)
        console.info('[NoteAnchor notes] derived notes file path:', currentDocument.notesFilePath)
        console.info('[NoteAnchor notes] note count to persist:', notes.length)

        if (!notes.length) {
          const clearedPath = await invoke<string>('clear_notes_file', {
            documentPath: currentDocument.documentPath,
            notesFilePath: currentDocument.notesFilePath,
          })
          if (
            requestId !== desktopNotesPersistRequestIdRef.current ||
            currentDesktopDocumentPathRef.current !== targetDocumentPath
          ) {
            return
          }
          console.info('[NoteAnchor notes] cleared notes file:', clearedPath)
          setDesktopNotesStatus(`Notes file removed: ${clearedPath}`)
          setDesktopOpenStatus('')
          return
        }

        const payload = createDesktopNotesPayload(currentDocument, notes)

        const savedPath = await invoke<string>('save_notes_file', {
          documentPath: currentDocument.documentPath,
          contents: payload,
          notesFilePath: currentDocument.notesFilePath,
        })
        if (
          requestId !== desktopNotesPersistRequestIdRef.current ||
          currentDesktopDocumentPathRef.current !== targetDocumentPath
        ) {
          return
        }
        console.info('[NoteAnchor notes] notes saved successfully:', savedPath)
        setDesktopNotesStatus(`Notes saved to: ${savedPath}`)
        setDesktopOpenStatus('')
      } catch (error) {
        const errorMessage = getBridgeErrorMessage(error)
        console.error('[NoteAnchor notes] failed to persist desktop notes:', error)
        if (
          requestId !== desktopNotesPersistRequestIdRef.current ||
          currentDesktopDocumentPathRef.current !== targetDocumentPath
        ) {
          return
        }
        setDesktopNotesStatus(`Notes save error: ${errorMessage}. Notes remain in memory.`)
      }
    }

    void persistDesktopNotes()
  }, [currentDocument, notes])

  const handleAddNote = () => {
    if (!addNoteAnchor) {
      return
    }

    setPendingDeleteNoteId(null)
    setIsEditorOpen(true)
    setEditingNoteId(null)
    setEditorAnchor(addNoteAnchor)
    setEditorSelectedText(addNoteAnchor.selectedText)
    setNoteDraft('')
    clearTemporarySelection(true)
  }

  const handleReconnectActiveNote = () => {
    if (activeNote && getPdfAnchorType(activeNote)) {
      setDesktopOpenStatus('Link again is available only for text-fragment notes.')
      return
    }

    if (!activeNote || !selectedAnchor) {
      setDesktopOpenStatus('Could not link this note again. Select a text fragment first.')
      return
    }

    if (!isActiveNoteUnresolved) {
      setDesktopOpenStatus('Only notes with missing text fragments can be linked again.')
      return
    }

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === activeNote.id
          ? {
              ...note,
              paragraphIndex: selectedAnchor.paragraphIndex,
              startOffset: selectedAnchor.startOffset,
              endOffset: selectedAnchor.endOffset,
              previousSelectedText: note.selectedText,
              selectedText: selectedAnchor.selectedText,
              context: selectedAnchor.context,
            }
          : note,
      ),
    )
    setDesktopNotesStatus('')
    setDesktopOpenStatus('Note linked again to the selected text.')
    setActiveNoteId(activeNote.id)
    clearTemporarySelection(true)
  }

  const handleNoteEditorDragStart = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!modalRef.current) {
      return
    }

    const modalRect = modalRef.current.getBoundingClientRect()
    modalDragOffsetRef.current = {
      x: event.clientX - modalRect.left,
      y: event.clientY - modalRect.top,
    }
    setIsDraggingEditor(true)
  }

  const handleOpenTextFile = () => {
    setIsRecentDocumentsOpen(false)
    fileInputRef.current?.click()
  }

  const handleExportNotes = async () => {
    console.info('[NoteAnchor export] button clicked', {
      canExportNotes,
      documentPath: currentDocument.documentPath,
      noteCount: notes.length,
      source: currentDocument.source,
    })
    setExportFeedback(null)

    if (!canExportNotes || !currentDocument.documentPath) {
      if (currentDocument.source !== 'desktop-file') {
        setDesktopOpenStatus('Export is available only for desktop-opened documents.')
      } else if (!notes.length) {
        setDesktopOpenStatus('There are no notes to export.')
      } else {
        setDesktopOpenStatus('Export error: current document path is unavailable.')
      }

      return
    }

    setDesktopOpenStatus('Exporting notes...')
    setDesktopNotesStatus('')

    const exportDate = new Date().toISOString()
    const exportDocumentPath = currentDocument.documentPath
    const markdownSections = [
      `# NoteAnchor notes export`,
      '',
      `- Document file: ${escapeMarkdownText(currentDocument.fileName)}`,
      `- Document path: ${escapeMarkdownText(exportDocumentPath)}`,
      `- Exported at: ${escapeMarkdownText(exportDate)}`,
      `- Total notes: ${notesInDocumentOrder.length}`,
      '',
    ]

    notesInDocumentOrder.forEach((note, index) => {
      const resolvedAnchor = resolvedAnchorsById.get(note.id)
      const anchorStatus =
        resolvedAnchor?.status === 'exact'
          ? 'Found'
          : resolvedAnchor?.status === 'recovered'
            ? 'Reconnected'
            : 'Text fragment not found'

      markdownSections.push(`## Note ${index + 1}`)
      markdownSections.push('')
      markdownSections.push(`- Selected text: ${escapeMarkdownText(note.selectedText)}`)
      if (note.previousSelectedText?.trim()) {
        markdownSections.push(
          `- Previously linked to: ${escapeMarkdownText(note.previousSelectedText.trim())}`,
        )
      }
      markdownSections.push(`- Note status: ${anchorStatus}`)
      markdownSections.push(
        `- Text position: paragraph ${note.paragraphIndex}, offsets ${note.startOffset}-${note.endOffset}`,
      )
      markdownSections.push('')
      markdownSections.push('### Comment')
      markdownSections.push('')
      markdownSections.push(formatMarkdownBlock(note.comment || '(empty)'))
      markdownSections.push('')
      markdownSections.push('### Context')
      markdownSections.push('')
      markdownSections.push(formatMarkdownBlock(note.context || '(no context available)'))

      if (anchorStatus === 'Text fragment not found') {
        markdownSections.push('')
        markdownSections.push(
          '> The document text may have changed. Select the correct fragment and use Link again.',
        )
      }

      markdownSections.push('')
    })

    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core')
      console.info('[NoteAnchor export] @tauri-apps/api/core imported')

      if (!isTauri()) {
        console.warn('[NoteAnchor export] not running inside Tauri runtime')
        setDesktopOpenStatus('Export is available only in the desktop app.')
        return
      }

      console.info("[NoteAnchor export] invoking 'save_notes_export_file'", {
        documentPath: exportDocumentPath,
        noteCount: notesInDocumentOrder.length,
      })
      const savedPath = await invoke<string>('save_notes_export_file', {
        documentPath: exportDocumentPath,
        contents: markdownSections.join('\n'),
      })
      console.info('[NoteAnchor export] export saved successfully:', savedPath)

      setDesktopOpenStatus(
        `Exported notes to ${getFileNameFromPath(savedPath)}`,
      )
      setExportFeedback({
        fileName: getFileNameFromPath(savedPath),
        filePath: savedPath,
        kind: 'success',
        message: 'Notes exported successfully.',
      })
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      console.error('[NoteAnchor export] export failed:', error)
      setDesktopOpenStatus(`Export error: ${errorMessage}`)
      setExportFeedback({
        fileName: currentDesktopExportPath
          ? getFileNameFromPath(currentDesktopExportPath)
          : undefined,
        filePath: currentDesktopExportPath || undefined,
        kind: 'error',
        message: `Export failed: ${errorMessage}`,
      })
    }
  }

  const handlePrintNotes = () => {
    if (!canPrintNotes) {
      if (!hasOpenDocument) {
        setDesktopOpenStatus('Open a document to print its notes.')
      } else {
        setDesktopOpenStatus('There are no notes to print.')
      }

      return
    }

    const printDate = new Date().toLocaleString()
    const documentType = getDocumentTypeLabel(currentDocument)
    setPrintSaveFeedback(null)
    setIsPrintSavePending(false)

    setPrintPreview({
      documentType,
      fileName: currentDocument.fileName,
      printedAt: printDate,
      notes: notesInDocumentOrder.map((note, index) => {
        const resolvedAnchor = resolvedAnchorsById.get(note.id)

        return {
          comment: note.comment,
          id: note.id,
          isFragmentMissing: resolvedAnchor?.status === 'review',
          noteNumber: index + 1,
          previousSelectedText: note.previousSelectedText?.trim() || undefined,
          selectedText: note.selectedText,
          sentenceOrPhrase: getPrintableContextForDisplay(
            note.selectedText,
            getPrintableSentenceOrPhrase(
              note,
              resolvedAnchor,
              currentParagraphs,
            ),
          ),
        }
      }),
    })
    setDesktopOpenStatus(`Opened print preview for ${currentDocument.fileName}.`)
  }

  const handleSavePrintableHtml = async () => {
    if (!printPreview || currentDocument.source !== 'desktop-file' || !currentDocument.documentPath) {
      const message = 'Print report can be saved only for desktop-opened documents.'
      setDesktopOpenStatus(message)
      setPrintSaveFeedback({
        kind: 'error',
        message,
      })
      return
    }

    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core')

      if (!isTauri()) {
        const message = 'Print report is available only in the desktop app.'
        setDesktopOpenStatus(message)
        setPrintSaveFeedback({
          kind: 'error',
          message,
        })
        return
      }

      setIsPrintSavePending(true)
      setPrintSaveFeedback({
        kind: 'success',
        message: 'Saving print report...',
      })
      setDesktopOpenStatus('Saving print report...')
      console.info('[NoteAnchor print] saving printable HTML', {
        documentPath: currentDocument.documentPath,
        fileName: currentDocument.fileName,
        noteCount: printPreview.notes.length,
      })
      const savedPath = await invoke<string>('save_notes_print_file', {
        documentPath: currentDocument.documentPath,
        contents: buildPrintableNotesHtml(printPreview),
      })
      if (!savedPath || typeof savedPath !== 'string') {
        throw new Error('Printable HTML save returned no path.')
      }

      console.info('[NoteAnchor print] printable HTML saved:', savedPath)
      setDesktopOpenStatus(`Print report saved: ${savedPath}`)
      setPrintSaveFeedback({
        fileName: getFileNameFromPath(savedPath),
        filePath: savedPath,
        kind: 'success',
        message: 'Print report saved successfully.',
      })
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      console.error('[NoteAnchor print] printable HTML save failed:', error)
      setDesktopOpenStatus(`Print report error: ${errorMessage}`)
      setPrintSaveFeedback({
        fileName: currentDocument.documentPath
          ? getFileNameFromPath(
              /\.txt$/i.test(currentDocument.documentPath)
                ? currentDocument.documentPath.replace(/\.txt$/i, '.notes-print.html')
                : `${currentDocument.documentPath}.notes-print.html`,
            )
          : undefined,
        kind: 'error',
        message: `Print report error: ${errorMessage}`,
      })
    } finally {
      setIsPrintSavePending(false)
    }
  }

  const handleCloseDocument = () => {
    if (isPdfDesktopDocument) {
      teardownActivePdfBeforeDocumentReplacement()
    }

    desktopDocumentTransitionRef.current = {
      active: false,
      targetDocumentPath: '',
    }
    pendingPdfReadingRestoreRef.current = null
    appliedPdfReadingRestoreRef.current = null
    suppressPdfReadingPersistRef.current = false
    resetDocumentNotes()
    setCurrentDocument(emptyDocumentMetadata)
    setCurrentParagraphs([])
    setPdfBlobUrl('')
    setPdfCurrentPage(1)
    setPdfPageInput('1')
    setPendingDeleteNoteId(null)
    setDesktopOpenStatus('')
    setDesktopNotesStatus('')
    setBridgeStatus('')
    setIsDebugToolsOpen(false)
    setIsHelpOpen(false)
    setPrintPreview(null)
    setIsRecentDocumentsOpen(false)
    setMissingRecentDocument(null)
    setExportFeedback(null)
    resetPdfReadingScrollContainers()
  }

  const confirmReplaceCurrentDocument = () => {
    if (!hasUserOpenedDocument) {
      return true
    }

    return window.confirm(
      'Opening another document will close the current document in this window. Saved notes will remain on disk. Continue?',
    )
  }

  const handleOpenDocument = async () => {
    if (!confirmReplaceCurrentDocument()) {
      return
    }

    try {
      const { isTauri } = await import('@tauri-apps/api/core')

      if (isTauri() || isLikelyTauriRuntimeWindow()) {
        setIsRecentDocumentsOpen(false)
        await handleOpenDesktopDocumentFile()
        return
      }
    } catch (error) {
      if (isLikelyTauriRuntimeWindow()) {
        const errorMessage = getBridgeErrorMessage(error)
        setDesktopOpenStatus(`Desktop file open error: ${errorMessage}`)
        return
      }
    }

    handleOpenTextFile()
  }

  const loadDocumentFromText = useCallback(
    (text: string, nextDocument: DocumentMetadata, nextNotes?: Note[]) => {
      if (isPdfDesktopDocument) {
        flushPdfReadingPositionPersist()
      }

      const paragraphs = splitTextIntoParagraphs(text)

      if (!paragraphs.length) {
        window.alert('The selected document is empty.')
        return false
      }

      const savedNotes =
        nextNotes ??
        loadSavedNotes(
          nextDocument.storageKey,
          nextDocument.documentId,
        )
      const notesWithUniqueIds = ensureUniqueNoteIds(savedNotes)

      resetDocumentNotes()
      pendingPdfReadingRestoreRef.current = null
      appliedPdfReadingRestoreRef.current = null
      suppressPdfReadingPersistRef.current = false
      setCurrentDocument(nextDocument)
      setCurrentParagraphs(paragraphs)
      setPdfCurrentPage(1)
      setPdfPageInput('1')
      setPdfBlobUrl('')
      setNotes(notesWithUniqueIds)
      resetPdfReadingScrollContainers()
      return true
    },
    [
      flushPdfReadingPositionPersist,
      isPdfDesktopDocument,
      resetDocumentNotes,
      resetPdfReadingScrollContainers,
    ],
  )

  const loadPdfDocument = useCallback(
    (nextDocument: DocumentMetadata, nextNotes?: Note[]) => {
      if (isPdfDesktopDocument) {
        flushPdfReadingPositionPersist()
      }

      const savedNotes =
        nextNotes ??
        loadSavedNotes(
          nextDocument.storageKey,
          nextDocument.documentId,
        )
      const savedReadingPosition = loadPdfReadingPosition(nextDocument.storageKey)
      const notesWithUniqueIds = ensureUniqueNoteIds(savedNotes)
      const nextSessionKey = currentPdfOpenSessionKeyRef.current + 1
      const normalizedNextDocumentPath = nextDocument.documentPath
        ? normalizeDesktopFilePath(nextDocument.documentPath)
        : ''

      pendingPdfReadingRestoreRef.current =
        savedReadingPosition && normalizedNextDocumentPath
          ? {
              documentPath: normalizedNextDocumentPath,
              pageNumber: savedReadingPosition.pageNumber,
              pageScrollRatio: savedReadingPosition.pageScrollRatio,
              sessionKey: nextSessionKey,
            }
          : null
      appliedPdfReadingRestoreRef.current = null
      suppressPdfReadingPersistRef.current = false

      resetDocumentNotes()
      setPdfBlobUrl('')
      setPdfPageCount(1)
      setPdfRenderedPage(null)
      setPdfPendingRender(null)
      setPdfRenderError('')
      setPdfTextTokens([])
      setPdfTextLayerStatus('pending')
      setPdfPageTextAnalysis(null)
      setPendingPdfTextSelection(null)
      setPendingPdfPointAnchor(null)
      setCurrentDocument(nextDocument)
      setCurrentParagraphs([])
      setPdfCurrentPage(savedReadingPosition?.pageNumber ?? 1)
      setPdfPageInput(String(savedReadingPosition?.pageNumber ?? 1))
      setNotes(notesWithUniqueIds)
      setPdfOpenSessionKey(nextSessionKey)
      resetPdfReadingScrollContainers()
      return true
    },
    [
      flushPdfReadingPositionPersist,
      isPdfDesktopDocument,
      resetDocumentNotes,
      resetPdfReadingScrollContainers,
    ],
  )

  const handleTestNativeBridge = async () => {
    if (isBridgePending) {
      return
    }

    setIsBridgePending(true)
    setBridgeStatus('Calling native bridge...')

    const globalState = globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: unknown
      isTauri?: unknown
    }

    console.info('[NoteAnchor bridge] button clicked')
    console.info('[NoteAnchor bridge] global runtime flags', {
      hasInternals: Boolean(globalState.__TAURI_INTERNALS__),
      isTauriFlag: Boolean(globalState.isTauri),
    })

    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core')
      console.info('[NoteAnchor bridge] @tauri-apps/api/core imported')

      const runtimeDetected = isTauri()
      console.info('[NoteAnchor bridge] Tauri runtime detected:', runtimeDetected)

      if (!runtimeDetected) {
        setBridgeStatus('Native bridge is available only in the desktop app.')
        return
      }

      console.info("[NoteAnchor bridge] invoking 'ping'")
      const message = await invoke<string>('ping')
      console.info('[NoteAnchor bridge] invoke succeeded:', message)
      setBridgeStatus(message)
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      console.error('[NoteAnchor bridge] invoke failed:', error)
      setBridgeStatus(`Native bridge error: ${errorMessage}`)
    } finally {
      setIsBridgePending(false)
    }
  }

  const rememberRecentDesktopDocument = useCallback(
    (nextDocument: DocumentMetadata) => {
      if (
        nextDocument.source !== 'desktop-file' ||
        !nextDocument.documentPath
      ) {
        return
      }

      const { documentPath } = nextDocument

      setRecentDocuments((currentEntries) =>
        upsertRecentDocument(currentEntries, {
          documentPath,
          fileName: nextDocument.fileName,
          lastOpenedAt: new Date().toISOString(),
          notesFilePath: nextDocument.notesFilePath,
        }),
      )
    },
    [],
  )

  const openDesktopDocumentByPath = useCallback(
    async (selectedPath: string, source: 'open' | 'recent' = 'open') => {
      const normalizedPath = normalizeDesktopFilePath(selectedPath)
      const targetFileName = getFileNameFromPath(normalizedPath)
      const isRecentSource = source === 'recent'
      const isReplacingActivePdfDocument =
        isPdfDesktopDocument &&
        currentDocument.source === 'desktop-file' &&
        Boolean(currentDocument.documentPath) &&
        normalizeDesktopFilePath(currentDocument.documentPath ?? '').toLowerCase() !==
          normalizedPath.toLowerCase()
      let recentFailureStep = 'path normalization'

      try {
        desktopDocumentTransitionRef.current = {
          active: true,
          targetDocumentPath: normalizedPath,
        }
        if (isReplacingActivePdfDocument) {
          teardownActivePdfBeforeDocumentReplacement()
        }
        if (isRecentSource) {
          setRecentOpenDiagnostic({
            ...initialRecentOpenDiagnosticState,
            active: true,
            normalizedPath,
            rawPath: selectedPath,
            source,
            status: 'Recent open requested.',
          })

          recentFailureStep = 'file read probe'
          await readDesktopDocumentBytes(normalizedPath)
          setRecentOpenDiagnostic((current) => ({
            ...current,
            fileExists: 'yes',
            status: 'Recent path resolved and file read probe succeeded.',
          }))
        } else {
          setRecentOpenDiagnostic(initialRecentOpenDiagnosticState)
        }

        console.info('[NoteAnchor desktop open] normalized path:', normalizedPath)
        console.info(
          '[NoteAnchor desktop open] replacing current document in single-document mode:',
          currentDocument.fileName,
          '->',
          targetFileName,
        )

        recentFailureStep = 'tauri imports'
        const { invoke, isTauri } = await import('@tauri-apps/api/core')
        const { confirm } = await import('@tauri-apps/plugin-dialog')

        recentFailureStep = 'tauri runtime check'
        if (!isTauri()) {
          setDesktopOpenStatus(
            'Desktop file opening is available only in the Tauri app.',
          )
          if (isRecentSource) {
            setRecentOpenDiagnostic((current) => ({
              ...current,
              failedAt: 'tauri runtime check',
              status: 'Recent open is unavailable outside the desktop runtime.',
            }))
          }
          return
        }

        console.info("[NoteAnchor desktop open] invoking 'open_document_file'")
        recentFailureStep = 'open_document_file'
        const openedFile = await invoke<OpenedDesktopTextFile>('open_document_file', {
          documentPath: normalizedPath,
        })
        if (isRecentSource) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            status: 'Recent open reached native document decode.',
          }))
        }
      const openedFileLabel =
        openedFile.documentKind === 'pdf'
          ? '.pdf'
          : openedFile.documentKind === 'docx'
            ? '.docx'
            : '.txt'
      console.info('[NoteAnchor desktop open] decoded encoding:', openedFile.encoding)
      console.info('[NoteAnchor desktop open] document kind:', openedFile.documentKind)
      console.info('[NoteAnchor desktop open] size bytes:', openedFile.sizeBytes)
      console.info('[NoteAnchor desktop open] modified at:', openedFile.modifiedAt)
      if (openedFile.warning) {
        console.warn('[NoteAnchor desktop open] decode warning:', openedFile.warning)
      }

      const text = openedFile.text
      const nextDocument = createDesktopDocumentMetadata(
        normalizedPath,
        openedFile.documentKind,
        openedFile.sizeBytes,
        openedFile.modifiedAt ?? undefined,
        openedFile.contentHash,
      )
      console.info('[NoteAnchor desktop open] opened path:', normalizedPath)
      console.info(
        '[NoteAnchor desktop open] derived notes path:',
        nextDocument.notesFilePath,
      )
      const paragraphs =
        openedFile.documentKind === 'pdf' ? [] : splitTextIntoParagraphs(text)

      if (openedFile.documentKind !== 'pdf' && !paragraphs.length) {
        window.alert('The selected document is empty.')
        setDesktopOpenStatus('The selected document is empty.')
        return
      }

      recentFailureStep = 'load_notes_file'
      const savedNotesPayload = await invoke<string | null>('load_notes_file', {
        documentPath: normalizedPath,
      })
      console.info(
        '[NoteAnchor notes] load result:',
        savedNotesPayload ? 'notes file found' : 'no notes file found',
      )
      shouldBlockDesktopNotesPersistRef.current = false
      setInvalidSidecarRecovery(null)

      let restoredNotes: Note[] = []
      let notesLoadMessage = ''
      let invalidNotesFilePathForRecovery = ''
      let shouldSearchAlternateNotesCandidates = !savedNotesPayload

      if (savedNotesPayload) {
        const result = extractNotesFromPayload(
          savedNotesPayload,
          paragraphs,
          normalizedPath,
          openedFile.sizeBytes,
          openedFile.modifiedAt ?? undefined,
          openedFile.contentHash,
        )

        restoredNotes = ensureUniqueNoteIds(result.notes)
        console.info('[NoteAnchor notes] raw notes count:', result.rawNotesCount)
        console.info('[NoteAnchor notes] valid notes count:', result.validNotesCount)

        if (result.loadFailed) {
          shouldBlockDesktopNotesPersistRef.current = true
          invalidNotesFilePathForRecovery = nextDocument.notesFilePath ?? ''
          shouldSearchAlternateNotesCandidates = true
        }

        if (result.message) {
          console.warn('[NoteAnchor notes] notes load warning:', result.message)
          notesLoadMessage = result.message
        } else {
          console.info(
            '[NoteAnchor notes] restored notes count:',
            restoredNotes.length,
          )
        }
        setPdfRecoveryDiagnostic({
          dialogAccepted: null,
          recoveredLegacyPdfTextNotesCount: 0,
          recoveredNotesCount: restoredNotes.length,
          recoveredPdfTextNotesCount: getPdfTextNotesDiagnostics(restoredNotes).pdfTextNotesCount,
          status:
            result.message ||
            (restoredNotes.length ? 'Direct notes file loaded.' : 'No notes were restored.'),
        })
      }

      if (shouldSearchAlternateNotesCandidates) {
        recentFailureStep = 'find_renamed_notes_candidates'
        const notesCandidates = await invoke<DesktopNotesFileCandidate[]>(
          'find_renamed_notes_candidates',
          {
            documentPath: normalizedPath,
          },
        )
        console.info(
          '[NoteAnchor notes] renamed-notes candidates found:',
          notesCandidates.length,
        )

        const candidatesWithHash = notesCandidates.filter(
          (candidate) => getSavedDocumentContentHash(candidate.contents) !== null,
        )
        const matchingCandidates = notesCandidates.filter(
          (candidate) =>
            getSavedDocumentContentHash(candidate.contents) ===
            openedFile.contentHash,
        )

        if (matchingCandidates.length === 1) {
          const renamedCandidate = matchingCandidates[0]
          const expectedNotesFileName = nextDocument.notesFilePath
            ? getFileNameFromPath(nextDocument.notesFilePath)
            : ''
          const candidateNotesFileName = getFileNameFromPath(
            renamedCandidate.notesFilePath,
          )
          const isRecoveredNotesCandidate =
            /\.recovered(?:-\d+)?\.notes\.json$/i.test(candidateNotesFileName)
          const requiresRenamedNotesConfirmation =
            candidateNotesFileName !== expectedNotesFileName
          if (requiresRenamedNotesConfirmation) {
            desktopDocumentTransitionRef.current = {
              active: true,
              targetDocumentPath: normalizedPath,
            }
          }
          const shouldLoadRenamedNotes = requiresRenamedNotesConfirmation
            ? await confirm(
                isRecoveredNotesCandidate
                  ? `Found separately saved notes: ${candidateNotesFileName}. Load these notes for the current document?`
                  : `This document may have been renamed. Found notes from: ${candidateNotesFileName}. Load these notes for the current document?`,
                {
                  title: isRecoveredNotesCandidate
                    ? 'Load recovered notes'
                    : 'Load renamed-document notes',
                  kind: 'warning',
                },
              )
            : true

          if (isRecentSource && requiresRenamedNotesConfirmation) {
            setRecentOpenDiagnostic((current) => ({
              ...current,
              recoveryDialogTriggered: true,
              status: 'Recent open reached renamed-document recovery prompt.',
            }))
          }

          if (shouldLoadRenamedNotes) {
            const result = extractNotesFromPayload(
              renamedCandidate.contents,
              paragraphs,
              normalizedPath,
              openedFile.sizeBytes,
              openedFile.modifiedAt ?? undefined,
              openedFile.contentHash,
              { allowPathMismatch: true },
            )

            restoredNotes = ensureUniqueNoteIds(result.notes)
            const diagnostics = getPdfTextNotesDiagnostics(restoredNotes)
            console.info(
              '[NoteAnchor notes] restored renamed-document notes count:',
              restoredNotes.length,
            )
            console.info(
              '[NoteAnchor notes] renamed-document recovery diagnostics:',
              diagnostics,
            )

            if (result.loadFailed) {
              shouldBlockDesktopNotesPersistRef.current = true
            } else {
              shouldBlockDesktopNotesPersistRef.current = false
              nextDocument.notesFilePath = renamedCandidate.notesFilePath
              invalidNotesFilePathForRecovery = ''
            }

            notesLoadMessage = result.message
              ? result.message
              : diagnostics.legacyPdfTextNotesCount > 0
                ? `Loaded ${restoredNotes.length} notes from ${isRecoveredNotesCandidate ? 'recovered file' : 'renamed file'} ${getFileNameFromPath(renamedCandidate.notesFilePath)}. ${diagnostics.legacyPdfTextNotesCount} PDF text note${diagnostics.legacyPdfTextNotesCount === 1 ? '' : 's'} need Refresh from the current Text mode selection.`
                : `Loaded notes from ${isRecoveredNotesCandidate ? 'recovered file' : 'renamed file'} ${getFileNameFromPath(renamedCandidate.notesFilePath)}.`
            setPdfRecoveryDiagnostic({
              dialogAccepted: true,
              recoveredLegacyPdfTextNotesCount: diagnostics.legacyPdfTextNotesCount,
              recoveredNotesCount: restoredNotes.length,
              recoveredPdfTextNotesCount: diagnostics.pdfTextNotesCount,
              status:
                result.message ||
                (diagnostics.legacyPdfTextNotesCount > 0
                  ? `${isRecoveredNotesCandidate ? 'Recovered' : 'Renamed-document'} notes loaded, but recovered PDF text notes are legacy and need Refresh from a current Text mode selection.`
                  : `${isRecoveredNotesCandidate ? 'Recovered' : 'Renamed-document'} notes loaded successfully.`),
            })
            if (isRecentSource) {
              setRecentOpenDiagnostic((current) => ({
                ...current,
                recoveredNotesLoaded: restoredNotes.length > 0,
                status: 'Recent open loaded renamed-document recovery notes.',
              }))
            }
          } else {
            notesLoadMessage = 'Opened without loading renamed-document notes.'
            setPdfRecoveryDiagnostic({
              dialogAccepted: false,
              recoveredLegacyPdfTextNotesCount: 0,
              recoveredNotesCount: 0,
              recoveredPdfTextNotesCount: 0,
              status: 'Renamed-document recovery was skipped.',
            })
          }
        } else if (matchingCandidates.length > 1) {
          notesLoadMessage =
            'Multiple possible notes files were found. Please rename the correct .notes.json file manually.'
          setPdfRecoveryDiagnostic({
            dialogAccepted: null,
            recoveredLegacyPdfTextNotesCount: 0,
            recoveredNotesCount: 0,
            recoveredPdfTextNotesCount: 0,
            status: notesLoadMessage,
          })
        } else if (notesCandidates.length > 0 && candidatesWithHash.length === 0) {
          notesLoadMessage =
            'Found notes files in this folder, but renamed-document recovery requires source hash metadata.'
          setPdfRecoveryDiagnostic({
            dialogAccepted: null,
            recoveredLegacyPdfTextNotesCount: 0,
            recoveredNotesCount: 0,
            recoveredPdfTextNotesCount: 0,
            status: notesLoadMessage,
          })
        }
      }

      setInvalidSidecarRecovery(
        invalidNotesFilePathForRecovery
          ? {
              invalidNotesFilePath: invalidNotesFilePathForRecovery,
              mode: 'memory-only',
            }
          : null,
      )

      skipNextDesktopNotesPersistRef.current = true
      recentFailureStep = 'document commit'
      const loaded =
        openedFile.documentKind === 'pdf'
          ? loadPdfDocument(nextDocument, restoredNotes)
          : loadDocumentFromText(text, nextDocument, restoredNotes)
      desktopDocumentTransitionRef.current = {
        active: false,
        targetDocumentPath: '',
      }

      if (loaded) {
        if (isRecentSource) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            openCommitted: true,
            status:
              openedFile.documentKind === 'pdf'
                ? 'Recent open committed the PDF document into app state.'
                : 'Recent open committed the document into app state.',
          }))
        }
        rememberRecentDesktopDocument(nextDocument)
        setDesktopNotesStatus(
          nextDocument.notesFilePath
            ? `Notes file: ${nextDocument.notesFilePath}`
            : '',
        )
        if (invalidNotesFilePathForRecovery) {
          setDesktopOpenStatus(invalidSidecarProtectedStatusMessage)
        } else if (openedFile.warning) {
          if (restoredNotes.length > 0) {
            setDesktopOpenStatus(
              `${openedFile.warning} Restored ${restoredNotes.length} note${restoredNotes.length === 1 ? '' : 's'}.`,
            )
          } else if (notesLoadMessage) {
            setDesktopOpenStatus(`${openedFile.warning} ${notesLoadMessage}`.trim())
          } else {
            setDesktopOpenStatus(openedFile.warning)
          }
        } else if (notesLoadMessage) {
          setDesktopOpenStatus(notesLoadMessage)
        } else {
          setDesktopOpenStatus(
            restoredNotes.length
              ? `Opened ${nextDocument.fileName} and restored ${restoredNotes.length} note${restoredNotes.length === 1 ? '' : 's'}.`
              : openedFile.documentKind === 'pdf'
                ? `Opened ${nextDocument.fileName}. PDF support is limited in this version.`
                : `Opened ${nextDocument.fileName}${openedFileLabel === '.docx' ? ' as plain text' : ''}.`,
          )
        }
      } else {
        setDesktopOpenStatus('The selected document is empty.')
        if (isRecentSource) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            failedAt: 'document commit',
            status: 'Recent open decoded the file, but the resulting document was empty.',
          }))
        }
      }
      } catch (error) {
        if (isRecentSource) {
          setRecentOpenDiagnostic((current) => ({
            ...current,
            failedAt: recentFailureStep,
            fileExists:
              current.fileExists === 'unknown' && /not found|cannot find|os error 2/i.test(getBridgeErrorMessage(error))
                ? 'no'
                : current.fileExists,
            status: `Recent open failed at ${recentFailureStep}: ${getBridgeErrorMessage(error)}`,
          }))
        }
        throw error
      } finally {
        desktopDocumentTransitionRef.current = {
          active: false,
          targetDocumentPath: '',
        }
      }
    },
    [
      currentDocument.fileName,
      currentDocument.documentPath,
      currentDocument.source,
      isPdfDesktopDocument,
      loadPdfDocument,
      loadDocumentFromText,
      rememberRecentDesktopDocument,
      teardownActivePdfBeforeDocumentReplacement,
    ],
  )

  const handleOpenDesktopDocumentFile = async () => {
    if (isDesktopOpenPending) {
      return
    }

    setDesktopOpenStatus('Opening desktop file dialog...')
    setDesktopNotesStatus('')
    setIsDesktopOpenPending(true)

    try {
      const { isTauri } = await import('@tauri-apps/api/core')
      const runtimeDetected = isTauri()

      console.info('[NoteAnchor desktop open] Tauri runtime detected:', runtimeDetected)

      if (!runtimeDetected) {
        setDesktopOpenStatus(
          'Desktop file opening is available only in the Tauri app.',
        )
        return
      }

      const { isTauri: confirmTauri } = await import('@tauri-apps/api/core')
      const { open } = await import('@tauri-apps/plugin-dialog')
      console.info('[NoteAnchor desktop open] dialog plugin imported')
      const selectedPath = await open({
        title: 'Open document',
        multiple: false,
        directory: false,
        filters: [{ name: 'Documents', extensions: ['txt', 'docx', 'pdf'] }],
      })

      console.info('[NoteAnchor desktop open] selected path:', selectedPath)

      if (!selectedPath || Array.isArray(selectedPath)) {
        setDesktopOpenStatus('')
        return
      }

      if (!confirmTauri()) {
        setDesktopOpenStatus(
          'Desktop file opening is available only in the Tauri app.',
        )
        return
      }
      setIsRecentDocumentsOpen(false)
      await openDesktopDocumentByPath(selectedPath, 'open')
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      console.error('[NoteAnchor desktop open] failed:', error)
      setDesktopOpenStatus(`Desktop file open error: ${errorMessage}`)
    } finally {
      setIsDesktopOpenPending(false)
    }
  }

  const handleOpenRecentDocument = async (documentPath: string) => {
    if (isDesktopOpenPending) {
      return
    }

    if (!confirmReplaceCurrentDocument()) {
      return
    }

    setIsDesktopOpenPending(true)
    setDesktopOpenStatus('Opening recent document...')
    setDesktopNotesStatus('')

    try {
      setIsRecentDocumentsOpen(false)
      await openDesktopDocumentByPath(documentPath, 'recent')
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      console.error('[NoteAnchor recent] failed to open recent document:', error)
      setRecentOpenDiagnostic((current) => ({
        ...current,
        failedAt: current.failedAt || 'openDesktopDocumentByPath',
        status: `Recent open failed: ${errorMessage}`,
      }))
      if (/not found|cannot find|os error 2/i.test(errorMessage)) {
        setMissingRecentDocument({
          documentPath,
          fileName: getFileNameFromPath(documentPath),
        })
        setDesktopOpenStatus('')
      } else {
        setDesktopOpenStatus(`Desktop file open error: ${errorMessage}`)
      }
    } finally {
      setIsDesktopOpenPending(false)
    }
  }

  const handleRemoveRecentDocument = (documentPath: string) => {
    const normalizedPath = normalizeDesktopFilePath(documentPath)

    setRecentDocuments((currentEntries) =>
      currentEntries.filter(
        (entry) =>
          normalizeDesktopFilePath(entry.documentPath).toLowerCase() !==
          normalizedPath.toLowerCase(),
      ),
    )
  }

  const closeMissingRecentDocumentDialog = () => {
    setMissingRecentDocument(null)
  }

  const closeExportFeedback = () => {
    setExportFeedback(null)
  }

  const handleShowExportInFileInfo = () => {
    setIsDebugToolsOpen(true)
    setIsRecentDocumentsOpen(false)
    setExportFeedback(null)
  }

  const handleRemoveMissingRecentDocument = () => {
    if (!missingRecentDocument) {
      return
    }

    handleRemoveRecentDocument(missingRecentDocument.documentPath)
    setDesktopOpenStatus('Removed missing document from Recent.')
    setMissingRecentDocument(null)
  }

  const handleClearRecentDocuments = () => {
    setRecentDocuments([])
    setMissingRecentDocument(null)
    setDesktopOpenStatus('Recent document shortcuts cleared.')
  }

  const togglePdfSidebarNoteExpanded = useCallback((noteId: number) => {
    setExpandedPdfSidebarNoteIds((currentIds) =>
      currentIds.includes(noteId)
        ? currentIds.filter((currentId) => currentId !== noteId)
        : [...currentIds, noteId],
    )
  }, [])

  const handleTextFileSelected = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const detectedDocumentKind = await detectBrowserSelectedDocumentKind(file)

    if (detectedDocumentKind === 'pdf') {
      setDesktopOpenStatus(
        'PDF opening must use the desktop PDF path. This browser fallback will not open PDF files as text.',
      )
      window.alert(
        'PDF opening is available through the desktop NoteAnchor app path. This browser fallback will not open PDF files as plain text.',
      )
      return
    }

    if (detectedDocumentKind === 'docx') {
      setDesktopOpenStatus(
        'DOCX opening must use the desktop document path. This browser fallback does not decode DOCX files.',
      )
      window.alert(
        'DOCX opening is available through the desktop NoteAnchor app path. This browser fallback does not decode DOCX files.',
      )
      return
    }

    if (detectedDocumentKind !== 'txt') {
      setDesktopOpenStatus(
        'Unsupported browser-opened file. Use a .txt file here, or use the desktop app path for PDF and DOCX.',
      )
      window.alert(
        'This browser fallback can open plain text files only. Use the desktop NoteAnchor app path for PDF and DOCX documents.',
      )
      return
    }

    const text = await file.text()
    const nextDocument = createFileDocumentMetadata(file)
    desktopDocumentTransitionRef.current = {
      active: false,
      targetDocumentPath: '',
    }
    loadDocumentFromText(text, nextDocument)
  }

  const scrollElementIntoWorkspace = useCallback((
    element: HTMLElement | null,
    options?: {
      bottomSafeMargin?: number
      topSafeMargin?: number
      source?: string
      targetId?: number | null
      preferredViewportOffset?: number
    },
  ) => {
    const workspaceElement = workspaceRef.current

    if (!workspaceElement || !element) {
      return
    }

    const workspaceRect = workspaceElement.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const topSafeMargin = options?.topSafeMargin ?? workspaceTopSafeMargin
    const bottomSafeMargin = options?.bottomSafeMargin ?? workspaceBottomSafeMargin
    let nextScrollTop = workspaceElement.scrollTop
    const preferredViewportOffset =
      options?.preferredViewportOffset ?? workspaceElement.clientHeight * 0.34
    const preferredScrollTop =
      workspaceElement.scrollTop +
      (elementRect.top - workspaceRect.top) -
      preferredViewportOffset

    if (
      elementRect.top >= workspaceRect.top + topSafeMargin &&
      elementRect.bottom <= workspaceRect.bottom - bottomSafeMargin
    ) {
      nextScrollTop = preferredScrollTop
    } else if (elementRect.top < workspaceRect.top + topSafeMargin) {
      nextScrollTop -= workspaceRect.top + topSafeMargin - elementRect.top
    } else if (elementRect.bottom > workspaceRect.bottom - bottomSafeMargin) {
      nextScrollTop +=
        elementRect.bottom - (workspaceRect.bottom - bottomSafeMargin)
    }

    const maxScrollTop =
      workspaceElement.scrollHeight - workspaceElement.clientHeight
    const clampedScrollTop = Math.min(
      Math.max(0, nextScrollTop),
      Math.max(0, maxScrollTop),
    )

    if (Math.abs(clampedScrollTop - workspaceElement.scrollTop) > 1) {
      workspaceElement.scrollTo({
        top: clampedScrollTop,
      })
    }

  }, [])

  useEffect(() => {
    const query = documentSearchText.trim()

    if (!query || !documentFindMatches.length) {
      setActiveFindMatchIndex(-1)
      return
    }

    setActiveFindMatchIndex((currentIndex) =>
      currentIndex >= 0 && currentIndex < documentFindMatches.length
        ? currentIndex
        : 0,
    )
  }, [documentFindMatches.length, documentSearchText, isWholeWordFind])

  useEffect(() => {
    if (activeFindMatchIndex < 0) {
      return
    }

    let cancelled = false
    let secondFrameId = 0

    const firstFrameId = requestAnimationFrame(() => {
      const targetElement = findMatchRefs.current.get(activeFindMatchIndex) ?? null

      scrollElementIntoWorkspace(targetElement, {
        preferredViewportOffset:
          workspaceRef.current?.clientHeight
            ? workspaceRef.current.clientHeight * 0.32
            : undefined,
        source: 'Find in text',
      })

      secondFrameId = requestAnimationFrame(() => {
        if (cancelled) {
          return
        }

        const workspaceElement = workspaceRef.current
        const latestTargetElement = findMatchRefs.current.get(activeFindMatchIndex) ?? null

        if (
          workspaceElement &&
          latestTargetElement &&
          !isElementVisibleInWorkspace(
            workspaceElement,
            latestTargetElement,
            workspaceTopSafeMargin,
            workspaceBottomSafeMargin,
          )
        ) {
          const workspaceRect = workspaceElement.getBoundingClientRect()
          const targetRect = latestTargetElement.getBoundingClientRect()
          const preferredViewportOffset = workspaceElement.clientHeight * 0.32
          let correctedScrollTop =
            workspaceElement.scrollTop +
            (targetRect.top - workspaceRect.top) -
            preferredViewportOffset

          if (targetRect.top < workspaceRect.top + workspaceTopSafeMargin) {
            correctedScrollTop =
              workspaceElement.scrollTop +
              (targetRect.top - workspaceRect.top) -
              workspaceTopSafeMargin
          } else if (
            targetRect.bottom >
            workspaceRect.bottom - workspaceBottomSafeMargin
          ) {
            correctedScrollTop =
              workspaceElement.scrollTop +
              (targetRect.bottom - workspaceRect.bottom) +
              workspaceBottomSafeMargin
          }
          const maxScrollTop =
            workspaceElement.scrollHeight - workspaceElement.clientHeight

          workspaceElement.scrollTo({
            top: Math.min(
              Math.max(0, correctedScrollTop),
              Math.max(0, maxScrollTop),
            ),
          })
        }
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrameId)
      if (secondFrameId) {
        cancelAnimationFrame(secondFrameId)
      }
    }
  }, [activeFindMatchIndex, scrollElementIntoWorkspace])

  const handleFindNext = () => {
    if (!documentFindMatches.length) {
      return
    }

    setActiveFindMatchIndex((currentIndex) =>
      currentIndex < 0
        ? 0
        : (currentIndex + 1) % documentFindMatches.length,
    )
  }

  const handleFindPrevious = () => {
    if (!documentFindMatches.length) {
      return
    }

    setActiveFindMatchIndex((currentIndex) =>
      currentIndex < 0
        ? documentFindMatches.length - 1
        : (currentIndex - 1 + documentFindMatches.length) % documentFindMatches.length,
    )
  }

  const activateNote = (noteId: number, shouldScroll = false) => {
    setPendingDeleteNoteId((currentId) => (currentId === noteId ? currentId : null))
    setActiveNoteId(noteId)

    if (!shouldScroll) {
      return
    }

    requestAnimationFrame(() => {
      const targetElement =
        highlightRefs.current.get(noteId) ??
        noteCardRefs.current.get(noteId) ??
        null

      scrollElementIntoWorkspace(targetElement, {
        preferredViewportOffset:
          workspaceRef.current?.clientHeight
            ? workspaceRef.current.clientHeight * 0.32
            : undefined,
        source: 'Note activation',
        targetId: noteId,
      })
    })
  }

  const activatePdfTextNote = useCallback((noteId: number, shouldScroll = false) => {
    const targetNote = notes.find((note) => note.id === noteId) ?? null

    if (targetNote && getPdfAnchorType(targetNote) === 'text') {
      setPdfInteractionMode('text')
      setPendingPdfPointAnchor(null)
      clearTemporarySelection(true)
    }

    activateNote(noteId, shouldScroll)
  }, [clearTemporarySelection, notes])

  const openPdfNote = useCallback((noteId: number, source: string, closeNotesList = false) => {
    const requestedNote = notes.find((note) => note.id === noteId) ?? null

    if (requestedNote && getPdfAnchorType(requestedNote)) {
      pendingPdfReadingRestoreRef.current = null
      appliedPdfReadingRestoreRef.current = {
        documentPath: currentPdfDocumentPathRef.current,
        sessionKey: currentPdfOpenSessionKeyRef.current,
      }

      if (ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && getPdfAnchorType(requestedNote) === 'text') {
        setPdfInteractionMode('text')
        setPendingPdfPointAnchor(null)
        clearTemporarySelection(true)
      }

      if (!isPdfPreviewFallbackLegacyPageNote(requestedNote)) {
        const targetPage = requestedNote.pdfPageNumber ?? 1
        const targetPageText = String(targetPage)

        if (currentPdfPage !== targetPage) {
          setPdfCurrentPage(targetPage)
        }

        if (pdfPageInput !== targetPageText) {
          setPdfPageInput(targetPageText)
        }
      }
    }

    setPendingNoteOpenScroll({
      noteId,
      source,
    })

    if (closeNotesList) {
      setIsNotesListOpen(false)
    }
  }, [
    clearTemporarySelection,
    currentPdfPage,
    notes,
    pdfPageInput,
  ])

  const handleAddExperimentalPdfTextNote = useCallback(() => {
    if (!pendingPdfTextSelection?.anchor) {
      return
    }

    const existingNote = notes.find(
      (note) =>
        getPdfAnchorType(note) === 'text' &&
        note.pdfSelectionKey &&
        note.pdfSelectionKey === pendingPdfTextSelection.anchor.pdfSelectionKey,
    )

    setPendingDeleteNoteId(null)
    setPendingPdfPointAnchor(null)
    setIsEditorOpen(true)
    setEditorAnchor(pendingPdfTextSelection.anchor)
    setEditorSelectedText(pendingPdfTextSelection.anchor.selectedText)

    if (existingNote) {
      setEditingNoteId(existingNote.id)
      setNoteDraft(existingNote.comment)
      setActiveNoteId(existingNote.id)
      return
    }

    setEditingNoteId(null)
    setNoteDraft('')
  }, [notes, pendingPdfTextSelection])

  const openNoteFromAllNotes = useCallback((noteId: number) => {
    openPdfNote(noteId, 'All notes', true)
  }, [openPdfNote])

  useEffect(() => {
    if (!pendingNoteOpenScroll || isNotesListOpen) {
      return
    }

    const requestedNote =
      notes.find((note) => note.id === pendingNoteOpenScroll.noteId) ?? null

    if (activeNoteId !== pendingNoteOpenScroll.noteId) {
      setActiveNoteId(pendingNoteOpenScroll.noteId)
      return
    }

    if (
      requestedNote &&
      getPdfAnchorType(requestedNote) &&
      !isPdfPreviewFallbackLegacyPageNote(requestedNote) &&
      (requestedNote.pdfPageNumber ?? 1) !== currentPdfPage
    ) {
      return
    }

    let cancelled = false

    const firstFrameId = requestAnimationFrame(() => {
      if (cancelled) {
        return
      }

      const highlightElement = highlightRefs.current.get(pendingNoteOpenScroll.noteId) ?? null
      const cardElement = noteCardRefs.current.get(pendingNoteOpenScroll.noteId) ?? null
      const isPdfTextTarget = requestedNote ? getPdfAnchorType(requestedNote) === 'text' : false
      const targetElement = highlightElement ?? (isPdfTextTarget ? null : cardElement)

      if (!targetElement) {
        return
      }

      const targetType = highlightElement ? 'highlight' : 'note card'

      scrollElementIntoWorkspace(targetElement, {
        preferredViewportOffset:
          workspaceRef.current?.clientHeight
            ? workspaceRef.current.clientHeight * 0.32
            : undefined,
        source: `${pendingNoteOpenScroll.source} -> ${targetType}`,
        targetId: pendingNoteOpenScroll.noteId,
      })

      if (requestedNote) {
        setDesktopOpenStatus(
          `Opened note: ${requestedNote.selectedText} · Scroll: ${targetType}`,
        )
      }

      setPendingNoteOpenScroll(null)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrameId)
    }
  }, [
    activeNoteId,
    currentPdfPage,
    isNotesListOpen,
    notes,
    pendingNoteOpenScroll,
    scrollElementIntoWorkspace,
  ])

  const handleCancelNote = () => {
    closeNoteEditor()
  }

  const handleSaveNote = () => {
    const comment = noteDraft.trim()

    if (!editorAnchor || !comment) {
      return
    }

    if (editingNoteId !== null) {
      const editingTextNote =
        notes.find((note) => note.id === editingNoteId && getPdfAnchorType(note) === 'text') ?? null
      setNotes((currentNotes) =>
        currentNotes.map((note) =>
          note.id === editingNoteId ? { ...note, ...editorAnchor, comment } : note,
        ),
      )
      setPdfTextHighlightDiagnostic((current) => ({
        ...current,
        lastSaveApplied: Boolean(editingTextNote),
      }))
      setActiveNoteId(editingNoteId)
      closeNoteEditor()
      clearTemporarySelection(true)
      return
    }

    const noteId = getNextNoteId(notes)

    setNotes((currentNotes) => [
      ...currentNotes,
      {
        id: noteId,
        ...editorAnchor,
        comment,
      },
    ])
    setPdfTextHighlightDiagnostic((current) => ({
      ...current,
      lastSaveApplied: getPdfAnchorType(editorAnchor) === 'text',
    }))
    setActiveNoteId(noteId)
    closeNoteEditor()
    clearTemporarySelection(true)
  }

  const handleEditNote = (note: Note) => {
    setPendingDeleteNoteId(null)
    setPendingPdfPointAnchor(null)
    if (ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && getPdfAnchorType(note) === 'text') {
      setPdfInteractionMode('text')
      activatePdfTextNote(note.id)
    } else {
      activateNote(note.id)
    }
    setEditingNoteId(note.id)
    setEditorAnchor({
      documentType: note.documentType,
      paragraphIndex: note.paragraphIndex,
      startOffset: note.startOffset,
      endOffset: note.endOffset,
      anchorType: note.anchorType,
      noteKind: note.noteKind,
      pdfPageNumber: note.pdfPageNumber,
      xRatio: note.xRatio,
      yRatio: note.yRatio,
      widthRatio: note.widthRatio,
      heightRatio: note.heightRatio,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      pageWidth: note.pageWidth,
      pageHeight: note.pageHeight,
      pdfHighlightRects: note.pdfHighlightRects,
      pdfSelectionKey: note.pdfSelectionKey,
      pdfTextAnchorItemIndex: note.pdfTextAnchorItemIndex,
      pdfTextAnchorLeftRatio: note.pdfTextAnchorLeftRatio,
      pdfTextAnchorTopRatio: note.pdfTextAnchorTopRatio,
      pdfTextAnchorTokenIndex: note.pdfTextAnchorTokenIndex,
      selectedText: note.selectedText,
      context: note.context,
    })
    setEditorSelectedText(note.selectedText)
    setNoteDraft(note.comment)
    setIsEditorOpen(true)
  }

  const handleDeleteNoteRequest = (noteId: number) => {
    setPendingDeleteNoteId(noteId)
    setActiveNoteId(noteId)
  }

  const handleRefreshLegacyPdfTextNote = useCallback((noteId: number) => {
    setPdfRefreshDiagnostic({
      applied: false,
      blockedReason: '',
      requested: true,
    })
    console.info('[NoteAnchor PDF refresh] requested for note:', noteId)
    const targetNote = notes.find((note) => note.id === noteId) ?? null

    if (!targetNote || getPdfAnchorType(targetNote) !== 'text' || !isLegacyPdfTextNote(targetNote)) {
      console.warn('[NoteAnchor PDF refresh] aborted: note is missing or no longer legacy text note.')
      setPdfRefreshDiagnostic({
        applied: false,
        blockedReason: 'Refresh target is missing or is no longer a legacy PDF text note.',
        requested: true,
      })
      return
    }

    if (pdfInteractionMode !== 'text' || !currentExperimentalPdfTextSelectionAnchor) {
      console.warn('[NoteAnchor PDF refresh] aborted: no current Text mode selection available.', {
        hasCurrentSelection: Boolean(currentExperimentalPdfTextSelectionAnchor),
        pdfInteractionMode,
      })
      setPdfRefreshDiagnostic({
        applied: false,
        blockedReason: 'No current valid PDF text selection is available in Text mode.',
        requested: true,
      })
      setDesktopOpenStatus(
        'Select the current PDF text fragment in Text mode, then refresh this note.',
      )
      return
    }

    console.info('[NoteAnchor PDF refresh] applying current selection anchor to legacy note.', {
      noteId,
      nextPdfSelectionKey: currentExperimentalPdfTextSelectionAnchor.pdfSelectionKey,
      nextSelectedText: currentExperimentalPdfTextSelectionAnchor.selectedText,
      nextHighlightRectCount: currentExperimentalPdfTextSelectionAnchor.pdfHighlightRects?.length ?? 0,
    })

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              ...currentExperimentalPdfTextSelectionAnchor,
              comment: note.comment,
            }
          : note,
      ),
    )
    setActiveNoteId(noteId)
    setPendingDeleteNoteId(null)
    setDesktopOpenStatus('PDF text note refreshed from the current text selection.')
    setPdfRefreshDiagnostic({
      applied: true,
      blockedReason: '',
      requested: true,
    })
    setPdfTextHighlightDiagnostic((current) => ({
      ...current,
      lastRefreshApplied: true,
    }))

    if (editingNoteId === noteId) {
      setEditorAnchor(currentExperimentalPdfTextSelectionAnchor)
      setEditorSelectedText(currentExperimentalPdfTextSelectionAnchor.selectedText)
    }

    clearTemporarySelection(true)
  }, [
    clearTemporarySelection,
    currentExperimentalPdfTextSelectionAnchor,
    editingNoteId,
    notes,
    pdfInteractionMode,
  ])

  const handleDeleteNoteCancel = (noteId: number) => {
    setPendingDeleteNoteId((currentId) => (currentId === noteId ? null : currentId))
  }

  const handleDeleteNoteConfirm = (noteId: number) => {
    const deletedNote = notes.find((note) => note.id === noteId) ?? null
    highlightRefs.current.delete(noteId)
    noteCardRefs.current.delete(noteId)
    setConnectorLines([])
    setNoteCardPositions((currentPositions) =>
      currentPositions.filter((position) => position.id !== noteId),
    )
    setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId))
    setPendingDeleteNoteId((currentId) => (currentId === noteId ? null : currentId))
    setExpandedPdfSidebarNoteIds((currentIds) =>
      currentIds.filter((currentId) => currentId !== noteId),
    )

    if (activeNoteId === noteId) {
      setActiveNoteId(null)
    }

    if (deletedNote && getPdfAnchorType(deletedNote) === 'text') {
      clearTemporarySelection(true)
    }

    if (editingNoteId === noteId) {
      setIsEditorOpen(false)
      setEditingNoteId(null)
      setEditorAnchor(null)
      setEditorSelectedText('')
      setNoteDraft('')
    }
  }

  const handleDeleteNotesRequest = () => {
    setPendingDeleteNoteId(null)
    if (!canDeleteNotes) {
      if (!hasUserOpenedDocument) {
        setDesktopOpenStatus('Open a document to delete its notes.')
      } else {
        setDesktopOpenStatus('There are no notes to delete.')
      }
      return
    }

    setIsDeleteNotesConfirmOpen(true)
    setDeleteNotesConfirmText('')
  }

  const handleDeleteNotesConfirm = () => {
    if (!isDeleteNotesConfirmationValid) {
      return
    }

    if (
      currentDocument.source === 'desktop-file' &&
      currentDocument.documentPath
    ) {
      skipNextDesktopNotesPersistRef.current = true
    }

    setNotes([])
    setActiveNoteId(null)
    setConnectorLines([])
    setNoteCardPositions([])
    setNoteListHeight(0)
    setEditingNoteId(null)
    setEditorAnchor(null)
    setEditorSelectedText('')
    setSelectedText('')
    setSelectedAnchor(null)
    setSelectionMessage('')
    setIsEditorOpen(false)
    setNoteDraft('')
    closeDeleteNotesConfirm()
    highlightRefs.current.clear()
    noteCardRefs.current.clear()
    if (
      currentDocument.source === 'desktop-file' &&
      currentDocument.documentPath
    ) {
      console.info(
        '[NoteAnchor notes] clearing notes for desktop document:',
        currentDocument.documentPath,
      )
      void import('@tauri-apps/api/core')
        .then(({ invoke, isTauri }) => {
          if (!isTauri()) {
            return
          }

          return invoke<string>('clear_notes_file', {
            documentPath: currentDocument.documentPath,
            notesFilePath: currentDocument.notesFilePath,
          })
        })
        .then((clearedPath) => {
          if (clearedPath) {
            console.info('[NoteAnchor notes] cleared notes file:', clearedPath)
            setDesktopNotesStatus('')
            setDesktopOpenStatus(
              'Notes deleted for this document. Original text was not changed.',
            )
          }
        })
        .catch((error) => {
          const errorMessage = getBridgeErrorMessage(error)
          console.error('[NoteAnchor notes] failed to clear desktop notes:', error)
          setDesktopNotesStatus(`Notes save error: ${errorMessage}`)
        })

      return
    }

    window.localStorage.removeItem(currentDocument.storageKey)
    setDesktopNotesStatus('')
    setDesktopOpenStatus(
      'Notes deleted for this document. Original text was not changed.',
    )
  }

  const handleContinueInvalidSidecarMemoryOnly = () => {
    if (!invalidSidecarRecovery) {
      return
    }

    setInvalidSidecarRecovery((current) =>
      current ? { ...current, mode: 'memory-only' } : current,
    )
    setDesktopOpenStatus(invalidSidecarProtectedStatusMessage)
  }

  const handleCancelReplaceInvalidSidecar = () => {
    setInvalidSidecarRecovery((current) =>
      current ? { ...current, mode: 'memory-only' } : current,
    )
    setDesktopNotesStatus(
      'Notes are currently in memory only. The existing .notes.json was rejected and will not be overwritten automatically.',
    )
    setDesktopOpenStatus(invalidSidecarProtectedStatusMessage)
  }

  const handleSaveInvalidSidecarRecovery = async () => {
    if (
      isInvalidSidecarRecoveryPending ||
      currentDocument.source !== 'desktop-file' ||
      !currentDocument.documentPath
    ) {
      return
    }

    setIsInvalidSidecarRecoveryPending(true)
    setDesktopNotesStatus('Saving notes...')

    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core')

      if (!isTauri()) {
        setDesktopNotesStatus('')
        setDesktopOpenStatus('Desktop notes recovery is available only in the Tauri app.')
        return
      }

      const payload = createDesktopNotesPayload(currentDocument, notes)
      const recoveredPath = await invoke<string>('save_recovered_notes_file', {
        documentPath: currentDocument.documentPath,
        contents: payload,
      })

      shouldBlockDesktopNotesPersistRef.current = false
      setCurrentDocument((current) =>
        current.source === 'desktop-file' &&
        current.documentPath === currentDocument.documentPath
          ? { ...current, notesFilePath: recoveredPath }
          : current,
      )
      setInvalidSidecarRecovery(null)
      setDesktopNotesStatus(`Notes saved to: ${recoveredPath}`)
      setDesktopOpenStatus(
        `Invalid .notes.json was left unchanged. Recovered notes file: ${recoveredPath}`,
      )
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      setDesktopNotesStatus(`Notes save error: ${errorMessage}. Notes remain in memory.`)
      setDesktopOpenStatus(
        'Could not save recovered notes file. The invalid .notes.json was left unchanged and notes remain only in memory.',
      )
    } finally {
      setIsInvalidSidecarRecoveryPending(false)
    }
  }

  const handleConfirmReplaceInvalidSidecar = async () => {
    if (
      isInvalidSidecarRecoveryPending ||
      currentDocument.source !== 'desktop-file' ||
      !currentDocument.documentPath
    ) {
      return
    }

    setIsInvalidSidecarRecoveryPending(true)
    setDesktopNotesStatus('Saving notes...')

    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core')

      if (!isTauri()) {
        setDesktopNotesStatus('')
        setDesktopOpenStatus('Replacing invalid notes is available only in the Tauri app.')
        return
      }

      const payload = createDesktopNotesPayload(currentDocument, notes)
      const replacedPath = await invoke<string>('save_notes_file', {
        documentPath: currentDocument.documentPath,
        contents: payload,
        notesFilePath: invalidSidecarRecovery?.invalidNotesFilePath ?? currentDocument.notesFilePath,
      })

      shouldBlockDesktopNotesPersistRef.current = false
      setCurrentDocument((current) =>
        current.source === 'desktop-file' &&
        current.documentPath === currentDocument.documentPath
          ? { ...current, notesFilePath: replacedPath }
          : current,
      )
      setInvalidSidecarRecovery(null)
      setDesktopNotesStatus(`Notes saved to: ${replacedPath}`)
      setDesktopOpenStatus('Invalid .notes.json was replaced. Autosave is using the original notes path again.')
    } catch (error) {
      const errorMessage = getBridgeErrorMessage(error)
      setDesktopNotesStatus(`Notes save error: ${errorMessage}. Notes remain in memory.`)
      setDesktopOpenStatus(
        'Could not replace the invalid .notes.json. The original file stays untouched and notes remain only in memory.',
      )
    } finally {
      setIsInvalidSidecarRecoveryPending(false)
    }
  }

  const setHighlightRef = (noteId: number) => (node: HTMLElement | null) => {
    if (node) {
      highlightRefs.current.set(noteId, node)
      return
    }

    highlightRefs.current.delete(noteId)
  }

  const setNoteCardRef = (noteId: number) => (node: HTMLElement | null) => {
    if (node) {
      noteCardRefs.current.set(noteId, node)
      return
    }

    noteCardRefs.current.delete(noteId)
  }

  const setFindMatchRef = (matchIndex: number) => (node: HTMLElement | null) => {
    if (node) {
      findMatchRefs.current.set(matchIndex, node)
      return
    }

    findMatchRefs.current.delete(matchIndex)
  }

  const renderFindHighlights = (
    text: string,
    offsetStart: number,
    paragraphMatches: DocumentFindMatch[],
  ) => {
    if (!paragraphMatches.length || !documentSearchText.trim()) {
      return text
    }

    const relevantMatches = paragraphMatches.filter(
      (match) =>
        match.startOffset >= offsetStart &&
        match.endOffset <= offsetStart + text.length,
    )

    if (!relevantMatches.length) {
      return text
    }

    const parts: ReactNode[] = []
    let cursor = offsetStart

    relevantMatches.forEach((match) => {
      if (match.startOffset > cursor) {
        parts.push(text.slice(cursor - offsetStart, match.startOffset - offsetStart))
      }

      const isActiveFindMatch = activeFindMatchIndex === match.index
      parts.push(
        <span
          className={
            isActiveFindMatch
              ? 'find-highlight find-highlight-active'
              : 'find-highlight'
          }
          key={`find-${match.index}`}
          ref={setFindMatchRef(match.index)}
        >
          {text.slice(match.startOffset - offsetStart, match.endOffset - offsetStart)}
        </span>,
      )
      cursor = match.endOffset
    })

    if (cursor < offsetStart + text.length) {
      parts.push(text.slice(cursor - offsetStart))
    }

    return parts
  }

  const renderHighlightedParagraph = (paragraph: string, paragraphIndex: number) => {
    const noteMatches = notes
      .map((note) => ({
        note,
        resolvedAnchor: resolvedAnchorsById.get(note.id),
      }))
      .filter(
        (entry) =>
          entry.resolvedAnchor?.paragraphIndex === paragraphIndex &&
          entry.resolvedAnchor.status !== 'review',
      )
      .map((note) => ({
        id: note.note.id,
        isRelinked: Boolean(note.note.previousSelectedText?.trim()),
        start: note.resolvedAnchor?.startOffset ?? 0,
        end: note.resolvedAnchor?.endOffset ?? 0,
      }))
      .filter((match): match is { id: number; isRelinked: boolean; start: number; end: number } =>
        match.start >= 0 && match.end > match.start && match.end <= paragraph.length,
      )
      .sort((first, second) => first.start - second.start)
    const paragraphFindMatches = findMatchesByParagraph.get(paragraphIndex) ?? []

    if (!noteMatches.length) {
      return renderFindHighlights(paragraph, 0, paragraphFindMatches)
    }

    const parts: ReactNode[] = []
    let cursor = 0

    noteMatches.forEach((match) => {
      if (match.start < cursor) {
        return
      }

      if (match.start > cursor) {
        parts.push(
          renderFindHighlights(
            paragraph.slice(cursor, match.start),
            cursor,
            paragraphFindMatches,
          ),
        )
      }

      parts.push(
        <mark
          className={[
            'saved-highlight',
            match.isRelinked ? 'saved-highlight-relinked' : '',
            activeNoteId === match.id ? 'saved-highlight-active' : '',
            activeNoteId === match.id && match.isRelinked
              ? 'saved-highlight-relinked-active'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-note-highlight="true"
          key={match.id}
          onClick={() => {
            clearTemporarySelection(true)
            activateNote(match.id)
          }}
          ref={setHighlightRef(match.id)}
        >
          {renderFindHighlights(
            paragraph.slice(match.start, match.end),
            match.start,
            paragraphFindMatches,
          )}
        </mark>,
      )

      cursor = match.end
    })

    if (cursor < paragraph.length) {
      parts.push(
        renderFindHighlights(
          paragraph.slice(cursor),
          cursor,
          paragraphFindMatches,
        ),
      )
    }

    return parts
  }

  const getAnchorReviewMessage = (noteId: number) =>
    resolvedAnchorsById.get(noteId)?.status === 'review'
      ? 'Text fragment not found'
      : null

  const getAnchorReviewHint = (noteId: number) =>
    resolvedAnchorsById.get(noteId)?.status === 'review'
      ? 'The document text may have changed. Select the correct fragment and use Link again.'
      : null

  const getAnchorReviewOriginalText = (noteId: number, selectedText: string) => {
    if (resolvedAnchorsById.get(noteId)?.status !== 'review') {
      return null
    }

    const trimmedSelectedText = selectedText.trim()

    return trimmedSelectedText || 'Original text unavailable'
  }

  const getPreviousSelectedText = (note: Note) => {
    const trimmedPreviousSelectedText = note.previousSelectedText?.trim()

    return trimmedPreviousSelectedText || null
  }

  return (
    <div className="app-shell">
      <header className="top-bar" ref={topBarRef}>
        <div className="toolbar-stack">
          <div className="header-main">
            <div className="toolbar" aria-label="Document actions" ref={selectionActionsRef}>
              <button
                className="primary-button"
                disabled={isDesktopOpenPending}
                type="button"
                onClick={() => {
                  void handleOpenDocument()
                }}
              >
                Open document
              </button>
              <button
                aria-expanded={isRecentDocumentsOpen}
                className="secondary-action-button"
                disabled={!hasRecentDocuments}
                title={
                  hasRecentDocuments
                    ? 'Open one of your recently used desktop documents.'
                    : 'Recent documents will appear here after you open a desktop document.'
                }
                type="button"
                onClick={() => {
                  setIsRecentDocumentsOpen((isOpen) => !isOpen)
                  setIsDebugToolsOpen(false)
                }}
              >
                Recent
              </button>
              <button
                className="secondary-action-button"
                  disabled={!canAddNote}
                  title={
                    isPdfDesktopDocument
                      ? isPdfPreviewOnlyFallback
                        ? 'Add a document note for this PDF preview.'
                        : pdfInteractionMode === 'text'
                          ? currentExperimentalPdfTextSelectionAnchor
                            ? 'Add a note for the selected PDF text.'
                            : isPdfTextPageLayoutGuarded
                              ? 'Text notes are unavailable on this page layout. Use Point mode or page notes.'
                              : isPdfTextSingleLineOnlyLayout
                                ? 'Select one line of PDF text to add a text note, or use Point mode for other notes.'
                                : 'Select PDF text to add a text note.'
                          : `Add a note for PDF page ${currentPdfPage}.`
                      : hasValidSelection
                      ? 'Add a note for the current text selection.'
                      : activeFindMatchAnchor
                      ? 'Add a note for the current match.'
                      : 'Select text or use Find to add a note.'
                }
                type="button"
                onClick={handleAddNote}
                onMouseDown={(event) => event.preventDefault()}
              >
                Add note
              </button>
              <button
                className="secondary-action-button"
                disabled={!canReconnectActiveNote}
                title={
                  isPdfDesktopDocument
                    ? 'Link again is available only for text-fragment notes.'
                    : activeNote && isActiveNoteUnresolved
                    ? hasValidSelection
                      ? 'Link this note again to the selected text.'
                      : 'Select the correct text fragment in the document to link this note again.'
                    : 'Select a note with a missing text fragment to link it again.'
                }
                type="button"
                onClick={handleReconnectActiveNote}
              >
                Link again
              </button>
              <input
                accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="file-input"
                onChange={handleTextFileSelected}
                ref={fileInputRef}
                type="file"
              />
              <button
                aria-expanded={isNotesListOpen}
                type="button"
                onClick={() => setIsNotesListOpen((isOpen) => !isOpen)}
              >
                All notes
              </button>
              <button
                disabled={!canExportNotes}
                title={
                  currentDocument.source !== 'desktop-file'
                    ? 'Export is available for desktop-opened documents.'
                    : isPdfDesktopDocument
                      ? 'Export notes is unavailable for PDFs in this version.'
                    : notes.length
                      ? undefined
                      : 'There are no notes to export.'
                }
                type="button"
                onClick={() => {
                  void handleExportNotes()
                }}
              >
                Export notes
              </button>
              <button
                disabled={!canPrintNotes}
                title={
                  !hasOpenDocument
                    ? 'Open a document to print its notes.'
                    : isPdfDesktopDocument
                      ? 'Print report is unavailable for PDFs in this version.'
                    : notes.length
                      ? 'Print a notes report for the current document.'
                      : 'There are no notes to print.'
                }
                type="button"
                onClick={handlePrintNotes}
              >
                Print report
              </button>
              <button
                className="subtle-danger-button"
                disabled={!canDeleteNotes}
                title={
                  !hasUserOpenedDocument
                    ? 'Open a document to delete its notes.'
                    : notes.length
                      ? undefined
                      : 'There are no notes to delete.'
                }
                type="button"
                onClick={handleDeleteNotesRequest}
              >
                Delete notes
              </button>
              <button
                className="debug-button"
                type="button"
                aria-expanded={isDebugToolsOpen}
                onClick={() => {
                  setIsDebugToolsOpen((isOpen) => !isOpen)
                  setIsHelpOpen(false)
                  setIsRecentDocumentsOpen(false)
                }}
              >
                File info
              </button>
              <button
                className="debug-button"
                type="button"
                aria-expanded={isHelpOpen}
                onClick={() => {
                  setIsHelpOpen((isOpen) => !isOpen)
                  setIsDebugToolsOpen(false)
                  setIsRecentDocumentsOpen(false)
                }}
              >
                Help
              </button>
              <button
                disabled={!canCloseDocument}
                type="button"
                onClick={handleCloseDocument}
              >
                Close document
              </button>
            </div>
          </div>
          {isPdfDesktopDocument ? (
            <div className="pdf-text-note-toolbar" ref={pdfToolbarRef}>
              {ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES ? (
                <>
                  <button
                    className={
                      pdfInteractionMode === 'text' && canSelectPdfTextMode
                        ? 'secondary-action-button pdf-text-note-button'
                        : 'pdf-text-note-clear-button'
                    }
                    disabled={!canSelectPdfTextMode}
                    type="button"
                    onClick={() => handlePdfTextModeChange('text')}
                  >
                    Text mode
                  </button>
                  <button
                    className={
                      pdfInteractionMode === 'point'
                        ? 'secondary-action-button pdf-text-note-button'
                        : 'pdf-text-note-clear-button'
                    }
                    disabled={!canUsePdfPointNotes}
                    type="button"
                    onClick={() => handlePdfTextModeChange('point')}
                  >
                    Point mode
                  </button>
                  <button
                    className="secondary-action-button pdf-text-note-button"
                    disabled={!pendingPdfTextSelection || isPdfPreviewOnlyFallback}
                    type="button"
                    onClick={handleAddExperimentalPdfTextNote}
                  >
                    {existingExperimentalPdfSelectionNote ? 'Edit fragment note' : 'Add text note'}
                  </button>
                  <button
                    className="pdf-text-note-clear-button"
                    disabled={!pendingPdfTextSelection || isPdfPreviewOnlyFallback}
                    type="button"
                    onClick={() => clearTemporarySelection(true)}
                  >
                    Clear
                  </button>
                </>
              ) : (
                <div className="pdf-page-note pdf-toolbar-status">
                  PDF text notes are disabled in the production app. Use page notes or point notes for PDFs.
                </div>
              )}
            </div>
          ) : null}
          <div className="header-meta-row">
            {shouldShowTextDocumentGuidanceInHeader ? (
              <div className="note-guidance-notice note-guidance-notice-compact">
                <div className="note-guidance-label">Text notes available</div>
                <div className="note-guidance-line note-guidance-line-available">
                  <span className="note-guidance-line-title">Available:</span>{' '}
                  <span>Text notes.</span>
                </div>
                <div className="note-guidance-line">
                  Select a fragment in the document to add a note, or use Find to locate text.
                </div>
              </div>
            ) : (
              <div
                className={
                  hasValidSelection
                    ? 'selection-summary'
                    : 'selection-summary selection-summary-idle'
                }
                title={
                  hasValidSelection
                    ? selectedText
                    : activeFindMatchAnchor
                      ? activeFindMatchAnchor.selectedText
                      : undefined
                }
              >
                {selectionSummaryText}
              </div>
            )}
            <div className="file-label" aria-label="Current file">
              <span title={currentDesktopDocumentPath || undefined}>
                {currentDocument.fileName}
              </span>
              <span
                className={
                  shouldPreferVisibleSaveStatus
                    ? 'storage-label storage-label-transient'
                    : 'storage-label'
                }
                title={
                  shouldPreferVisibleSaveStatus
                    ? effectiveDesktopNotesStatusLabel
                    : currentDesktopNotesPath && compactHeaderStatusMessage === 'Saved'
                    ? `Notes file: ${currentDesktopNotesPath}`
                    : isDesktopDocument && currentDesktopNotesPath
                      ? `Notes file: ${currentDesktopNotesPath}`
                      : headerStatusMessage || undefined
                }
              >
                {visibleFileStatusLine}
              </span>
            </div>
          </div>
          <div className="header-find-row">
            <label className="find-text-label" htmlFor="document-find-input">
              Find in text
            </label>
            <div className="find-text-controls">
              <input
                id="document-find-input"
                className="find-text-input"
                disabled={isPdfDesktopDocument}
                onChange={(event) => setDocumentSearchText(event.target.value)}
                placeholder={
                  isPdfDesktopDocument
                    ? 'Find is unavailable for PDFs in this version'
                    : 'Find in text...'
                }
                type="text"
                value={documentSearchText}
              />
              {documentSearchText ? (
                <button
                  className="find-text-clear"
                  type="button"
                  onClick={() => {
                    setDocumentSearchText('')
                    setActiveFindMatchIndex(-1)
                  }}
                >
                  Clear
                </button>
              ) : null}
              <label className="find-text-toggle">
                <input
                  checked={isWholeWordFind}
                  disabled={isPdfDesktopDocument}
                  type="checkbox"
                  onChange={(event) => setIsWholeWordFind(event.target.checked)}
                />
                <span>Whole word</span>
              </label>
              <button
                disabled={isPdfDesktopDocument || !documentFindMatches.length}
                type="button"
                onClick={handleFindPrevious}
              >
                Prev
              </button>
              <button
                disabled={isPdfDesktopDocument || !documentFindMatches.length}
                type="button"
                onClick={handleFindNext}
              >
                Next
              </button>
              <span className="find-text-counter">{documentFindCounterText}</span>
            </div>
          </div>
          {isHeaderStatusError ? (
            <div className="toolbar-status-grid">
              <div className="bridge-status-row">
                <div
                  className="bridge-status"
                  role="status"
                >
                  {headerStatusMessage}
                </div>
              </div>
              {hasInvalidSidecarRecoveryActions ? (
                <div className="invalid-sidecar-actions" role="group" aria-label="Notes recovery actions">
                  <button
                    className="secondary-action-button"
                    disabled={isInvalidSidecarRecoveryPending}
                    type="button"
                    onClick={handleSaveInvalidSidecarRecovery}
                  >
                    Save new notes separately
                  </button>
                  {invalidSidecarRecovery?.mode === 'replace-confirm' ? (
                    <>
                      <button
                        className="destructive-button"
                        disabled={isInvalidSidecarRecoveryPending}
                        type="button"
                        onClick={handleConfirmReplaceInvalidSidecar}
                      >
                        Confirm replace
                      </button>
                      <button
                        disabled={isInvalidSidecarRecoveryPending}
                        type="button"
                        onClick={handleCancelReplaceInvalidSidecar}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="subtle-danger-button"
                      disabled={isInvalidSidecarRecoveryPending}
                      type="button"
                      onClick={() =>
                        setInvalidSidecarRecovery((current) =>
                          current ? { ...current, mode: 'replace-confirm' } : current,
                        )
                      }
                    >
                      Replace invalid notes file
                    </button>
                  )}
                  <button
                    disabled={isInvalidSidecarRecoveryPending}
                    type="button"
                    onClick={handleContinueInvalidSidecarMemoryOnly}
                  >
                    Continue in memory only
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {isDebugToolsOpen ? (
            <div className="debug-tools-panel">
              <div className="panel-header-row">
                <div className="debug-tools-header">File info</div>
                <button
                  className="panel-close-button"
                  type="button"
                  onClick={() => setIsDebugToolsOpen(false)}
                >
                  Close
                </button>
              </div>
              {hasUserOpenedDocument ? (
                <div className="info-panel-grid">
                  <div className="info-panel-row">
                    <span className="info-panel-label">Document</span>
                    <span className="info-panel-value" title={currentDesktopDocumentPath || undefined}>
                      {currentDocument.fileName}
                    </span>
                  </div>
                  <div className="info-panel-row">
                    <span className="info-panel-label">Document path</span>
                    <span className="info-panel-value info-panel-value-path" title={currentDesktopDocumentPath || undefined}>
                      {currentDesktopDocumentPath || 'Available only for desktop-opened documents'}
                    </span>
                  </div>
                  {isDocxDesktopDocument ? (
                    <>
                      <div className="info-panel-row">
                        <span className="info-panel-label">Document type</span>
                        <span className="info-panel-value">DOCX opened as plain text</span>
                      </div>
                      <div className="info-panel-row">
                        <span className="info-panel-label">Original file</span>
                        <span className="info-panel-value">Not changed by NoteAnchor</span>
                      </div>
                    </>
                  ) : isPdfDesktopDocument ? (
                    <>
                      <div className="info-panel-row">
                        <span className="info-panel-label">Document type</span>
                        <span className="info-panel-value">PDF support is limited in this version</span>
                      </div>
                      <div className="info-panel-row">
                        <span className="info-panel-label">Original file</span>
                        <span className="info-panel-value">Not changed by NoteAnchor</span>
                      </div>
                    </>
                  ) : null}
                  <div className="info-panel-row">
                    <span className="info-panel-label">Notes file</span>
                    <span className="info-panel-value info-panel-value-path" title={currentDesktopNotesPath || undefined}>
                      {currentDesktopNotesPath || 'Temporary browser storage'}
                    </span>
                  </div>
                  <div className="info-panel-row">
                    <span className="info-panel-label">Export file</span>
                    <span className="info-panel-value info-panel-value-path" title={currentDesktopExportPath || undefined}>
                      {currentDesktopExportPath || (isPdfDesktopDocument
                        ? 'Unavailable for PDFs in this version'
                        : 'Available only for desktop-opened documents')}
                    </span>
                  </div>
                  <div className="info-panel-row">
                    <span className="info-panel-label">Notes</span>
                    <span className="info-panel-value">{notes.length}</span>
                  </div>
                  <div className="info-panel-row">
                    <span className="info-panel-label">
                      {isPdfDesktopDocument ? 'PDF note status' : 'Text match status'}
                    </span>
                    <span className="info-panel-value">
                      {isPdfDesktopDocument
                        ? `${notes.length} PDF note${notes.length === 1 ? '' : 's'} loaded`
                        : `Found ${anchorStatusCounts.exact}, reconnected ${anchorStatusCounts.recovered}, text fragment not found ${anchorStatusCounts.unresolved}`}
                    </span>
                  </div>
                  <div className="info-panel-row">
                    <span className="info-panel-label">Changed text warning</span>
                    <span className="info-panel-value">
                      {changedTextWarningMessage
                        ? 'Shown for this document'
                        : missingTrackingMessage
                          ? 'Tracking unavailable until next save'
                          : 'No warning'}
                    </span>
                  </div>
                  <div className="info-panel-row">
                    <span className="info-panel-label">Active note id</span>
                    <span className="info-panel-value">
                      {activeNoteId ?? 'none'}
                    </span>
                  </div>
                  {currentDocument.documentContentHash ? (
                    <div className="info-panel-row">
                      <span className="info-panel-label">Document hash (technical)</span>
                      <span
                        className="info-panel-value info-panel-value-hash"
                        title={currentDocument.documentContentHash}
                      >
                        {currentDocument.documentContentHash}
                      </span>
                    </div>
                  ) : null}
                  {bridgeStatus ? (
                    <div className="info-panel-row">
                      <span className="info-panel-label">Desktop bridge</span>
                      <span className="info-panel-value">{bridgeStatus}</span>
                    </div>
                  ) : null}
                  <div className="debug-tools-actions">
                    <button type="button" onClick={handleOpenTextFile}>
                      Browser fallback
                    </button>
                    <button
                      className="debug-button"
                      disabled={isBridgePending}
                      type="button"
                      onClick={() => {
                        void handleTestNativeBridge()
                      }}
                    >
                      Test desktop bridge
                    </button>
                  </div>
                </div>
              ) : (
                <div className="info-panel-empty-state">
                  Open a document to see file information.
                </div>
              )}
            </div>
          ) : null}
          {isRecentDocumentsOpen ? (
            <div className="recent-documents-panel">
              <div className="debug-tools-header">Recent documents</div>
              {recentDocuments.length ? (
                <>
                  <div className="recent-documents-list">
                    {recentDocuments.map((entry) => {
                      const formattedOpenedAt = formatRecentOpenedAt(entry.lastOpenedAt)
                      const parentPath = getParentPathFromPath(entry.documentPath)

                      return (
                        <div className="recent-document-item" key={entry.documentPath}>
                          <button
                            className="recent-document-button"
                            title={entry.documentPath}
                            type="button"
                            onClick={() => {
                              void handleOpenRecentDocument(entry.documentPath)
                            }}
                          >
                            <span className="recent-document-name">{entry.fileName}</span>
                            <span className="recent-document-path">{parentPath}</span>
                            {formattedOpenedAt ? (
                              <span className="recent-document-time">
                                Last opened {formattedOpenedAt}
                              </span>
                            ) : null}
                          </button>
                          <button
                            className="recent-document-remove"
                            title={`Remove ${entry.fileName} from recent documents`}
                            type="button"
                            onClick={() => handleRemoveRecentDocument(entry.documentPath)}
                          >
                            Remove
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="recent-documents-actions">
                    <button type="button" onClick={handleClearRecentDocuments}>
                      Clear recent
                    </button>
                  </div>
                </>
              ) : (
                <div className="info-panel-empty-state">
                  No recent desktop documents yet.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <main className="workspace" ref={workspaceRef}>
        {connectorLines.length && !isPdfDesktopDocument ? (
          <svg
            aria-hidden="true"
            className="connector-overlay"
            focusable="false"
            style={{
              height: workspaceCanvasSize.height || undefined,
              width: workspaceCanvasSize.width || undefined,
            }}
          >
            {connectorLines.map((line) => {
              const isActive = activeNoteId === line.id

              return (
                <line
                  className={
                    isActive
                      ? 'connector-line connector-line-active'
                      : 'connector-line'
                  }
                  key={line.id}
                  x1={line.x1}
                  x2={line.x2}
                  y1={line.y1}
                  y2={line.y2}
                />
              )
            })}
          </svg>
        ) : null}

        <section
          className="document-viewer"
          aria-labelledby="document-title"
          ref={documentViewerRef}
        >
          {hasOpenDocument ? (
            isPdfDesktopDocument ? (
              <article
                className="document-page document-page-pdf"
                key={currentDocument.documentId}
                ref={documentRef}
              >
                <div className="pdf-page-controls pdf-toolbar" ref={pdfPageControlsRef}>
                  <div className="pdf-page-label">Page</div>
                  <div className="pdf-page-navigation" aria-label="PDF page navigation">
                    <button
                      className="secondary-button pdf-page-nav-button"
                      disabled={!canGoToPreviousPdfPage}
                      onClick={() => navigatePdfPage(-1)}
                      type="button"
                    >
                      Prev page
                    </button>
                    <div className="pdf-page-indicator">
                      Page {currentPdfPage} of {Math.max(1, pdfPageCount)}
                    </div>
                    <button
                      className="secondary-button pdf-page-nav-button"
                      disabled={!canGoToNextPdfPage}
                      onClick={() => navigatePdfPage(1)}
                      type="button"
                    >
                      Next page
                    </button>
                    <input
                      id="pdf-page-input"
                      className="pdf-page-input"
                      inputMode="numeric"
                      max={Math.max(1, pdfPageCount)}
                      min={1}
                      onBlur={handlePdfPageInputBlur}
                      onPointerDown={handlePdfPageInputPointerDown}
                      onKeyDown={handlePdfPageInputKeyDown}
                      onChange={handlePdfPageInputChange}
                      title="Use arrows, or enter a page number and press Enter."
                      type="number"
                      value={pdfPageInput}
                    />
                  </div>
                  <div
                    className="pdf-page-note"
                    title="Use arrows, or enter a page number and press Enter."
                  >
                    {isPdfPreviewOnlyFallback
                      ? 'Preview only • use arrows, or enter a page number and press Enter.'
                      : 'Use arrows, or enter a page number and press Enter.'}
                  </div>
                </div>
                <h1 id="document-title">{documentTitle}</h1>
                <div className="pdf-viewer-shell" key={pdfViewerRemountKey}>
                  {pdfRenderedPage ? (
                    <div className="pdf-point-stage" key={`${pdfViewerRemountKey}-stage`}>
                        <div className="pdf-point-stage-header">
                          <div className="pdf-point-stage-label">
                            {ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES ? (
                              isPdfPreviewOnlyFallback ? (
                                previewOnlyPdfNotesMessage
                              ) : showPdfPointOnlyStatusNotice ? (
                                renderNoteGuidanceNotice({
                                  action:
                                    'Click the page to place a point note, or use Add note for a page note.',
                                  available: 'Point notes and page/document notes.',
                                  label: 'Point mode selected',
                                  unavailable: !canUsePdfTextNotes
                                    ? 'Text notes on this page.'
                                    : 'Text notes on this page layout.',
                                })
                              ) : pdfInteractionMode === 'text' ? (
                                isPdfTextPageLayoutGuarded
                                  ? experimentalPdfTextLayoutGuardMessage
                                  : isPdfTextSingleLineOnlyLayout
                                    ? renderNoteGuidanceNotice({
                                        action:
                                          'Text notes: drag across a single line on the rendered page. Point notes: switch to Point mode and click the page.',
                                        available:
                                          'Text notes (one line only), point notes, and page/document notes.',
                                        label: 'PDF text mode selected',
                                      })
                                    : renderNoteGuidanceNotice({
                                        action: `Text notes: drag across one to five adjacent lines on the rendered page ${currentPdfPage}. Point notes: switch to Point mode and click the page.`,
                                        available:
                                          'Text notes, point notes, and page/document notes.',
                                        label: 'PDF text mode selected',
                                      })
                              ) : isPdfTextSingleLineOnlyLayout ? (
                                renderNoteGuidanceNotice({
                                  action:
                                    'Click the page to place a point note, or switch to Text mode for one-line fragment notes.',
                                  available:
                                    'Point notes, one-line text notes, and page/document notes.',
                                  label: 'Point mode selected',
                                })
                              ) : (
                                renderNoteGuidanceNotice({
                                  action:
                                    'Click the page to place a point note, or switch to Text mode for fragment notes.',
                                  available:
                                    'Point notes, text notes, and page/document notes.',
                                  label: 'Point mode selected',
                                })
                              )
                            ) : (
                              'PDF text notes are disabled in the production app. Use the current page field for page notes, or click the page to place a point note.'
                            )}
                          </div>
                          </div>
                      <div className="pdf-point-shell" ref={pdfViewportHostRef}>
                        <div
                          className={
                            ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && pdfInteractionMode === 'text'
                              ? 'pdf-point-canvas-wrap pdf-point-canvas-wrap-text-mode'
                              : 'pdf-point-canvas-wrap'
                          }
                          ref={pdfCurrentPageStageRef}
                          onClick={handlePdfPointCanvasClick}
                          onPointerDown={handlePdfTextSelectionPointerDown}
                          onPointerMove={handlePdfTextSelectionPointerMove}
                          onPointerUp={handlePdfTextSelectionPointerEnd}
                          onPointerCancel={handlePdfTextSelectionPointerEnd}
                          style={{
                            height: `${pdfRenderedPage.height}px`,
                            width: `${pdfRenderedPage.width}px`,
                          }}
                        >
                          <canvas className="pdf-point-canvas" ref={pdfCanvasRef} />
                            <div
                              ref={pdfTextLayerHostRef}
                              className="pdf-text-layer-host"
                            />
                          {experimentalPdfTextNotes.flatMap((note) =>
                                (note.pdfHighlightRects ?? []).map((rect, rectIndex) => (
                                  <div
                                    key={`pdf-text-highlight-${note.id}-${rectIndex}`}
                                    className={[
                                      'pdf-text-highlight',
                                      ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && pdfInteractionMode === 'text'
                                        ? 'pdf-text-highlight-passive'
                                        : '',
                                      activeNoteId === note.id ? 'pdf-text-highlight-active' : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                    data-note-highlight="true"
                                    onClick={
                                      ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && pdfInteractionMode === 'text'
                                        ? undefined
                                        : (event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            activatePdfTextNote(note.id)
                                          }
                                    }
                                    onPointerDown={
                                      ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && pdfInteractionMode === 'text'
                                        ? undefined
                                        : (event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                          }
                                    }
                                    ref={rectIndex === 0 ? setHighlightRef(note.id) : undefined}
                                    style={{
                                      height: `${rect.heightRatio * pdfRenderedPage.height}px`,
                                      left: `${rect.xRatio * pdfRenderedPage.width}px`,
                                      top: `${rect.yRatio * pdfRenderedPage.height}px`,
                                      width: `${rect.widthRatio * pdfRenderedPage.width}px`,
                                    }}
                                    title={note.selectedText}
                                  />
                                )),
                              )}
                          {pendingPdfTextSelection?.anchor.pdfHighlightRects?.map((rect, rectIndex) => (
                            <div
                              key={`pending-pdf-text-highlight-${rectIndex}`}
                              className="pdf-text-highlight pdf-text-highlight-pending"
                              style={{
                                height: `${rect.heightRatio * pdfRenderedPage.height}px`,
                                left: `${rect.xRatio * pdfRenderedPage.width}px`,
                                top: `${rect.yRatio * pdfRenderedPage.height}px`,
                                width: `${rect.widthRatio * pdfRenderedPage.width}px`,
                              }}
                            />
                          ))}
                          {pdfPointMarkers.map((marker, index) => (
                            <div
                              key={marker.isPending ? 'pending-pdf-point-marker' : `pdf-point-marker-${marker.noteId ?? index}`}
                              className={[
                                'pdf-point-marker',
                                marker.isPending ? 'pdf-point-marker-pending' : '',
                                marker.noteId !== null && activeNoteId === marker.noteId
                                  ? 'pdf-point-marker-active'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              data-pdf-point-marker={
                                !marker.isPending && marker.noteId !== null
                                  ? String(marker.noteId)
                                  : undefined
                              }
                              onClick={
                                !marker.isPending && marker.noteId !== null
                                  ? (event) =>
                                      handlePdfPointMarkerActivate(event, marker.noteId as number)
                                  : undefined
                              }
                              onMouseDown={
                                !marker.isPending && marker.noteId !== null
                                  ? (event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }
                                  : undefined
                              }
                              style={{
                                left: `${marker.xRatio * 100}%`,
                                top: `${marker.yRatio * 100}%`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : pdfRenderError && pdfViewerSrc ? (
                    <div className="pdf-viewer-fallback">
                      <div className="pdf-viewer-fallback-notice" role="status">
                        <div className="pdf-viewer-fallback-label">Preview-only fallback</div>
                        <div className="pdf-viewer-fallback-line pdf-viewer-fallback-line-available">
                          <span className="pdf-viewer-fallback-line-title">Available:</span>{' '}
                          <span>Page notes and document notes.</span>
                        </div>
                        <div className="pdf-viewer-fallback-line pdf-viewer-fallback-line-unavailable">
                          <span className="pdf-viewer-fallback-line-title">Unavailable:</span>{' '}
                          <span>Text notes and point notes.</span>
                        </div>
                        <div className="pdf-viewer-fallback-line">
                          Use Add note to create a page or document note.
                        </div>
                        <span className="pdf-viewer-fallback-detail">
                          Technical detail: {pdfRenderError}
                        </span>
                      </div>
                      <object
                        className="pdf-viewer-frame"
                        data={pdfViewerEmbeddedSrc}
                        type="application/pdf"
                        >
                          <div className="pdf-viewer-empty">
                          PDF preview is unavailable in this WebView. This file can only use document notes here.
                          </div>
                        </object>
                      </div>
                    ) : (
                      <div className="pdf-viewer-empty">
                        PDF preview is loading. If controlled rendering does not appear, document notes still work for this file.
                      </div>
                    )}
                </div>
              </article>
            ) : (
              <article
                className="document-page"
                key={currentDocument.documentId}
                ref={documentRef}
                onKeyUp={updateSelectedText}
                onMouseUp={() => {
                  requestAnimationFrame(updateSelectedText)
                }}
              >
                <h1 id="document-title">{documentTitle}</h1>
                {currentParagraphs.map((paragraph, paragraphIndex) => (
                  <p
                    data-paragraph-index={paragraphIndex}
                    key={`${paragraphIndex}-${paragraph.slice(0, 32)}`}
                  >
                    {renderHighlightedParagraph(paragraph, paragraphIndex)}
                  </p>
                ))}
              </article>
            )
          ) : (
            <div className="document-empty-state">
              <div className="document-empty-state-copy">
                <h1>NoteAnchor</h1>
                <p className="document-empty-state-subtitle">
                  Add notes beside the source without changing the original file.
                </p>
                <ol className="document-empty-state-steps">
                  <li>Open a TXT, DOCX, or supported PDF document</li>
                  <li>Add Text Notes, Point Notes, or page notes where supported</li>
                  <li>Keep notes saved beside the original document</li>
                </ol>
                <p className="document-empty-state-note">
                  Original files stay unchanged. PDF support is limited in this
                  version.
                </p>
                <div className="document-empty-state-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      void handleOpenDocument()
                    }}
                  >
                    Open document
                  </button>
                </div>
              </div>
              {recentDocumentsPreview.length ? (
                <div className="document-empty-state-recent">
                  <div className="document-empty-state-recent-header">
                    Recent documents
                  </div>
                  <div className="document-empty-state-recent-list">
                    {recentDocumentsPreview.map((entry) => {
                      const formattedOpenedAt = formatRecentOpenedAt(entry.lastOpenedAt)
                      const parentPath = getParentPathFromPath(entry.documentPath)

                      return (
                        <button
                          className="document-empty-state-recent-item"
                          key={entry.documentPath}
                          title={entry.documentPath}
                          type="button"
                          onClick={() => {
                            void handleOpenRecentDocument(entry.documentPath)
                          }}
                        >
                          <span className="document-empty-state-recent-name">
                            {entry.fileName}
                          </span>
                          <span className="document-empty-state-recent-path">
                            {parentPath}
                          </span>
                          {formattedOpenedAt ? (
                            <span className="document-empty-state-recent-time">
                              Last opened {formattedOpenedAt}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <aside
          className={isPdfDesktopDocument ? 'margin-notes margin-notes-pdf' : 'margin-notes'}
          aria-label="Margin notes"
          ref={marginNotesRef}
        >
          {sidebarNotesInDocumentOrder.length ? (
            <div
              className={
                isPdfDesktopDocument
                  ? shouldUseAlignedPdfCurrentPageNotes
                    ? 'note-list note-list-pdf note-list-pdf-aligned'
                    : 'note-list note-list-pdf'
                  : 'note-list'
              }
              ref={isPdfDesktopDocument ? pdfSidebarNoteListRef : undefined}
              style={
                isPdfDesktopDocument
                  ? shouldUseAlignedPdfCurrentPageNotes
                    ? { minHeight: `${pdfCurrentPageNoteListHeight}px` }
                    : undefined
                  : { minHeight: noteListHeight }
              }
            >
              {sidebarNotesInDocumentOrder.map((note) => {
                const isActiveNote = activeNoteId === note.id
                const isDeletePending = pendingDeleteNoteId === note.id
                const isLegacyPdfTextSelection = isLegacyPdfTextNote(note)
                const isLongPdfSidebarNote =
                  isPdfDesktopDocument && isPdfSidebarLongNote(note.comment)
                const isPdfSidebarNoteExpanded =
                  isLongPdfSidebarNote && expandedPdfSidebarNoteIdSet.has(note.id)
                const anchorReviewMessage = getAnchorReviewMessage(note.id)
                const anchorReviewHint = getAnchorReviewHint(note.id)
                const anchorReviewOriginalText = getAnchorReviewOriginalText(
                  note.id,
                  note.selectedText,
                )
                const previousSelectedText = getPreviousSelectedText(note)
                const pdfNoteLabel = getPdfNoteDisplayLabel(note)
                const notePreviewText = getNotePreviewText(note)
                const shouldQuoteNotePreview =
                  Boolean(note.selectedText.trim()) &&
                  !isPdfDocumentLevelNote(note) &&
                  !isPdfPreviewFallbackLegacyPageNote(note)

                return (
                <article
                  className={[
                    isActiveNote ? 'note-card note-card-active' : 'note-card',
                    isPdfDesktopDocument ? 'note-card-pdf' : '',
                    isPdfDesktopDocument && shouldUseAlignedPdfCurrentPageNotes
                      ? 'note-card-pdf-aligned'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={note.id}
                  onClick={() => {
                    if (isPdfDesktopDocument && getPdfAnchorType(note)) {
                      openPdfNote(note.id, 'Note card')
                      return
                    }

                    if (ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES && getPdfAnchorType(note) === 'text') {
                      activatePdfTextNote(note.id)
                      return
                    }

                    activateNote(note.id)
                  }}
                  ref={setNoteCardRef(note.id)}
                  style={
                    isPdfDesktopDocument
                      ? shouldUseAlignedPdfCurrentPageNotes
                        ? {
                            left: 0,
                            right: 0,
                            top: `${pdfCurrentPageNoteCardTopById.get(note.id) ?? 0}px`,
                          }
                        : undefined
                      : {
                          left: noteCardPositionById.get(note.id)?.left ?? 0,
                          top: noteCardPositionById.get(note.id)?.top ?? 0,
                          width: noteCardPositionById.get(note.id)?.width,
                        }
                  }
                >
                  <div
                    className={isActiveNote ? 'note-context' : 'note-context note-context-collapsed'}
                    title={isActiveNote ? undefined : notePreviewText}
                  >
                    {shouldQuoteNotePreview ? `“${notePreviewText}”` : notePreviewText}
                  </div>
                  {pdfNoteLabel ? (
                    <div className="note-pdf-page">{pdfNoteLabel}</div>
                  ) : null}
                  {isLegacyPdfTextSelection ? (
                    <div className="note-pdf-legacy-label">
                      Saved from earlier PDF text extraction
                    </div>
                  ) : null}
                  {previousSelectedText ? (
                    <div className="note-previous-link">
                      <div className="note-previous-link-label">Previously linked to:</div>
                      <div
                        className={
                          isActiveNote
                            ? 'note-previous-link-text'
                            : 'note-previous-link-text note-previous-link-text-collapsed'
                        }
                        title={isActiveNote ? undefined : previousSelectedText}
                      >
                        &ldquo;{previousSelectedText}&rdquo;
                      </div>
                    </div>
                  ) : null}
                  {anchorReviewMessage ? (
                    <div className="note-anchor-review">
                      <div>{anchorReviewMessage}</div>
                      {anchorReviewOriginalText !== null ? (
                        <div className="note-anchor-review-original">
                          <div className="note-anchor-review-original-label">Original:</div>
                          <div
                            className={
                              isActiveNote
                                ? 'note-anchor-review-original-text'
                                : 'note-anchor-review-original-text note-anchor-review-original-text-collapsed'
                            }
                            title={
                              isActiveNote || anchorReviewOriginalText === 'Original text unavailable'
                                ? undefined
                                : anchorReviewOriginalText
                            }
                          >
                            {anchorReviewOriginalText === 'Original text unavailable'
                              ? anchorReviewOriginalText
                              : `“${anchorReviewOriginalText}”`}
                          </div>
                        </div>
                      ) : null}
                      {isActiveNote && anchorReviewHint ? (
                        <div className="note-anchor-review-hint">{anchorReviewHint}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <p
                    className={
                      isLongPdfSidebarNote
                        ? isPdfSidebarNoteExpanded
                          ? 'note-comment'
                          : 'note-comment note-comment-preview'
                        : isActiveNote
                          ? 'note-comment'
                          : 'note-comment note-comment-collapsed'
                    }
                    title={
                      isLongPdfSidebarNote || isActiveNote
                        ? undefined
                        : note.comment
                    }
                  >
                    {note.comment}
                  </p>
                  {isDeletePending ? (
                    <div className="note-delete-confirm" onClick={(event) => event.stopPropagation()}>
                      <div className="note-delete-confirm-text">Delete this note?</div>
                      <div className="note-actions">
                        <button
                          type="button"
                          onClick={() => handleDeleteNoteCancel(note.id)}
                        >
                          Cancel
                        </button>
                        <button
                          className="note-delete-confirm-button"
                          type="button"
                          onClick={() => handleDeleteNoteConfirm(note.id)}
                        >
                          Delete note
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="note-actions">
                      {isLongPdfSidebarNote ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            togglePdfSidebarNoteExpanded(note.id)
                          }}
                        >
                          {isPdfSidebarNoteExpanded ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                      {isLegacyPdfTextSelection ? (
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleRefreshLegacyPdfTextNote(note.id)
                          }}
                        >
                          Refresh
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleEditNote(note)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDeleteNoteRequest(note.id)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </article>
                )
              })}
            </div>
          ) : hasOpenDocument ? (
            shouldShowPdfSidebarCurrentPageEmptyState ? (
              <div className="margin-empty-state margin-empty-state-actions">
                <div>No notes on this page.</div>
                <div>This document has {notesInDocumentOrder.length} notes on other pages.</div>
                <button
                  type="button"
                  onClick={() => {
                    setPdfNotesListFilter('all')
                    setIsNotesListOpen(true)
                  }}
                >
                  Show all notes
                </button>
              </div>
            ) : (
              <div className="margin-empty-state">
                {isPdfDesktopDocument
                  ? isPdfPreviewOnlyFallback
                    ? 'Use Add note for document notes.'
                    : ENABLE_EXPERIMENTAL_PDF_TEXT_NOTES
                      ? isPdfTextPageLayoutGuarded
                        ? 'Use Point note or Add note for page notes.'
                        : isPdfTextSingleLineOnlyLayout
                          ? 'Only one-line text notes are available on this page layout.'
                          : 'In Text mode, drag across up to five adjacent lines on the current page to add a PDF text note. Point notes and page notes still work.'
                      : 'Select PDF text, click the current page for a point note, or use the page field for a legacy-compatible PDF page note.'
                  : renderNoteGuidanceNotice({
                      action: 'Select a fragment in the document or use Find to add a note.',
                      available: 'Text notes.',
                      label: 'Text document',
                    })}
              </div>
            )
          ) : (
            <div className="margin-empty-state">
              Open a document to start adding notes.
            </div>
          )}
        </aside>
      </main>

      {isDeleteNotesConfirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="delete-notes-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-header">
              <h2 id="delete-notes-title">Delete notes</h2>
            </div>
            <div className="confirm-dialog-body">
              <p>
                This deletes NoteAnchor notes for the currently opened document.
                The original document will not be changed.
              </p>
              <p>
                The matching <code>.notes.json</code> data will be updated or removed.
                This cannot be undone unless you have a backup.
              </p>
              <label className="note-field">
                <span>Type DELETE to confirm</span>
                <input
                  autoFocus
                  className="confirm-input"
                  onChange={(event) => setDeleteNotesConfirmText(event.target.value)}
                  type="text"
                  value={deleteNotesConfirmText}
                />
              </label>
            </div>
            <div className="editor-actions">
              <button type="button" onClick={closeDeleteNotesConfirm}>
                Cancel
              </button>
              <button
                className="destructive-button"
                disabled={!isDeleteNotesConfirmationValid}
                type="button"
                onClick={handleDeleteNotesConfirm}
              >
                Delete notes
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {missingRecentDocument ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="missing-recent-document-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-header">
              <h2 id="missing-recent-document-title">Recent document not found</h2>
            </div>
            <div className="confirm-dialog-body">
              <p>This file may have been moved, renamed, or deleted.</p>
              <div className="missing-recent-document-details">
                <div className="missing-recent-document-name">
                  {missingRecentDocument.fileName}
                </div>
                <div
                  className="missing-recent-document-path"
                  title={missingRecentDocument.documentPath}
                >
                  {missingRecentDocument.documentPath}
                </div>
              </div>
            </div>
            <div className="editor-actions">
              <button type="button" onClick={handleRemoveMissingRecentDocument}>
                Remove from Recent
              </button>
              <button type="button" onClick={closeMissingRecentDocumentDialog}>
                OK
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {exportFeedback ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="export-feedback-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-header">
              <h2 id="export-feedback-title">
                {exportFeedback.kind === 'success'
                  ? 'Notes exported'
                  : 'Export failed'}
              </h2>
            </div>
            <div className="confirm-dialog-body">
              <p>{exportFeedback.message}</p>
              {exportFeedback.fileName ? (
                <div className="missing-recent-document-details">
                  <div className="missing-recent-document-name">
                    {exportFeedback.fileName}
                  </div>
                  {exportFeedback.kind === 'success' ? (
                    <div className="missing-recent-document-path">
                      Saved next to the document.
                    </div>
                  ) : null}
                  {exportFeedback.filePath ? (
                    <div
                      className="missing-recent-document-path"
                      title={exportFeedback.filePath}
                    >
                      {exportFeedback.filePath}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="editor-actions">
              <button type="button" onClick={handleShowExportInFileInfo}>
                Show in File info
              </button>
              <button type="button" onClick={closeExportFeedback}>
                OK
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {printPreview ? (
        <div className="modal-backdrop print-preview-backdrop" role="presentation">
          <section
            aria-labelledby="print-preview-title"
            aria-modal="true"
            className="confirm-dialog print-preview-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-header help-about-header">
              <div className="help-about-header-copy">
                <h2 id="print-preview-title">Print report</h2>
                <div className="help-about-version">
                  Review the report, then save the print report.
                </div>
              </div>
              <button
                aria-label="Close print preview"
                className="help-about-close-button"
                type="button"
                onClick={closePrintPreview}
              >
                &times;
              </button>
            </div>
            <div className="confirm-dialog-body print-preview-body">
              <div className="print-preview-meta">
                <div className="missing-recent-document-name">
                  {printPreview.fileName}
                </div>
                <div className="missing-recent-document-path">
                  Save a print-ready report beside the document.
                </div>
              </div>
              <div className="print-report-shell">
                <header className="print-report-header">
                  <div className="print-report-app-name">NoteAnchor</div>
                  <h3 className="print-report-title">Notes report</h3>
                  <div className="print-report-meta-grid">
                    <div><strong>Document:</strong> {printPreview.fileName}</div>
                    <div><strong>Document type:</strong> {printPreview.documentType}</div>
                    <div><strong>Printed:</strong> {printPreview.printedAt}</div>
                    <div><strong>Notes:</strong> {printPreview.notes.length}</div>
                  </div>
                </header>
                <div className="print-report-list">
                  {printPreview.notes.map((note) => (
                    <section key={note.id} className="print-report-card">
                      <div className="print-report-number">Note {note.noteNumber}</div>
                      <div className="print-report-fragment">
                        &ldquo;{note.selectedText}&rdquo;
                      </div>
                      {note.sentenceOrPhrase ? (
                        <div className="print-report-sentence">
                          <strong>Sentence or phrase:</strong> {note.sentenceOrPhrase}
                        </div>
                      ) : null}
                      {note.previousSelectedText ? (
                        <div className="print-report-meta-line">
                          <strong>Previously linked to:</strong> &ldquo;{note.previousSelectedText}&rdquo;
                        </div>
                      ) : null}
                      {note.isFragmentMissing ? (
                        <div className="print-report-warning">
                          Text fragment not found
                        </div>
                      ) : null}
                      <div className="print-report-comment">
                        {note.comment || '(empty)'}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
            <div className="editor-actions print-preview-actions">
              {printSaveFeedback ? (
                <div
                  className={
                    printSaveFeedback.kind === 'error'
                      ? 'print-preview-feedback print-preview-feedback-error print-preview-footer-feedback'
                      : 'print-preview-feedback print-preview-feedback-success print-preview-footer-feedback'
                  }
                >
                  <div>{printSaveFeedback.message}</div>
                  {printSaveFeedback.filePath ? (
                    <div className="print-preview-feedback-label">Saved to:</div>
                  ) : null}
                  {printSaveFeedback.filePath ? (
                    <div
                      className="print-preview-feedback-path"
                      title={printSaveFeedback.filePath}
                    >
                      {printSaveFeedback.filePath}
                    </div>
                  ) : null}
                  {printSaveFeedback.kind === 'success' ? (
                    <div className="print-preview-feedback-note">
                      Open the saved file in your browser to print it.
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button type="button" onClick={closePrintPreview}>
                Close
              </button>
              <button
                className="primary-button"
                disabled={isPrintSavePending}
                type="button"
                onClick={handleSavePrintableHtml}
              >
                {isPrintSavePending ? 'Saving...' : 'Save print report'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isHelpOpen ? (
        <div
          className="modal-backdrop help-about-backdrop"
          role="presentation"
          onClick={closeHelp}
        >
          <section
            aria-labelledby="help-about-title"
            aria-modal="true"
            className="confirm-dialog help-about-dialog"
            role="dialog"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="confirm-dialog-header help-about-header">
              <div className="help-about-header-copy">
                <h2 id="help-about-title">NoteAnchor</h2>
                <div className="help-about-version">Version {appVersion}</div>
              </div>
              <button
                aria-label="Close Help"
                className="help-about-close-button"
                type="button"
                onClick={closeHelp}
              >
                &times;
              </button>
            </div>
            <div className="confirm-dialog-body help-about-body">
              <p>
                NoteAnchor is a local Windows app for notes beside TXT, DOCX, and
                supported PDF documents.
              </p>

              <div className="help-about-section">
                <div className="help-about-label">Supported documents</div>
                <div>TXT files: Text Notes are available.</div>
                <div>DOCX files: Text Notes are available in the simplified reading view.</div>
                <div>PDF files: Text Notes are available when selectable text is available.</div>
                <div>Supported rendered PDF pages may also allow Point Notes.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Important</div>
                <div>Original files are not changed by NoteAnchor.</div>
                <div>PDF support is limited in this version.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Where notes are saved</div>
                <div>Notes are saved beside the document in a separate .notes.json file.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Examples</div>
                <div className="help-about-example">For document.txt: <code>document.notes.json</code></div>
                <div className="help-about-example">For document.docx: <code>document.docx.notes.json</code></div>
                <div className="help-about-example">For document.pdf: <code>document.pdf.notes.json</code></div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">DOCX reading view</div>
                <div>Original DOCX files are not changed.</div>
                <div>
                  NoteAnchor uses a simplified reading view, so complex Word layout,
                  images, comments, or tracked changes may not appear exactly as they
                  do in Word.
                </div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">PDF notes</div>
                <div>PDF Text Notes require selectable text on a rendered page.</div>
                <div>Point Notes may be available when NoteAnchor can render a stable PDF page.</div>
                <div>
                  In preview-only fallback, Text Notes and Point Notes are unavailable.
                  Page or document notes remain available there.
                </div>
                <div>OCR is not included.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Find</div>
                <div>Use Find in text to search the document.</div>
                <div>Whole word searches for complete words only.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">All notes</div>
                <div>Use All notes to search and open notes.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Print report</div>
                <div>
                  Print report saves a browser-printable notes report next to your
                  document.
                </div>
                <div>
                  Open the saved report in your browser and print it from there.
                </div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Link again</div>
                <div>If the original text fragment changes or disappears, the note shows Text fragment not found.</div>
                <div>Select the new fragment and click Link again.</div>
              </div>

              <div className="help-about-section">
                <div className="help-about-label">Previously linked to</div>
                <div>After Link again, NoteAnchor keeps the previous selected text as history.</div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isEditorOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="note-editor-title"
            aria-modal="true"
            className="note-editor"
            ref={modalRef}
            role="dialog"
            style={
              modalPosition
                ? {
                    left: modalPosition.left,
                    top: modalPosition.top,
                  }
                : undefined
            }
          >
            <div
              className={
                isDraggingEditor
                  ? 'note-editor-header note-editor-header-dragging'
                  : 'note-editor-header'
              }
              onPointerDown={handleNoteEditorDragStart}
            >
              <h2 id="note-editor-title">
                {editingNoteId === null ? 'Add note' : 'Edit note'}
              </h2>
            </div>
            <div className="note-editor-body">
              <div className="editor-selection">
                {shouldQuoteEditorPreview ? `“${editorPreviewText}”` : editorPreviewText}
              </div>
              <label className="note-field">
                <span>Comment</span>
                <textarea
                  autoFocus
                  onChange={(event) => setNoteDraft(event.target.value)}
                  rows={5}
                  value={noteDraft}
                />
              </label>
            </div>
            <div className="editor-actions">
              <button type="button" onClick={handleCancelNote}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!noteDraft.trim()}
                type="button"
                onClick={handleSaveNote}
              >
                Save
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isNotesListOpen ? (
        <div
          className="notes-list-backdrop"
          onClick={() => setIsNotesListOpen(false)}
          role="presentation"
          style={{
            height: topBarHeight ? `calc(100vh - ${topBarHeight}px)` : undefined,
            top: topBarHeight || undefined,
          }}
        >
          <aside
            aria-labelledby="notes-list-title"
            className="notes-list-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="notes-list-header">
              <h2 id="notes-list-title">{notesListTitle}</h2>
              <button type="button" onClick={() => setIsNotesListOpen(false)}>
                Close
              </button>
            </div>

              {notes.length ? (
                <>
                  {isPdfDesktopDocument && !isPdfPreviewOnlyFallback ? (
                   <div className="notes-list-filter" aria-label="PDF notes filter">
                      <button
                        className={
                        pdfNotesListFilter === 'current-page'
                          ? 'notes-list-filter-button notes-list-filter-button-active'
                          : 'notes-list-filter-button'
                      }
                      type="button"
                      onClick={() => setPdfNotesListFilter('current-page')}
                    >
                      Current page
                    </button>
                    <button
                      className={
                        pdfNotesListFilter === 'all'
                          ? 'notes-list-filter-button notes-list-filter-button-active'
                          : 'notes-list-filter-button'
                      }
                      type="button"
                      onClick={() => setPdfNotesListFilter('all')}
                    >
                      All notes
                    </button>
                    </div>
                  ) : null}
                <div className="notes-list-search">
                  <label className="notes-list-search-label" htmlFor="notes-search">
                    Search notes
                  </label>
                  <div className="notes-list-search-row">
                    <input
                      id="notes-search"
                      className="notes-list-search-input"
                      onChange={(event) => setNotesSearchText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') {
                          return
                        }

                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      placeholder="Search notes..."
                      type="text"
                      value={notesSearchText}
                    />
                    {notesSearchText ? (
                      <button
                        className="notes-list-search-clear"
                        type="button"
                        onClick={() => setNotesSearchText('')}
                      >
                        Clear
                      </button>
                    ) : null}
                    <label className="notes-list-search-toggle">
                      <input
                        checked={isWholeWordNotesSearch}
                        type="checkbox"
                        onChange={(event) => setIsWholeWordNotesSearch(event.target.checked)}
                      />
                      <span>Whole word</span>
                    </label>
                  </div>
                  <div className="notes-list-search-count">
                    {filteredNotesInDocumentOrder.length} of {pageFilteredNotesInDocumentOrder.length}
                    {isPdfDesktopDocument && !isPdfPreviewOnlyFallback && pdfNotesListFilter === 'current-page'
                      ? ` notes on page ${currentPdfPage}`
                      : ` notes`}
                  </div>
              </div>

                <div className="notes-list-scroll" ref={notesListScrollRef}>
                  {filteredNotesInDocumentOrder.length ? (
                    <div className="notes-list-items">
                      {filteredNotesInDocumentOrder.map((note) => {
                        const isLegacyPdfTextSelection = isLegacyPdfTextNote(note)
                        const anchorReviewMessage = getAnchorReviewMessage(note.id)
                        const anchorReviewHint = getAnchorReviewHint(note.id)
                        const anchorReviewOriginalText = getAnchorReviewOriginalText(
                          note.id,
                          note.selectedText,
                        )
                        const previousSelectedText = getPreviousSelectedText(note)
                        const pdfNoteLabel = getPdfNoteDisplayLabel(note)
                        const notePreviewText = getNotePreviewText(note)
                        const shouldQuoteNotePreview =
                          Boolean(note.selectedText.trim()) &&
                          !isPdfDocumentLevelNote(note) &&
                          !isPdfPreviewFallbackLegacyPageNote(note)
                        const selectedTextMatchIndex = normalizedNotesSearchQuery
                          ? isPdfDocumentLevelNote(note)
                            ? -1
                            : findSearchMatchIndex(
                              note.selectedText,
                              normalizedNotesSearchQuery,
                              isWholeWordNotesSearch,
                            )
                          : -1
                        const notePreviewMatchIndex = normalizedNotesSearchQuery
                          ? findSearchMatchIndex(
                              notePreviewText,
                              normalizedNotesSearchQuery,
                              isWholeWordNotesSearch,
                            )
                          : -1
                        const showSelectedTextSearchSnippet =
                          normalizedNotesSearchQuery &&
                          selectedTextMatchIndex >= 0 &&
                          notePreviewMatchIndex < 0
                        const selectedTextSearchSnippet = showSelectedTextSearchSnippet
                          ? buildSearchSnippet(
                              note.selectedText,
                              normalizedNotesSearchQuery,
                              isWholeWordNotesSearch,
                            )
                          : ''

                        return (
                          <div
                            className={
                              activeNoteId === note.id
                                ? 'notes-list-item notes-list-item-active'
                                : 'notes-list-item'
                            }
                            key={note.id}
                          >
                            <button
                              className="notes-list-item-body"
                              type="button"
                              onClick={() => openNoteFromAllNotes(note.id)}
                            >
                              <span className="notes-list-context">
                                {showSelectedTextSearchSnippet ? (
                                  <>
                                    &ldquo;{renderSearchHighlightedText(selectedTextSearchSnippet)}&rdquo;
                                  </>
                                ) : shouldQuoteNotePreview ? (
                                  <>
                                    &ldquo;{renderSearchHighlightedText(notePreviewText)}&rdquo;
                                  </>
                                ) : (
                                  renderSearchHighlightedText(notePreviewText)
                                )}
                              </span>
                              {pdfNoteLabel ? (
                                <span className="notes-list-pdf-page">
                                  {pdfNoteLabel}
                                </span>
                              ) : null}
                              {isLegacyPdfTextSelection ? (
                                <span className="notes-list-pdf-legacy-label">
                                  Saved from earlier PDF text extraction
                                </span>
                              ) : null}
                              {previousSelectedText ? (
                                <span className="notes-list-previous-link">
                                  <span className="notes-list-previous-link-label">Previously linked to:</span>
                                  <span className="notes-list-previous-link-text">
                                    &ldquo;{renderSearchHighlightedText(previousSelectedText)}&rdquo;
                                  </span>
                                </span>
                              ) : null}
                              {anchorReviewMessage ? (
                                <span className="notes-list-anchor-review">
                                  {anchorReviewMessage}
                                  {anchorReviewOriginalText !== null ? (
                                    <span className="notes-list-anchor-review-original">
                                      <span className="notes-list-anchor-review-original-label">Original:</span>
                                      <span className="notes-list-anchor-review-original-text">
                                        {anchorReviewOriginalText === 'Original text unavailable'
                                          ? anchorReviewOriginalText
                                          : `“${anchorReviewOriginalText}”`}
                                      </span>
                                    </span>
                                  ) : null}
                                  {anchorReviewHint ? (
                                    <span className="notes-list-anchor-review-hint">
                                      {anchorReviewHint}
                                    </span>
                                  ) : null}
                                </span>
                              ) : null}
                              <span className="notes-list-comment">
                                {renderSearchHighlightedText(note.comment)}
                              </span>
                            </button>
                            <div className="notes-list-item-actions">
                              <button
                                className="notes-list-item-open"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openNoteFromAllNotes(note.id)
                                }}
                              >
                                Open
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : shouldShowPdfCurrentPageEmptyState ? (
                    <div className="notes-list-empty-state" role="status">
                      <p className="notes-list-empty">No notes on this page</p>
                      <p className="notes-list-empty-detail">
                        This document has {notesInDocumentOrder.length} notes on other pages.
                      </p>
                      <button
                        className="notes-list-empty-action"
                        type="button"
                        onClick={() => setPdfNotesListFilter('all')}
                      >
                        Show all notes
                      </button>
                    </div>
                  ) : (
                    <p className="notes-list-empty">No notes found</p>
                  )}
                </div>
              </>
            ) : (
              <p className="notes-list-empty">No notes yet.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  )
}

export default App

