import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import PdfControlledSpike from '../pdf-controlled-spike/PdfControlledSpike.tsx'
import PdfTextSelectionSpike from '../pdf-text-selection-spike/PdfTextSelectionSpike.tsx'
import PdfTextContentGeometrySpike from '../pdf-textcontent-geometry-spike/PdfTextContentGeometrySpike.tsx'

const getIsPdfControlledSpikeRoute = () => {
  const searchParams = new URLSearchParams(window.location.search)

  return (
    searchParams.get('pdf-controlled-spike') === '1' ||
    window.location.hash === '#pdf-controlled-spike'
  )
}

const getIsPdfTextSelectionSpikeRoute = () => {
  const searchParams = new URLSearchParams(window.location.search)

  return (
    searchParams.get('pdf-text-selection-spike') === '1' ||
    window.location.hash === '#pdf-text-selection-spike'
  )
}

const getIsPdfTextContentGeometrySpikeRoute = () => {
  const searchParams = new URLSearchParams(window.location.search)

  return (
    import.meta.env.DEV &&
    (searchParams.get('pdf-textcontent-geometry-spike') === '1' ||
      window.location.hash === '#pdf-textcontent-geometry-spike')
  )
}

function Root() {
  const [isPdfControlledSpikeRoute, setIsPdfControlledSpikeRoute] = useState(
    getIsPdfControlledSpikeRoute(),
  )
  const [isPdfTextSelectionSpikeRoute, setIsPdfTextSelectionSpikeRoute] = useState(
    getIsPdfTextSelectionSpikeRoute(),
  )
  const [isPdfTextContentGeometrySpikeRoute, setIsPdfTextContentGeometrySpikeRoute] = useState(
    getIsPdfTextContentGeometrySpikeRoute(),
  )

  useEffect(() => {
    const syncRouteState = () => {
      setIsPdfControlledSpikeRoute(getIsPdfControlledSpikeRoute())
      setIsPdfTextSelectionSpikeRoute(getIsPdfTextSelectionSpikeRoute())
      setIsPdfTextContentGeometrySpikeRoute(getIsPdfTextContentGeometrySpikeRoute())
    }

    window.addEventListener('hashchange', syncRouteState)
    window.addEventListener('popstate', syncRouteState)

    return () => {
      window.removeEventListener('hashchange', syncRouteState)
      window.removeEventListener('popstate', syncRouteState)
    }
  }, [])

  if (isPdfTextSelectionSpikeRoute) {
    return <PdfTextSelectionSpike />
  }

  if (isPdfTextContentGeometrySpikeRoute) {
    return <PdfTextContentGeometrySpike />
  }

  return isPdfControlledSpikeRoute ? <PdfControlledSpike /> : <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
