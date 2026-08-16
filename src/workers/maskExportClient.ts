import type { flattenGds } from '../../lib/gds.js'
import type { rasterizeBinaryMask } from '../../lib/raster.js'

export type ExportProgress = { stage: string; completed: number }
export type MaskExportResult = {
  encoded: { data: Uint8Array; checksum: number; whitePixels: number }
  smallPreview: Uint16Array
  bigPreview: Uint16Array
  png: Uint8Array | null
}

type WorkerMessage =
  | { type: 'progress'; requestId: string; stage: string; completed: number }
  | ({ type: 'complete'; requestId: string } & MaskExportResult)
  | { type: 'error'; requestId: string; message: string }

type Request = {
  resolve: (result: MaskExportResult) => void
  reject: (reason: unknown) => void
  onProgress?: (progress: ExportProgress) => void
}

let worker: Worker | null = null
let generation = 0
const pending = new Map<string, Request>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.requestId !== 'string') return false
  if (value.type === 'progress') return typeof value.stage === 'string' && typeof value.completed === 'number'
  if (value.type === 'error') return typeof value.message === 'string'
  if (value.type !== 'complete' || !isRecord(value.encoded)) return false
  return value.encoded.data instanceof Uint8Array
    && typeof value.encoded.checksum === 'number'
    && typeof value.encoded.whitePixels === 'number'
    && value.smallPreview instanceof Uint16Array
    && value.bigPreview instanceof Uint16Array
    && (value.png === null || value.png instanceof Uint8Array)
}

function failPending(error: Error) {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
  worker?.terminate()
  worker = null
}

function activeWorker() {
  if (worker) return worker
  const currentGeneration = generation
  worker = new Worker(new URL('./mask-export.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (currentGeneration !== generation) return
    if (!isWorkerMessage(event.data)) {
      failPending(new Error('The mask worker returned an invalid response.'))
      return
    }
    const message = event.data
    const request = pending.get(message.requestId)
    if (!request) return
    if (message.type === 'progress') {
      request.onProgress?.({
        stage: message.stage,
        completed: message.completed,
      })
      return
    }
    pending.delete(message.requestId)
    if (message.type === 'error') {
      request.reject(new Error(message.message))
      return
    }
    request.resolve(message)
  })
  worker.addEventListener('error', (event) => {
    if (currentGeneration !== generation) return
    failPending(new Error(event.message || 'The mask worker stopped unexpectedly.'))
  })
  worker.addEventListener('messageerror', () => {
    if (currentGeneration !== generation) return
    failPending(new Error('The mask worker returned an unreadable response.'))
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
