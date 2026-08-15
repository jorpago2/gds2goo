import type { flattenGds } from '../../lib/gds.js'
import type { rasterizeBinaryMask } from '../../lib/raster.js'

export type ExportProgress = { stage: string; completed: number }
export type MaskExportResult = {
  encoded: { data: Uint8Array; checksum: number; whitePixels: number }
  smallPreview: Uint16Array
  bigPreview: Uint16Array
  png: Uint8Array | null
}

type Request = {
  resolve: (result: MaskExportResult) => void
  reject: (reason: unknown) => void
  onProgress?: (progress: ExportProgress) => void
}

let worker: Worker | null = null
let generation = 0
const pending = new Map<string, Request>()

function activeWorker() {
  if (worker) return worker
  const currentGeneration = generation
  worker = new Worker(new URL('./mask-export.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.addEventListener('message', (event) => {
    if (currentGeneration !== generation) return
    const message = event.data as {
      type: 'progress' | 'complete' | 'error'
      requestId: string
      stage?: string
      completed?: number
      message?: string
    } & Partial<MaskExportResult>
    const request = pending.get(message.requestId)
    if (!request) return
    if (message.type === 'progress') {
      request.onProgress?.({
        stage: message.stage ?? 'Generating mask',
        completed: message.completed ?? 0,
      })
      return
    }
    pending.delete(message.requestId)
    if (message.type === 'error') {
      request.reject(new Error(message.message ?? 'Mask generation failed.'))
      return
    }
    request.resolve(message as MaskExportResult)
  })
  worker.addEventListener('error', (event) => {
    if (currentGeneration !== generation) return
    const error = new Error(event.message || 'The mask worker stopped unexpectedly.')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
  })
  return worker
}

export function rasterizeMaskInWorker(
  shapes: ReturnType<typeof flattenGds>,
  settings: Parameters<typeof rasterizeBinaryMask>[1],
  substrateShapes: ReturnType<typeof flattenGds>,
  includePng: boolean,
  onProgress?: (progress: ExportProgress) => void,
) {
  const requestId = crypto.randomUUID()
  return new Promise<MaskExportResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress })
    try {
      activeWorker().postMessage({
        type: 'rasterize',
        requestId,
        shapes,
        settings,
        substrateShapes,
        includePng,
      })
    } catch (error) {
      pending.delete(requestId)
      reject(error)
    }
  })
}

export function cancelMaskExport() {
  generation += 1
  worker?.terminate()
  worker = null
  const error = new DOMException('Mask generation cancelled.', 'AbortError')
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}
