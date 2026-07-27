export const CALIBRATION_FEATURE_SIZES = Array.from({ length: 10 }, (_, index) => (index + 1) * 18);

/** @typedef {{x:number, y:number}} Point */
/** @typedef {{kind:"polygon"|"path", layer:number, datatype:number, points:Point[], width:number, pathType:number}} Shape */

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} layer @returns {Shape} */
function rectangle(x1, y1, x2, y2, layer) {
  return {
    kind: "polygon",
    layer,
    datatype: 0,
    width: 0,
    pathType: 0,
    points: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
  };
}

/** Generate vertical and horizontal 1:1 line/space groups from 18 to 180 µm. */
/** @returns {Shape[]} */
export function createCalibrationShapes() {
  /** @type {Shape[]} */
  const shapes = [];
  for (let index = 0; index < CALIBRATION_FEATURE_SIZES.length; index += 1) {
    const feature = CALIBRATION_FEATURE_SIZES[index];
    const layer = index + 1;
    const centreX = (index % 5 - 2) * 29988;
    const centreY = index < 5 ? 17982 : -17982;
    const verticalStart = centreX - 3600 - feature * 6;
    const horizontalStart = centreY - feature * 6;
    for (let bar = 0; bar < 7; bar += 1) {
      const verticalX = verticalStart + bar * feature * 2;
      shapes.push(rectangle(verticalX, centreY - 3996, verticalX + feature, centreY + 3996, layer));
      const horizontalY = horizontalStart + bar * feature * 2;
      shapes.push(rectangle(centreX - 396, horizontalY, centreX + 7596, horizontalY + feature, layer));
    }
  }
  return shapes;
}

export function parseExposureSeries(value) {
  const values = value.split(/[,;\s]+/).filter(Boolean).map(Number);
  if (!values.length) throw new Error("Enter at least one calibration exposure.");
  if (values.some((exposure) => !Number.isFinite(exposure) || exposure < 0.1 || exposure > 600)) {
    throw new Error("Calibration exposures must be between 0.1 and 600 s.");
  }
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length > 12) throw new Error("Use at most 12 calibration exposures per series.");
  return unique;
}
