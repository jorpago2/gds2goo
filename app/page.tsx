"use client";

import { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  boundsOf,
  estimateMinimumFeature,
  fitsDisplay,
  flattenGds,
  parseGds,
} from "@/lib/gds.js";
import { buildGooFile, encodeBinaryLayer, MARS_4_9K, validateGooFile } from "@/lib/goo.js";
import { createCalibrationShapes, createOrientationCheckShapes, parseExposureSeries } from "@/lib/calibration.js";
import { fitsSubstrateArea, repeatShapes, transformGuideShapes } from "@/lib/experiment.js";
import { createRunManifest, parseRunManifest } from "@/lib/manifest.js";
import { createMonochromePreview, mergeBinaryOverlay, rasterizeBinaryMask } from "@/lib/raster.js";
import { parseRecipeLibrary, saveRecipeToLibrary } from "@/lib/recipes.js";
import { createAlignmentMarkShapes, createSubstrateOutlineShape } from "@/lib/substrate.js";
import { calculateViewerRasterSize, calculateViewerZoom } from "@/lib/viewer.js";
import { buildZip } from "@/lib/zip.js";

type MaskSettings = {
  exposure: number;
  anchor: "center" | "gds-origin" | "lower-left";
  offsetX: number;
  offsetY: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  inverted: boolean;
};

const DEFAULT_SETTINGS: MaskSettings = {
  exposure: 9,
  anchor: "center",
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
  inverted: false,
};

const SUBSTRATE_MASK_SETTINGS = { ...DEFAULT_SETTINGS, anchor: "gds-origin" as const };
const INSPECTOR_SIZE = 64;

type SubstrateTemplate = {
  id: string;
  label: string;
  shape: "circle" | "rectangle";
  width: number;
  height: number;
  flatLength: number;
};

type SavedRecipe = {
  name: string;
  exposure: number;
  calibrationSeries: string;
  process: ProcessMetadata;
};

const SUBSTRATE_TEMPLATES: SubstrateTemplate[] = [
  { id: "wafer-1", label: "1-inch wafer · Ø25.4 mm", shape: "circle", width: 25.4, height: 25.4, flatLength: 4 },
  { id: "wafer-2", label: "2-inch wafer · Ø50.8 mm", shape: "circle", width: 50.8, height: 50.8, flatLength: 15.88 },
  { id: "wafer-3", label: "3-inch wafer · Ø76.2 mm", shape: "circle", width: 76.2, height: 76.2, flatLength: 22.22 },
  { id: "slide-75x25", label: "Microscope slide · 75 × 25 mm", shape: "rectangle", width: 75, height: 25, flatLength: 0 },
  { id: "custom-circle", label: "Custom circular substrate", shape: "circle", width: 50, height: 50, flatLength: 15 },
  { id: "custom-rectangle", label: "Custom rectangular substrate", shape: "rectangle", width: 50, height: 25, flatLength: 0 },
];

type ProcessMetadata = {
  photoresist: string;
  thicknessNm: string;
  softBake: string;
  development: string;
  notes: string;
};

type SourceInfo = {
  kind: "gds" | "generated-calibration" | "generated-diagnostic";
  name: string;
  sizeBytes: number | null;
  sha256: string | null;
};

const DEFAULT_PROCESS: ProcessMetadata = {
  photoresist: "",
  thicknessNm: "",
  softBake: "",
  development: "",
  notes: "",
};

function combinedMask(
  shapes: ReturnType<typeof flattenGds>,
  settings: MaskSettings,
  substrateShapes: ReturnType<typeof flattenGds>,
  options: Parameters<typeof rasterizeBinaryMask>[2],
) {
  const pixels = rasterizeBinaryMask(shapes, settings, options);
  if (substrateShapes.length) {
    const overlay = rasterizeBinaryMask(substrateShapes, SUBSTRATE_MASK_SETTINGS, options);
    mergeBinaryOverlay(pixels, overlay, settings.inverted);
  }
  return pixels;
}

function nativeMask(
  shapes: ReturnType<typeof flattenGds>,
  settings: MaskSettings,
  substrateShapes: ReturnType<typeof flattenGds>,
) {
  return combinedMask(shapes, settings, substrateShapes, {
    width: MARS_4_9K.width,
    height: MARS_4_9K.height,
    pixelMicrometers: MARS_4_9K.pixelMicrometers,
  });
}

function rasterizeMask(
  shapes: ReturnType<typeof flattenGds>,
  settings: MaskSettings,
  substrateShapes: ReturnType<typeof flattenGds>,
) {
  const pixels = nativeMask(shapes, settings, substrateShapes);
  const encoded = encodeBinaryLayer(
    (y: number) => pixels.subarray(y * MARS_4_9K.width, (y + 1) * MARS_4_9K.width),
    MARS_4_9K.width,
    MARS_4_9K.height,
  );
  return {
    pixels,
    encoded,
    smallPreview: createMonochromePreview(pixels, MARS_4_9K.width, MARS_4_9K.height, 116, 116, settings.inverted ? 1 : 0),
    bigPreview: createMonochromePreview(pixels, MARS_4_9K.width, MARS_4_9K.height, 290, 290, settings.inverted ? 1 : 0),
  };
}

function drawBinaryPixels(canvas: HTMLCanvasElement, pixels: Uint8Array, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create the binary mask canvas.");
  const image = context.createImageData(width, height);
  for (let index = 0; index < pixels.length; index += 1) {
    const value = pixels[index] ? 255 : 0;
    image.data[index * 4] = value;
    image.data[index * 4 + 1] = value;
    image.data[index * 4 + 2] = value;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return context;
}

function saveFile(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function encodePng(pixels: Uint8Array) {
  const canvas = document.createElement("canvas");
  try {
    drawBinaryPixels(canvas, pixels, MARS_4_9K.width, MARS_4_9K.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not encode the PNG.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function sha256Hex(buffer: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function boundedNumber(value: string, current: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : current;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const runInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const inspector = useRef<HTMLCanvasElement>(null);
  const previewPanel = useRef<HTMLElement>(null);
  const lcdGrid = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<ReturnType<typeof parseGds> | null>(null);
  const [fileName, setFileName] = useState("");
  const [topCell, setTopCell] = useState("");
  const [shapes, setShapes] = useState<ReturnType<typeof flattenGds>>([]);
  const [selectedLayers, setSelectedLayers] = useState<number[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [message, setMessage] = useState("Load a GDSII file to begin.");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showPreviewGrid, setShowPreviewGrid] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [substrateTemplateId, setSubstrateTemplateId] = useState("");
  const [waferMarker, setWaferMarker] = useState<"round" | "flat" | "notch">("round");
  const [includeSubstrateOutline, setIncludeSubstrateOutline] = useState(false);
  const [substrateLineWidth, setSubstrateLineWidth] = useState(180);
  const [substrateOffsetX, setSubstrateOffsetX] = useState(0);
  const [substrateOffsetY, setSubstrateOffsetY] = useState(0);
  const [substrateRotation, setSubstrateRotation] = useState(0);
  const [edgeExclusion, setEdgeExclusion] = useState(3);
  const [customWidth, setCustomWidth] = useState(50);
  const [customHeight, setCustomHeight] = useState(25);
  const [customFlatLength, setCustomFlatLength] = useState(15);
  const [alignmentStyle, setAlignmentStyle] = useState<"none" | "crosses" | "corners" | "targets" | "ruler" | "full">("none");
  const [alignmentSize, setAlignmentSize] = useState(3);
  const [repeatRows, setRepeatRows] = useState(1);
  const [repeatColumns, setRepeatColumns] = useState(1);
  const [repeatPitchX, setRepeatPitchX] = useState(0);
  const [repeatPitchY, setRepeatPitchY] = useState(0);
  const [layerExposures, setLayerExposures] = useState<Record<number, number>>({});
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [recipeName, setRecipeName] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState("");
  const [measureMode, setMeasureMode] = useState(false);
  const [measurementStart, setMeasurementStart] = useState<{ x: number; y: number } | null>(null);
  const [measurementEnd, setMeasurementEnd] = useState<{ x: number; y: number } | null>(null);
  const [inspection, setInspection] = useState({ x: Math.floor(MARS_4_9K.width / 2), y: Math.floor(MARS_4_9K.height / 2) });
  const [calibrationSeries, setCalibrationSeries] = useState("5, 7, 9, 11, 13");
  const [processMetadata, setProcessMetadata] = useState(DEFAULT_PROCESS);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const calibrationMode = sourceInfo?.kind === "generated-calibration";

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRecipes(parseRecipeLibrary(localStorage.getItem("gds2goo-recipes")) as SavedRecipe[]);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(document.fullscreenElement === previewPanel.current);
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  const layers = useMemo(() => [...new Set(shapes.map((shape) => shape.layer))].sort((a, b) => a - b), [shapes]);
  const visibleShapes = useMemo(
    () => shapes.filter((shape) => selectedLayers.includes(shape.layer)),
    [shapes, selectedLayers],
  );
  const repeatedShapes = useMemo(
    () => repeatShapes(visibleShapes, {
      rows: repeatRows,
      columns: repeatColumns,
      pitchXMicrometers: repeatPitchX,
      pitchYMicrometers: repeatPitchY,
    }),
    [visibleShapes, repeatRows, repeatColumns, repeatPitchX, repeatPitchY],
  );
  const bounds = useMemo(() => repeatedShapes.length ? boundsOf(repeatedShapes) : null, [repeatedShapes]);
  const minimumFeature = useMemo(
    () => repeatedShapes.length ? estimateMinimumFeature(repeatedShapes) : null,
    [repeatedShapes],
  );
  const substrateTemplate = useMemo(() => {
    const preset = SUBSTRATE_TEMPLATES.find(({ id }) => id === substrateTemplateId);
    if (!preset) return undefined;
    if (preset.id === "custom-circle") {
      const flatLength = Math.min(customFlatLength, customWidth - 0.1);
      return { ...preset, label: `Custom circular substrate · Ø${customWidth} mm`, width: customWidth, height: customWidth, flatLength };
    }
    if (preset.id === "custom-rectangle") {
      return { ...preset, label: `Custom rectangular substrate · ${customWidth} × ${customHeight} mm`, width: customWidth, height: customHeight };
    }
    return preset;
  }, [substrateTemplateId, customWidth, customHeight, customFlatLength]);
  const substrateOutlineShapes = useMemo(
    () => substrateTemplate ? [createSubstrateOutlineShape({
      shape: substrateTemplate.shape,
      widthMillimeters: substrateTemplate.width,
      heightMillimeters: substrateTemplate.height,
      marker: substrateTemplate.shape === "circle" ? waferMarker : "round",
      flatLengthMillimeters: substrateTemplate.shape === "circle" ? substrateTemplate.flatLength : undefined,
      lineWidthMicrometers: substrateLineWidth,
    })] : [],
    [substrateTemplate, waferMarker, substrateLineWidth],
  );
  const alignmentShapes = useMemo(
    () => substrateTemplate ? createAlignmentMarkShapes({
      shape: substrateTemplate.shape,
      widthMillimeters: substrateTemplate.width,
      heightMillimeters: substrateTemplate.height,
      style: alignmentStyle,
      sizeMillimeters: alignmentSize,
      edgeExclusionMillimeters: edgeExclusion,
      lineWidthMicrometers: substrateLineWidth,
    }) : [],
    [substrateTemplate, alignmentStyle, alignmentSize, edgeExclusion, substrateLineWidth],
  );
  const exportedSubstrateShapes = useMemo(
    () => transformGuideShapes([
      ...(includeSubstrateOutline ? substrateOutlineShapes : []),
      ...alignmentShapes,
    ], {
      offsetXMicrometers: substrateOffsetX,
      offsetYMicrometers: substrateOffsetY,
      rotationDegrees: substrateRotation,
    }),
    [includeSubstrateOutline, substrateOutlineShapes, alignmentShapes, substrateOffsetX, substrateOffsetY, substrateRotation],
  );
  const outsideScreen = Boolean(repeatedShapes.length && (!fitsDisplay(
    repeatedShapes,
    settings,
    MARS_4_9K.sizeX * 1000,
    MARS_4_9K.sizeY * 1000,
  ) || (exportedSubstrateShapes.length && !fitsDisplay(
    exportedSubstrateShapes,
    SUBSTRATE_MASK_SETTINGS,
    MARS_4_9K.sizeX * 1000,
    MARS_4_9K.sizeY * 1000,
  ))));
  const substrateFitSettings = substrateTemplate ? {
      shape: substrateTemplate.shape,
      widthMillimeters: substrateTemplate.width,
      heightMillimeters: substrateTemplate.height,
      marker: substrateTemplate.shape === "circle" ? waferMarker : "round",
      flatLengthMillimeters: substrateTemplate.flatLength,
      offsetXMicrometers: substrateOffsetX,
      offsetYMicrometers: substrateOffsetY,
      rotationDegrees: substrateRotation,
      edgeExclusionMillimeters: edgeExclusion,
    } : null;
  const exportedAlignmentShapes = exportedSubstrateShapes.slice(includeSubstrateOutline ? substrateOutlineShapes.length : 0);
  const outsideSubstrate = Boolean(substrateFitSettings && repeatedShapes.length && (
    !fitsSubstrateArea(repeatedShapes, settings, substrateFitSettings)
    || !fitsSubstrateArea(exportedAlignmentShapes, SUBSTRATE_MASK_SETTINGS, substrateFitSettings)
  ));
  const measurement = measurementStart && measurementEnd ? {
    deltaX: (measurementEnd.x - measurementStart.x) * MARS_4_9K.pixelMicrometers / 1000,
    deltaY: (measurementStart.y - measurementEnd.y) * MARS_4_9K.pixelMicrometers / 1000,
    distance: Math.hypot(measurementEnd.x - measurementStart.x, measurementEnd.y - measurementStart.y)
      * MARS_4_9K.pixelMicrometers / 1000,
  } : null;
  const previewRasterSize = calculateViewerRasterSize(
    previewZoom,
    MARS_4_9K.width,
    MARS_4_9K.height,
  );

  useEffect(() => {
    if (!preview.current || !repeatedShapes.length) return;
    const pixels = combinedMask(repeatedShapes, settings, exportedSubstrateShapes, {
      width: previewRasterSize.width,
      height: previewRasterSize.height,
      pixelMicrometers: MARS_4_9K.pixelMicrometers * MARS_4_9K.width / previewRasterSize.width,
    });
    drawBinaryPixels(preview.current, pixels, previewRasterSize.width, previewRasterSize.height);
  }, [repeatedShapes, settings, exportedSubstrateShapes, previewRasterSize.width, previewRasterSize.height]);

  useEffect(() => {
    if (!inspector.current || !repeatedShapes.length) return;
    const offsetX = Math.max(0, Math.min(MARS_4_9K.width - INSPECTOR_SIZE, inspection.x - INSPECTOR_SIZE / 2));
    const offsetY = Math.max(0, Math.min(MARS_4_9K.height - INSPECTOR_SIZE, inspection.y - INSPECTOR_SIZE / 2));
    const pixels = combinedMask(repeatedShapes, settings, exportedSubstrateShapes, {
      width: INSPECTOR_SIZE,
      height: INSPECTOR_SIZE,
      fullWidth: MARS_4_9K.width,
      fullHeight: MARS_4_9K.height,
      offsetX,
      offsetY,
      pixelMicrometers: MARS_4_9K.pixelMicrometers,
    });
    const context = drawBinaryPixels(inspector.current, pixels, INSPECTOR_SIZE, INSPECTOR_SIZE);
    context.strokeStyle = "#ff5a1f";
    context.lineWidth = 0.5;
    context.strokeRect(inspection.x - offsetX + 0.25, inspection.y - offsetY + 0.25, 0.5, 0.5);
  }, [repeatedShapes, settings, inspection, exportedSubstrateShapes]);

  useEffect(() => {
    const grid = lcdGrid.current;
    if (!grid) return;
    const zoomWithWheel = (event: WheelEvent) => {
      if (!repeatedShapes.length) return;
      event.preventDefault();
      const bounds = grid.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left;
      const cursorY = event.clientY - bounds.top;
      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? grid.clientHeight : 1;
      const pixelDeltaY = event.deltaY * deltaScale;
      setPreviewZoom((currentZoom) => {
        const nextZoom = calculateViewerZoom(currentZoom, pixelDeltaY, event.ctrlKey);
        if (nextZoom === currentZoom) return currentZoom;
        requestAnimationFrame(() => {
          const scale = nextZoom / currentZoom;
          grid.scrollLeft = (grid.scrollLeft + cursorX) * scale - cursorX;
          grid.scrollTop = (grid.scrollTop + cursorY) * scale - cursorY;
        });
        return nextZoom;
      });
    };
    grid.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => grid.removeEventListener("wheel", zoomWithWheel);
  }, [repeatedShapes.length]);

  function inspectPreview(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(MARS_4_9K.width - 1, Math.floor((event.clientX - rect.left) / rect.width * MARS_4_9K.width))),
      y: Math.max(0, Math.min(MARS_4_9K.height - 1, Math.floor((event.clientY - rect.top) / rect.height * MARS_4_9K.height))),
    };
    setInspection(point);
    if (measureMode) {
      if (!measurementStart || measurementEnd) {
        setMeasurementStart(point);
        setMeasurementEnd(null);
      } else setMeasurementEnd(point);
    }
  }

  function updateShapes(nextModel: ReturnType<typeof parseGds>, cell: string) {
    const flattened = flattenGds(nextModel, cell);
    const nextLayers = [...new Set(flattened.map((shape) => shape.layer))].sort((a, b) => a - b);
    setShapes(flattened);
    setSelectedLayers(nextLayers);
    setLayerExposures(Object.fromEntries(nextLayers.map((layer) => [layer, settings.exposure])));
    setMessage(`${flattened.length.toLocaleString("en-US")} geometries ready across ${nextLayers.length} layer(s).`);
  }

  async function loadFile(file?: File) {
    if (!file) return;
    if (!/\.gds(ii)?$/i.test(file.name)) {
      setMessage("Select a .gds or .gdsii file.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setMessage("The GDS exceeds the local 100 MB limit.");
      return;
    }
    try {
      setBusy(true);
      setMessage("Reading GDSII hierarchy…");
      const buffer = await file.arrayBuffer();
      const parsed = parseGds(buffer);
      const sha256 = await sha256Hex(buffer);
      const cell = parsed.topCells.at(-1) ?? "";
      setModel(parsed);
      setFileName(file.name);
      setSourceInfo({ kind: "gds", name: file.name, sizeBytes: file.size, sha256 });
      setTopCell(cell);
      updateShapes(parsed, cell);
    } catch (error) {
      setModel(null);
      setShapes([]);
      setSourceInfo(null);
      setMessage(error instanceof Error ? error.message : "The GDS could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function loadGeneratedPattern(kind: SourceInfo["kind"], name: string, generatedShapes: ReturnType<typeof flattenGds>, readyMessage: string) {
    const generatedLayers = [...new Set(generatedShapes.map((shape) => shape.layer))];
    setModel(null);
    setFileName(name);
    setSourceInfo({ kind, name, sizeBytes: null, sha256: null });
    setTopCell("");
    setShapes(generatedShapes);
    setSelectedLayers(generatedLayers);
    setLayerExposures(Object.fromEntries(generatedLayers.map((layer) => [layer, settings.exposure])));
    setSettings({ ...DEFAULT_SETTINGS, exposure: settings.exposure });
    setMessage(readyMessage);
  }

  function loadCalibrationPattern() {
    loadGeneratedPattern(
      "generated-calibration",
      "calibration-line-space-18-180um",
      createCalibrationShapes(),
      "Built-in 18–180 µm line/space calibration pattern ready.",
    );
  }

  function loadOrientationPattern() {
    loadGeneratedPattern(
      "generated-diagnostic",
      "mars4-9k-orientation-check",
      createOrientationCheckShapes(),
      "Orientation, polarity and clipping diagnostic ready.",
    );
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files[0]);
  }

  async function restoreRun(file?: File) {
    if (!file) return;
    if (!/\.run\.json$/i.test(file.name) || file.size > 1024 * 1024) {
      setMessage("Select a GDS2GOO .run.json file smaller than 1 MB.");
      return;
    }
    try {
      const restored = parseRunManifest(await file.text());
      let restoredShapes: ReturnType<typeof flattenGds>;
      if (restored.source.kind === "gds") {
        if (!model || sourceInfo?.kind !== "gds") throw new Error("Load the source GDS before restoring this run manifest.");
        if (restored.source.sha256 && sourceInfo.sha256 && restored.source.sha256 !== sourceInfo.sha256) {
          throw new Error("The run manifest SHA-256 does not match the loaded GDS.");
        }
        const cell = restored.topCell ?? topCell;
        if (!model.structures.has(cell)) throw new Error(`Top cell “${cell}” is not present in the loaded GDS.`);
        restoredShapes = flattenGds(model, cell);
        setTopCell(cell);
        setShapes(restoredShapes);
      } else if (restored.source.kind === "generated-calibration") {
        restoredShapes = createCalibrationShapes();
        loadGeneratedPattern("generated-calibration", restored.source.name, restoredShapes, "Calibration run restored.");
      } else {
        restoredShapes = createOrientationCheckShapes();
        loadGeneratedPattern("generated-diagnostic", restored.source.name, restoredShapes, "Diagnostic run restored.");
      }
      const availableLayers = new Set(restoredShapes.map((shape) => shape.layer));
      const restoredLayers = restored.selectedLayers.filter((layer) => availableLayers.has(layer));
      if (!restoredLayers.length) throw new Error("None of the manifest layers exist in the selected source.");
      setSelectedLayers(restoredLayers);
      setSettings(restored.settings as MaskSettings);
      setProcessMetadata(restored.process);
      setSubstrateTemplateId(restored.substrateOutline?.templateId ?? "");
      setWaferMarker(restored.substrateOutline?.marker ?? "round");
      setIncludeSubstrateOutline(restored.substrateOutline?.included ?? false);
      setSubstrateLineWidth(restored.substrateOutline?.lineWidthMicrometers ?? 180);
      if (restored.substrateOutline) {
        setCustomWidth(restored.substrateOutline.widthMillimeters);
        setCustomHeight(restored.substrateOutline.heightMillimeters);
        setCustomFlatLength(restored.substrateOutline.flatLengthMillimeters || 15);
        setSubstrateOffsetX(restored.substrateOutline.offsetXMicrometers);
        setSubstrateOffsetY(restored.substrateOutline.offsetYMicrometers);
        setSubstrateRotation(restored.substrateOutline.rotationDegrees);
        setEdgeExclusion(restored.substrateOutline.edgeExclusionMillimeters);
        setAlignmentStyle(restored.substrateOutline.alignmentStyle as typeof alignmentStyle);
        setAlignmentSize(restored.substrateOutline.alignmentSizeMillimeters);
      }
      setRepeatRows(restored.stepAndRepeat.rows);
      setRepeatColumns(restored.stepAndRepeat.columns);
      setRepeatPitchX(restored.stepAndRepeat.pitchXMicrometers);
      setRepeatPitchY(restored.stepAndRepeat.pitchYMicrometers);
      setLayerExposures(Object.keys(restored.layerExposures).length
        ? restored.layerExposures
        : Object.fromEntries(restoredLayers.map((layer) => [layer, restored.settings.exposure])));
      if (restored.exposures.length > 1) setCalibrationSeries(restored.exposures.join(", "));
      setMessage(`Run restored from ${file.name}. Verify the preview before export.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The run manifest could not be restored.");
    } finally {
      if (runInput.current) runInput.current.value = "";
    }
  }

  function changeTopCell(cell: string) {
    if (!model) return;
    try {
      setTopCell(cell);
      updateShapes(model, cell);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The cell hierarchy could not be flattened.");
    }
  }

  function toggleLayer(layer: number) {
    setSelectedLayers((current) => current.includes(layer)
      ? current.filter((value) => value !== layer)
      : [...current, layer].sort((a, b) => a - b));
  }

  function persistRecipes(nextRecipes: SavedRecipe[]) {
    localStorage.setItem("gds2goo-recipes", JSON.stringify(nextRecipes));
    setRecipes(nextRecipes);
  }

  function saveRecipe() {
    try {
      const nextRecipes = saveRecipeToLibrary(recipes, {
        name: recipeName.trim(),
        exposure: settings.exposure,
        calibrationSeries,
        process: processMetadata,
      }) as SavedRecipe[];
      persistRecipes(nextRecipes);
      setSelectedRecipe(nextRecipes[0].name);
      setRecipeName("");
      setMessage(`Process recipe “${nextRecipes[0].name}” saved locally.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The process recipe could not be saved.");
    }
  }

  function loadRecipe() {
    const recipe = recipes.find(({ name }) => name === selectedRecipe);
    if (!recipe) return;
    setSettings({ ...settings, exposure: recipe.exposure });
    setCalibrationSeries(recipe.calibrationSeries);
    setProcessMetadata(recipe.process);
    setMessage(`Process recipe “${recipe.name}” loaded.`);
  }

  function deleteRecipe() {
    if (!selectedRecipe) return;
    persistRecipes(recipes.filter(({ name }) => name !== selectedRecipe));
    setSelectedRecipe("");
    setMessage("Process recipe deleted from this browser.");
  }

  function outputBaseName() {
    return fileName.replace(/\.gds(ii)?$/i, "") || "mask";
  }

  function buildManifest(exposures: number[], outputs: string[]) {
    if (!sourceInfo) throw new Error("The source information is unavailable.");
    return createRunManifest({
      source: sourceInfo,
      exposures,
      outputs,
      process: processMetadata,
      mask: {
        topCell: model ? topCell : null,
        selectedLayers,
        geometryCount: repeatedShapes.length,
        boundsMicrometers: bounds,
        estimatedMinimumFeatureMicrometers: minimumFeature,
        polarity: settings.inverted ? "exposed-background" : "exposed-geometry",
        placement: {
          anchor: settings.anchor,
          anchorXMicrometers: settings.offsetX,
          anchorYMicrometers: settings.offsetY,
          rotationDegrees: settings.rotation,
          mirrorX: settings.mirrorX,
          mirrorY: settings.mirrorY,
        },
        substrateOutline: substrateTemplate ? {
          templateId: substrateTemplate.id,
          marker: substrateTemplate.shape === "circle" ? waferMarker : "round",
          included: includeSubstrateOutline,
          lineWidthMicrometers: substrateLineWidth,
          widthMillimeters: substrateTemplate.width,
          heightMillimeters: substrateTemplate.height,
          flatLengthMillimeters: substrateTemplate.flatLength,
          offsetXMicrometers: substrateOffsetX,
          offsetYMicrometers: substrateOffsetY,
          rotationDegrees: substrateRotation,
          edgeExclusionMillimeters: edgeExclusion,
          alignmentStyle,
          alignmentSizeMillimeters: alignmentSize,
        } : null,
        stepAndRepeat: {
          rows: repeatRows,
          columns: repeatColumns,
          pitchXMicrometers: repeatPitchX,
          pitchYMicrometers: repeatPitchY,
        },
        layerExposuresSeconds: Object.fromEntries(selectedLayers.map((layer) => [layer, layerExposures[layer] ?? settings.exposure])),
      },
    });
  }

  function buildValidatedGoo(raster: ReturnType<typeof rasterizeMask>, exposure: number) {
    const goo = buildGooFile({
      layerData: raster.encoded.data,
      exposureSeconds: exposure,
      whitePixels: raster.encoded.whitePixels,
      smallPreview: raster.smallPreview,
      bigPreview: raster.bigPreview,
    });
    return { goo, check: validateGooFile(goo) };
  }

  async function runExport(startMessage: string, fallbackMessage: string, operation: () => Promise<void>) {
    setBusy(true);
    setMessage(startMessage);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      await operation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      setBusy(false);
    }
  }

  async function exportGoo() {
    if (!visibleShapes.length || outsideScreen) return;
    await runExport("Rasterizing 36.8 million pixels locally…", "The GOO file could not be generated.", async () => {
      const raster = rasterizeMask(repeatedShapes, settings, exportedSubstrateShapes);
      const { goo, check } = buildValidatedGoo(raster, settings.exposure);
      const baseName = outputBaseName();
      const gooName = `${baseName}.goo`;
      saveFile(goo, gooName, "application/octet-stream");
      saveFile(JSON.stringify(buildManifest([settings.exposure], [gooName]), null, 2), `${baseName}.run.json`, "application/json");
      setMessage(`GOO validated: ${check.pixels.toLocaleString("en-US")} pixels, 1 layer, ${settings.exposure} s.`);
    });
  }

  async function exportCalibrationSeries() {
    if (!calibrationMode || !visibleShapes.length || outsideScreen) return;
    await runExport("Preparing calibration exposure series…", "The calibration series could not be generated.", async () => {
      const exposures = parseExposureSeries(calibrationSeries);
      setMessage(`Rasterizing calibration series for ${exposures.length} exposure(s)…`);
      const raster = rasterizeMask(repeatedShapes, settings, exportedSubstrateShapes);
      const outputNames: string[] = [];
      const entries: Array<{ name: string; data: Uint8Array | string }> = [];
      for (const exposure of exposures) {
        const { goo } = buildValidatedGoo(raster, exposure);
        const exposureLabel = String(exposure).replace(".", "p");
        const outputName = `calibration-line-space-${exposureLabel}s.goo`;
        outputNames.push(outputName);
        entries.push({ name: outputName, data: goo });
      }
      const pngName = "calibration-line-space-8520x4320.png";
      entries.push({ name: pngName, data: await encodePng(raster.pixels) });
      outputNames.push(pngName);
      entries.push({ name: "calibration-line-space.run.json", data: JSON.stringify(buildManifest(exposures, outputNames), null, 2) });
      saveFile(buildZip(entries), "calibration-line-space.experiment.zip", "application/zip");
      setMessage(`${exposures.length} validated calibration files packaged with PNG and manifest.`);
    });
  }

  async function exportLayerFiles() {
    if (selectedLayers.length < 2 || outsideScreen) return;
    await runExport(
      `Generating ${selectedLayers.length} independent layer exposure(s)…`,
      "The layer exposure package could not be generated.",
      async () => {
        const entries: Array<{ name: string; data: Uint8Array | string }> = [];
        const outputs: string[] = [];
        const exposures: number[] = [];
        for (let index = 0; index < selectedLayers.length; index += 1) {
          const layer = selectedLayers[index];
          const exposure = Number(layerExposures[layer] ?? settings.exposure);
          if (!(exposure >= 0.1 && exposure <= 600)) throw new Error(`Layer ${layer} exposure must be between 0.1 and 600 s.`);
          const layerShapes = repeatShapes(shapes.filter((shape) => shape.layer === layer), {
            rows: repeatRows,
            columns: repeatColumns,
            pitchXMicrometers: repeatPitchX,
            pitchYMicrometers: repeatPitchY,
          });
          const raster = rasterizeMask(layerShapes, settings, index === 0 ? exportedSubstrateShapes : []);
          const { goo } = buildValidatedGoo(raster, exposure);
          const exposureLabel = String(exposure).replace(".", "p");
          const name = `${outputBaseName()}-L${layer}-${exposureLabel}s.goo`;
          entries.push({ name, data: goo });
          outputs.push(name);
          exposures.push(exposure);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        entries.push({ name: `${outputBaseName()}-layers.run.json`, data: JSON.stringify(buildManifest(exposures, outputs), null, 2) });
        saveFile(buildZip(entries), `${outputBaseName()}-layer-exposures.zip`, "application/zip");
        setMessage(`${selectedLayers.length} layer-specific GOO files validated and packaged.`);
      },
    );
  }

  async function exportBundle() {
    if (!visibleShapes.length || outsideScreen) return;
    await runExport("Building reproducible experiment package…", "The experiment package could not be generated.", async () => {
      const raster = rasterizeMask(repeatedShapes, settings, exportedSubstrateShapes);
      const baseName = outputBaseName();
      const gooName = `${baseName}.goo`;
      const pngName = `${baseName}-8520x4320.png`;
      const manifestName = `${baseName}.run.json`;
      const { goo } = buildValidatedGoo(raster, settings.exposure);
      const png = await encodePng(raster.pixels);
      const manifest = JSON.stringify(buildManifest([settings.exposure], [gooName, pngName]), null, 2);
      const zip = buildZip([
        { name: gooName, data: goo },
        { name: pngName, data: png },
        { name: manifestName, data: manifest },
      ]);
      saveFile(zip, `${baseName}.experiment.zip`, "application/zip");
      setMessage("Experiment package validated: GOO, 9K PNG and run manifest.");
    });
  }

  async function exportPng() {
    if (!visibleShapes.length || outsideScreen) return;
    await runExport("Generating 9K verification PNG…", "The PNG could not be generated.", async () => {
      const png = await encodePng(nativeMask(repeatedShapes, settings, exportedSubstrateShapes));
      saveFile(png, `${fileName.replace(/\.gds(ii)?$/i, "") || "mask"}-8520x4320.png`, "image/png");
      setMessage("9K PNG generated. Use it to verify orientation and polarity.");
    });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await previewPanel.current?.requestFullscreen();
    } catch {
      setMessage("Full-screen mode is unavailable in this browser.");
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="GDS2GOO, home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          GDS<span>2</span>GOO
        </a>
        <div className="device-pill"><span /> Elegoo Mars 4 · 9K</div>
        <p>Local conversion · no file leaves your browser</p>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">MASKLESS PHOTOLITHOGRAPHY TOOL</p>
          <h1><span>From GDS layout</span><em>to the UV display.</em></h1>
        </div>
        <div className="hero-summary">
          <p className="hero-flow">GDSII <span>→</span> NATIVE RASTER <span>→</span> GOO V3.0</p>
          <p className="hero-copy">Rasterize physical geometries at native pixel resolution and generate a single-layer <code>.goo</code> exposure for the Mars 4 9K.</p>
        </div>
      </section>

      <details className="quick-guide">
        <summary>
          <span><b>QUICK GUIDE</b> From layout to a verified exposure</span>
          <small>5 steps · about 2 min</small>
        </summary>
        <div className="guide-body">
          <ol>
            <li><span>01</span><div><strong>Prepare the layout</strong><p>Confirm the GDS physical units and prefer features of at least 36 µm for a robust first test.</p></div></li>
            <li><span>02</span><div><strong>Load and select</strong><p>Drop the GDS, choose its top cell and enable only the layers that must be exposed.</p></div></li>
            <li><span>03</span><div><strong>Place and array</strong><p>Set mask and substrate placement, edge exclusion and step-and-repeat. Display clipping blocks export.</p></div></li>
            <li><span>04</span><div><strong>Calibrate the dose</strong><p>Use the built-in pattern and an exposure series for each resist, thickness, bake and development process.</p></div></li>
            <li><span>05</span><div><strong>Inspect and record</strong><p>Measure, check polarity and native pixels, then download the experiment ZIP and print the run sheet.</p></div></li>
          </ol>
          <p className="guide-safety"><strong>First run:</strong> verify the GOO in UVtools and perform a dry exposure without photoresist. The default 9 s is a starting point, not a universal dose.</p>
          <a href="#converter">Open the converter <span aria-hidden="true">↓</span></a>
        </div>
      </details>

      <section className="workspace" id="converter" aria-label="GDS to GOO converter">
        <aside className="controls">
          <div className="step-heading"><span>01</span><div><p>INPUT</p><h2>File and layers</h2></div></div>
          <div
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
          >
            <input ref={fileInput} type="file" accept=".gds,.gdsii" onChange={onFileChange} />
            <span className="upload-icon" aria-hidden="true">↑</span>
            <strong>{fileName || "Drop your .gds file"}</strong>
            <small>{fileName ? "Click to replace it" : "or click to browse · max. 100 MB"}</small>
          </div>

          <div className="source-actions">
            <button type="button" disabled={busy} onClick={loadCalibrationPattern}>18–180 µm calibration pattern</button>
            <button type="button" disabled={busy} onClick={loadOrientationPattern}>Printer orientation check</button>
            <button type="button" disabled={busy} onClick={() => runInput.current?.click()}>Restore .run.json</button>
            <input ref={runInput} type="file" accept=".json,application/json" onChange={(event) => void restoreRun(event.target.files?.[0])} />
          </div>

          {sourceInfo && (
            <div className="file-options">
              {model && <label>Top cell
                <select value={topCell} onChange={(event) => changeTopCell(event.target.value)}>
                  {model.topCells.map((cell) => <option key={cell}>{cell}</option>)}
                </select>
              </label>}
              {model && (
                <div className={`compatibility-report ${model.compatibility.warnings.length ? "has-warnings" : ""}`}>
                  <div><strong>GDS compatibility</strong><span>{model.compatibility.warnings.length ? `${model.compatibility.warnings.length} warning(s)` : "Ready"}</span></div>
                  <p>
                    {model.compatibility.elementCounts.boundaries} BOUNDARY · {model.compatibility.elementCounts.boxes} BOX · {model.compatibility.elementCounts.paths} PATH · {model.compatibility.elementCounts.references} REF
                  </p>
                  {model.compatibility.warnings.length ? (
                    <ul>{model.compatibility.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  ) : <small>No unsupported exposure geometry detected.</small>}
                </div>
              )}
              <fieldset>
                <legend>Layers to expose</legend>
                <div className="layer-list">
                  {layers.map((layer) => (
                    <button
                      type="button"
                      key={layer}
                      className={selectedLayers.includes(layer) ? "active" : ""}
                      onClick={() => toggleLayer(layer)}
                      aria-pressed={selectedLayers.includes(layer)}
                    >{calibrationMode ? `${layer * 18} µm` : `L${layer}`}</button>
                  ))}
                </div>
              </fieldset>
              {selectedLayers.length > 1 && (
                <details className="process-metadata layer-exposures">
                  <summary>Per-layer exposures</summary>
                  <div className="layer-exposure-grid">
                    {selectedLayers.map((layer) => (
                      <label key={layer}>L{layer} <span>s</span>
                        <input
                          type="number"
                          min="0.1"
                          max="600"
                          step="0.1"
                          value={layerExposures[layer] ?? settings.exposure}
                          onChange={(event) => setLayerExposures({
                            ...layerExposures,
                            [layer]: boundedNumber(event.target.value, layerExposures[layer] ?? settings.exposure, 0.1, 600),
                          })}
                        />
                      </label>
                    ))}
                  </div>
                  <button type="button" disabled={busy || outsideScreen} onClick={() => void exportLayerFiles()}>
                    Download layer exposure ZIP
                  </button>
                  <p>One GOO per layer. Substrate outline and alignment marks are included only in the first file to avoid repeated dose.</p>
                </details>
              )}
              {sourceInfo?.kind === "generated-diagnostic" && (
                <div className="diagnostic-note">
                  <strong>How to read it</strong>
                  <p>Corner blocks increase clockwise: 1 top-left, 2 top-right, 3 bottom-right and 4 bottom-left. The long arrows indicate +X and +Y; the lower bar is 10.008 mm.</p>
                </div>
              )}
            </div>
          )}

          <div className="divider" />
          <div className="step-heading"><span>02</span><div><p>MASK</p><h2>Exposure and orientation</h2></div></div>
          <div className="settings-grid">
            <label>Exposure <span>s</span>
              <input type="number" min="0.1" max="600" step="0.1" value={settings.exposure}
                onChange={(event) => setSettings({ ...settings, exposure: Number(event.target.value) })} />
            </label>
            <label>Rotation
              <select value={settings.rotation} onChange={(event) => setSettings({ ...settings, rotation: Number(event.target.value) })}>
                {[0, 90, 180, 270].map((angle) => <option key={angle} value={angle}>{angle}°</option>)}
              </select>
            </label>
            <label className="full-width">Placement anchor
              <select value={settings.anchor} onChange={(event) => setSettings({ ...settings, anchor: event.target.value as MaskSettings["anchor"] })}>
                <option value="center">Layout centre</option>
                <option value="gds-origin">GDS origin (0, 0)</option>
                <option value="lower-left">Layout lower-left</option>
              </select>
            </label>
            <label>Anchor X <span>µm</span>
              <input type="number" step="18" value={settings.offsetX}
                onChange={(event) => setSettings({ ...settings, offsetX: Number(event.target.value) })} />
            </label>
            <label>Anchor Y <span>µm</span>
              <input type="number" step="18" value={settings.offsetY}
                onChange={(event) => setSettings({ ...settings, offsetY: Number(event.target.value) })} />
            </label>
          </div>
          <p className="placement-note">Anchor coordinates are measured from the LCD centre.</p>
          <details className="process-metadata repeat-settings">
            <summary>Step-and-repeat</summary>
            <div className="process-grid">
              <label>Rows <span>1–10</span>
                <input type="number" min="1" max="10" step="1" value={repeatRows}
                  onChange={(event) => setRepeatRows(Math.round(boundedNumber(event.target.value, repeatRows, 1, 10)))} />
              </label>
              <label>Columns <span>1–10</span>
                <input type="number" min="1" max="10" step="1" value={repeatColumns}
                  onChange={(event) => setRepeatColumns(Math.round(boundedNumber(event.target.value, repeatColumns, 1, 10)))} />
              </label>
              <label>Pitch X <span>µm</span>
                <input type="number" min="0" step="18" value={repeatPitchX}
                  onChange={(event) => setRepeatPitchX(boundedNumber(event.target.value, repeatPitchX, 0, 153360))} />
              </label>
              <label>Pitch Y <span>µm</span>
                <input type="number" min="0" step="18" value={repeatPitchY}
                  onChange={(event) => setRepeatPitchY(boundedNumber(event.target.value, repeatPitchY, 0, 77760))} />
              </label>
            </div>
            <p>{repeatRows * repeatColumns} copies · pitch is centre-to-centre. Maximum 100 copies.</p>
          </details>
          {calibrationMode && (
            <div className="calibration-series">
              <label>Exposure series <span>s · comma-separated</span>
                <input type="text" value={calibrationSeries} onChange={(event) => setCalibrationSeries(event.target.value)} />
              </label>
              <button type="button" disabled={busy || outsideScreen} onClick={() => void exportCalibrationSeries()}>
                Download calibration bundle (.zip)
              </button>
              <p>Includes every GOO exposure, a 9K PNG and the run manifest.</p>
            </div>
          )}
          <div className="toggle-row">
            <button type="button" className={settings.mirrorX ? "active" : ""} onClick={() => setSettings({ ...settings, mirrorX: !settings.mirrorX })}>↔ Mirror X</button>
            <button type="button" className={settings.mirrorY ? "active" : ""} onClick={() => setSettings({ ...settings, mirrorY: !settings.mirrorY })}>↕ Mirror Y</button>
          </div>
          <label className="switch-row">
            <input type="checkbox" checked={settings.inverted} onChange={(event) => setSettings({ ...settings, inverted: event.target.checked })} />
            <span className="switch" />
            Invert polarity <small>{settings.inverted ? "exposed background" : "exposed geometry"}</small>
          </label>

          <details className="process-metadata recipe-library">
            <summary>Local process recipes</summary>
            <label>Recipe name
              <input type="text" maxLength={50} value={recipeName} placeholder="e.g. AZ1505 · 600 nm"
                onChange={(event) => setRecipeName(event.target.value)} />
            </label>
            <button type="button" disabled={!recipeName.trim()} onClick={saveRecipe}>Save current process</button>
            {recipes.length > 0 && (
              <>
                <label>Saved recipes
                  <select value={selectedRecipe} onChange={(event) => setSelectedRecipe(event.target.value)}>
                    <option value="">Select a recipe</option>
                    {recipes.map((recipe) => <option key={recipe.name} value={recipe.name}>{recipe.name}</option>)}
                  </select>
                </label>
                <div className="recipe-actions">
                  <button type="button" disabled={!selectedRecipe} onClick={loadRecipe}>Load</button>
                  <button type="button" disabled={!selectedRecipe} onClick={deleteRecipe}>Delete</button>
                </div>
              </>
            )}
            <p>Stored only in this browser. Recipes contain exposure and process metadata, not GDS geometry.</p>
          </details>

          <details className="process-metadata">
            <summary>Process metadata</summary>
            <div className="process-grid">
              <label>Photoresist
                <input type="text" value={processMetadata.photoresist} placeholder="e.g. AZ1505"
                  onChange={(event) => setProcessMetadata({ ...processMetadata, photoresist: event.target.value })} />
              </label>
              <label>Thickness <span>nm</span>
                <input type="number" min="0" step="1" value={processMetadata.thicknessNm} placeholder="e.g. 600"
                  onChange={(event) => setProcessMetadata({ ...processMetadata, thicknessNm: event.target.value })} />
              </label>
              <label>Soft bake
                <input type="text" value={processMetadata.softBake} placeholder="e.g. 100 °C · 60 s"
                  onChange={(event) => setProcessMetadata({ ...processMetadata, softBake: event.target.value })} />
              </label>
              <label>Development
                <input type="text" value={processMetadata.development} placeholder="e.g. AZ 400K 1:4 · 45 s"
                  onChange={(event) => setProcessMetadata({ ...processMetadata, development: event.target.value })} />
              </label>
            </div>
            <label>Notes
              <textarea value={processMetadata.notes} rows={2} placeholder="Substrate, contact mode, batch…"
                onChange={(event) => setProcessMetadata({ ...processMetadata, notes: event.target.value })} />
            </label>
            <p>Saved locally in the companion <code>.run.json</code> file.</p>
          </details>

          <div className={`status ${outsideScreen ? "error" : outsideSubstrate ? "warning" : ""}`} role="status">
            <span>{outsideScreen || outsideSubstrate ? "!" : busy ? "…" : "✓"}</span>
            <p>{outsideScreen
              ? "The mask exceeds the physical display area."
              : outsideSubstrate
                ? "The layout crosses the configured substrate usable area. Export remains available."
                : message}</p>
          </div>
          <button className="primary-action" type="button" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportGoo()}>
            {busy ? "Processing…" : "Generate .GOO file"}<span>→</span>
          </button>
          <button className="secondary-action" type="button" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportPng()}>
            Download 9K verification PNG
          </button>
          <button className="secondary-action bundle-action" type="button" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportBundle()}>
            Download experiment bundle (.zip)
          </button>
          <button className="secondary-action print-action" type="button" disabled={busy || !visibleShapes.length} onClick={() => window.print()}>
            Print experimental run sheet
          </button>
        </aside>

        <section ref={previewPanel} className="preview-panel">
          <div className="preview-toolbar">
            <div><span className="live-dot" /> LCD PREVIEW</div>
            <div className="preview-tools">
              <p>153.36 × 77.76 mm <b>·</b> 8520 × 4320 px</p>
              <label className="zoom-control">
                <span>ZOOM</span>
                <input
                  type="range"
                  min="1"
                  max="64"
                  step="0.5"
                  value={previewZoom}
                  disabled={!visibleShapes.length}
                  onChange={(event) => setPreviewZoom(Number(event.target.value))}
                />
                <output>{previewZoom.toFixed(1)}×</output>
              </label>
              <button
                className="fullscreen-control"
                type="button"
                disabled={!visibleShapes.length}
                aria-pressed={isFullscreen}
                onClick={() => void toggleFullscreen()}
              >{isFullscreen ? "EXIT FULL SCREEN" : "FULL SCREEN"}</button>
              <label className="grid-control" title="Native 8520 × 4320 LCD pixel grid">
                <input
                  type="checkbox"
                  checked={showPreviewGrid}
                  disabled={!visibleShapes.length}
                  onChange={(event) => setShowPreviewGrid(event.target.checked)}
                />
                <span>PIXEL GRID</span>
              </label>
              <label className="template-control" title="Centred physical substrate outline">
                <span>SUBSTRATE OUTLINE</span>
                <select value={substrateTemplateId} onChange={(event) => setSubstrateTemplateId(event.target.value)}>
                  <option value="">None</option>
                  {SUBSTRATE_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid-control" title="Measure between two clicks on the LCD preview">
                <input type="checkbox" checked={measureMode} disabled={!repeatedShapes.length}
                  onChange={(event) => { setMeasureMode(event.target.checked); setMeasurementStart(null); setMeasurementEnd(null); }} />
                <span>MEASURE</span>
              </label>
            </div>
          </div>
          {substrateTemplate && (
            <div className="substrate-controls" aria-label="Substrate configuration">
              {substrateTemplateId.startsWith("custom-") && (
                <>
                  <label>{substrateTemplate.shape === "circle" ? "Diameter" : "Width"} <span>mm</span>
                    <input type="number" min="1" max={substrateTemplate.shape === "circle" ? 77.76 : 153.36} step="0.1" value={customWidth}
                      onChange={(event) => setCustomWidth(boundedNumber(event.target.value, customWidth, 1, substrateTemplate.shape === "circle" ? 77.76 : 153.36))} />
                  </label>
                  {substrateTemplate.shape === "rectangle" && <label>Height <span>mm</span>
                    <input type="number" min="1" max="77.76" step="0.1" value={customHeight}
                      onChange={(event) => setCustomHeight(boundedNumber(event.target.value, customHeight, 1, 77.76))} />
                  </label>}
                </>
              )}
              {substrateTemplate.shape === "circle" && (
                <label title="SEMI nominal flat for 2/3-inch wafers; the 1-inch flat is a 4 mm guide.">Edge marker
                  <select value={waferMarker} onChange={(event) => setWaferMarker(event.target.value as typeof waferMarker)}>
                    <option value="round">None</option>
                    <option value="flat">Primary flat</option>
                    <option value="notch">90° notch</option>
                  </select>
                </label>
              )}
              {substrateTemplateId === "custom-circle" && waferMarker === "flat" && <label>Flat length <span>mm</span>
                <input type="number" min="1" max={customWidth - 0.1} step="0.1" value={customFlatLength}
                  onChange={(event) => setCustomFlatLength(boundedNumber(event.target.value, customFlatLength, 1, customWidth - 0.1))} />
              </label>}
              <label>Substrate X <span>µm</span>
                <input type="number" step="18" value={substrateOffsetX} onChange={(event) => setSubstrateOffsetX(boundedNumber(event.target.value, substrateOffsetX, -153360, 153360))} />
              </label>
              <label>Substrate Y <span>µm</span>
                <input type="number" step="18" value={substrateOffsetY} onChange={(event) => setSubstrateOffsetY(boundedNumber(event.target.value, substrateOffsetY, -77760, 77760))} />
              </label>
              <label>Substrate rotation <span>°</span>
                <input type="number" min="-180" max="180" step="1" value={substrateRotation}
                  onChange={(event) => setSubstrateRotation(boundedNumber(event.target.value, substrateRotation, -180, 180))} />
              </label>
              <label>Edge exclusion <span>mm</span>
                <input type="number" min="0" max="20" step="0.1" value={edgeExclusion}
                  onChange={(event) => setEdgeExclusion(boundedNumber(event.target.value, edgeExclusion, 0, 20))} />
              </label>
              <label>Alignment marks
                <select value={alignmentStyle} onChange={(event) => setAlignmentStyle(event.target.value as typeof alignmentStyle)}>
                  <option value="none">None</option><option value="crosses">Crosses</option><option value="corners">Corner brackets</option>
                  <option value="targets">Targets</option><option value="ruler">10 mm ruler</option><option value="full">Full set</option>
                </select>
              </label>
              <label>Mark size <span>mm</span>
                <input type="number" min="1" max="10" step="0.5" value={alignmentSize} disabled={alignmentStyle === "none"}
                  onChange={(event) => setAlignmentSize(boundedNumber(event.target.value, alignmentSize, 1, 10))} />
              </label>
              <label className="inline-check" title="Rasterize the selected outline into GOO, PNG and ZIP outputs">
                <input type="checkbox" checked={includeSubstrateOutline} onChange={(event) => setIncludeSubstrateOutline(event.target.checked)} />
                Include outline in mask
              </label>
              <label>Guide line width <span>µm</span>
                <input type="number" min="36" max="1000" step="18" value={substrateLineWidth}
                  disabled={!includeSubstrateOutline && alignmentStyle === "none"}
                  onChange={(event) => { const value = Number(event.target.value); if (value >= 36 && value <= 1000) setSubstrateLineWidth(value); }} />
              </label>
              <p className="substrate-note">Alignment marks are exported when selected. The dashed inner guide is the usable area and is never exported.</p>
            </div>
          )}
          <div className="lcd-shell">
            <div ref={lcdGrid} className="lcd-grid" title="Use the mouse wheel or a trackpad pinch gesture to zoom">
              {visibleShapes.length ? (
                <div
                  className="preview-surface"
                  style={{ width: `${previewZoom * 100}%`, height: `${previewZoom * 100}%` }}
                  onClick={inspectPreview}
                >
                  <canvas ref={preview} aria-label="LCD mask preview" />
                  {substrateTemplate && (
                    <div className="substrate-template" aria-hidden="true">
                      <svg viewBox={`0 0 ${MARS_4_9K.sizeX} ${MARS_4_9K.sizeY}`} preserveAspectRatio="none">
                        <g transform={`translate(${substrateOffsetX / 1000} ${-substrateOffsetY / 1000}) rotate(${-substrateRotation} ${MARS_4_9K.sizeX / 2} ${MARS_4_9K.sizeY / 2})`}>
                          <polyline points={substrateOutlineShapes[0].points.map((point) => (
                            `${MARS_4_9K.sizeX / 2 + point.x / 1000},${MARS_4_9K.sizeY / 2 - point.y / 1000}`
                          )).join(" ")} />
                          {edgeExclusion > 0 && (substrateTemplate.shape === "circle" ? (
                            <circle
                              className="usable-area"
                              cx={MARS_4_9K.sizeX / 2}
                              cy={MARS_4_9K.sizeY / 2}
                              r={Math.max(0, substrateTemplate.width / 2 - edgeExclusion)}
                            />
                          ) : (
                            <rect
                              className="usable-area"
                              x={(MARS_4_9K.sizeX - substrateTemplate.width) / 2 + edgeExclusion}
                              y={(MARS_4_9K.sizeY - substrateTemplate.height) / 2 + edgeExclusion}
                              width={Math.max(0, substrateTemplate.width - 2 * edgeExclusion)}
                              height={Math.max(0, substrateTemplate.height - 2 * edgeExclusion)}
                            />
                          ))}
                          {alignmentShapes.map((shape, index) => (
                            <polyline
                              key={index}
                              className="alignment-mark"
                              points={shape.points.map((point: { x: number; y: number }) => `${MARS_4_9K.sizeX / 2 + point.x / 1000},${MARS_4_9K.sizeY / 2 - point.y / 1000}`).join(" ")}
                            />
                          ))}
                          {!includeSubstrateOutline && <path className="centre-mark" d={`M ${MARS_4_9K.sizeX / 2 - 2} ${MARS_4_9K.sizeY / 2} h 4 M ${MARS_4_9K.sizeX / 2} ${MARS_4_9K.sizeY / 2 - 2} v 4`} />}
                        </g>
                      </svg>
                      <span>
                        {substrateTemplate.label}
                        {waferMarker === "flat" && substrateTemplate.shape === "circle" ? ` · FLAT ${substrateTemplate.flatLength} mm` : ""}
                        {waferMarker === "notch" && substrateTemplate.shape === "circle" ? " · NOTCH 1 mm / 90°" : ""}
                        {includeSubstrateOutline ? ` · INCLUDED ${substrateLineWidth} µm` : " · PREVIEW ONLY"}
                      </span>
                    </div>
                  )}
                  {measurementStart && (
                    <svg className="measurement-overlay" viewBox={`0 0 ${MARS_4_9K.width} ${MARS_4_9K.height}`} preserveAspectRatio="none" aria-hidden="true">
                      <line
                        x1={measurementStart.x}
                        y1={measurementStart.y}
                        x2={(measurementEnd ?? measurementStart).x}
                        y2={(measurementEnd ?? measurementStart).y}
                      />
                      <circle cx={measurementStart.x} cy={measurementStart.y} r="18" />
                      {measurementEnd && <circle cx={measurementEnd.x} cy={measurementEnd.y} r="18" />}
                    </svg>
                  )}
                  {showPreviewGrid && <span className="preview-pixel-grid" aria-hidden="true" />}
                </div>
              ) : (
                <div className="empty-preview">
                  <div className="empty-pattern"><i /><i /><i /><i /><i /></div>
                  <strong>LCD READY</strong>
                  <p>The mask will appear here at physical scale.</p>
                </div>
              )}
            </div>
            <div className="screen-axis"><span>0, 0</span><span>X · 153.36 mm</span></div>
            {measureMode && (
              <p className="measurement-readout">{measurement
                ? `MEASURE · ΔX ${measurement.deltaX.toFixed(3)} mm · ΔY ${measurement.deltaY.toFixed(3)} mm · DISTANCE ${measurement.distance.toFixed(3)} mm`
                : measurementStart ? "MEASURE · Select the second point." : "MEASURE · Select the first point."}</p>
            )}
          </div>
          {visibleShapes.length > 0 && (
            <div className="pixel-inspector">
              <div>
                <p>NATIVE 1:1 INSPECTOR</p>
                <strong>PX {inspection.x}, {inspection.y}</strong>
                <span>
                  {((inspection.x + 0.5) * 0.018 - MARS_4_9K.sizeX / 2).toFixed(3)} mm X · {(MARS_4_9K.sizeY / 2 - (inspection.y + 0.5) * 0.018).toFixed(3)} mm Y
                </span>
                <small>Click the main preview to inspect a 64 × 64 native-pixel region.</small>
              </div>
              <canvas ref={inspector} aria-label={`Native LCD pixels around ${inspection.x}, ${inspection.y}`} />
            </div>
          )}
          <div className="metrics">
            <article><p>LAYOUT SIZE</p><strong>{bounds ? `${(bounds.width / 1000).toFixed(3)} × ${(bounds.height / 1000).toFixed(3)} mm` : "—"}</strong></article>
            <article><p>MINIMUM FEATURE*</p><strong className={minimumFeature !== null && minimumFeature < 36 ? "warn" : ""}>{minimumFeature === null ? "—" : `${minimumFeature.toFixed(1)} µm`}</strong></article>
            <article><p>LCD PIXEL</p><strong>18 × 18 µm</strong></article>
            <article><p>ACTIVE LAYERS</p><strong>{selectedLayers.length || "—"}</strong></article>
          </div>
          <p className="metric-note">*Estimated from PATH width or the minimum bounding box of each polygon. The paper barely resolved 1 pixel; use ≥2 pixels (36 µm) for greater robustness.</p>
        </section>
      </section>

      <section className="print-sheet" aria-label="Experimental run sheet">
        <header>
          <div><p>GDS2GOO · EXPERIMENT RECORD</p><h1>UV exposure run sheet</h1></div>
          <p>Elegoo Mars 4 9K<br />405 nm · 18 µm pixel</p>
        </header>
        <dl className="print-parameters">
          <div><dt>Source</dt><dd>{sourceInfo?.name ?? "—"}</dd></div>
          <div><dt>GDS SHA-256</dt><dd className="print-hash">{sourceInfo?.sha256 ?? "Not applicable"}</dd></div>
          <div><dt>Top cell / layers</dt><dd>{model ? topCell : "Generated pattern"} · {selectedLayers.join(", ") || "—"}</dd></div>
          <div><dt>Exposure</dt><dd>{calibrationMode ? calibrationSeries : settings.exposure} s</dd></div>
          <div><dt>Placement</dt><dd>{settings.anchor} · X {settings.offsetX} µm · Y {settings.offsetY} µm · {settings.rotation}°</dd></div>
          <div><dt>Orientation</dt><dd>{settings.mirrorX ? "Mirror X · " : ""}{settings.mirrorY ? "Mirror Y · " : ""}{settings.inverted ? "Exposed background" : "Exposed geometry"}</dd></div>
          <div><dt>Layout / minimum feature</dt><dd>{bounds ? `${(bounds.width / 1000).toFixed(3)} × ${(bounds.height / 1000).toFixed(3)} mm` : "—"} · {minimumFeature === null ? "—" : `${minimumFeature.toFixed(1)} µm`}</dd></div>
          <div><dt>Step-and-repeat</dt><dd>{repeatRows} × {repeatColumns} · pitch X {repeatPitchX} µm · Y {repeatPitchY} µm</dd></div>
          <div><dt>Substrate</dt><dd>{substrateTemplate ? `${substrateTemplate.label} · X ${substrateOffsetX} µm · Y ${substrateOffsetY} µm · ${substrateRotation}° · edge ${edgeExclusion} mm` : "—"}</dd></div>
          <div><dt>Exported guides</dt><dd>{substrateTemplate ? `${includeSubstrateOutline ? `outline ${substrateLineWidth} µm` : "no outline"} · ${alignmentStyle === "none" ? "no alignment marks" : `${alignmentStyle} marks`}` : "—"}</dd></div>
          <div><dt>Layer exposures</dt><dd>{selectedLayers.map((layer) => `L${layer}: ${layerExposures[layer] ?? settings.exposure} s`).join(" · ") || "—"}</dd></div>
          <div><dt>Photoresist / thickness</dt><dd>{processMetadata.photoresist || "—"} · {processMetadata.thicknessNm ? `${processMetadata.thicknessNm} nm` : "—"}</dd></div>
          <div><dt>Soft bake</dt><dd>{processMetadata.softBake || "—"}</dd></div>
          <div><dt>Development</dt><dd>{processMetadata.development || "—"}</dd></div>
          <div className="print-wide"><dt>Notes</dt><dd>{processMetadata.notes || "—"}</dd></div>
        </dl>
        <div className="print-checklist">
          <h2>Pre-exposure verification</h2>
          <p>□ GOO opens in UVtools as 8520 × 4320 px and one layer.</p>
          <p>□ Orientation, corner markers and polarity match the intended mask.</p>
          <p>□ Dry LCD exposure completed without substrate or photoresist.</p>
          <p>□ Resist batch, substrate ID and process conditions recorded.</p>
        </div>
        <div className="print-results">
          <h2>Experimental result</h2>
          <p>Date: ____________________________________ Operator: ____________________________________</p>
          <p>Observed linewidth / outcome: __________________________________________________________________________</p>
          <p>Deviations and next dose: ______________________________________________________________________________</p>
        </div>
        <footer>Generated from the current local GDS2GOO state. Attach the companion <code>.run.json</code> to the laboratory record.</footer>
      </section>

      <section className="science-strip">
        <div><span>01</span><p><b>GDSII</b>Hierarchy, BOUNDARY, BOX, PATH, SREF and AREF</p></div>
        <i>→</i>
        <div><span>02</span><p><b>1:1 RASTER</b>18 µm/pixel · no automatic rescaling</p></div>
        <i>→</i>
        <div><span>03</span><p><b>GOO V3.0</b>One 0.05 mm layer · verified RLE and checksum</p></div>
      </section>

      <footer>
        <p>Based on <a href="https://doi.org/10.1002/smtd.202501336">Wu et al., <i>Small Methods</i> 9 (2025), e01336</a>. The optimum dose must be recalibrated for each photoresist, thickness, LCD and development process.</p>
        <p><a href="https://jorpago2.github.io/jorpago2/">A tool by Jorge Parra</a><br />405 nm · local-first · experimental use</p>
      </footer>
    </main>
  );
}
