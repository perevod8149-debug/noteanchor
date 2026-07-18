import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist'
import type {
  OnProgressParameters,
  PDFPageProxy,
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api'
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import './pdf-textcontent-geometry-spike.css'

type RenderedPageState = {
  height: number
  pageNumber: number
  scale: number
  width: number
}

type PendingRenderState = {
  byteLength: number
  fileName: string
  filePath: string
  page: PDFPageProxy
  pageNumber: number
  scale: number
  textItems: GeometryTextItem[]
  viewport: ReturnType<PDFPageProxy['getViewport']>
  workerMode: string
}

type GeometryTextItem = {
  angleDegrees: number
  centerX: number
  centerY: number
  height: number
  index: number
  localTransform: number[]
  pageNumber: number
  text: string
  transform: number[]
  viewportHeight: number
  viewportWidth: number
  width: number
  x: number
  xRatio: number
  y: number
  yRatio: number
}

type GeometryWordToken = {
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
  xRatio: number
  y: number
  yRatio: number
}

type GeometrySpikeDiagnostics = {
  byteLength?: number
  canvasHeight?: number
  canvasWidth?: number
  errorMessage?: string
  errorName?: string
  fileName?: string
  filePath?: string
  pageHeight?: number
  pageWidth?: number
  sampleItems?: Array<{
    height: number
    index: number
    text: string
    width: number
    x: number
    y: number
  }>
  sampleTokens?: Array<{
    height: number
    index: number
    itemIndex: number
    text: string
    width: number
    x: number
    y: number
  }>
  scale?: number
  selectionEndLineId?: string
  selectedRange?: string
  selectedLineRange?: string
  selectedText?: string
  selectedTokenCount?: number
  selectionAccepted?: boolean
  selectionLinesSpannedCount?: number
  selectionMode?:
    | 'single-line'
    | 'two-line'
    | 'three-line'
    | 'paragraph'
    | 'unsupported-multiline'
  selectionReason?: string
  selectionStartLineId?: string
  startTokenText?: string
  stage: string
  textItemCount?: number
  tokenUnderCursorText?: string
  tokenCount?: number
  workerMode: string
}

type DragPoint = {
  x: number
  y: number
}

type DragSelectionState = {
  currentTokenKey: string
  end: DragPoint
  lineCenterY: number
  lineIndex: number
  lineRangeLabel: string
  lineTokenKeys: string[]
  startTokenKey: string
  start: DragPoint
}

type SelectionResult = {
  currentTokenKey?: string
  currentTokenText?: string
  endLineId: string
  lineRangeLabel: string
  linesSpannedCount: number
  reason: string
  selectedRangeLabel: string
  selectedText: string
  selectedTokenKeys: string[]
  selectionMode:
    | 'single-line'
    | 'two-line'
    | 'three-line'
    | 'paragraph'
    | 'unsupported-multiline'
  startLineId: string
  startTokenKey?: string
  startTokenText?: string
  success: boolean
}

type TokenLineCluster = {
  centerY: number
  lineId: string
  lineRangeLabel: string
  tokens: GeometryWordToken[]
}

type SpikeNote = {
  comment: string
  createdAt?: number
  id: string
  lineCount: number
  pageNumber: number
  selectedText: string
  selectionKey: string
  selectionMode: Exclude<NonNullable<SelectionResult['selectionMode']>, 'unsupported-multiline'>
  tokenKeys: string[]
}

type SpikeNoteDraft = {
  lineCount: number
  pageNumber: number
  selectedText: string
  selectionKey: string
  selectionMode: Exclude<NonNullable<SelectionResult['selectionMode']>, 'unsupported-multiline'>
  tokenKeys: string[]
}

type SpikeNoteGroup = {
  comments: SpikeNote[]
  lineCount: number
  pageNumber: number
  selectedText: string
  selectionKey: string
  selectionMode: Exclude<NonNullable<SelectionResult['selectionMode']>, 'unsupported-multiline'>
  tokenKeys: string[]
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

const truncateLabel = (value: string, maxLength = 18) => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}...`
}

const isRenderableTextItem = (item: TextItem | TextMarkedContent): item is TextItem =>
  'str' in item && typeof item.str === 'string' && item.str.trim().length > 0

const roundForDiagnostics = (value: number) => Number(value.toFixed(2))

const normalizeSelectedTokenText = (tokens: GeometryWordToken[]) =>
  tokens
    .map((token) => token.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

const getTokenKey = (token: GeometryWordToken) =>
  `${token.pageNumber}-${token.itemIndex}-${token.startOffset}-${token.endOffset}`

const getSpikeSelectionKey = (pageNumber: number, tokenKeys: string[]) =>
  `${pageNumber}::${tokenKeys.join('|')}`

const parseSpikeTokenKey = (tokenKey: string) => {
  const [pageNumberText, itemIndexText, startOffsetText, endOffsetText] = tokenKey.split('-')

  return {
    endOffset: Number(endOffsetText) || 0,
    itemIndex: Number(itemIndexText) || 0,
    pageNumber: Number(pageNumberText) || 0,
    startOffset: Number(startOffsetText) || 0,
  }
}

const PARAGRAPH_LINE_LIMIT = 8
const PDF_SPIKE_NOTES_STORAGE_PREFIX = 'noteanchor.pdf-spike-notes'

const getPdfSpikeNotesStorageKey = (documentPath: string) =>
  `${PDF_SPIKE_NOTES_STORAGE_PREFIX}::${documentPath}`

const isStoredSpikeNote = (value: unknown): value is SpikeNote => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SpikeNote>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.pageNumber === 'number' &&
    typeof candidate.selectedText === 'string' &&
    typeof candidate.comment === 'string' &&
    typeof candidate.selectionKey === 'string' &&
    typeof candidate.selectionMode === 'string' &&
    typeof candidate.lineCount === 'number' &&
    (candidate.createdAt == null || typeof candidate.createdAt === 'number') &&
    Array.isArray(candidate.tokenKeys) &&
    candidate.tokenKeys.every((tokenKey) => typeof tokenKey === 'string')
  )
}

const buildTokenLineClusters = (tokens: GeometryWordToken[]): TokenLineCluster[] => {
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
    10,
    sortedTokens.reduce((max, token) => Math.max(max, token.height * 0.7), 0),
  )
  const clusters: Array<{ centerY: number; tokens: GeometryWordToken[] }> = []

  for (const token of sortedTokens) {
    const cluster = clusters.find((entry) => Math.abs(entry.centerY - token.centerY) <= lineTolerance)

    if (cluster) {
      cluster.tokens.push(token)
      cluster.centerY =
        cluster.tokens.reduce((sum, currentToken) => sum + currentToken.centerY, 0) /
        cluster.tokens.length
    } else {
      clusters.push({
        centerY: token.centerY,
        tokens: [token],
      })
    }
  }

  return clusters.map((cluster) => {
    const lineTokens = [...cluster.tokens].sort((left, right) => {
      if (left.x === right.x) {
        return left.itemIndex - right.itemIndex
      }

      return left.x - right.x
    })
    const lineTop = Math.min(...lineTokens.map((token) => token.y))
    const lineBottom = Math.max(...lineTokens.map((token) => token.y + token.height))

    return {
      centerY: cluster.centerY,
      lineId: `${lineTokens[0]?.pageNumber ?? 1}:${roundForDiagnostics(cluster.centerY)}`,
      lineRangeLabel: `${roundForDiagnostics(lineTop)}-${roundForDiagnostics(lineBottom)}`,
      tokens: lineTokens,
    }
  })
}

const getHorizontalDistanceToToken = (token: GeometryWordToken, x: number) => {
  const tokenLeft = token.x
  const tokenRight = token.x + token.width

  if (x < tokenLeft) {
    return tokenLeft - x
  }

  if (x > tokenRight) {
    return x - tokenRight
  }

  return 0
}

const findNearestLineCluster = (lines: TokenLineCluster[], y: number) => {
  if (!lines.length) {
    return null
  }

  return lines.reduce((best, line) =>
    Math.abs(line.centerY - y) < Math.abs(best.centerY - y) ? line : best,
  )
}

const findNearestTokenInLine = (line: TokenLineCluster, point: DragPoint) => {
  if (!line.tokens.length) {
    return null
  }

  return line.tokens.reduce((best, token) => {
    const bestHorizontal = getHorizontalDistanceToToken(best, point.x)
    const tokenHorizontal = getHorizontalDistanceToToken(token, point.x)
    const bestVertical = Math.abs(best.centerY - point.y)
    const tokenVertical = Math.abs(token.centerY - point.y)

    if (tokenHorizontal !== bestHorizontal) {
      return tokenHorizontal < bestHorizontal ? token : best
    }

    if (tokenVertical !== bestVertical) {
      return tokenVertical < bestVertical ? token : best
    }

    return Math.abs(token.centerX - point.x) < Math.abs(best.centerX - point.x) ? token : best
  })
}

const collectTokenSpans = (value: string) => {
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

let tokenMeasureContext: CanvasRenderingContext2D | null = null

const getTokenMeasureContext = () => {
  if (typeof document === 'undefined') {
    return null
  }

  if (tokenMeasureContext) {
    return tokenMeasureContext
  }

  const canvas = document.createElement('canvas')
  tokenMeasureContext = canvas.getContext('2d')
  return tokenMeasureContext
}

const getApproximatePdfMeasureFont = (height: number) => {
  const fontSize = Math.max(10, Math.round(height * 0.92))
  return `${fontSize}px "Times New Roman", Georgia, serif`
}

const measureTokenHorizontalBounds = (
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

  const context = getTokenMeasureContext()

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

    return {
      left,
      right,
    }
  } catch {
    return null
  }
}

const computeTextItemGeometry = (
  item: TextItem,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  index: number,
  pageNumber: number,
): GeometryTextItem | null => {
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
    centerX: x + width / 2,
    centerY: y + height / 2,
    height,
    index,
    localTransform: [...item.transform],
    pageNumber,
    text: item.str,
    transform: [...transform],
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
    width,
    x,
    xRatio: viewport.width > 0 ? x / viewport.width : 0,
    y,
    yRatio: viewport.height > 0 ? y / viewport.height : 0,
  }
}

const computeTokenGeometry = (
  item: GeometryTextItem,
  index: number,
): GeometryWordToken[] => {
  const textLength = item.text.length

  if (!textLength || item.width <= 0) {
    return []
  }

  const tokenSpans = collectTokenSpans(item.text)

  return tokenSpans
    .map((tokenSpan) => {
      const measuredBounds = measureTokenHorizontalBounds(
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
        index,
        itemIndex: item.index,
        pageNumber: item.pageNumber,
        startOffset: tokenSpan.startOffset,
        text: tokenSpan.text,
        width,
        x,
        xRatio: item.viewportWidth > 0 ? x / item.viewportWidth : 0,
        y: item.y,
        yRatio: item.viewportHeight > 0 ? item.y / item.viewportHeight : 0,
      }
    })
    .filter((token): token is GeometryWordToken => token !== null)
    .map((token, tokenIndex) => ({
      ...token,
      index: index + tokenIndex,
    }))
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

export default function PdfTextContentGeometrySpike() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pdfPath, setPdfPath] = useState('')
  const [renderedPage, setRenderedPage] = useState<RenderedPageState | null>(null)
  const [pendingRender, setPendingRender] = useState<PendingRenderState | null>(null)
  const [textItems, setTextItems] = useState<GeometryTextItem[]>([])
  const [wordTokens, setWordTokens] = useState<GeometryWordToken[]>([])
  const [showBoxes, setShowBoxes] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [showCenters, setShowCenters] = useState(false)
  const [showTokenBoxes, setShowTokenBoxes] = useState(false)
  const [showTokenLabels, setShowTokenLabels] = useState(false)
  const [showTokenCenters, setShowTokenCenters] = useState(false)
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null)
  const [pointerDownPoint, setPointerDownPoint] = useState<DragPoint | null>(null)
  const [pointerUpPoint, setPointerUpPoint] = useState<DragPoint | null>(null)
  const [selectedTokenKeys, setSelectedTokenKeys] = useState<string[]>([])
  const [selectedText, setSelectedText] = useState('')
  const [selectionLineRangeLabel, setSelectionLineRangeLabel] = useState('')
  const [selectedRangeLabel, setSelectedRangeLabel] = useState('')
  const [selectionAccepted, setSelectionAccepted] = useState<boolean | null>(null)
  const [selectionReason, setSelectionReason] = useState('')
  const [startTokenText, setStartTokenText] = useState('')
  const [currentTokenText, setCurrentTokenText] = useState('')
  const [spikeNotes, setSpikeNotes] = useState<SpikeNote[]>([])
  const [spikeNoteDraft, setSpikeNoteDraft] = useState<SpikeNoteDraft | null>(null)
  const [spikeNoteComment, setSpikeNoteComment] = useState('')
  const [activeSpikeNoteId, setActiveSpikeNoteId] = useState<string | null>(null)
  const [editingSpikeNoteId, setEditingSpikeNoteId] = useState<string | null>(null)
  const [editingSpikeNoteComment, setEditingSpikeNoteComment] = useState('')
  const [pendingDeleteSpikeNoteId, setPendingDeleteSpikeNoteId] = useState<string | null>(null)
  const [expandedFragmentGroups, setExpandedFragmentGroups] = useState<Record<string, boolean>>({})
  const [isAdvancedDebugOpen, setIsAdvancedDebugOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    'Open a local PDF and compare computed textContent boxes with the visible page.',
  )
  const [diagnostics, setDiagnostics] = useState<GeometrySpikeDiagnostics>({
    stage: 'idle',
    workerMode: 'unconfigured',
  })

  const fileName = useMemo(
    () => (pdfPath ? getFileNameFromPath(pdfPath) : ''),
    [pdfPath],
  )
  const activeSpikeNote = useMemo(
    () => spikeNotes.find((note) => note.id === activeSpikeNoteId) ?? null,
    [activeSpikeNoteId, spikeNotes],
  )
  const activeSpikeNoteTokenKeys = useMemo(
    () => new Set(activeSpikeNote?.tokenKeys ?? []),
    [activeSpikeNote],
  )
  const sortedSpikeNotes = useMemo(() => {
    return [...spikeNotes].sort((left, right) => {
      const leftFirstToken = parseSpikeTokenKey(left.tokenKeys[0] ?? '')
      const rightFirstToken = parseSpikeTokenKey(right.tokenKeys[0] ?? '')

      if (left.pageNumber !== right.pageNumber) {
        return left.pageNumber - right.pageNumber
      }

      if (leftFirstToken.pageNumber !== rightFirstToken.pageNumber) {
        return leftFirstToken.pageNumber - rightFirstToken.pageNumber
      }

      if (leftFirstToken.itemIndex !== rightFirstToken.itemIndex) {
        return leftFirstToken.itemIndex - rightFirstToken.itemIndex
      }

      if (leftFirstToken.startOffset !== rightFirstToken.startOffset) {
        return leftFirstToken.startOffset - rightFirstToken.startOffset
      }

      if (leftFirstToken.endOffset !== rightFirstToken.endOffset) {
        return leftFirstToken.endOffset - rightFirstToken.endOffset
      }

      return left.id.localeCompare(right.id)
    })
  }, [spikeNotes])
  const groupedSpikeNotes = useMemo(() => {
    const groups = new Map<string, SpikeNoteGroup>()

    for (const note of sortedSpikeNotes) {
      const existingGroup = groups.get(note.selectionKey)

      if (existingGroup) {
        existingGroup.comments.push(note)
        continue
      }

      groups.set(note.selectionKey, {
        comments: [note],
        lineCount: note.lineCount,
        pageNumber: note.pageNumber,
        selectedText: note.selectedText,
        selectionKey: note.selectionKey,
        selectionMode: note.selectionMode,
        tokenKeys: note.tokenKeys,
      })
    }

    return [...groups.values()].map((group) => ({
      ...group,
      comments: [...group.comments].sort((left, right) => {
        const leftCreatedAt = left.createdAt ?? 0
        const rightCreatedAt = right.createdAt ?? 0

        if (leftCreatedAt !== rightCreatedAt) {
          return leftCreatedAt - rightCreatedAt
        }

        return left.id.localeCompare(right.id)
      }),
    }))
  }, [sortedSpikeNotes])
  const selectionKeyByTokenKey = useMemo(() => {
    const nextMap = new Map<string, string>()

    for (const group of groupedSpikeNotes) {
      for (const tokenKey of group.tokenKeys) {
        nextMap.set(tokenKey, group.selectionKey)
      }
    }

    return nextMap
  }, [groupedSpikeNotes])
  const fragmentMarkers = useMemo(() => {
    if (!renderedPage) {
      return []
    }

    return groupedSpikeNotes
      .map((group) => {
        const tokens = group.tokenKeys
          .map((tokenKey) => wordTokens.find((token) => getTokenKey(token) === tokenKey))
          .filter((token): token is GeometryWordToken => token !== undefined)

        if (!tokens.length) {
          return null
        }

        const minX = Math.min(...tokens.map((token) => token.x))
        const minY = Math.min(...tokens.map((token) => token.y))
        const maxRight = Math.max(...tokens.map((token) => token.x + token.width))
        const markerLeft = Math.min(Math.max(minX, maxRight + 6), Math.max(8, renderedPage.width - 26))
        const markerTop = Math.max(6, minY - 8)

        return {
          commentCount: group.comments.length,
          isActive: group.comments.some((note) => note.id === activeSpikeNoteId),
          left: markerLeft,
          selectionKey: group.selectionKey,
          top: markerTop,
        }
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null)
  }, [activeSpikeNoteId, groupedSpikeNotes, renderedPage, wordTokens])
  useEffect(() => {
    setExpandedFragmentGroups((currentState) => {
      const nextState: Record<string, boolean> = {}

      for (const group of groupedSpikeNotes) {
        nextState[group.selectionKey] =
          currentState[group.selectionKey] ?? group.comments.length === 1
      }

      return nextState
    })
  }, [groupedSpikeNotes])
  const canCreateSpikeNote = useMemo(
    () =>
      Boolean(
        selectionAccepted &&
          selectedText.trim() &&
          selectedTokenKeys.length &&
          diagnostics.selectionMode &&
          diagnostics.selectionMode !== 'unsupported-multiline',
      ),
    [diagnostics.selectionMode, selectedText, selectedTokenKeys, selectionAccepted],
  )
  const currentRuntimeSelectionKey = useMemo(() => {
    if (!selectedTokenKeys.length) {
      return ''
    }

    const pageNumber = renderedPage?.pageNumber ?? 1
    return getSpikeSelectionKey(pageNumber, selectedTokenKeys)
  }, [renderedPage?.pageNumber, selectedTokenKeys])

  const tokenLineClusters = useMemo(() => buildTokenLineClusters(wordTokens), [wordTokens])
  const selectedPrimaryTokenDebug = useMemo(() => {
    const primaryTokenKey = selectedTokenKeys[0]

    if (!primaryTokenKey) {
      return null
    }

    const token = wordTokens.find((currentToken) => getTokenKey(currentToken) === primaryTokenKey)

    if (!token) {
      return null
    }

    const sourceItem = textItems.find((item) => item.index === token.itemIndex)
    const normalizedTokenText = token.text.trim().replace(/\s+/g, ' ')

    return {
      lineId: `${token.pageNumber}:${selectionLineRangeLabel || 'unknown-line'}`,
      normalizedTokenText,
      selectedText,
      sourceItemRect: sourceItem
        ? {
            height: roundForDiagnostics(sourceItem.height),
            left: roundForDiagnostics(sourceItem.x),
            right: roundForDiagnostics(sourceItem.x + sourceItem.width),
            top: roundForDiagnostics(sourceItem.y),
            width: roundForDiagnostics(sourceItem.width),
          }
        : null,
      sourceItemText: sourceItem?.text ?? '',
      tokenRect: {
        height: roundForDiagnostics(token.height),
        left: roundForDiagnostics(token.x),
        right: roundForDiagnostics(token.x + token.width),
        top: roundForDiagnostics(token.y),
        width: roundForDiagnostics(token.width),
      },
      tokenText: token.text,
    }
  }, [selectedText, selectedTokenKeys, selectionLineRangeLabel, textItems, wordTokens])

  useEffect(() => {
    if (!selectedPrimaryTokenDebug) {
      setIsAdvancedDebugOpen(false)
    }
  }, [selectedPrimaryTokenDebug])

  useEffect(() => {
    setSpikeNoteDraft(null)
    setSpikeNoteComment('')
    setActiveSpikeNoteId(null)
    setEditingSpikeNoteId(null)
    setEditingSpikeNoteComment('')
    setPendingDeleteSpikeNoteId(null)

    if (!pdfPath || typeof window === 'undefined') {
      setSpikeNotes([])
      return
    }

    try {
      const storageKey = getPdfSpikeNotesStorageKey(pdfPath)
      const rawValue = window.localStorage.getItem(storageKey)

      if (!rawValue) {
        setSpikeNotes([])
        return
      }

      const parsedValue: unknown = JSON.parse(rawValue)

      if (!Array.isArray(parsedValue)) {
        setSpikeNotes([])
        return
      }

      setSpikeNotes(parsedValue.filter(isStoredSpikeNote))
    } catch {
      setSpikeNotes([])
    }
  }, [pdfPath])

  useEffect(() => {
    if (!pdfPath || typeof window === 'undefined') {
      return
    }

    try {
      const storageKey = getPdfSpikeNotesStorageKey(pdfPath)
      window.localStorage.setItem(storageKey, JSON.stringify(spikeNotes))
    } catch {
      // Ignore spike-only localStorage persistence failures.
    }
  }, [pdfPath, spikeNotes])

  const handleOpenSpikeNoteDraft = useCallback(() => {
    if (!canCreateSpikeNote || !diagnostics.selectionMode || diagnostics.selectionMode === 'unsupported-multiline') {
      return
    }

    const pageNumber = renderedPage?.pageNumber ?? 1
    const trimmedSelectedText = selectedText.trim()
    const tokenKeys = [...selectedTokenKeys]
    const selectionKey = getSpikeSelectionKey(pageNumber, tokenKeys)
    setSpikeNoteDraft({
      lineCount: diagnostics.selectionLinesSpannedCount ?? 1,
      pageNumber,
      selectedText: trimmedSelectedText,
      selectionKey,
      selectionMode: diagnostics.selectionMode,
      tokenKeys,
    })
    setSpikeNoteComment('')
  }, [
    canCreateSpikeNote,
    diagnostics.selectionLinesSpannedCount,
    diagnostics.selectionMode,
    renderedPage?.pageNumber,
    selectedText,
    selectedTokenKeys,
  ])

  const handleCancelSpikeNoteDraft = useCallback(() => {
    setSpikeNoteDraft(null)
    setSpikeNoteComment('')
  }, [])

  const handleStartEditingSpikeNote = useCallback((note: SpikeNote) => {
    setEditingSpikeNoteId(note.id)
    setEditingSpikeNoteComment(note.comment)
    setPendingDeleteSpikeNoteId(null)
    setSpikeNoteDraft(null)
    setSpikeNoteComment('')
  }, [])

  const handleCancelEditingSpikeNote = useCallback(() => {
    setEditingSpikeNoteId(null)
    setEditingSpikeNoteComment('')
  }, [])

  const handleRequestDeleteSpikeNote = useCallback((noteId: string) => {
    setPendingDeleteSpikeNoteId(noteId)
    setEditingSpikeNoteId((currentId) => (currentId === noteId ? null : currentId))
    setEditingSpikeNoteComment((currentComment) =>
      editingSpikeNoteId === noteId ? '' : currentComment,
    )
  }, [editingSpikeNoteId])

  const handleCancelDeleteSpikeNote = useCallback(() => {
    setPendingDeleteSpikeNoteId(null)
  }, [])

  const handleToggleFragmentGroup = useCallback((selectionKey: string) => {
    setExpandedFragmentGroups((currentState) => ({
      ...currentState,
      [selectionKey]: !currentState[selectionKey],
    }))
  }, [])

  const handleSaveSpikeNote = useCallback(() => {
    if (!spikeNoteDraft) {
      return
    }

    const nextNote: SpikeNote = {
      comment: spikeNoteComment.trim(),
      createdAt: Date.now(),
      id: `spike-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      lineCount: spikeNoteDraft.lineCount,
      pageNumber: spikeNoteDraft.pageNumber,
      selectedText: spikeNoteDraft.selectedText,
      selectionKey: spikeNoteDraft.selectionKey,
      selectionMode: spikeNoteDraft.selectionMode,
      tokenKeys: spikeNoteDraft.tokenKeys,
    }

    setSpikeNotes((currentNotes) => {
      return [nextNote, ...currentNotes]
    })
    setActiveSpikeNoteId(nextNote.id)
    setSpikeNoteDraft(null)
    setSpikeNoteComment('')
    setStatusMessage('Spike note saved in local spike state only.')
  }, [spikeNoteComment, spikeNoteDraft])

  const handleActivateSpikeNote = useCallback(
    (
      note: SpikeNote,
      options?: {
        expandGroup?: boolean
        scrollCanvas?: boolean
        scrollSidebar?: boolean
      },
    ) => {
      const shouldExpandGroup = options?.expandGroup ?? false
      const shouldScrollCanvas = options?.scrollCanvas ?? true
      const shouldScrollSidebar = options?.scrollSidebar ?? false

      setActiveSpikeNoteId(note.id)
      setSpikeNoteDraft(null)
      setSpikeNoteComment('')
      setEditingSpikeNoteId(null)
      setEditingSpikeNoteComment('')
      setPendingDeleteSpikeNoteId(null)

      if (shouldExpandGroup) {
        setExpandedFragmentGroups((currentState) => ({
          ...currentState,
          [note.selectionKey]: true,
        }))
      }

      setSelectedTokenKeys(note.tokenKeys)
      setSelectedText(note.selectedText)
      setSelectionAccepted(true)
      setSelectionReason('Activated saved spike note.')

      const matchingTokens = note.tokenKeys
        .map((tokenKey) => wordTokens.find((token) => getTokenKey(token) === tokenKey))
        .filter((token): token is GeometryWordToken => token !== undefined)

      if (matchingTokens.length) {
        const lineClusters = buildTokenLineClusters(matchingTokens)
        const firstLine = lineClusters[0] ?? null
        const lastLine = lineClusters[lineClusters.length - 1] ?? null

        setSelectionLineRangeLabel(
          lineClusters.length > 1 && firstLine && lastLine
            ? `${firstLine.lineRangeLabel} -> ${lastLine.lineRangeLabel}`
            : firstLine?.lineRangeLabel ?? '',
        )

        const sortedTokenIndexes = matchingTokens
          .map((token) => token.index)
          .sort((left, right) => left - right)

        if (sortedTokenIndexes.length) {
          setSelectedRangeLabel(
            `${sortedTokenIndexes[0]}-${sortedTokenIndexes[sortedTokenIndexes.length - 1]}`,
          )
        }

        setStartTokenText(matchingTokens[0]?.text ?? '')
        setCurrentTokenText(matchingTokens[matchingTokens.length - 1]?.text ?? '')
      }

      if (typeof window !== 'undefined' && shouldScrollSidebar) {
        window.requestAnimationFrame(() => {
          const sidebar = sidebarRef.current

          if (sidebar) {
            const groupElement = sidebar.querySelector<HTMLElement>(
              `[data-selection-key="${note.selectionKey}"]`,
            )

            if (groupElement) {
              const targetTop =
                groupElement.offsetTop - Math.max(12, (sidebar.clientHeight - groupElement.clientHeight) * 0.2)

              sidebar.scrollTo({
                behavior: 'smooth',
                top: Math.max(0, targetTop),
              })
            }
          }
        })
      }

      if (typeof window !== 'undefined' && shouldScrollCanvas) {
        window.requestAnimationFrame(() => {
          const shell = canvasShellRef.current

          if (!shell || !matchingTokens.length) {
            return
          }

          const topTokenY = Math.min(...matchingTokens.map((token) => token.y))
          const targetTop = Math.max(0, topTokenY - shell.clientHeight * 0.3)

          shell.scrollTo({
            behavior: 'smooth',
            left: shell.scrollLeft,
            top: targetTop,
          })
        })
      }
    },
    [wordTokens],
  )

  const handleActivateFragmentGroupFromPdf = useCallback(
    (selectionKey: string) => {
      const group = groupedSpikeNotes.find((currentGroup) => currentGroup.selectionKey === selectionKey)

      if (!group) {
        return
      }

      const preferredNote =
        group.comments.find((note) => note.id === activeSpikeNoteId) ?? group.comments[0]

      if (!preferredNote) {
        return
      }

      handleActivateSpikeNote(preferredNote, {
        expandGroup: true,
        scrollCanvas: false,
        scrollSidebar: true,
      })
    },
    [activeSpikeNoteId, groupedSpikeNotes, handleActivateSpikeNote],
  )

  const handleSaveEditedSpikeNote = useCallback(() => {
    if (!editingSpikeNoteId) {
      return
    }

    const nextComment = editingSpikeNoteComment.trim()
    let updated = false

    setSpikeNotes((currentNotes) =>
      currentNotes.map((note) => {
        if (note.id !== editingSpikeNoteId) {
          return note
        }

        updated = true
        return {
          ...note,
          comment: nextComment,
        }
      }),
    )

    if (updated) {
      setStatusMessage('Spike note updated in local spike state only.')
    }

    setEditingSpikeNoteId(null)
    setEditingSpikeNoteComment('')
    setPendingDeleteSpikeNoteId(null)
  }, [editingSpikeNoteComment, editingSpikeNoteId])

  const handleDeleteSpikeNote = useCallback((noteId: string) => {
    const noteToDelete = spikeNotes.find((note) => note.id === noteId) ?? null
    const siblingNote =
      noteToDelete == null
        ? null
        : spikeNotes.find(
            (note) => note.selectionKey === noteToDelete.selectionKey && note.id !== noteId,
          ) ?? null
    const shouldClearRuntimeSelection =
      Boolean(noteToDelete) &&
      !siblingNote &&
      (activeSpikeNoteId === noteId || currentRuntimeSelectionKey === noteToDelete?.selectionKey)

    setSpikeNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId))
    setStatusMessage('Spike note deleted from local spike state only.')
    setPendingDeleteSpikeNoteId((currentId) => (currentId === noteId ? null : currentId))
    setEditingSpikeNoteId((currentId) => (currentId === noteId ? null : currentId))
    setEditingSpikeNoteComment((currentComment) =>
      editingSpikeNoteId === noteId ? '' : currentComment,
    )
    setActiveSpikeNoteId((currentId) => {
      if (currentId !== noteId) {
        return currentId
      }

      return siblingNote?.id ?? null
    })

    if (shouldClearRuntimeSelection) {
      setDragSelection(null)
      setPointerDownPoint(null)
      setPointerUpPoint(null)
      setSelectedTokenKeys([])
      setSelectedText('')
      setSelectionLineRangeLabel('')
      setSelectedRangeLabel('')
      setSelectionAccepted(null)
      setSelectionReason('')
      setStartTokenText('')
      setCurrentTokenText('')
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        selectionAccepted: undefined,
        selectionEndLineId: '',
        selectionLinesSpannedCount: 0,
        selectionMode: undefined,
        selectionReason: '',
        selectionStartLineId: '',
        selectedLineRange: '',
        selectedRange: '',
        selectedText: '',
        selectedTokenCount: 0,
        startTokenText: '',
        tokenUnderCursorText: '',
      }))
    }
  }, [activeSpikeNoteId, currentRuntimeSelectionKey, editingSpikeNoteId, spikeNotes])

  const renderPdfPage = useCallback(async (filePath: string) => {
    setIsLoading(true)
    setLoadError('')
    setStatusMessage('Loading PDF page 1 and textContent items...')
    setRenderedPage(null)
    setPendingRender(null)
    setTextItems([])
    setWordTokens([])
    setDragSelection(null)
    setPointerDownPoint(null)
    setPointerUpPoint(null)
    setSelectedTokenKeys([])
    setSelectedText('')
    setSelectionLineRangeLabel('')
    setSelectedRangeLabel('')
    setSelectionAccepted(null)
    setSelectionReason('')
    setStartTokenText('')
    setCurrentTokenText('')

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
        console.info('[PDF textContent geometry spike] pdf.js load progress:', progressData)
      }

      const pdfDocument = await loadingTask.promise
      const page = await pdfDocument.getPage(1)
      const rawTextContent = await page.getTextContent({
        disableNormalization: true,
        includeMarkedContent: true,
      })
      const baseViewport = page.getViewport({ scale: 1 })
      const preferredWidth = 820
      const scale = Math.max(0.8, Math.min(1.6, preferredWidth / baseViewport.width))
      const viewport = page.getViewport({ scale })

      const computedTextItems = rawTextContent.items
        .filter(isRenderableTextItem)
        .map((item, index) => computeTextItemGeometry(item, viewport, index, 1))
        .filter((item): item is GeometryTextItem => item !== null)
      const computedWordTokens = computedTextItems.flatMap((item, itemIndex) =>
        computeTokenGeometry(item, itemIndex * 1000),
      )

      setRenderedPage({
        height: Math.ceil(viewport.height),
        pageNumber: 1,
        scale,
        width: Math.ceil(viewport.width),
      })
      setTextItems(computedTextItems)
      setWordTokens(computedWordTokens)
      setPendingRender({
        byteLength,
        fileName: nextFileName,
        filePath,
        page,
        pageNumber: 1,
        scale,
        textItems: computedTextItems,
        viewport,
        workerMode,
      })
      setDiagnostics({
        byteLength,
        fileName: nextFileName,
        filePath,
        pageHeight: roundForDiagnostics(viewport.height),
        pageWidth: roundForDiagnostics(viewport.width),
        sampleItems: computedTextItems.slice(0, 8).map((item) => ({
          height: roundForDiagnostics(item.height),
          index: item.index,
          text: truncateLabel(item.text, 32),
          width: roundForDiagnostics(item.width),
          x: roundForDiagnostics(item.x),
          y: roundForDiagnostics(item.y),
        })),
        sampleTokens: computedWordTokens.slice(0, 10).map((token) => ({
          height: roundForDiagnostics(token.height),
          index: token.index,
          itemIndex: token.itemIndex,
          text: truncateLabel(token.text, 24),
          width: roundForDiagnostics(token.width),
          x: roundForDiagnostics(token.x),
          y: roundForDiagnostics(token.y),
        })),
        scale: roundForDiagnostics(scale),
        stage: 'page-ready-for-render',
        textItemCount: computedTextItems.length,
        tokenCount: computedWordTokens.length,
        workerMode,
      })
      setStatusMessage(
        `Loaded page 1 of ${nextFileName}. Turn on item and token boxes and compare them with the visible PDF text.`,
      )
    } catch (error) {
      const { message, name } = getErrorDetails(error)
      console.error('[PDF textContent geometry spike] render failure', { error, filePath })
      setLoadError(message)
      setRenderedPage(null)
      setPendingRender(null)
      setTextItems([])
      setWordTokens([])
      setSelectedTokenKeys([])
      setSelectedText('')
      setSelectionLineRangeLabel('')
      setSelectedRangeLabel('')
      setSelectionAccepted(null)
      setSelectionReason('')
      setStartTokenText('')
      setCurrentTokenText('')
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        errorMessage: message,
        errorName: name,
        fileName: currentDiagnostics.fileName ?? getFileNameFromPath(filePath),
        filePath,
        stage: `${currentDiagnostics.stage}-failed`,
      }))
      setStatusMessage(`PDF textContent geometry spike failed for this file. ${name}: ${message}`)
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

    let cancelled = false

    const renderToCanvas = async () => {
      try {
        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('Could not create a 2D canvas context for PDF rendering.')
        }

        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          stage: 'rendering-canvas',
        }))

        canvas.width = Math.ceil(pendingRender.viewport.width)
        canvas.height = Math.ceil(pendingRender.viewport.height)
        canvas.style.width = `${Math.ceil(pendingRender.viewport.width)}px`
        canvas.style.height = `${Math.ceil(pendingRender.viewport.height)}px`

        await pendingRender.page.render({
          canvas,
          viewport: pendingRender.viewport,
        }).promise

        if (cancelled) {
          return
        }

        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          canvasHeight: canvas.height,
          canvasWidth: canvas.width,
          stage: 'render-complete',
        }))
        setStatusMessage(
          `Rendered page 1 of ${pendingRender.fileName}. Inspect whether textContent item boxes match the printed PDF text.`,
        )
      } catch (error) {
        const { message, name } = getErrorDetails(error)
        console.error('[PDF textContent geometry spike] canvas render failure', {
          error,
          filePath: pendingRender.filePath,
        })
        setLoadError(message)
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          errorMessage: message,
          errorName: name,
          stage: `${currentDiagnostics.stage}-failed`,
        }))
        setStatusMessage(`Controlled PDF render failed for this file. ${name}: ${message}`)
      }
    }

    void renderToCanvas()

    return () => {
      cancelled = true
    }
  }, [pendingRender, renderedPage])

  const getLocalPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }, [])

  const evaluateDragSelection = useCallback(
    (selection: DragSelectionState, end: DragPoint): SelectionResult => {
      const anchoredLine = tokenLineClusters[selection.lineIndex]

      if (!anchoredLine) {
        return {
          currentTokenKey: undefined,
          currentTokenText: '',
          endLineId: '',
          lineRangeLabel: selection.lineRangeLabel,
          linesSpannedCount: 0,
          reason: 'No word tokens selected. Try dragging across a visible word or phrase.',
          selectedRangeLabel: '',
          selectedText: '',
          selectedTokenKeys: [],
          selectionMode: 'single-line',
          startLineId: '',
          startTokenKey: selection.startTokenKey,
          startTokenText: '',
          success: false,
        }
      }
      const startToken =
        anchoredLine.tokens.find((token) => getTokenKey(token) === selection.startTokenKey) ?? null
      const currentLine = findNearestLineCluster(tokenLineClusters, end.y) ?? anchoredLine
      const currentLineIndex = tokenLineClusters.findIndex(
        (line) => line.lineId === currentLine.lineId,
      )
      const linesSpannedCount = Math.abs(currentLineIndex - selection.lineIndex) + 1
      const currentToken =
        findNearestTokenInLine(currentLine, end) ??
        currentLine.tokens.find((token) => getTokenKey(token) === selection.startTokenKey) ??
        startToken

      if (!startToken || !currentToken) {
        return {
          currentTokenKey: currentToken ? getTokenKey(currentToken) : undefined,
          currentTokenText: currentToken?.text ?? '',
          endLineId: currentLine.lineId,
          lineRangeLabel: selection.lineRangeLabel,
          linesSpannedCount,
          reason: 'No word tokens selected. Try dragging across a visible word or phrase.',
          selectedRangeLabel: '',
          selectedText: '',
          selectedTokenKeys: [],
          selectionMode:
            linesSpannedCount === 1
              ? 'single-line'
              : linesSpannedCount === 2
                ? 'two-line'
                : linesSpannedCount === 3
                  ? 'three-line'
                  : linesSpannedCount <= PARAGRAPH_LINE_LIMIT
                    ? 'paragraph'
                    : 'unsupported-multiline',
          startLineId: anchoredLine.lineId,
          startTokenKey: selection.startTokenKey,
          startTokenText: startToken?.text ?? '',
          success: false,
        }
      }

      if (
        linesSpannedCount > PARAGRAPH_LINE_LIMIT ||
        Math.abs(currentLineIndex - selection.lineIndex) > PARAGRAPH_LINE_LIMIT - 1
      ) {
        return {
          currentTokenKey: getTokenKey(currentToken),
          currentTokenText: currentToken.text,
          endLineId: currentLine.lineId,
          lineRangeLabel: `${anchoredLine.lineRangeLabel} -> ${currentLine.lineRangeLabel}`,
          linesSpannedCount,
          reason: `Spike selection currently supports up to ${PARAGRAPH_LINE_LIMIT} adjacent lines only.`,
          selectedRangeLabel: '',
          selectedText: '',
          selectedTokenKeys: [],
          selectionMode: 'unsupported-multiline',
          startLineId: anchoredLine.lineId,
          startTokenKey: selection.startTokenKey,
          startTokenText: startToken.text,
          success: false,
        }
      }

      const startIndex = anchoredLine.tokens.findIndex(
        (token) => getTokenKey(token) === selection.startTokenKey,
      )
      const endIndex = currentLine.tokens.findIndex(
        (token) => getTokenKey(token) === getTokenKey(currentToken),
      )

      if (startIndex < 0 || endIndex < 0) {
        return {
          currentTokenKey: currentToken ? getTokenKey(currentToken) : undefined,
          currentTokenText: currentToken?.text ?? '',
          endLineId: currentLine.lineId,
          lineRangeLabel: selection.lineRangeLabel,
          linesSpannedCount,
          reason: 'No word tokens selected. Try dragging across a visible word or phrase.',
          selectedRangeLabel: '',
          selectedText: '',
          selectedTokenKeys: [],
          selectionMode:
            linesSpannedCount === 1
              ? 'single-line'
              : linesSpannedCount === 2
                ? 'two-line'
                : linesSpannedCount === 3
                  ? 'three-line'
                  : linesSpannedCount <= PARAGRAPH_LINE_LIMIT
                    ? 'paragraph'
                    : 'unsupported-multiline',
          startLineId: anchoredLine.lineId,
          startTokenKey: selection.startTokenKey,
          startTokenText: startToken.text,
          success: false,
        }
      }

      const isSingleLine = linesSpannedCount === 1
      const isTwoLine = linesSpannedCount === 2
      const isThreeLine = linesSpannedCount === 3
      const isParagraph = linesSpannedCount >= 4 && linesSpannedCount <= PARAGRAPH_LINE_LIMIT
      const isForwardAcrossLines = currentLineIndex >= selection.lineIndex
      const rangeStart = Math.min(startIndex, endIndex)
      const rangeEnd = Math.max(startIndex, endIndex)
      const selectedTokens = isSingleLine
        ? anchoredLine.tokens.slice(rangeStart, rangeEnd + 1)
        : isTwoLine
          ? isForwardAcrossLines
            ? [
                ...anchoredLine.tokens.slice(startIndex),
                ...currentLine.tokens.slice(0, endIndex + 1),
              ]
            : [
                ...currentLine.tokens.slice(endIndex),
                ...anchoredLine.tokens.slice(0, startIndex + 1),
              ]
          : isThreeLine
            ? isForwardAcrossLines
              ? [
                  ...anchoredLine.tokens.slice(startIndex),
                  ...tokenLineClusters[selection.lineIndex + 1].tokens,
                  ...currentLine.tokens.slice(0, endIndex + 1),
                ]
              : [
                  ...currentLine.tokens.slice(endIndex),
                  ...tokenLineClusters[currentLineIndex + 1].tokens,
                  ...anchoredLine.tokens.slice(0, startIndex + 1),
                ]
            : isForwardAcrossLines
              ? [
                  ...anchoredLine.tokens.slice(startIndex),
                  ...tokenLineClusters
                    .slice(selection.lineIndex + 1, currentLineIndex)
                    .flatMap((line) => line.tokens),
                  ...currentLine.tokens.slice(0, endIndex + 1),
                ]
              : [
                  ...currentLine.tokens.slice(endIndex),
                  ...tokenLineClusters
                    .slice(currentLineIndex + 1, selection.lineIndex)
                    .flatMap((line) => line.tokens),
                  ...anchoredLine.tokens.slice(0, startIndex + 1),
                ]

      if (!selectedTokens.length) {
        return {
          currentTokenKey: currentToken ? getTokenKey(currentToken) : undefined,
          currentTokenText: currentToken?.text ?? '',
          endLineId: currentLine.lineId,
          lineRangeLabel: selection.lineRangeLabel,
          linesSpannedCount,
          reason: 'No word tokens selected. Try dragging across a visible word or phrase.',
          selectedRangeLabel: '',
          selectedText: '',
          selectedTokenKeys: [],
          selectionMode:
            linesSpannedCount === 1
              ? 'single-line'
              : linesSpannedCount === 2
                ? 'two-line'
                : linesSpannedCount === 3
                  ? 'three-line'
                  : linesSpannedCount <= PARAGRAPH_LINE_LIMIT
                    ? 'paragraph'
                    : 'unsupported-multiline',
          startLineId: anchoredLine.lineId,
          startTokenKey: selection.startTokenKey,
          startTokenText: startToken.text,
          success: false,
        }
      }

      return {
        currentTokenKey: currentToken ? getTokenKey(currentToken) : undefined,
        currentTokenText: currentToken?.text ?? '',
        endLineId: currentLine.lineId,
        lineRangeLabel: isSingleLine
          ? anchoredLine.lineRangeLabel
          : `${anchoredLine.lineRangeLabel} -> ${currentLine.lineRangeLabel}`,
        linesSpannedCount,
        reason: isSingleLine
          ? 'Selection accepted.'
          : isTwoLine
            ? 'Two-line selection accepted.'
            : isThreeLine
              ? 'Three-line selection accepted.'
              : 'Paragraph selection accepted.',
        selectedRangeLabel: isSingleLine
          ? `${rangeStart + 1}-${rangeEnd + 1}`
          : isTwoLine
            ? isForwardAcrossLines
              ? `${startIndex + 1}-end | 1-${endIndex + 1}`
              : `1-${endIndex + 1} | ${startIndex + 1}-end`
            : isThreeLine
              ? isForwardAcrossLines
                ? `${startIndex + 1}-end | full line | 1-${endIndex + 1}`
                : `1-${endIndex + 1} | full line | ${startIndex + 1}-end`
              : isForwardAcrossLines
                ? `${startIndex + 1}-end | ${linesSpannedCount - 2} full lines | 1-${endIndex + 1}`
                : `1-${endIndex + 1} | ${linesSpannedCount - 2} full lines | ${startIndex + 1}-end`,
        selectedText: normalizeSelectedTokenText(selectedTokens),
        selectedTokenKeys: selectedTokens.map(getTokenKey),
        selectionMode: isSingleLine
          ? 'single-line'
          : isTwoLine
            ? 'two-line'
            : isThreeLine
              ? 'three-line'
              : isParagraph
                ? 'paragraph'
                : 'unsupported-multiline',
        startLineId: anchoredLine.lineId,
        startTokenKey: selection.startTokenKey,
        startTokenText: startToken.text,
        success: true,
      }
    },
    [tokenLineClusters],
  )

  const applySelectionResult = useCallback((result: SelectionResult) => {
    setSelectedTokenKeys(result.selectedTokenKeys)
    setSelectedText(result.selectedText)
    setSelectionLineRangeLabel(result.lineRangeLabel)
    setSelectedRangeLabel(result.selectedRangeLabel)
    setSelectionAccepted(result.success)
    setSelectionReason(result.reason)
    setStartTokenText(result.startTokenText ?? '')
    setCurrentTokenText(result.currentTokenText ?? '')
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      selectionEndLineId: result.endLineId,
      selectionLinesSpannedCount: result.linesSpannedCount,
      selectionMode: result.selectionMode,
      selectedRange: result.selectedRangeLabel,
      selectedLineRange: result.lineRangeLabel,
      selectedText: result.selectedText,
      selectedTokenCount: result.selectedTokenKeys.length,
      selectionAccepted: result.success,
      selectionReason: result.reason,
      selectionStartLineId: result.startLineId,
      startTokenText: result.startTokenText,
      tokenUnderCursorText: result.currentTokenText,
    }))
    setStatusMessage(result.reason)
  }, [])

  const handleOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!renderedPage || !tokenLineClusters.length) {
        return
      }

      const point = getLocalPoint(event)
      const line = findNearestLineCluster(tokenLineClusters, point.y)

      if (!line) {
        return
      }

      const startToken = findNearestTokenInLine(line, point)

      if (!startToken) {
        return
      }

      const startTokenKey = getTokenKey(startToken)
      const startIndex = line.tokens.findIndex((token) => getTokenKey(token) === startTokenKey)
      const singleTokenRangeLabel = startIndex >= 0 ? `${startIndex + 1}-${startIndex + 1}` : '1-1'
      setPointerDownPoint(point)
      setPointerUpPoint(null)
      setDragSelection({
        currentTokenKey: startTokenKey,
        end: point,
        lineCenterY: line.centerY,
        lineIndex: tokenLineClusters.findIndex((tokenLine) => tokenLine.lineId === line.lineId),
        lineRangeLabel: line.lineRangeLabel,
        lineTokenKeys: line.tokens.map(getTokenKey),
        startTokenKey,
        start: point,
      })
      setSelectedTokenKeys([startTokenKey])
      setSelectedText(startToken.text)
      setSelectionLineRangeLabel(line.lineRangeLabel)
      setSelectedRangeLabel(singleTokenRangeLabel)
      setSelectionAccepted(null)
      setSelectionReason(
        'Drag across neighboring words on one line, or continue into the next adjacent lines.',
      )
      setStartTokenText(startToken.text)
      setCurrentTokenText(startToken.text)
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        selectionEndLineId: line.lineId,
        selectionLinesSpannedCount: 1,
        selectionMode: 'single-line',
        selectedLineRange: line.lineRangeLabel,
        selectedRange: singleTokenRangeLabel,
        selectedText: startToken.text,
        selectedTokenCount: 1,
        selectionAccepted: undefined,
        selectionReason:
          'Drag across neighboring words on one line, or continue into the next adjacent lines.',
        selectionStartLineId: line.lineId,
        startTokenText: startToken.text,
        tokenUnderCursorText: startToken.text,
      }))
      setStatusMessage(
        'Drag across one line or into the next adjacent lines to test controlled selection.',
      )
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [getLocalPoint, renderedPage, tokenLineClusters],
  )

  const handleOverlayPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragSelection) {
        return
      }

      const point = getLocalPoint(event)
      const currentLine = tokenLineClusters.find(
        (line) => line.lineRangeLabel === dragSelection.lineRangeLabel,
      )
      const currentToken = currentLine ? findNearestTokenInLine(currentLine, point) : null

      setDragSelection({
        currentTokenKey: currentToken ? getTokenKey(currentToken) : dragSelection.currentTokenKey,
        end: point,
        lineCenterY: dragSelection.lineCenterY,
        lineIndex: dragSelection.lineIndex,
        lineRangeLabel: dragSelection.lineRangeLabel,
        lineTokenKeys: dragSelection.lineTokenKeys,
        startTokenKey: dragSelection.startTokenKey,
        start: dragSelection.start,
      })

      if (currentLine && currentToken) {
        const previewResult = evaluateDragSelection(
          {
            ...dragSelection,
            currentTokenKey: getTokenKey(currentToken),
            end: point,
          },
          point,
        )

        setSelectedTokenKeys(previewResult.selectedTokenKeys)
        setSelectedText(previewResult.selectedText)
        setSelectionLineRangeLabel(previewResult.lineRangeLabel)
        setSelectedRangeLabel(previewResult.selectedRangeLabel)
        setStartTokenText(previewResult.startTokenText ?? '')
        setCurrentTokenText(previewResult.currentTokenText ?? '')
        setSelectionAccepted(previewResult.success ? null : false)
        setSelectionReason(
          previewResult.success
            ? previewResult.selectionMode === 'paragraph'
              ? 'Previewing paragraph token range.'
              : previewResult.selectionMode === 'three-line'
                ? 'Previewing three-line token range.'
                : previewResult.selectionMode === 'two-line'
                  ? 'Previewing two-line token range.'
                  : 'Previewing single-line token range.'
            : previewResult.reason,
        )
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          selectionEndLineId: previewResult.endLineId,
          selectionLinesSpannedCount: previewResult.linesSpannedCount,
          selectionMode: previewResult.selectionMode,
          selectedLineRange: previewResult.lineRangeLabel,
          selectedRange: previewResult.selectedRangeLabel,
          selectedText: previewResult.selectedText,
          selectedTokenCount: previewResult.selectedTokenKeys.length,
          selectionAccepted: previewResult.success ? undefined : false,
          selectionReason: previewResult.success
            ? previewResult.selectionMode === 'paragraph'
              ? 'Previewing paragraph token range.'
              : previewResult.selectionMode === 'three-line'
                ? 'Previewing three-line token range.'
                : previewResult.selectionMode === 'two-line'
                  ? 'Previewing two-line token range.'
                  : 'Previewing single-line token range.'
            : previewResult.reason,
          selectionStartLineId: previewResult.startLineId,
          startTokenText: previewResult.startTokenText ?? '',
          tokenUnderCursorText: previewResult.currentTokenText ?? '',
        }))
      }
    },
    [dragSelection, evaluateDragSelection, getLocalPoint, tokenLineClusters],
  )

  const finalizeDragSelection = useCallback(
    (point: DragPoint) => {
      if (!dragSelection) {
        return
      }

      setPointerUpPoint(point)
      const result = evaluateDragSelection(dragSelection, point)
      applySelectionResult(result)
      setDragSelection(null)
    },
    [applySelectionResult, dragSelection, evaluateDragSelection],
  )

  const handleOverlayPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragSelection) {
        return
      }

      const point = getLocalPoint(event)
      finalizeDragSelection(point)
      event.currentTarget.releasePointerCapture(event.pointerId)
    },
    [dragSelection, finalizeDragSelection, getLocalPoint],
  )

  const handleOverlayPointerCancel = useCallback(() => {
    setDragSelection(null)
    setPointerUpPoint(null)
    setPointerDownPoint(null)
    setSelectedTokenKeys([])
    setSelectedText('')
    setSelectionLineRangeLabel('')
    setSelectedRangeLabel('')
    setSelectionAccepted(false)
    setSelectionReason('No word tokens selected. Try dragging across a visible word or phrase.')
    setStartTokenText('')
    setCurrentTokenText('')
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      selectionEndLineId: '',
      selectionLinesSpannedCount: 0,
      selectionMode: 'single-line',
      selectedRange: '',
      selectedLineRange: '',
      selectedText: '',
      selectedTokenCount: 0,
      selectionAccepted: false,
      selectionReason: 'No word tokens selected. Try dragging across a visible word or phrase.',
      selectionStartLineId: '',
      startTokenText: '',
      tokenUnderCursorText: '',
    }))
    setStatusMessage('No word tokens selected. Try dragging across a visible word or phrase.')
  }, [])

  const dragBand = useMemo(() => {
    if (!dragSelection) {
      return null
    }

    const left = Math.min(dragSelection.start.x, dragSelection.end.x)
    const top = Math.min(dragSelection.start.y, dragSelection.end.y)
    const width = Math.abs(dragSelection.end.x - dragSelection.start.x)
    const height = Math.abs(dragSelection.end.y - dragSelection.start.y)

    return {
      height,
      left,
      top,
      width,
    }
  }, [dragSelection])

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
        setStatusMessage(
          'The PDF textContent geometry spike can open files only inside the Tauri app.',
        )
        return
      }

      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        title: 'Open PDF for textContent geometry spike',
        directory: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        multiple: false,
      })

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
      const message = error instanceof Error ? error.message : 'Unknown file dialog error.'
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

  const handleBackToNoteAnchor = useCallback(() => {
    if (window.location.hash === '#pdf-textcontent-geometry-spike') {
      history.replaceState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      return
    }

    const searchParams = new URLSearchParams(window.location.search)

    if (searchParams.get('pdf-textcontent-geometry-spike') === '1') {
      searchParams.delete('pdf-textcontent-geometry-spike')
      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      history.replaceState(null, '', nextUrl)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [])

  return (
    <main className="pdf-textcontent-geometry-spike-page">
      <section className="pdf-textcontent-geometry-spike-hero">
        <div className="pdf-textcontent-geometry-spike-actions">
          <button
            className="pdf-textcontent-geometry-spike-button"
            disabled={isLoading}
            onClick={() => void handleSelectPdf()}
            type="button"
          >
            {isLoading ? 'Loading PDF...' : 'Open PDF for spike'}
          </button>
          <button
            className="pdf-textcontent-geometry-spike-button secondary"
            onClick={handleBackToNoteAnchor}
            type="button"
          >
            Back to NoteAnchor
          </button>
        </div>
        <div className="pdf-textcontent-geometry-spike-toolbar-meta">
          <span className="pdf-textcontent-geometry-spike-toolbar-mode">
            Mode: isolated PDF text-selection spike
          </span>
          <span className="pdf-textcontent-geometry-spike-toolbar-switch">
            Use Back to NoteAnchor to switch modes.
          </span>
        </div>
        <div aria-hidden="true" className="pdf-textcontent-geometry-spike-hidden-meta">
          <span>{statusMessage}</span>
          <span>{loadError}</span>
        </div>
      </section>

      <section className="pdf-textcontent-geometry-spike-layout">
        <div className="pdf-textcontent-geometry-spike-stage">
          <div className="pdf-textcontent-geometry-spike-stage-header">
            <div>
              <h2>Rendered page with geometry overlay</h2>
              <p>Toggle boxes, labels, and centers to inspect alignment against the visible text.</p>
            </div>
            <div className="pdf-textcontent-geometry-spike-file-meta">
              <span>{fileName || 'No PDF selected yet'}</span>
              <span>{renderedPage ? `Page ${renderedPage.pageNumber}` : 'Page -'}</span>
            </div>
          </div>

          <div className="pdf-textcontent-geometry-spike-canvas-shell" ref={canvasShellRef}>
            {renderedPage ? (
              <div
                className="pdf-textcontent-geometry-spike-page-wrap"
                style={{
                  height: `${renderedPage.height}px`,
                  width: `${renderedPage.width}px`,
                }}
              >
                <canvas
                  ref={canvasRef}
                  className="pdf-textcontent-geometry-spike-canvas"
                />
                <div
                  className="pdf-textcontent-geometry-spike-overlay"
                  onPointerCancel={handleOverlayPointerCancel}
                  onPointerDown={handleOverlayPointerDown}
                  onPointerMove={handleOverlayPointerMove}
                  onPointerUp={handleOverlayPointerUp}
                >
                  {dragBand ? (
                    <div
                      className="pdf-textcontent-geometry-spike-drag-band"
                      style={{
                        height: `${Math.max(dragBand.height, 2)}px`,
                        left: `${dragBand.left}px`,
                        top: `${dragBand.top}px`,
                        width: `${Math.max(dragBand.width, 2)}px`,
                      }}
                    />
                  ) : null}
                  {pointerDownPoint ? (
                    <div
                      className="pdf-textcontent-geometry-spike-pointer pdf-textcontent-geometry-spike-pointer-down"
                      style={{
                        left: `${pointerDownPoint.x}px`,
                        top: `${pointerDownPoint.y}px`,
                      }}
                      title="Pointer down"
                    />
                  ) : null}
                  {pointerUpPoint ? (
                    <div
                      className="pdf-textcontent-geometry-spike-pointer pdf-textcontent-geometry-spike-pointer-up"
                      style={{
                        left: `${pointerUpPoint.x}px`,
                        top: `${pointerUpPoint.y}px`,
                      }}
                      title="Pointer up"
                    />
                  ) : null}
                  {fragmentMarkers.map((marker) => (
                    <button
                      className={`pdf-textcontent-geometry-spike-fragment-marker ${
                        marker.isActive ? 'is-active' : ''
                      }`}
                      key={`fragment-marker-${marker.selectionKey}`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        handleActivateFragmentGroupFromPdf(marker.selectionKey)
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      style={{
                        left: `${marker.left}px`,
                        top: `${marker.top}px`,
                      }}
                      title={`${marker.commentCount} comment${marker.commentCount === 1 ? '' : 's'} on this fragment`}
                      type="button"
                    >
                      {marker.commentCount}
                    </button>
                  ))}
                  {textItems.map((item) => (
                    <div
                      key={`${item.pageNumber}-${item.index}`}
                      className={`pdf-textcontent-geometry-spike-item ${
                        showBoxes ? 'show-box' : ''
                      }`}
                      style={{
                        height: `${item.height}px`,
                        left: `${item.x}px`,
                        top: `${item.y}px`,
                        transform: `rotate(${item.angleDegrees}deg)`,
                        width: `${item.width}px`,
                      }}
                      title={`${item.text} (${roundForDiagnostics(item.x)}, ${roundForDiagnostics(item.y)})`}
                    >
                      {showLabels ? (
                        <span className="pdf-textcontent-geometry-spike-item-label">
                          {truncateLabel(item.text)}
                        </span>
                      ) : null}
                      {showCenters ? (
                        <span
                          className="pdf-textcontent-geometry-spike-item-center"
                          style={{
                            left: `${item.width / 2}px`,
                            top: `${item.height / 2}px`,
                          }}
                        />
                      ) : null}
                    </div>
                  ))}
                  {wordTokens.map((token) => (
                    (() => {
                      const tokenKey = getTokenKey(token)
                      const savedSelectionKey = selectionKeyByTokenKey.get(tokenKey) ?? ''
                      const isSelected = selectedTokenKeys.includes(tokenKey)
                      const isSavedSpikeNote = savedSelectionKey !== ''
                      const isActiveSpikeNote = activeSpikeNoteTokenKeys.has(tokenKey)
                      const isStartToken = dragSelection?.startTokenKey === tokenKey
                      const isCurrentToken = dragSelection?.currentTokenKey === tokenKey
                      const isPreviewSelected = Boolean(dragSelection) && isSelected

                      return (
                        <div
                          key={`token-${token.pageNumber}-${token.itemIndex}-${token.startOffset}-${token.endOffset}`}
                          data-token-key={tokenKey}
                          className={`pdf-textcontent-geometry-spike-token ${
                            showTokenBoxes ? 'show-box' : ''
                          } ${isSelected ? 'is-selected' : ''} ${
                            isSavedSpikeNote ? 'is-saved-note' : ''
                          } ${isActiveSpikeNote ? 'is-active-note' : ''} ${
                            isPreviewSelected ? 'is-preview-selected' : ''
                          } ${
                            isStartToken ? 'is-start-token' : ''
                          } ${
                            isCurrentToken ? 'is-current-token' : ''
                          }`}
                          style={{
                            height: `${token.height}px`,
                            left: `${token.x}px`,
                            top: `${token.y}px`,
                            transform: `rotate(${token.angleDegrees}deg)`,
                            width: `${token.width}px`,
                          }}
                          onClick={
                            savedSelectionKey
                              ? (event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  handleActivateFragmentGroupFromPdf(savedSelectionKey)
                                }
                              : undefined
                          }
                          onPointerDown={
                            savedSelectionKey
                              ? (event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                }
                              : undefined
                          }
                          title={`${token.text} (${roundForDiagnostics(token.x)}, ${roundForDiagnostics(token.y)})`}
                        >
                          {showTokenLabels ? (
                            <span className="pdf-textcontent-geometry-spike-token-label">
                              {truncateLabel(token.text, 14)}
                            </span>
                          ) : null}
                          {showTokenCenters ? (
                            <span
                              className="pdf-textcontent-geometry-spike-token-center"
                              style={{
                                left: `${token.width / 2}px`,
                                top: `${token.height / 2}px`,
                              }}
                            />
                          ) : null}
                        </div>
                      )
                    })()
                  ))}
                </div>
              </div>
            ) : (
              <div className="pdf-textcontent-geometry-spike-empty">
                Select a PDF file to render page 1 and inspect computed text item geometry.
              </div>
            )}
          </div>
        </div>

        <aside className="pdf-textcontent-geometry-spike-sidebar" ref={sidebarRef}>
          <section className="pdf-textcontent-geometry-spike-panel pdf-textcontent-geometry-spike-notes-panel">
            <h3>Spike notes</h3>
            <div className="pdf-textcontent-geometry-spike-notes-action-area">
              {!spikeNoteDraft ? (
                <button
                  className="pdf-textcontent-geometry-spike-button"
                  disabled={!canCreateSpikeNote}
                  onClick={handleOpenSpikeNoteDraft}
                  type="button"
                >
                  Add spike note
                </button>
              ) : (
                <div className="pdf-textcontent-geometry-spike-note-draft-inline">
                  <div className="pdf-textcontent-geometry-spike-selection-box">
                    <div className="pdf-textcontent-geometry-spike-selection-box-label">
                      Selected text
                    </div>
                    <div className="pdf-textcontent-geometry-spike-selection-box-value">
                      {spikeNoteDraft.selectedText}
                    </div>
                  </div>
                  <label className="pdf-textcontent-geometry-spike-note-label">
                    <span>Comment</span>
                    <textarea
                      className="pdf-textcontent-geometry-spike-note-input"
                      onChange={(event) => setSpikeNoteComment(event.target.value)}
                      placeholder="Add a temporary comment for this spike note..."
                      rows={4}
                      value={spikeNoteComment}
                    />
                  </label>
                  <div className="pdf-textcontent-geometry-spike-note-actions">
                    <button
                      className="pdf-textcontent-geometry-spike-button"
                      onClick={handleSaveSpikeNote}
                      type="button"
                    >
                      Save
                    </button>
                    <button
                      className="pdf-textcontent-geometry-spike-button secondary"
                      onClick={handleCancelSpikeNoteDraft}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            {groupedSpikeNotes.length ? (
              <div className="pdf-textcontent-geometry-spike-notes-list">
                {groupedSpikeNotes.map((group) => (
                  (() => {
                    const isGroupExpanded = expandedFragmentGroups[group.selectionKey] ?? group.comments.length === 1

                    return (
                  <article
                    className={`pdf-textcontent-geometry-spike-note-card ${
                      group.comments.some((note) => note.id === activeSpikeNoteId) ? 'is-active' : ''
                    }`}
                    data-selection-key={group.selectionKey}
                    key={group.selectionKey}
                  >
                    <div className="pdf-textcontent-geometry-spike-note-group-header">
                      <button
                        className="pdf-textcontent-geometry-spike-note-card-main"
                        onClick={() => handleActivateSpikeNote(group.comments[0])}
                        type="button"
                      >
                        <div className="pdf-textcontent-geometry-spike-note-meta">
                          <span>{group.selectionMode}</span>
                          <span>{group.lineCount} line{group.lineCount === 1 ? '' : 's'}</span>
                        </div>
                        <div className="pdf-textcontent-geometry-spike-note-selected-text">
                          {group.selectedText}
                        </div>
                        <div className="pdf-textcontent-geometry-spike-note-group-summary">
                          {group.comments.length} comment{group.comments.length === 1 ? '' : 's'}
                        </div>
                      </button>
                      <button
                        className="pdf-textcontent-geometry-spike-button secondary pdf-textcontent-geometry-spike-group-toggle"
                        onClick={() => handleToggleFragmentGroup(group.selectionKey)}
                        type="button"
                      >
                        {isGroupExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    </div>
                    {isGroupExpanded ? (
                      <div className="pdf-textcontent-geometry-spike-fragment-comments">
                        {group.comments.map((note, commentIndex) => (
                          <div
                            className="pdf-textcontent-geometry-spike-fragment-comment"
                            key={note.id}
                          >
                            <div className="pdf-textcontent-geometry-spike-fragment-comment-meta">
                              <span>Comment {commentIndex + 1}</span>
                            </div>
                            <div className="pdf-textcontent-geometry-spike-note-comment">
                              {note.comment || 'No comment.'}
                            </div>
                            <div className="pdf-textcontent-geometry-spike-note-card-actions">
                              <button
                                className="pdf-textcontent-geometry-spike-button secondary pdf-textcontent-geometry-spike-note-inline-button"
                                onClick={() => handleStartEditingSpikeNote(note)}
                                type="button"
                              >
                                Edit
                              </button>
                              <button
                                className="pdf-textcontent-geometry-spike-button secondary pdf-textcontent-geometry-spike-note-inline-button danger"
                                onClick={() => handleRequestDeleteSpikeNote(note.id)}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                            {pendingDeleteSpikeNoteId === note.id ? (
                              <div className="pdf-textcontent-geometry-spike-note-delete-confirm">
                                <div className="pdf-textcontent-geometry-spike-note-delete-confirm-text">
                                  Delete this comment?
                                </div>
                                <div className="pdf-textcontent-geometry-spike-note-delete-confirm-actions">
                                  <button
                                    className="pdf-textcontent-geometry-spike-button pdf-textcontent-geometry-spike-note-inline-button danger-solid"
                                    onClick={() => handleDeleteSpikeNote(note.id)}
                                    type="button"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    className="pdf-textcontent-geometry-spike-button secondary pdf-textcontent-geometry-spike-note-inline-button"
                                    onClick={handleCancelDeleteSpikeNote}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            {editingSpikeNoteId === note.id ? (
                              <div className="pdf-textcontent-geometry-spike-note-edit-inline">
                                <div className="pdf-textcontent-geometry-spike-selection-box">
                                  <div className="pdf-textcontent-geometry-spike-selection-box-label">
                                    Selected text
                                  </div>
                                  <div className="pdf-textcontent-geometry-spike-selection-box-value">
                                    {group.selectedText}
                                  </div>
                                </div>
                                <label className="pdf-textcontent-geometry-spike-note-label">
                                  <span>Comment</span>
                                  <textarea
                                    className="pdf-textcontent-geometry-spike-note-input"
                                    onChange={(event) => setEditingSpikeNoteComment(event.target.value)}
                                    rows={4}
                                    value={editingSpikeNoteComment}
                                  />
                                </label>
                                <div className="pdf-textcontent-geometry-spike-note-actions">
                                  <button
                                    className="pdf-textcontent-geometry-spike-button"
                                    onClick={handleSaveEditedSpikeNote}
                                    type="button"
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="pdf-textcontent-geometry-spike-button secondary"
                                    onClick={handleCancelEditingSpikeNote}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                    )
                  })()
                ))}
              </div>
            ) : (
              <p className="pdf-textcontent-geometry-spike-muted">
                No spike notes yet.
              </p>
            )}
          </section>

          <section className="pdf-textcontent-geometry-spike-panel pdf-textcontent-geometry-spike-selection-panel">
            <h3>Selection result</h3>
            <div className="pdf-textcontent-geometry-spike-selection-body">
              <div className="pdf-textcontent-geometry-spike-selection-box">
                <div className="pdf-textcontent-geometry-spike-selection-box-label">
                  Selected text
                </div>
                <div className="pdf-textcontent-geometry-spike-selection-box-value">
                  {selectedText || diagnostics.selectedText || 'No selected text yet.'}
                </div>
              </div>
              <dl className="pdf-textcontent-geometry-spike-kv-list">
                <div>
                  <dt>Status</dt>
                  <dd>
                    {(selectionAccepted ?? diagnostics.selectionAccepted) == null
                      ? 'none'
                      : (selectionAccepted ?? diagnostics.selectionAccepted)
                        ? 'accepted'
                        : 'rejected'}
                  </dd>
                </div>
                <div>
                  <dt>Selected tokens</dt>
                  <dd>{diagnostics.selectedTokenCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Selection mode</dt>
                  <dd>{diagnostics.selectionMode || '-'}</dd>
                </div>
                <div>
                  <dt>Lines spanned</dt>
                  <dd>{diagnostics.selectionLinesSpannedCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Start line id</dt>
                  <dd>{diagnostics.selectionStartLineId || '-'}</dd>
                </div>
                <div>
                  <dt>End line id</dt>
                  <dd>{diagnostics.selectionEndLineId || '-'}</dd>
                </div>
                <div>
                  <dt>Selected range</dt>
                  <dd>{selectedRangeLabel || diagnostics.selectedRange || '-'}</dd>
                </div>
                <div className="wide">
                  <dt>Reason</dt>
                  <dd>{selectionReason || diagnostics.selectionReason || '-'}</dd>
                </div>
              </dl>
            </div>
            <div className="pdf-textcontent-geometry-spike-selection-actions">
              <p className="pdf-textcontent-geometry-spike-muted">
                Use the top Spike note block to create a temporary note from the current selection.
              </p>
            </div>
          </section>

          <section className="pdf-textcontent-geometry-spike-panel pdf-textcontent-geometry-spike-advanced-debug-panel">
            <h3>Advanced geometry debug</h3>
            <button
              className="pdf-textcontent-geometry-spike-advanced-debug-toggle"
              onClick={() => setIsAdvancedDebugOpen((currentValue) => !currentValue)}
              type="button"
            >
              <span>{isAdvancedDebugOpen ? 'Hide' : 'Show'}</span> Advanced geometry debug
            </button>
            <div
              className={`pdf-textcontent-geometry-spike-advanced-debug-body ${
                isAdvancedDebugOpen ? 'is-open' : 'is-closed'
              }`}
            >
              <div className="pdf-textcontent-geometry-spike-advanced-debug-marker">
                Advanced debug body mounted
              </div>
              <div className="pdf-textcontent-geometry-spike-debug-grid compact">
                <div>
                  <strong>Raw source item text</strong>
                  <div className="pdf-textcontent-geometry-spike-debug-block compact">
                    {selectedPrimaryTokenDebug?.sourceItemText || 'unavailable'}
                  </div>
                </div>
                <dl className="pdf-textcontent-geometry-spike-kv-list compact">
                  <div>
                    <dt>Token text</dt>
                    <dd>{selectedPrimaryTokenDebug?.tokenText || 'unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Normalized token text</dt>
                    <dd>{selectedPrimaryTokenDebug?.normalizedTokenText || 'unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Selected text</dt>
                    <dd>{selectedPrimaryTokenDebug?.selectedText || 'unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Line id</dt>
                    <dd>{selectedPrimaryTokenDebug?.lineId || 'unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Start token</dt>
                    <dd>{startTokenText || diagnostics.startTokenText || 'unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Current token</dt>
                    <dd>{currentTokenText || diagnostics.tokenUnderCursorText || 'unavailable'}</dd>
                  </div>
                  <div className="wide">
                    <dt>Selected line</dt>
                    <dd>{selectionLineRangeLabel || diagnostics.selectedLineRange || 'unavailable'}</dd>
                  </div>
                  <div className="wide">
                    <dt>Token rect</dt>
                    <dd>
                      {selectedPrimaryTokenDebug
                        ? `L ${selectedPrimaryTokenDebug.tokenRect.left}, T ${selectedPrimaryTokenDebug.tokenRect.top}, W ${selectedPrimaryTokenDebug.tokenRect.width}, R ${selectedPrimaryTokenDebug.tokenRect.right}, H ${selectedPrimaryTokenDebug.tokenRect.height}`
                        : 'unavailable'}
                    </dd>
                  </div>
                  <div className="wide">
                    <dt>Source item rect</dt>
                    <dd>
                      {selectedPrimaryTokenDebug?.sourceItemRect
                        ? `L ${selectedPrimaryTokenDebug.sourceItemRect.left}, T ${selectedPrimaryTokenDebug.sourceItemRect.top}, W ${selectedPrimaryTokenDebug.sourceItemRect.width}, R ${selectedPrimaryTokenDebug.sourceItemRect.right}, H ${selectedPrimaryTokenDebug.sourceItemRect.height}`
                        : 'unavailable'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
            {!selectedPrimaryTokenDebug && !isAdvancedDebugOpen ? (
              <p className="pdf-textcontent-geometry-spike-muted">
                Select one token to inspect extended geometry diagnostics.
              </p>
            ) : null}
          </section>

          <section className="pdf-textcontent-geometry-spike-panel">
            <h3>Overlay toggles</h3>
            <label className="pdf-textcontent-geometry-spike-toggle">
              <input
                checked={showBoxes}
                onChange={(event) => setShowBoxes(event.target.checked)}
                type="checkbox"
              />
              <span>Show text item boxes</span>
            </label>
            <label className="pdf-textcontent-geometry-spike-toggle">
              <input
                checked={showLabels}
                onChange={(event) => setShowLabels(event.target.checked)}
                type="checkbox"
              />
              <span>Show item labels</span>
            </label>
            <label className="pdf-textcontent-geometry-spike-toggle">
              <input
                checked={showCenters}
                onChange={(event) => setShowCenters(event.target.checked)}
                type="checkbox"
              />
              <span>Show item centers</span>
            </label>
            <label className="pdf-textcontent-geometry-spike-toggle">
              <input
                checked={showTokenBoxes}
                onChange={(event) => setShowTokenBoxes(event.target.checked)}
                type="checkbox"
              />
              <span>Show word/token boxes</span>
            </label>
            <label className="pdf-textcontent-geometry-spike-toggle">
              <input
                checked={showTokenLabels}
                onChange={(event) => setShowTokenLabels(event.target.checked)}
                type="checkbox"
              />
              <span>Show token labels</span>
            </label>
            <label className="pdf-textcontent-geometry-spike-toggle">
              <input
                checked={showTokenCenters}
                onChange={(event) => setShowTokenCenters(event.target.checked)}
                type="checkbox"
              />
              <span>Show token centers</span>
            </label>
          </section>

          <section className="pdf-textcontent-geometry-spike-panel">
            <h3>Diagnostics</h3>
            <ul className="pdf-textcontent-geometry-spike-list">
              <li>
                <strong>Stage:</strong> {diagnostics.stage}
              </li>
              <li>
                <strong>Text items:</strong> {diagnostics.textItemCount ?? 0}
              </li>
              <li>
                <strong>Word tokens:</strong> {diagnostics.tokenCount ?? 0}
              </li>
              <li>
                <strong>Viewport:</strong>{' '}
                {diagnostics.pageWidth ?? '-'} x {diagnostics.pageHeight ?? '-'}
              </li>
              <li>
                <strong>Canvas:</strong>{' '}
                {diagnostics.canvasWidth ?? '-'} x {diagnostics.canvasHeight ?? '-'}
              </li>
              <li>
                <strong>Scale:</strong> {diagnostics.scale ?? '-'}
              </li>
              <li>
                <strong>Worker mode:</strong> {diagnostics.workerMode}
              </li>
              <li>
                <strong>Bytes:</strong> {diagnostics.byteLength ?? '-'}
              </li>
            </ul>
          </section>

          <section className="pdf-textcontent-geometry-spike-panel">
            <h3>First items</h3>
            {diagnostics.sampleItems?.length ? (
              <ol className="pdf-textcontent-geometry-spike-samples">
                {diagnostics.sampleItems.map((item) => (
                  <li key={item.index}>
                    <div className="sample-text">{item.text}</div>
                    <div className="sample-meta">
                      #{item.index} x {item.x} y {item.y} w {item.width} h {item.height}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pdf-textcontent-geometry-spike-muted">
                Open a PDF to inspect the first few computed items.
              </p>
            )}
          </section>

          <section className="pdf-textcontent-geometry-spike-panel">
            <h3>First tokens</h3>
            {diagnostics.sampleTokens?.length ? (
              <ol className="pdf-textcontent-geometry-spike-samples">
                {diagnostics.sampleTokens.map((token) => (
                  <li key={`${token.itemIndex}-${token.index}`}>
                    <div className="sample-text">{token.text}</div>
                    <div className="sample-meta">
                      item {token.itemIndex} x {token.x} y {token.y} w {token.width} h {token.height}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pdf-textcontent-geometry-spike-muted">
                Open a PDF to inspect the first few computed word tokens.
              </p>
            )}
          </section>

          <section className="pdf-textcontent-geometry-spike-panel">
            <h3>What to inspect</h3>
            <p className="pdf-textcontent-geometry-spike-muted">
              Turn on boxes and look at whether each box sits over the same visible text on the
              canvas. A line like <code>"Nonsense!" said Mr. Decker.</code> is a good test.
            </p>
          </section>
        </aside>
      </section>
    </main>
  )
}
