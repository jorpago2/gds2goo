/** Convert a wheel or trackpad-pinch delta into a bounded viewer zoom. */
export function calculateViewerZoom(currentZoom, pixelDeltaY, pinchGesture = false) {
  if (![currentZoom, pixelDeltaY].every(Number.isFinite)) throw new Error("Viewer zoom values must be finite.");
  const exponent = Math.max(-1, Math.min(1, -pixelDeltaY * (pinchGesture ? 0.01 : 0.002)));
  return Math.max(1, Math.min(8, currentZoom * Math.exp(exponent)));
}
