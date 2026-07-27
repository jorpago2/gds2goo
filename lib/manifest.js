const SUBSTRATE_TEMPLATE_IDS = new Set(["wafer-1", "wafer-2", "wafer-3", "slide-75x25", "custom-circle", "custom-rectangle"]);
const ALIGNMENT_STYLES = new Set(["none", "crosses", "corners", "targets", "ruler", "full"]);

export function createRunManifest({ source, mask, exposures, process, outputs }) {
  if (!source || !outputs.length || !exposures.length) throw new Error("The run manifest is incomplete.");
  return {
    schema: "gds2goo-run-manifest/v1",
    generatedAt: new Date().toISOString(),
    application: {
      name: "GDS2GOO",
      version: "0.3.0",
      url: "https://jorpago2.github.io/gds2goo/",
    },
    source,
    printer: {
      model: "Elegoo Mars 4 9K",
      lcdPixels: [8520, 4320],
      lcdSizeMillimeters: [153.36, 77.76],
      pixelPitchMicrometers: 18,
      wavelengthNanometers: 405,
    },
    mask,
    exposuresSeconds: exposures,
    process: {
      photoresist: process.photoresist.trim() || null,
      thicknessNanometers: process.thicknessNm ? Number(process.thicknessNm) : null,
      softBake: process.softBake.trim() || null,
      development: process.development.trim() || null,
      notes: process.notes.trim() || null,
    },
    outputs,
  };
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function rangedNumber(value, label, minimum, maximum) {
  const number = finiteNumber(value, label);
  if (number < minimum || number > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  return number;
}

/** Validate and normalize a GDS2GOO run manifest before restoring UI state. */
export function parseRunManifest(input) {
  let manifest;
  try {
    manifest = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("The run manifest is not valid JSON.");
  }
  if (!manifest || typeof manifest !== "object" || manifest.schema !== "gds2goo-run-manifest/v1") {
    throw new Error("Unsupported run manifest schema.");
  }
  if (!manifest.source || typeof manifest.source.name !== "string" || !manifest.mask || !manifest.mask.placement) {
    throw new Error("The run manifest is incomplete.");
  }
  if (!["gds", "generated-calibration", "generated-diagnostic"].includes(manifest.source.kind)) {
    throw new Error("The run manifest contains an unsupported source type.");
  }
  if (manifest.printer?.model !== "Elegoo Mars 4 9K"
    || manifest.printer?.lcdPixels?.[0] !== 8520
    || manifest.printer?.lcdPixels?.[1] !== 4320) {
    throw new Error("The run manifest targets a different printer profile.");
  }
  const exposures = manifest.exposuresSeconds;
  if (!Array.isArray(exposures) || !exposures.length) throw new Error("The run manifest contains no exposure time.");
  const normalizedExposures = exposures.map((value) => finiteNumber(value, "Exposure"));
  if (normalizedExposures.some((value) => value < 0.1 || value > 600)) {
    throw new Error("Manifest exposures must be between 0.1 and 600 s.");
  }
  const placement = manifest.mask.placement;
  if (!["center", "gds-origin", "lower-left"].includes(placement.anchor)) throw new Error("Invalid placement anchor in run manifest.");
  const rotation = finiteNumber(placement.rotationDegrees, "Rotation");
  if (![0, 90, 180, 270].includes(rotation)) throw new Error("Manifest rotation must be 0, 90, 180 or 270 degrees.");
  if (!Array.isArray(manifest.mask.selectedLayers) || manifest.mask.selectedLayers.some((layer) => !Number.isInteger(layer))) {
    throw new Error("The run manifest contains invalid layer identifiers.");
  }
  let substrateOutline = null;
  if (manifest.mask.substrateOutline !== null && manifest.mask.substrateOutline !== undefined) {
    const substrate = manifest.mask.substrateOutline;
    if (!SUBSTRATE_TEMPLATE_IDS.has(substrate.templateId)) throw new Error("The run manifest contains an unsupported substrate outline.");
    if (!["round", "flat", "notch"].includes(substrate.marker)) throw new Error("The run manifest contains an invalid substrate edge marker.");
    const lineWidthMicrometers = finiteNumber(substrate.lineWidthMicrometers, "Substrate outline width");
    if (lineWidthMicrometers < 36 || lineWidthMicrometers > 1000) {
      throw new Error("Substrate outline width must be between 36 and 1000 µm.");
    }
    substrateOutline = {
      templateId: substrate.templateId,
      marker: substrate.marker,
      included: Boolean(substrate.included),
      lineWidthMicrometers,
      widthMillimeters: rangedNumber(substrate.widthMillimeters ?? 1, "Substrate width", 1, 153.36),
      heightMillimeters: rangedNumber(substrate.heightMillimeters ?? 1, "Substrate height", 1, 77.76),
      flatLengthMillimeters: rangedNumber(substrate.flatLengthMillimeters ?? 0, "Flat length", 0, 153.35),
      offsetXMicrometers: rangedNumber(substrate.offsetXMicrometers ?? 0, "Substrate X", -153360, 153360),
      offsetYMicrometers: rangedNumber(substrate.offsetYMicrometers ?? 0, "Substrate Y", -77760, 77760),
      rotationDegrees: rangedNumber(substrate.rotationDegrees ?? 0, "Substrate rotation", -180, 180),
      edgeExclusionMillimeters: rangedNumber(substrate.edgeExclusionMillimeters ?? 3, "Edge exclusion", 0, 20),
      alignmentStyle: substrate.alignmentStyle ?? "none",
      alignmentSizeMillimeters: rangedNumber(substrate.alignmentSizeMillimeters ?? 3, "Alignment mark size", 1, 10),
    };
    if (!ALIGNMENT_STYLES.has(substrateOutline.alignmentStyle)) throw new Error("The run manifest contains an invalid alignment mark style.");
    if (substrateOutline.flatLengthMillimeters >= substrateOutline.widthMillimeters) {
      throw new Error("Flat length must be smaller than the substrate diameter.");
    }
  }
  const repeat = manifest.mask.stepAndRepeat ?? {};
  const rows = rangedNumber(repeat.rows ?? 1, "Repeat rows", 1, 10);
  const columns = rangedNumber(repeat.columns ?? 1, "Repeat columns", 1, 10);
  if (!Number.isInteger(rows) || !Number.isInteger(columns)) throw new Error("Repeat rows and columns must be integers.");
  const stepAndRepeat = {
    rows,
    columns,
    pitchXMicrometers: rangedNumber(repeat.pitchXMicrometers ?? 0, "Repeat pitch X", 0, 153360),
    pitchYMicrometers: rangedNumber(repeat.pitchYMicrometers ?? 0, "Repeat pitch Y", 0, 77760),
  };
  const rawLayerExposures = manifest.mask.layerExposuresSeconds ?? {};
  if (!rawLayerExposures || typeof rawLayerExposures !== "object" || Array.isArray(rawLayerExposures)) {
    throw new Error("The run manifest contains invalid layer exposures.");
  }
  const layerExposures = Object.fromEntries(Object.entries(rawLayerExposures).map(([layer, value]) => {
    if (!Number.isInteger(Number(layer))) throw new Error("Layer exposure keys must be integer layer numbers.");
    return [Number(layer), rangedNumber(value, `Layer ${layer} exposure`, 0.1, 600)];
  }));
  const process = manifest.process ?? {};
  return {
    source: manifest.source,
    topCell: typeof manifest.mask.topCell === "string" ? manifest.mask.topCell : null,
    selectedLayers: [...new Set(manifest.mask.selectedLayers)],
    exposures: normalizedExposures,
    settings: {
      exposure: normalizedExposures[0],
      anchor: placement.anchor,
      offsetX: finiteNumber(placement.anchorXMicrometers ?? 0, "Anchor X"),
      offsetY: finiteNumber(placement.anchorYMicrometers ?? 0, "Anchor Y"),
      rotation,
      mirrorX: Boolean(placement.mirrorX),
      mirrorY: Boolean(placement.mirrorY),
      inverted: manifest.mask.polarity === "exposed-background",
    },
    substrateOutline,
    stepAndRepeat,
    layerExposures,
    process: {
      photoresist: typeof process.photoresist === "string" ? process.photoresist : "",
      thicknessNm: Number.isFinite(process.thicknessNanometers) ? String(process.thicknessNanometers) : "",
      softBake: typeof process.softBake === "string" ? process.softBake : "",
      development: typeof process.development === "string" ? process.development : "",
      notes: typeof process.notes === "string" ? process.notes : "",
    },
  };
}
