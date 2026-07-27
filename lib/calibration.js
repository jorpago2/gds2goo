const CALIBRATION_FEATURE_SIZES = Array.from({ length: 10 }, (_, index) => (index + 1) * 18);

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

/** Generate an asymmetric, pixel-aligned pattern for LCD orientation and polarity checks. */
/** @returns {Shape[]} */
export function createOrientationCheckShapes() {
  /** @type {Shape[]} */
  const shapes = [];
  const layer = 1;
  const pixel = 18;
  const halfWidth = 76680;
  const halfHeight = 38880;
  const inset = pixel * 20;
  const stroke = pixel * 2;
  const block = pixel * 80;
  const gap = pixel * 40;

  shapes.push(
    rectangle(-halfWidth + inset, halfHeight - inset - stroke, halfWidth - inset, halfHeight - inset, layer),
    rectangle(-halfWidth + inset, -halfHeight + inset, halfWidth - inset, -halfHeight + inset + stroke, layer),
    rectangle(-halfWidth + inset, -halfHeight + inset, -halfWidth + inset + stroke, halfHeight - inset, layer),
    rectangle(halfWidth - inset - stroke, -halfHeight + inset, halfWidth - inset, halfHeight - inset, layer),
  );

  const cornerBlocks = (count, startX, startY, directionX) => {
    for (let index = 0; index < count; index += 1) {
      const x = startX + index * directionX * (block + gap);
      shapes.push(rectangle(x, startY, x + directionX * block, startY - block, layer));
    }
  };
  cornerBlocks(1, -halfWidth + inset + gap, halfHeight - inset - gap, 1);
  cornerBlocks(2, halfWidth - inset - gap, halfHeight - inset - gap, -1);
  cornerBlocks(3, halfWidth - inset - gap, -halfHeight + inset + gap + block, -1);
  cornerBlocks(4, -halfWidth + inset + gap, -halfHeight + inset + gap + block, 1);

  shapes.push(
    rectangle(-pixel * 40, -stroke / 2, pixel * 1200, stroke / 2, layer),
    rectangle(-stroke / 2, -pixel * 40, stroke / 2, pixel * 850, layer),
    {
      kind: "polygon", layer, datatype: 0, width: 0, pathType: 0,
      points: [{ x: pixel * 1200, y: -pixel * 12 }, { x: pixel * 1260, y: 0 }, { x: pixel * 1200, y: pixel * 12 }],
    },
    {
      kind: "polygon", layer, datatype: 0, width: 0, pathType: 0,
      points: [{ x: -pixel * 12, y: pixel * 850 }, { x: 0, y: pixel * 910 }, { x: pixel * 12, y: pixel * 850 }],
    },
    rectangle(-pixel * 30, -pixel * 4, pixel * 30, pixel * 4, layer),
    rectangle(-pixel * 4, -pixel * 30, pixel * 4, pixel * 30, layer),
  );

  const scaleY = -halfHeight + inset + pixel * 90;
  const scaleHalf = pixel * 278;
  shapes.push(
    rectangle(-scaleHalf, scaleY - stroke / 2, scaleHalf, scaleY + stroke / 2, layer),
    rectangle(-scaleHalf, scaleY - pixel * 20, -scaleHalf + stroke, scaleY + pixel * 20, layer),
    rectangle(scaleHalf - stroke, scaleY - pixel * 20, scaleHalf, scaleY + pixel * 20, layer),
    rectangle(-pixel * 500, pixel * 250, -pixel * 350, pixel * 400, layer),
    rectangle(-pixel * 250, pixel * 250, -pixel * 100, pixel * 400, layer),
    rectangle(-pixel * 500, -pixel * 400, -pixel * 350, -pixel * 250, layer),
    rectangle(-pixel * 500, -pixel * 400, -pixel * 350, -pixel * 250 + stroke, layer),
    rectangle(-pixel * 500, -pixel * 400, -pixel * 500 + stroke, -pixel * 250, layer),
    rectangle(-pixel * 350 - stroke, -pixel * 400, -pixel * 350, -pixel * 250, layer),
    rectangle(-pixel * 500, -pixel * 250 - stroke, -pixel * 350, -pixel * 250, layer),
  );
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
