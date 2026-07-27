/** Create a closed, screen-centred PATH suitable for deterministic mask rasterization. */
export function createSubstrateOutlineShape({
  shape,
  widthMillimeters,
  heightMillimeters,
  marker = "round",
  flatLengthMillimeters,
  lineWidthMicrometers,
}) {
  if (!(widthMillimeters > 0 && heightMillimeters > 0)) throw new Error("Substrate dimensions must be greater than zero.");
  if (!(lineWidthMicrometers >= 36 && lineWidthMicrometers <= 1000)) {
    throw new Error("Substrate outline width must be between 36 and 1000 µm.");
  }

  let points;
  if (shape === "rectangle") {
    const halfWidth = widthMillimeters * 500;
    const halfHeight = heightMillimeters * 500;
    points = [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
      { x: -halfWidth, y: -halfHeight },
    ];
  } else if (shape === "circle") {
    const radius = widthMillimeters / 2;
    let startAngle = 0;
    let endAngle = 2 * Math.PI;
    let closingPoint = null;

    if (marker === "flat") {
      if (!(flatLengthMillimeters > 0 && flatLengthMillimeters < widthMillimeters)) {
        throw new Error("Flat length must be between zero and the wafer diameter.");
      }
      const halfFlat = flatLengthMillimeters / 2;
      const offset = Math.asin(halfFlat / radius);
      startAngle = -Math.PI / 2 + offset;
      endAngle = 3 * Math.PI / 2 - offset;
    } else if (marker === "notch") {
      const notchDepth = 1;
      const apexFromCentre = radius - notchDepth;
      const halfMouth = (-apexFromCentre + Math.sqrt(2 * radius ** 2 - apexFromCentre ** 2)) / 2;
      const offset = Math.atan2(halfMouth, apexFromCentre + halfMouth);
      startAngle = -Math.PI / 2 + offset;
      endAngle = 3 * Math.PI / 2 - offset;
      closingPoint = { x: 0, y: -apexFromCentre * 1000 };
    } else if (marker !== "round") {
      throw new Error(`Unsupported wafer marker: ${marker}`);
    }

    // A full 360-segment circle stays within 1.5 µm of the exact 3-inch arc, below one 18 µm LCD pixel.
    const segmentCount = Math.max(24, Math.ceil(360 * (endAngle - startAngle) / (2 * Math.PI)));
    points = Array.from({ length: segmentCount + 1 }, (_, index) => {
      const angle = startAngle + (endAngle - startAngle) * index / segmentCount;
      return { x: radius * Math.cos(angle) * 1000, y: radius * Math.sin(angle) * 1000 };
    });
    if (closingPoint) points.push(closingPoint);
    points.push(points[0]);
  } else {
    throw new Error(`Unsupported substrate shape: ${shape}`);
  }

  const kind = /** @type {"path"} */ ("path");
  return {
    kind,
    layer: 0,
    datatype: 0,
    width: lineWidthMicrometers,
    pathType: 0,
    points,
  };
}

/** Generate screen-centred alignment geometry in micrometres. */
export function createAlignmentMarkShapes({
  shape,
  widthMillimeters,
  heightMillimeters,
  style,
  sizeMillimeters = 3,
  edgeExclusionMillimeters = 3,
  lineWidthMicrometers = 180,
}) {
  if (style === "none") return [];
  if (!(sizeMillimeters >= 1 && sizeMillimeters <= 10)) throw new Error("Alignment mark size must be between 1 and 10 mm.");
  const size = sizeMillimeters * 1000;
  const edge = edgeExclusionMillimeters * 1000;
  const halfWidth = widthMillimeters * 500;
  const halfHeight = heightMillimeters * 500;
  const positionX = shape === "circle"
    ? Math.max(0, (Math.min(halfWidth, halfHeight) - edge - size) / Math.sqrt(2))
    : Math.max(0, halfWidth - edge - size);
  const positionY = shape === "circle" ? positionX : Math.max(0, halfHeight - edge - size);
  const positions = [-1, 1].flatMap((xSign) => [-1, 1].map((ySign) => ({ x: xSign * positionX, y: ySign * positionY, xSign, ySign })));
  const path = (points) => ({
    kind: /** @type {"path"} */ ("path"),
    layer: 0,
    datatype: 0,
    width: lineWidthMicrometers,
    pathType: 0,
    points,
  });
  const output = [];

  const addCrosses = () => {
    for (const { x, y } of positions) {
      output.push(path([{ x: x - size / 2, y }, { x: x + size / 2, y }]));
      output.push(path([{ x, y: y - size / 2 }, { x, y: y + size / 2 }]));
    }
  };
  const addCorners = () => {
    for (const { x, y, xSign, ySign } of positions) {
      output.push(path([{ x: x - xSign * size / 2, y }, { x, y }, { x, y: y - ySign * size / 2 }]));
    }
  };
  const addTargets = () => {
    const targetRadius = size / 2;
    for (const { x, y } of positions) {
      const points = Array.from({ length: 49 }, (_, index) => {
        const angle = index / 48 * 2 * Math.PI;
        return { x: x + Math.cos(angle) * targetRadius, y: y + Math.sin(angle) * targetRadius };
      });
      output.push(path(points));
      output.push(path([{ x: x - targetRadius, y }, { x: x + targetRadius, y }]));
      output.push(path([{ x, y: y - targetRadius }, { x, y: y + targetRadius }]));
    }
  };
  const addRuler = () => {
    const rulerY = -halfHeight + edge + size;
    output.push(path([{ x: -5000, y: rulerY }, { x: 5000, y: rulerY }]));
    for (let index = -5; index <= 5; index += 1) {
      const tickHeight = index % 5 === 0 ? size : size / 2;
      output.push(path([{ x: index * 1000, y: rulerY }, { x: index * 1000, y: rulerY + tickHeight }]));
    }
  };

  if (style === "crosses") addCrosses();
  else if (style === "corners") addCorners();
  else if (style === "targets") addTargets();
  else if (style === "ruler") addRuler();
  else if (style === "full") { addCorners(); addTargets(); addRuler(); }
  else throw new Error(`Unsupported alignment mark style: ${style}`);
  return output;
}
