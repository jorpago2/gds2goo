/** Build a centred wafer outline with a bottom flat or V-notch. Dimensions are in millimetres. */
export function createWaferOutlinePath({ centreX, centreY, diameter, marker, flatLength, notchDepth = 1 }) {
  const radius = diameter / 2;
  if (!(diameter > 0)) throw new Error("Wafer diameter must be greater than zero.");

  if (marker === "flat") {
    if (!(flatLength > 0 && flatLength < diameter)) throw new Error("Flat length must be between zero and the wafer diameter.");
    const halfFlat = flatLength / 2;
    const flatY = centreY + Math.sqrt(radius ** 2 - halfFlat ** 2);
    return `M ${centreX - halfFlat} ${flatY} A ${radius} ${radius} 0 1 1 ${centreX + halfFlat} ${flatY} L ${centreX - halfFlat} ${flatY} Z`;
  }

  if (marker === "notch") {
    if (!(notchDepth > 0 && notchDepth < radius)) throw new Error("Notch depth must be between zero and the wafer radius.");
    const apexFromCentre = radius - notchDepth;
    const halfMouth = (-apexFromCentre + Math.sqrt(2 * radius ** 2 - apexFromCentre ** 2)) / 2;
    const mouthY = centreY + apexFromCentre + halfMouth;
    return `M ${centreX - halfMouth} ${mouthY} A ${radius} ${radius} 0 1 1 ${centreX + halfMouth} ${mouthY} L ${centreX} ${centreY + apexFromCentre} Z`;
  }

  throw new Error(`Unsupported wafer marker: ${marker}`);
}

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
