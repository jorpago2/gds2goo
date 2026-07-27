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
