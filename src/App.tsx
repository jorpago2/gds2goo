"use client";

import { MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  ComboBox,
  Content,
  FileUploaderButton,
  FileUploaderDropContainer,
  IconButton,
  InlineNotification,
  Layer,
  Link,
  NumberInput,
  Select,
  SelectItem,
  SelectItemGroup,
  Slider,
  Tag,
  TextArea,
  TextInput,
  Toggle,
} from "@carbon/react";

import {
  boundsOf,
  estimateMinimumFeature,
  fitsDisplay,
  flattenGds,
  parseGds,
} from "@/lib/gds.js";
import { Chemistry, Close, Document, Download, Grid as GridIcon } from "@carbon/react/icons";
import { ExportReceipt as SharedExportReceipt, ScientificHeader, ScientificTaskPanel, ScientificToolRail } from "@jorpago2/scientific-ui";
import { buildGooFile, encodeBinaryLayer, MARS_4_9K, validateGooFile } from "@/lib/goo.js";
import { createCalibrationShapes, createOrientationCheckShapes, parseExposureSeries } from "@/lib/calibration.js";
import { fitsSubstrateArea, repeatShapes, transformGuideShapes } from "@/lib/experiment.js";
import { createRunManifest, parseRunManifest } from "@/lib/manifest.js";
import {
  parsePhotoresistResponseProfiles,
  PHOTORESIST_MANUFACTURERS_405_NM,
  PHOTORESISTS_405_NM,
  savePhotoresistResponseProfile,
} from "@/lib/photoresists.js";
import { createMonochromePreview, mergeBinaryOverlay, rasterizeBinaryMask } from "@/lib/raster.js";
import { parseRecipeLibrary, saveRecipeToLibrary } from "@/lib/recipes.js";
import { createAlignmentMarkShapes, createSubstrateOutlineShape } from "@/lib/substrate.js";
import { calculateResistResponse, calculateViewerRasterSize, calculateViewerZoom } from "@/lib/viewer.js";
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

type ResistResponseProfile = {
  thresholdSeconds: number;
  contrast: number;
  opticalBlurMicrometers: number;
};

type SourceInfo = {
  kind: "gds" | "generated-calibration" | "generated-diagnostic";
  name: string;
  sizeBytes: number | null;
  sha256: string | null;
};

type ExportReceipt = {
  kind: "success" | "error";
  title: string;
  filename: string;
  format: string;
  timestamp: string;
  geometryCount: number;
  transform: string;
  validation: string;
};

const DEFAULT_PROCESS: ProcessMetadata = {
  photoresist: "",
  thicknessNm: "",
  softBake: "",
  development: "",
  notes: "",
};

const DEFAULT_RESIST_RESPONSE: ResistResponseProfile = {
  thresholdSeconds: 9,
  contrast: 4,
  opticalBlurMicrometers: 18,
};

const PAPER_IRRADIANCE_ESTIMATE_MW_CM2 = 10;

function describeTransform(settings: MaskSettings) {
  const anchor = settings.anchor === "center"
    ? "centred"
    : settings.anchor === "gds-origin"
      ? "GDS origin"
      : "lower left";
  return [
    `${settings.rotation}°`,
    settings.mirrorX ? "mirror X" : null,
    settings.mirrorY ? "mirror Y" : null,
    `${settings.offsetX}, ${settings.offsetY} µm`,
    anchor,
    settings.inverted ? "background exposed" : "geometry exposed",
  ].filter(Boolean).join(" · ");
}

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

function drawResistResponse(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  width: number,
  height: number,
  exposureSeconds: number,
  thresholdSeconds: number,
  contrast: number,
  blurPixels: number,
) {
  const source = document.createElement("canvas");
  drawBinaryPixels(source, pixels, width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create the resist preview canvas.");
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--viewer-surface-deep").trim();
  context.fillRect(0, 0, width, height);
  context.filter = blurPixels > 0 ? `blur(${blurPixels}px)` : "none";
  context.drawImage(source, 0, 0);
  context.filter = "none";
  const image = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.length; index += 1) {
    const response = calculateResistResponse(image.data[index * 4] / 255, exposureSeconds, thresholdSeconds, contrast);
    const mix = response < 0.5 ? response * 2 : (response - 0.5) * 2;
    const start = response < 0.5 ? [5, 8, 7] : [255, 90, 31];
    const end = response < 0.5 ? [255, 90, 31] : [217, 255, 67];
    image.data[index * 4] = Math.round(start[0] + (end[0] - start[0]) * mix);
    image.data[index * 4 + 1] = Math.round(start[1] + (end[1] - start[1]) * mix);
    image.data[index * 4 + 2] = Math.round(start[2] + (end[2] - start[2]) * mix);
  }
  context.putImageData(image, 0, 0);
  source.width = 1;
  source.height = 1;
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
  const logoExampleButton = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const panelPreview = useRef<HTMLCanvasElement>(null);
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
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showPreviewGrid, setShowPreviewGrid] = useState(false);
  const [showResistResponse, setShowResistResponse] = useState(false);
  const [responseThresholdSeconds, setResponseThresholdSeconds] = useState(DEFAULT_RESIST_RESPONSE.thresholdSeconds);
  const [responseContrast, setResponseContrast] = useState(DEFAULT_RESIST_RESPONSE.contrast);
  const [opticalBlurMicrometers, setOpticalBlurMicrometers] = useState(DEFAULT_RESIST_RESPONSE.opticalBlurMicrometers);
  const [responseIrradianceMwCm2, setResponseIrradianceMwCm2] = useState(String(PAPER_IRRADIANCE_ESTIMATE_MW_CM2));
  const [responseIrradianceIsEstimated, setResponseIrradianceIsEstimated] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activePanel, setActivePanel] = useState<"input" | "mask" | "process" | "export" | null>("input");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [substrateTemplateId, setSubstrateTemplateId] = useState("wafer-2");
  const [waferMarker, setWaferMarker] = useState<"round" | "flat" | "notch">("flat");
  const [includeSubstrateOutline, setIncludeSubstrateOutline] = useState(false);
  const [substrateLineWidth, setSubstrateLineWidth] = useState(180);
  const [substrateOffsetX, setSubstrateOffsetX] = useState(0);
  const [substrateOffsetY, setSubstrateOffsetY] = useState(0);
  const [substrateRotation, setSubstrateRotation] = useState(0);
  const [edgeExclusion, setEdgeExclusion] = useState(3);
  const [customWidth, setCustomWidth] = useState(50);
  const [customHeight, setCustomHeight] = useState(25);
  const [customFlatLength, setCustomFlatLength] = useState(15);
  const [alignmentStyle, setAlignmentStyle] = useState<"none" | "crosses" | "corners" | "targets" | "ruler" | "full">("crosses");
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
  const [photoresistPresetId, setPhotoresistPresetId] = useState("");
  const [responseProfiles, setResponseProfiles] = useState<Record<string, ResistResponseProfile>>({});
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [exportReceipt, setExportReceipt] = useState<ExportReceipt | null>(null);
  const calibrationMode = sourceInfo?.kind === "generated-calibration";
  const photoresistPreset = PHOTORESISTS_405_NM.find(({ id }) => id === photoresistPresetId);
  const savedResponseProfile = photoresistPresetId ? responseProfiles[photoresistPresetId] : undefined;
  const responseIrradiance = Number(responseIrradianceMwCm2);
  const referenceDose = photoresistPreset?.referenceDoseMjCm2;
  const referenceDoseText = referenceDose
    ? referenceDose[0] === referenceDose[1] ? `${referenceDose[0]}` : `${referenceDose[0]}–${referenceDose[1]}`
    : "";
  const referenceTimeText = referenceDose && responseIrradiance > 0
    ? referenceDose[0] === referenceDose[1]
      ? `${(referenceDose[0] / responseIrradiance).toFixed(1)} s`
      : `${(referenceDose[0] / responseIrradiance).toFixed(1)}–${(referenceDose[1] / responseIrradiance).toFixed(1)} s`
    : "";
  const responseProfileIsSaved = Boolean(savedResponseProfile
    && savedResponseProfile.thresholdSeconds === responseThresholdSeconds
    && savedResponseProfile.contrast === responseContrast
    && savedResponseProfile.opticalBlurMicrometers === opticalBlurMicrometers);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRecipes(parseRecipeLibrary(localStorage.getItem("gds2goo-recipes")) as SavedRecipe[]);
      setResponseProfiles(parsePhotoresistResponseProfiles(localStorage.getItem("gds2goo-resist-response-profiles")) as Record<string, ResistResponseProfile>);
      logoExampleButton.current?.click();
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
  const transformSummary = describeTransform(settings);
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
    if (showResistResponse) {
      drawResistResponse(
        preview.current,
        pixels,
        previewRasterSize.width,
        previewRasterSize.height,
        settings.exposure,
        responseThresholdSeconds,
        responseContrast,
        opticalBlurMicrometers / (MARS_4_9K.pixelMicrometers * MARS_4_9K.width / previewRasterSize.width),
      );
    } else drawBinaryPixels(preview.current, pixels, previewRasterSize.width, previewRasterSize.height);
    if (panelPreview.current) {
      const width = 560;
      const height = Math.round(width * previewRasterSize.height / previewRasterSize.width);
      const context = panelPreview.current.getContext("2d", { alpha: false });
      if (context) {
        panelPreview.current.width = width;
        panelPreview.current.height = height;
        context.imageSmoothingEnabled = false;
        context.drawImage(preview.current, 0, 0, width, height);
      }
    }
  }, [repeatedShapes, settings, exportedSubstrateShapes, previewRasterSize.width, previewRasterSize.height, showResistResponse, responseThresholdSeconds, responseContrast, opticalBlurMicrometers, activePanel]);

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
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--viewer-accent").trim();
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
    if (!measureMode) {
      if (window.matchMedia("(max-width: 75rem)").matches) setActivePanel(null);
      setInspectorOpen(true);
    }
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
      const restoredPhotoresistId = PHOTORESISTS_405_NM.find(({ name }) => name === restored.process.photoresist)?.id ?? "";
      setPhotoresistPresetId(restoredPhotoresistId);
      if (restoredPhotoresistId) applyResponseProfile(restoredPhotoresistId);
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
    const recipePhotoresistId = PHOTORESISTS_405_NM.find(({ name }) => name === recipe.process.photoresist)?.id ?? "";
    setPhotoresistPresetId(recipePhotoresistId);
    if (recipePhotoresistId) applyResponseProfile(recipePhotoresistId);
    setMessage(`Process recipe “${recipe.name}” loaded.`);
  }

  function applyResponseProfile(id: string) {
    const responseProfile = responseProfiles[id];
    const preset = PHOTORESISTS_405_NM.find((item) => item.id === id);
    setResponseThresholdSeconds(responseProfile?.thresholdSeconds ?? DEFAULT_RESIST_RESPONSE.thresholdSeconds);
    setResponseContrast(responseProfile?.contrast ?? preset?.documentedContrast ?? DEFAULT_RESIST_RESPONSE.contrast);
    setOpticalBlurMicrometers(responseProfile?.opticalBlurMicrometers ?? DEFAULT_RESIST_RESPONSE.opticalBlurMicrometers);
    setShowResistResponse(true);
  }

  function selectPhotoresistPreset(id: string) {
    setPhotoresistPresetId(id);
    const preset = PHOTORESISTS_405_NM.find((item) => item.id === id);
    if (!preset) return;
    setProcessMetadata({ ...processMetadata, photoresist: preset.name, thicknessNm: String(preset.referenceThicknessNm) });
    applyResponseProfile(id);
  }

  function saveResponseProfile() {
    if (!photoresistPreset) return;
    const nextProfiles = savePhotoresistResponseProfile(responseProfiles, photoresistPreset.id, {
      thresholdSeconds: responseThresholdSeconds,
      contrast: responseContrast,
      opticalBlurMicrometers,
    }) as Record<string, ResistResponseProfile>;
    localStorage.setItem("gds2goo-resist-response-profiles", JSON.stringify(nextProfiles));
    setResponseProfiles(nextProfiles);
    setMessage(`Response calibration for ${photoresistPreset.name} saved in this browser.`);
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

  function recordExport(format: string, filename: string, validation: string) {
    setExportReceipt({
      kind: "success",
      title: "Export generated",
      filename,
      format,
      timestamp: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
      geometryCount: repeatedShapes.length,
      transform: transformSummary,
      validation,
    });
  }

  async function runExport(format: string, startMessage: string, fallbackMessage: string, operation: () => Promise<void>) {
    setBusy(true);
    setMessage(startMessage);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      await operation();
    } catch (error) {
      const failure = error instanceof Error ? error.message : fallbackMessage;
      setMessage(failure);
      setExportReceipt({
        kind: "error",
        title: "Export failed",
        filename: "No file generated",
        format,
        timestamp: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
        geometryCount: repeatedShapes.length,
        transform: transformSummary,
        validation: failure,
      });
    } finally {
      setBusy(false);
    }
  }

  async function exportGoo() {
    if (!visibleShapes.length || outsideScreen) return;
    await runExport("GOO + run manifest", "Rasterizing 36.8 million pixels locally…", "The GOO file could not be generated.", async () => {
      const raster = rasterizeMask(repeatedShapes, settings, exportedSubstrateShapes);
      const { goo, check } = buildValidatedGoo(raster, settings.exposure);
      const baseName = outputBaseName();
      const gooName = `${baseName}.goo`;
      saveFile(goo, gooName, "application/octet-stream");
      saveFile(JSON.stringify(buildManifest([settings.exposure], [gooName]), null, 2), `${baseName}.run.json`, "application/json");
      setMessage(`GOO validated: ${check.pixels.toLocaleString("en-US")} pixels, 1 layer, ${settings.exposure} s.`);
      recordExport("GOO + run manifest", `${gooName} + ${baseName}.run.json`, `${check.pixels.toLocaleString("en-US")} pixels validated · 1 layer · ${settings.exposure} s exposure.`);
    });
  }

  async function exportCalibrationSeries() {
    if (!calibrationMode || !visibleShapes.length || outsideScreen) return;
    await runExport("Calibration experiment ZIP", "Preparing calibration exposure series…", "The calibration series could not be generated.", async () => {
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
      recordExport("Calibration experiment ZIP", "calibration-line-space.experiment.zip", `${exposures.length} GOO files validated with PNG and manifest.`);
    });
  }

  async function exportLayerFiles() {
    if (selectedLayers.length < 2 || outsideScreen) return;
    await runExport(
      "Layer exposure ZIP",
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
        recordExport("Layer exposure ZIP", `${outputBaseName()}-layer-exposures.zip`, `${selectedLayers.length} layer-specific GOO files validated with run manifest.`);
      },
    );
  }

  async function loadLogoExample() {
    try {
      setBusy(true);
      setMessage("Loading the Universitat de València logo GDS…");
      const response = await fetch("./examples/universitat-valencia-logo.gds?v=2inch-40mm");
      if (!response.ok) throw new Error(`The example GDS could not be loaded (${response.status}).`);
      await loadFile(new File(
        [await response.blob()],
        "universitat-valencia-logo.gds",
        { type: "application/octet-stream" },
      ));
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "The example GDS could not be loaded.");
    }
  }

  async function exportBundle() {
    if (!visibleShapes.length || outsideScreen) return;
    await runExport("Experiment ZIP", "Building reproducible experiment package…", "The experiment package could not be generated.", async () => {
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
      recordExport("Experiment ZIP", `${baseName}.experiment.zip`, "GOO, 9K PNG and run manifest validated and packaged.");
    });
  }

  async function exportPng() {
    if (!visibleShapes.length || outsideScreen) return;
    await runExport("Verification PNG", "Generating 9K verification PNG…", "The PNG could not be generated.", async () => {
      const png = await encodePng(nativeMask(repeatedShapes, settings, exportedSubstrateShapes));
      const pngName = `${fileName.replace(/\.gds(ii)?$/i, "") || "mask"}-8520x4320.png`;
      saveFile(png, pngName, "image/png");
      setMessage("9K PNG generated. Use it to verify orientation and polarity.");
      recordExport("Verification PNG", pngName, "Native 8520 × 4320 orientation and polarity image generated.");
    });
  }

  function printRunSheet() {
    recordExport("Print", "Experimental run sheet", "Run sheet prepared from the current validated workspace state.");
    window.print();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await previewPanel.current?.requestFullscreen();
    } catch {
      setMessage("Full-screen mode is unavailable in this browser.");
    }
  }

  function closePanel() {
    const panel = activePanel;
    setActivePanel(null);
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      if (panel) document.getElementById(`workflow-${panel}`)?.focus();
    });
  }

  useEffect(() => {
    if (!activePanel && !inspectorOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      if (activePanel) {
        const panel = activePanel;
        setActivePanel(null);
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new Event("resize"));
          document.getElementById(`workflow-${panel}`)?.focus();
        });
      } else setInspectorOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [activePanel, inspectorOpen]);

  useEffect(() => {
    if (!activePanel || !inspectorOpen) return;
    const compactLayout = window.matchMedia("(max-width: 75rem)");
    const keepOneOverlay = () => {
      if (compactLayout.matches) setActivePanel(null);
    };
    keepOneOverlay();
    compactLayout.addEventListener("change", keepOneOverlay);
    return () => compactLayout.removeEventListener("change", keepOneOverlay);
  }, [activePanel, inspectorOpen]);

  const workspaceStatus = outsideScreen
    ? "Outside LCD"
    : outsideSubstrate
      ? "Check substrate"
      : busy
        ? "Processing"
        : sourceInfo
          ? "Ready"
          : "Needs input";
  const showInspector = inspectorOpen && visibleShapes.length > 0;

  return (
    <>
      <ScientificHeader
        aria-label="GDS2GOO"
        product="GDS2GOO"
        productMark="G"
        descriptor="Mask conversion"
        href="#workspace"
        contextLabel="Current workspace"
        context={sourceInfo ? `${topCell || "GDS"} · ${fileName || "untitled"}` : "No file loaded"}
        status={{
          state: outsideScreen || outsideSubstrate ? "warning" : busy ? "running" : sourceInfo ? "ready" : "needs-input",
          label: workspaceStatus,
        }}
      />

      <Content
        id="workspace"
        className="app-shell-content"
        data-panel-open={Boolean(activePanel)}
        data-inspector-open={showInspector}
      >
        <h1 className="visually-hidden">GDS2GOO scientific mask conversion workspace</h1>
        <ScientificToolRail className="workflow-navigation" label="Configuration tools" activeId={activePanel ?? "input"} expandedId={activePanel} onChange={(id) => {
          setActivePanel(id as "input" | "mask" | "process" | "export" | null);
          window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        }} items={[
          { id: "input", label: "Input", icon: <Document size={20} />, controlsId: "configuration-panel" },
          { id: "mask", label: "Mask", icon: <GridIcon size={20} />, controlsId: "configuration-panel" },
          { id: "process", label: "Process", icon: <Chemistry size={20} />, controlsId: "configuration-panel" },
          { id: "export", label: "Export", icon: <Download size={20} />, controlsId: "configuration-panel" },
        ]} />

      {activePanel && (
        <ScientificTaskPanel
          id="configuration-panel"
          className="app-panel"
          titleId="configuration-panel-title"
          title={activePanel === "input" ? "Input & layers" : activePanel === "mask" ? "Mask & placement" : activePanel === "process" ? "Process & resist" : "Export & review"}
          eyebrow="Configuration"
          closeLabel="Close"
          onClose={closePanel}
          bodyClassName="panel-content controls"
        >
          {sourceInfo && activePanel !== "input" && (
            <div className="mobile-panel-preview" aria-label="Live mask preview">
              <div>
                <strong>Live preview</strong>
                <span>{transformSummary}</span>
              </div>
              <canvas ref={panelPreview} aria-label="Compact live mask preview" />
            </div>
          )}
            {activePanel === "input" && (
              <>
                <FileUploaderDropContainer
                  id="gds-file"
                  className="gds-uploader"
                  accept={[".gds", ".gdsii"]}
                  maxFileSize={100 * 1024 * 1024}
                  labelText={fileName ? `Replace ${fileName}` : "Drop or select a GDSII file · max. 100 MB"}
                  onAddFiles={(_event, { addedFiles }) => void loadFile(addedFiles[0])}
                />

                <div className="source-actions">
                  <Button kind="tertiary" size="sm" disabled={busy} onClick={loadCalibrationPattern}>18–180 µm calibration pattern</Button>
                  <Button kind="tertiary" size="sm" disabled={busy} onClick={loadOrientationPattern}>Printer orientation check</Button>
                  <Button ref={logoExampleButton} kind="tertiary" size="sm" disabled={busy} title="40.0 × 13.4 mm · layer 1 · 22.2 µm source grid" onClick={() => void loadLogoExample()}>UV logo GDS example</Button>
                  <FileUploaderButton id="run-file" accept={[".json", "application/json"]} buttonKind="tertiary" size="sm" disabled={busy} labelText="Restore .run.json" onChange={(event) => void restoreRun(event.target.files?.[0])} />
                </div>

                {sourceInfo && (
                  <div className="file-options">
                    {model && <Select id="top-cell" labelText="Top cell" size="sm" value={topCell} onChange={(event) => changeTopCell(event.target.value)}>
                      {model.topCells.map((cell) => <SelectItem key={cell} value={cell} text={cell} />)}
                    </Select>}
                    {model && (
                      <InlineNotification
                        className="compatibility-notification"
                        hideCloseButton
                        kind={model.compatibility.warnings.length ? "warning" : "success"}
                        lowContrast
                        title={model.compatibility.warnings.length ? `GDS compatibility · ${model.compatibility.warnings.length} warning(s)` : "GDS compatibility · Ready"}
                      >
                        <p>
                          {model.compatibility.elementCounts.boundaries} BOUNDARY · {model.compatibility.elementCounts.boxes} BOX · {model.compatibility.elementCounts.paths} PATH · {model.compatibility.elementCounts.references} REF
                        </p>
                        {model.compatibility.warnings.length ? (
                          <ul>{model.compatibility.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                        ) : <p>No unsupported exposure geometry detected.</p>}
                      </InlineNotification>
                    )}
                    <fieldset>
                      <legend>Layers to expose</legend>
                      <div className="layer-list">
                        {layers.map((layer) => (
                          <Button
                            kind={selectedLayers.includes(layer) ? "primary" : "tertiary"}
                            size="sm"
                            key={layer}
                            onClick={() => toggleLayer(layer)}
                            aria-pressed={selectedLayers.includes(layer)}
                          >{calibrationMode ? `${layer * 18} µm` : `L${layer}`}</Button>
                        ))}
                      </div>
                    </fieldset>
                    {selectedLayers.length > 1 && (
                      <Accordion className="process-metadata layer-exposures" size="sm">
                        <AccordionItem title="Per-layer exposures">
                        <div className="layer-exposure-grid">
                          {selectedLayers.map((layer) => (
                            <NumberInput
                                key={layer}
                                id={`layer-exposure-${layer}`}
                                label={`L${layer} · s`}
                                size="sm"
                                min={0.1}
                                max={600}
                                step={0.1}
                                value={layerExposures[layer] ?? settings.exposure}
                                onChange={(_event, { value }) => setLayerExposures({
                                  ...layerExposures,
                                  [layer]: boundedNumber(String(value), layerExposures[layer] ?? settings.exposure, 0.1, 600),
                                })}
                              />
                          ))}
                        </div>
                        <Button kind="secondary" size="sm" disabled={busy || outsideScreen} onClick={() => void exportLayerFiles()}>
                          Download layer exposure ZIP
                        </Button>
                        <p>One GOO per layer. Substrate outline and alignment marks are included only in the first file to avoid repeated dose.</p>
                        </AccordionItem>
                      </Accordion>
                    )}
                    {sourceInfo?.kind === "generated-diagnostic" && (
                      <InlineNotification
                        hideCloseButton
                        kind="info"
                        lowContrast
                        subtitle="Corner blocks increase clockwise: 1 top-left, 2 top-right, 3 bottom-right and 4 bottom-left. The long arrows indicate +X and +Y; the lower bar is 10.008 mm."
                        title="How to read it"
                      />
                    )}
                  </div>
                )}
              </>
            )}

            {activePanel === "mask" && sourceInfo && (
              <>
                <div className="settings-grid">
                  <NumberInput id="mask-exposure" label="Exposure · s" size="sm" min={0.1} max={600} step={0.1} value={settings.exposure}
                    onChange={(_event, { value }) => setSettings({ ...settings, exposure: boundedNumber(String(value), settings.exposure, 0.1, 600) })} />
                  <Select id="mask-rotation" labelText="Rotation" size="sm" value={String(settings.rotation)} onChange={(event) => setSettings({ ...settings, rotation: Number(event.target.value) })}>
                    {[0, 90, 180, 270].map((angle) => <SelectItem key={angle} value={String(angle)} text={`${angle}°`} />)}
                  </Select>
                  <Select id="mask-anchor" className="full-width" labelText="Placement anchor" size="sm" value={settings.anchor} onChange={(event) => setSettings({ ...settings, anchor: event.target.value as MaskSettings["anchor"] })}>
                    <SelectItem value="center" text="Layout centre" />
                    <SelectItem value="gds-origin" text="GDS origin (0, 0)" />
                    <SelectItem value="lower-left" text="Layout lower-left" />
                  </Select>
                  <NumberInput id="mask-offset-x" label="Anchor X · µm" size="sm" step={18} value={settings.offsetX}
                    onChange={(_event, { value }) => setSettings({ ...settings, offsetX: Number(value) })} />
                  <NumberInput id="mask-offset-y" label="Anchor Y · µm" size="sm" step={18} value={settings.offsetY}
                    onChange={(_event, { value }) => setSettings({ ...settings, offsetY: Number(value) })} />
                </div>
                <p className="placement-note">Anchor coordinates are measured from the LCD centre.</p>
                <Accordion className="process-metadata repeat-settings" size="sm">
                  <AccordionItem title="Step-and-repeat">
                  <div className="process-grid">
                    <NumberInput id="repeat-rows" label="Rows · 1–10" size="sm" min={1} max={10} step={1} value={repeatRows}
                      onChange={(_event, { value }) => setRepeatRows(Math.round(boundedNumber(String(value), repeatRows, 1, 10)))} />
                    <NumberInput id="repeat-columns" label="Columns · 1–10" size="sm" min={1} max={10} step={1} value={repeatColumns}
                      onChange={(_event, { value }) => setRepeatColumns(Math.round(boundedNumber(String(value), repeatColumns, 1, 10)))} />
                    <NumberInput id="repeat-pitch-x" label="Pitch X · µm" size="sm" min={0} step={18} value={repeatPitchX}
                      onChange={(_event, { value }) => setRepeatPitchX(boundedNumber(String(value), repeatPitchX, 0, 153360))} />
                    <NumberInput id="repeat-pitch-y" label="Pitch Y · µm" size="sm" min={0} step={18} value={repeatPitchY}
                      onChange={(_event, { value }) => setRepeatPitchY(boundedNumber(String(value), repeatPitchY, 0, 77760))} />
                  </div>
                  <p>{repeatRows * repeatColumns} copies · pitch is centre-to-centre. Maximum 100 copies.</p>
                  </AccordionItem>
                </Accordion>
                {calibrationMode && (
                  <Layer className="calibration-series" withBackground>
                    <TextInput id="calibration-series" labelText="Exposure series" helperText="Seconds · comma-separated" size="sm" value={calibrationSeries} onChange={(event) => setCalibrationSeries(event.target.value)} />
                    <Button kind="secondary" size="sm" disabled={busy || outsideScreen} onClick={() => void exportCalibrationSeries()}>
                      Download calibration bundle (.zip)
                    </Button>
                    <p>Includes every GOO exposure, a 9K PNG and the run manifest.</p>
                  </Layer>
                )}
                <div className="toggle-row">
                  <Button kind={settings.mirrorX ? "primary" : "tertiary"} size="sm" aria-pressed={settings.mirrorX} onClick={() => setSettings({ ...settings, mirrorX: !settings.mirrorX })}>↔ Mirror X</Button>
                  <Button kind={settings.mirrorY ? "primary" : "tertiary"} size="sm" aria-pressed={settings.mirrorY} onClick={() => setSettings({ ...settings, mirrorY: !settings.mirrorY })}>↕ Mirror Y</Button>
                </div>
                <Toggle id="invert-polarity" className="switch-row" size="sm" labelText="Invert polarity" labelA="Exposed geometry" labelB="Exposed background" toggled={settings.inverted} onToggle={(checked) => setSettings({ ...settings, inverted: checked })} />
              </>
            )}

            {activePanel === "process" && sourceInfo && (
              <>
                <Accordion className="process-metadata recipe-library" size="sm">
                  <AccordionItem title="Local process recipes">
                  <TextInput id="recipe-name" labelText="Recipe name" size="sm" maxLength={50} value={recipeName} placeholder="e.g. AZ1505 · 600 nm"
                    onChange={(event) => setRecipeName(event.target.value)} />
                  <Button kind="secondary" size="sm" disabled={!recipeName.trim()} onClick={saveRecipe}>Save current process</Button>
                  {recipes.length > 0 && (
                    <>
                      <ComboBox
                        id="saved-recipe"
                        items={recipes}
                        itemToString={(recipe) => recipe?.name ?? ""}
                        itemToElement={(recipe) => (
                          <span className="recipe-option">
                            <strong>{recipe.name}</strong>
                            <span>{recipe.process.photoresist || "Unassigned resist"} · {recipe.process.thicknessNm ? `${recipe.process.thicknessNm} nm` : "thickness not set"} · {recipe.exposure} s</span>
                          </span>
                        )}
                        selectedItem={recipes.find(({ name }) => name === selectedRecipe) ?? null}
                        titleText="Saved recipes"
                        placeholder="Search by recipe, resist or thickness"
                        size="sm"
                        shouldFilterItem={({ item, inputValue }) => !inputValue || [
                          item.name,
                          item.process.photoresist,
                          item.process.thicknessNm,
                          String(item.exposure),
                        ].join(" ").toLocaleLowerCase().includes(inputValue.toLocaleLowerCase())}
                        onChange={({ selectedItem }) => setSelectedRecipe(selectedItem?.name ?? "")}
                      />
                      <div className="recipe-actions">
                        <Button kind="secondary" size="sm" disabled={!selectedRecipe} onClick={loadRecipe}>Load</Button>
                        <Button kind="danger--tertiary" size="sm" disabled={!selectedRecipe} onClick={deleteRecipe}>Delete</Button>
                      </div>
                    </>
                  )}
                  <p>Stored only in this browser. Recipes contain exposure and process metadata, not GDS geometry.</p>
                  </AccordionItem>
                </Accordion>

                <Layer className="process-metadata process-metadata-card" withBackground>
                  <h3>Process metadata</h3>
                  <div className="process-grid">
                    <ComboBox
                      id="photoresist-library"
                      className="full-width"
                      titleText="405 nm photoresist library"
                      helperText={`${PHOTORESISTS_405_NM.length} verified entries · search manufacturer, resist or tone`}
                      items={PHOTORESISTS_405_NM}
                      selectedItem={photoresistPreset ?? null}
                      itemToString={(preset) => preset ? `${preset.manufacturer} · ${preset.name}` : ""}
                      itemToElement={(preset) => (
                        <span className="recipe-option">
                          <strong>{preset.manufacturer} · {preset.name}</strong>
                          <span>{preset.tone} · {preset.referenceThicknessNm} nm · {preset.referenceRpm} rpm</span>
                        </span>
                      )}
                      placeholder="Custom / not listed"
                      size="sm"
                      shouldFilterItem={({ item, inputValue }) => !inputValue || [
                        item.manufacturer,
                        item.name,
                        item.tone,
                        String(item.referenceThicknessNm),
                      ].join(" ").toLocaleLowerCase().includes(inputValue.toLocaleLowerCase())}
                      onChange={({ selectedItem }) => selectPhotoresistPreset(selectedItem?.id ?? "")}
                    />
                    {photoresistPreset && (
                      <div className="photoresist-reference">
                        <InlineNotification
                          hideCloseButton
                          kind="info"
                          lowContrast
                          title={`${photoresistPreset.manufacturer} · ${photoresistPreset.name}`}
                        >
                          <p>{photoresistPreset.tone} · 405 nm documented · {photoresistPreset.referenceThicknessNm} nm at {photoresistPreset.referenceRpm} rpm.</p>
                          <p>{photoresistPreset.evidence}. This is a spin reference, not an exposure-dose prescription.</p>
                        </InlineNotification>
                        <Link href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Open manufacturer source ↗</Link>
                      </div>
                    )}
                    <TextInput id="process-photoresist" labelText="Photoresist" size="sm" value={processMetadata.photoresist} placeholder="e.g. AZ1505"
                      onChange={(event) => { setPhotoresistPresetId(""); setProcessMetadata({ ...processMetadata, photoresist: event.target.value }); }} />
                    <NumberInput id="process-thickness" label="Thickness · nm" size="sm" min={0} step={1} value={processMetadata.thicknessNm} allowEmpty placeholder="e.g. 600"
                      onChange={(_event, { value }) => setProcessMetadata({ ...processMetadata, thicknessNm: String(value) })} />
                    <TextInput id="process-soft-bake" labelText="Soft bake" size="sm" value={processMetadata.softBake} placeholder="e.g. 100 °C · 60 s"
                      onChange={(event) => setProcessMetadata({ ...processMetadata, softBake: event.target.value })} />
                    <TextInput id="process-development" labelText="Development" size="sm" value={processMetadata.development} placeholder="e.g. AZ 400K 1:4 · 45 s"
                      onChange={(event) => setProcessMetadata({ ...processMetadata, development: event.target.value })} />
                  </div>
                  <TextArea id="process-notes" labelText="Notes" rows={2} value={processMetadata.notes} placeholder="Substrate, contact mode, batch…"
                    onChange={(event) => setProcessMetadata({ ...processMetadata, notes: event.target.value })} />
                  <p>Saved locally in the companion <code>.run.json</code> file.</p>
                </Layer>
              </>
            )}

            {activePanel === "export" && sourceInfo && (
              <>
                <Layer className="export-dock" withBackground>
                  <Button className="primary-action" kind="primary" size="lg" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportGoo()}>
                    {busy ? "Processing…" : "Generate .GOO"}
                  </Button>
                  <div className="export-options">
                    <Button className="secondary-action" kind="secondary" size="md" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportPng()}>
                      Verification PNG
                    </Button>
                    <Button className="secondary-action bundle-action" kind="secondary" size="md" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportBundle()}>
                      Experiment bundle (.zip)
                    </Button>
                    <Button className="secondary-action print-action" kind="tertiary" size="md" disabled={busy || !visibleShapes.length} onClick={printRunSheet}>
                      Experimental run sheet
                    </Button>
                  </div>
                </Layer>
                {exportReceipt && (
                  <SharedExportReceipt
                    className="export-receipt"
                    kind={exportReceipt.kind}
                    title={exportReceipt.title}
                    fileName={exportReceipt.filename}
                    format={exportReceipt.format}
                    destination={exportReceipt.timestamp}
                  >
                    <dl>
                      <div><dt>Time</dt><dd>{exportReceipt.timestamp}</dd></div>
                      <div><dt>Format</dt><dd>{exportReceipt.format}</dd></div>
                      <div><dt>Geometry</dt><dd>{exportReceipt.geometryCount.toLocaleString("en-US")} objects</dd></div>
                      <div><dt>Transform</dt><dd>{exportReceipt.transform}</dd></div>
                      <div><dt>Validation</dt><dd>{exportReceipt.validation}</dd></div>
                    </dl>
                  </SharedExportReceipt>
                )}
              </>
            )}

            {activePanel && !sourceInfo && activePanel !== "input" && (
               <div className="empty-panel-message">
                 <p>Load a GDSII file first in the Input panel.</p>
               </div>
            )}
        </ScientificTaskPanel>
      )}

      <section className="app-result scientific-stage" data-empty={!sourceInfo} aria-label="Mask preview and export">
        <section ref={previewPanel} className="preview-panel">
          {sourceInfo && <>
          <div className="preview-toolbar">
            <div className="preview-heading">
              <div><span className="live-dot" /> LCD PREVIEW</div>
              <p>153.36 × 77.76 mm <b>·</b> 8520 × 4320 px</p>
              <Tag className="transform-summary" size="sm" type="gray">{transformSummary}</Tag>
            </div>
            <div className="preview-tools">
              <div className="zoom-tools" aria-label="Viewer scale">
                <Slider
                  id="preview-zoom"
                  className="zoom-control"
                  labelText="Zoom"
                  min={1}
                  max={64}
                  step={0.5}
                  value={previewZoom}
                  disabled={!visibleShapes.length}
                  hideTextInput
                  formatLabel={(value) => `${value.toFixed(1)}×`}
                  onChange={({ value }) => setPreviewZoom(Number(value))}
                />
                <Button
                  className="fullscreen-control"
                  kind="tertiary"
                  size="sm"
                  disabled={!visibleShapes.length}
                  aria-pressed={isFullscreen}
                  onClick={() => void toggleFullscreen()}
                >{isFullscreen ? "Exit full screen" : "Full screen"}</Button>
              </div>
              <div className="preview-mode-tools" aria-label="Viewer overlays">
                <Checkbox id="pixel-grid" className="grid-control" labelText="Pixel grid" title="Native 8520 × 4320 LCD pixel grid" checked={showPreviewGrid} disabled={!visibleShapes.length} onChange={(_event, { checked }) => setShowPreviewGrid(checked)} />
                <Checkbox id="resist-response" className="grid-control" labelText="Resist response" title="Relative latent-image response versus exposure time" checked={showResistResponse} disabled={!visibleShapes.length} onChange={(_event, { checked }) => setShowResistResponse(checked)} />
                <Checkbox id="measure-mode" className="grid-control" labelText="Measure" title="Measure between two clicks on the LCD preview" checked={measureMode} disabled={!repeatedShapes.length}
                  onChange={(_event, { checked }) => { setMeasureMode(checked); setMeasurementStart(null); setMeasurementEnd(null); }} />
              </div>
              <Select id="substrate-template" className="template-control" labelText="Substrate outline" title="Centred physical substrate outline" size="sm" value={substrateTemplateId} onChange={(event) => setSubstrateTemplateId(event.target.value)}>
                  <SelectItem value="" text="None" />
                  {SUBSTRATE_TEMPLATES.map((template) => (
                    <SelectItem key={template.id} value={template.id} text={template.label} />
                  ))}
              </Select>
            </div>
          </div>
          {showResistResponse && visibleShapes.length > 0 && (
            <Layer className="exposure-controls" withBackground aria-label="Resist exposure model">
              <Select id="viewer-photoresist" labelText="Photoresist" helperText="405 nm" size="sm" value={photoresistPresetId} onChange={(event) => selectPhotoresistPreset(event.target.value)}>
                  <SelectItem value="" text="Generic / unassigned" />
                  {PHOTORESIST_MANUFACTURERS_405_NM.map((manufacturer) => (
                    <SelectItemGroup key={manufacturer} label={manufacturer}>
                      {PHOTORESISTS_405_NM.filter((preset) => preset.manufacturer === manufacturer).map((preset) => (
                        <SelectItem key={preset.id} value={preset.id} text={preset.name} />
                      ))}
                    </SelectItemGroup>
                  ))}
              </Select>
              <NumberInput id="viewer-irradiance" label={`Irradiance · mW/cm² · ${responseIrradianceIsEstimated ? "estimated" : "entered"}`} size="sm" min={0} step={0.1} value={responseIrradianceMwCm2} allowEmpty placeholder="Enter a measured value"
                onChange={(_event, { value }) => { setResponseIrradianceMwCm2(String(value)); setResponseIrradianceIsEstimated(false); }} />
              <NumberInput id="viewer-threshold" label="Threshold time t₅₀ · s" size="sm" min={0.1} max={600} step={0.1} value={responseThresholdSeconds}
                onChange={(_event, { value }) => setResponseThresholdSeconds(boundedNumber(String(value), responseThresholdSeconds, 0.1, 600))} />
              <NumberInput id="viewer-blur" label="Optical blur σ · µm" size="sm" min={0} max={1000} step={1} value={opticalBlurMicrometers}
                onChange={(_event, { value }) => setOpticalBlurMicrometers(boundedNumber(String(value), opticalBlurMicrometers, 0, 1000))} />
              <NumberInput id="viewer-contrast" label="Response steepness γ · 0.2–20" size="sm" min={0.2} max={20} step={0.1} value={responseContrast}
                onChange={(_event, { value }) => setResponseContrast(boundedNumber(String(value), responseContrast, 0.2, 20))} />
              <div className="response-profile-note">
                <p><strong>{(calculateResistResponse(1, settings.exposure, responseThresholdSeconds, responseContrast) * 100).toFixed(0)}%</strong> latent response for {photoresistPreset?.name ?? "the generic model"}. {photoresistPreset
                  ? <>{photoresistPreset.documentedContrast ? `Documented γ ${photoresistPreset.documentedContrast}. ` : ""}{referenceDose ? <>Reference dose {referenceDoseText} mJ/cm² ({photoresistPreset.referenceDoseBasis}){referenceTimeText ? ` = ${referenceTimeText} at the entered irradiance` : ""}. </> : "The data sheet provides no transferable 405 nm dose. "}<a href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Manufacturer source</a>. E₀ is not assumed to equal t₅₀.</>
                  : <>Assign a resist, then calibrate t₅₀ and σ from an exposure matrix.</>}</p>
                <span>{responseIrradianceIsEstimated ? "10 mW/cm² · ESTIMATED FROM PAPER" : photoresistPreset ? responseProfileIsSaved ? "CALIBRATION SAVED" : savedResponseProfile ? "UNSAVED CHANGES" : photoresistPreset.documentedContrast ? "DOCUMENTED γ · CALIBRATION NEEDED" : "CALIBRATION NEEDED" : "NO RESIST ASSIGNED"}</span>
                <Button kind="tertiary" size="sm" disabled={!photoresistPreset || responseProfileIsSaved} onClick={saveResponseProfile}>Save calibration</Button>
              </div>
            </Layer>
          )}
          {substrateTemplate && (
            <Accordion className="viewer-settings" size="sm">
              <AccordionItem title={<><span>Substrate &amp; alignment</span><small>{substrateTemplate.label}</small></>}>
              <Layer className="substrate-controls" withBackground aria-label="Substrate configuration">
              <fieldset className="substrate-group substrate-geometry">
                <legend>Wafer geometry</legend>
              {substrateTemplateId.startsWith("custom-") && (
                <>
                  <NumberInput id="substrate-width" label={`${substrateTemplate.shape === "circle" ? "Diameter" : "Width"} · mm`} size="sm" min={1} max={substrateTemplate.shape === "circle" ? 77.76 : 153.36} step={0.1} value={customWidth}
                    onChange={(_event, { value }) => setCustomWidth(boundedNumber(String(value), customWidth, 1, substrateTemplate.shape === "circle" ? 77.76 : 153.36))} />
                  {substrateTemplate.shape === "rectangle" && <NumberInput id="substrate-height" label="Height · mm" size="sm" min={1} max={77.76} step={0.1} value={customHeight}
                    onChange={(_event, { value }) => setCustomHeight(boundedNumber(String(value), customHeight, 1, 77.76))} />}
                </>
              )}
              {substrateTemplate.shape === "circle" && (
                <Select id="wafer-marker" labelText="Edge marker" title="SEMI nominal flat for 2/3-inch wafers" size="sm" value={waferMarker} onChange={(event) => setWaferMarker(event.target.value as typeof waferMarker)}>
                  <SelectItem value="round" text="None" />
                  <SelectItem value="flat" text="Primary flat" />
                  <SelectItem value="notch" text="90° notch" />
                </Select>
              )}
              {substrateTemplateId === "custom-circle" && waferMarker === "flat" && <NumberInput id="wafer-flat-length" label="Flat length · mm" size="sm" min={1} max={customWidth - 0.1} step={0.1} value={customFlatLength}
                onChange={(_event, { value }) => setCustomFlatLength(boundedNumber(String(value), customFlatLength, 1, customWidth - 0.1))} />}
              <NumberInput id="substrate-offset-x" label="Substrate X · µm" size="sm" step={18} value={substrateOffsetX} onChange={(_event, { value }) => setSubstrateOffsetX(boundedNumber(String(value), substrateOffsetX, -153360, 153360))} />
              <NumberInput id="substrate-offset-y" label="Substrate Y · µm" size="sm" step={18} value={substrateOffsetY} onChange={(_event, { value }) => setSubstrateOffsetY(boundedNumber(String(value), substrateOffsetY, -77760, 77760))} />
              <NumberInput id="substrate-rotation" label="Substrate rotation · °" size="sm" min={-180} max={180} step={1} value={substrateRotation}
                onChange={(_event, { value }) => setSubstrateRotation(boundedNumber(String(value), substrateRotation, -180, 180))} />
              <NumberInput id="edge-exclusion" label="Edge exclusion · mm" size="sm" min={0} max={20} step={0.1} value={edgeExclusion}
                onChange={(_event, { value }) => setEdgeExclusion(boundedNumber(String(value), edgeExclusion, 0, 20))} />
              </fieldset>
              <fieldset className="substrate-group substrate-output">
                <legend>Alignment &amp; mask</legend>
              <Select id="alignment-style" labelText="Alignment marks" size="sm" value={alignmentStyle} onChange={(event) => setAlignmentStyle(event.target.value as typeof alignmentStyle)}>
                <SelectItem value="none" text="None" /><SelectItem value="crosses" text="Crosses" /><SelectItem value="corners" text="Corner brackets" />
                <SelectItem value="targets" text="Targets" /><SelectItem value="ruler" text="10 mm ruler" /><SelectItem value="full" text="Full set" />
              </Select>
              <NumberInput id="alignment-size" label="Mark size · mm" size="sm" min={1} max={10} step={0.5} value={alignmentSize} disabled={alignmentStyle === "none"}
                onChange={(_event, { value }) => setAlignmentSize(boundedNumber(String(value), alignmentSize, 1, 10))} />
              <Checkbox id="include-substrate-outline" className="inline-check" labelText="Include outline in mask" title="Rasterize the selected outline into GOO, PNG and ZIP outputs" checked={includeSubstrateOutline} onChange={(_event, { checked }) => setIncludeSubstrateOutline(checked)} />
              <NumberInput id="substrate-line-width" label="Guide line width · µm" size="sm" min={36} max={1000} step={18} value={substrateLineWidth}
                disabled={!includeSubstrateOutline && alignmentStyle === "none"}
                onChange={(_event, { value }) => { const number = Number(value); if (number >= 36 && number <= 1000) setSubstrateLineWidth(number); }} />
              </fieldset>
              <p className="substrate-note">Alignment marks are exported when selected. The dashed inner guide is the usable area and is never exported.</p>
              </Layer>
              </AccordionItem>
            </Accordion>
          )}
          </>}
          <div className="lcd-shell">
            <div ref={lcdGrid} className={`lcd-grid ${visibleShapes.length ? "" : "is-empty"}`} title="Use the mouse wheel or a trackpad pinch gesture to zoom">
              {visibleShapes.length ? (
                <div
                  className="preview-surface"
                  style={{ width: `${previewZoom * 100}%`, height: `${previewZoom * 100}%` }}
                  onClick={inspectPreview}
                >
                  <canvas ref={preview} aria-label={showResistResponse ? "Relative photoresist response preview" : "LCD mask preview"} />
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
                  <strong>Start a mask</strong>
                  <p>Open a GDSII layout or try the UV example to preview it at physical scale.</p>
                  <div className="empty-preview-actions">
                    <FileUploaderButton id="empty-gds-file" accept={[".gds", ".gdsii"]} buttonKind="primary" size="sm" disabled={busy} labelText="Open GDS" onChange={(event) => void loadFile(event.target.files?.[0])} />
                    <Button kind="secondary" size="sm" disabled={busy} onClick={() => void loadLogoExample()}>Try UV example</Button>
                  </div>
                  <small>GDS/GDSII · maximum 100 MB</small>
                </div>
              )}
            </div>
            <div className="screen-axis"><span>0, 0</span><span>X · 153.36 mm</span></div>
            {showResistResponse && <div className="exposure-legend"><span>0% · unexposed</span><i /><span>50% · t₅₀</span><i /><span>100% · saturated</span></div>}
            {measureMode && (
              <p className="measurement-readout">{measurement
                ? `MEASURE · ΔX ${measurement.deltaX.toFixed(3)} mm · ΔY ${measurement.deltaY.toFixed(3)} mm · DISTANCE ${measurement.distance.toFixed(3)} mm`
                : measurementStart ? "MEASURE · Select the second point." : "MEASURE · Select the first point."}</p>
            )}
          </div>
        </section>
      </section>

      <Layer as="aside" id="pixel-inspector" className={`app-inspector scientific-inspector ${showInspector ? "open" : ""}`} withBackground aria-labelledby="pixel-inspector-title" hidden={!showInspector}>
         {showInspector ? (
            <div className="pixel-inspector">
              <div className="inspector-header scientific-inspector__heading">
                <p>Selection</p>
                <h2 id="pixel-inspector-title">Native 1:1 inspector</h2>
                <IconButton className="close-panel" kind="ghost" size="lg" label="Close pixel inspector" align="bottom-end" onClick={() => setInspectorOpen(false)}><Close /></IconButton>
              </div>
              <div className="inspector-content scientific-inspector__body">
                <canvas ref={inspector} aria-label={`Native LCD pixels around ${inspection.x}, ${inspection.y}`} />
                <div className="inspector-metrics">
                  <strong>PX {inspection.x}, {inspection.y}</strong>
                  <span>
                    {((inspection.x + 0.5) * 0.018 - MARS_4_9K.sizeX / 2).toFixed(3)} mm X
                    <br />
                    {(MARS_4_9K.sizeY / 2 - (inspection.y + 0.5) * 0.018).toFixed(3)} mm Y
                  </span>
                </div>
                <small>Click the main preview to inspect a 64 × 64 native-pixel region.</small>
              </div>
            </div>
          ) : (
            <div className="empty-inspector">
               <p>No objects selected</p>
            </div>
          )}
      </Layer>

      <Layer className="app-status scientific-status-surface" withBackground data-kind={outsideScreen ? "error" : outsideSubstrate ? "warning" : busy ? "running" : sourceInfo ? "ready" : "idle"} aria-label="Mask status">
        <p className="status-message" title={message}><span aria-hidden="true" /><span className="status-message-text">{message}</span></p>
        <dl className="status-metrics">
          <div><dt>LCD pixel</dt><dd>18 × 18 µm</dd></div>
          <div><dt>Layout</dt><dd>{bounds ? `${(bounds.width / 1000).toFixed(3)} × ${(bounds.height / 1000).toFixed(3)} mm` : "—"}</dd></div>
          <div><dt>Minimum feature</dt><dd className={minimumFeature !== null && minimumFeature < 36 ? "warn" : ""}>{minimumFeature === null ? "—" : `${minimumFeature.toFixed(1)} µm`}</dd></div>
          <div><dt>Layers</dt><dd>{selectedLayers.length || "—"}</dd></div>
        </dl>
      </Layer>

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
      </Content>
    </>
  );
}
