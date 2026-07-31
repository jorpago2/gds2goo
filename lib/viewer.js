/** Convert a wheel or trackpad-pinch delta into a bounded viewer zoom. */
export function calculateViewerZoom(currentZoom, pixelDeltaY, pinchGesture = false) {
  if (![currentZoom, pixelDeltaY].every(Number.isFinite)) throw new Error("Viewer zoom values must be finite.");
  const exponent = Math.max(-1, Math.min(1, -pixelDeltaY * (pinchGesture ? 0.01 : 0.002)));
  return Math.max(1, Math.min(64, currentZoom * Math.exp(exponent)));
}

/** Increase preview detail in stable tiers, capped at the printer's native raster. */
export function calculateViewerRasterSize(zoom, nativeWidth, nativeHeight, baseWidth = 1400) {
  if (![zoom, nativeWidth, nativeHeight, baseWidth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Viewer raster dimensions must be positive finite values.");
  }
  const width = Math.min(Math.round(nativeWidth), Math.round(baseWidth * 2 ** Math.max(0, Math.ceil(Math.log2(zoom)))));
  return { width, height: Math.round(width * nativeHeight / nativeWidth) };
}

/** Reduced-order latent-image response: local dose followed by a calibrated contrast curve. */
export function calculateResistResponse(normalizedIntensity, exposureSeconds, thresholdSeconds, contrast) {
  if (![normalizedIntensity, exposureSeconds, thresholdSeconds, contrast].every(Number.isFinite)
    || normalizedIntensity < 0 || normalizedIntensity > 1
    || exposureSeconds < 0 || thresholdSeconds <= 0 || contrast <= 0) {
    throw new Error("Resist response values are outside their physical model bounds.");
  }
  const doseRatio = normalizedIntensity * exposureSeconds / thresholdSeconds;
  if (doseRatio === 0) return 0;
  const contrastedDose = doseRatio ** contrast;
  return contrastedDose / (1 + contrastedDose);
}
