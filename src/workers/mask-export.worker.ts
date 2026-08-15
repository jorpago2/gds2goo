import { encodeBinaryLayer, MARS_4_9K } from '../../lib/goo.js'
import {
  createMonochromePreview,
  mergeBinaryOverlay,
  rasterizeBinaryMask,
} from '../../lib/raster.js'

type RasterRequest = {
  type: 'rasterize'
  requestId: string
  shapes: Parameters<typeof rasterizeBinaryMask>[0]
  settings: Parameters<typeof rasterizeBinaryMask>[1]
  substrateShapes: Parameters<typeof rasterizeBinaryMask>[0]
  includePng: boolean
}

function progress(requestId: string, stage: string, completed: number) {
  self.postMessage({ type: 'progress', requestId, stage, completed })
}

async function encodePng(pixels: Uint8Array) {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('This browser cannot encode the verification PNG off the main thread.')
  }
  const canvas = new OffscreenCanvas(MARS_4_9K.width, MARS_4_9K.height)
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('The worker could not create the PNG canvas.')
  const image = context.createImageData(MARS_4_9K.width, MARS_4_9K.height)
  for (let index = 0; index < pixels.length; index += 1) {
    const value = pixels[index] ? 255 : 0
    const offset = index * 4
    image.data[offset] = value
    image.data[offset + 1] = value
    image.data[offset + 2] = value
    image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

self.addEventListener('message', async (event: MessageEvent<RasterRequest>) => {
  const request = event.data
  try {
    progress(request.requestId, 'Rasterizing native LCD mask', 0.1)
    const options = {
      width: MARS_4_9K.width,
      height: MARS_4_9K.height,
      pixelMicrometers: MARS_4_9K.pixelMicrometers,
    }
    const pixels = rasterizeBinaryMask(request.shapes, request.settings, options)
    if (request.substrateShapes.length) {
      const overlay = rasterizeBinaryMask(
        request.substrateShapes,
        {
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          offsetX: 0,
          offsetY: 0,
          anchor: 'gds-origin',
          inverted: false,
        },
        options,
      )
      mergeBinaryOverlay(pixels, overlay, request.settings.inverted)
    }
    progress(request.requestId, 'Encoding printer layer', 0.55)
    const encoded = encodeBinaryLayer(
      (row: number) =>
        pixels.subarray(
          row * MARS_4_9K.width,
          (row + 1) * MARS_4_9K.width,
        ),
      MARS_4_9K.width,
      MARS_4_9K.height,
    )
    const smallPreview = createMonochromePreview(
      pixels,
      MARS_4_9K.width,
      MARS_4_9K.height,
      116,
      116,
      request.settings.inverted ? 1 : 0,
    )
    const bigPreview = createMonochromePreview(
      pixels,
      MARS_4_9K.width,
      MARS_4_9K.height,
      290,
      290,
      request.settings.inverted ? 1 : 0,
    )
    progress(request.requestId, 'Encoding verification image', request.includePng ? 0.72 : 0.95)
    const png = request.includePng ? await encodePng(pixels) : null
    const transfer: Transferable[] = [
      encoded.data.buffer,
      smallPreview.buffer,
      bigPreview.buffer,
    ]
    if (png) transfer.push(png.buffer)
    self.postMessage(
      {
        type: 'complete',
        requestId: request.requestId,
        encoded,
        smallPreview,
        bigPreview,
        png,
      },
      { transfer },
    )
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message:
        error instanceof Error ? error.message : 'Mask generation failed.',
    })
  }
})
