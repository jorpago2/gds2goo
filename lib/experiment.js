import { placementAnchorOf, transformPlacedPoint } from "./gds.js";

/** Repeat a layout around its original origin. Limited to 10 × 10 copies for browser memory safety. */
export function repeatShapes(shapes, { rows = 1, columns = 1, pitchXMicrometers = 0, pitchYMicrometers = 0 } = {}) {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 10 || columns > 10) {
    throw new Error("Step-and-repeat rows and columns must be integers between 1 and 10.");
  }
  if (![pitchXMicrometers, pitchYMicrometers].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Step-and-repeat pitch must be zero or greater.");
  }
  if (rows === 1 && columns === 1) return shapes;
  const output = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offsetX = (column - (columns - 1) / 2) * pitchXMicrometers;
      const offsetY = ((rows - 1) / 2 - row) * pitchYMicrometers;
      for (const shape of shapes) {
        output.push({ ...shape, points: shape.points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY })) });
      }
    }
  }
  return output;
}

/** Apply independent physical placement to screen-centred guide geometry. */
export function transformGuideShapes(shapes, { offsetXMicrometers = 0, offsetYMicrometers = 0, rotationDegrees = 0 } = {}) {
  if (![offsetXMicrometers, offsetYMicrometers, rotationDegrees].every(Number.isFinite)) throw new Error("Guide placement must use finite numbers.");
  const angle = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return shapes.map((shape) => ({
    ...shape,
    points: shape.points.map((point) => ({
      x: point.x * cosine - point.y * sine + offsetXMicrometers,
      y: point.x * sine + point.y * cosine + offsetYMicrometers,
    })),
  }));
}

/** Conservative vertex-based check against a substrate's usable circular or rectangular area. */
export function fitsSubstrateArea(shapes, layoutSettings, substrate) {
  if (!shapes.length || !substrate) return true;
  const anchor = placementAnchorOf(shapes, layoutSettings.anchor);
  const angle = -substrate.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const edge = substrate.edgeExclusionMillimeters * 1000;
  const radius = substrate.widthMillimeters * 500;
  const halfWidth = substrate.widthMillimeters * 500;
  const halfHeight = substrate.heightMillimeters * 500;

  for (const shape of shapes) {
    const margin = shape.kind === "path" ? shape.width / 2 : 0;
    for (const point of shape.points) {
      const placed = transformPlacedPoint(point, anchor, layoutSettings);
      const relativeX = placed.x - substrate.offsetXMicrometers;
      const relativeY = placed.y - substrate.offsetYMicrometers;
      const x = relativeX * cosine - relativeY * sine;
      const y = relativeX * sine + relativeY * cosine;
      if (substrate.shape === "rectangle") {
        if (Math.abs(x) + margin > halfWidth - edge || Math.abs(y) + margin > halfHeight - edge) return false;
      } else {
        if (Math.hypot(x, y) + margin > radius - edge) return false;
        if (substrate.marker === "flat") {
          const halfFlat = substrate.flatLengthMillimeters * 500;
          const flatY = -Math.sqrt(radius ** 2 - halfFlat ** 2) + edge + margin;
          if (y < flatY) return false;
        }
        if (substrate.marker === "notch") {
          const notchApexY = -(radius - 1000) + edge + margin;
          if (y < notchApexY - Math.abs(x)) return false;
        }
      }
    }
  }
  return true;
}
