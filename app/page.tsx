"use client";

import { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  boundsOf,
  estimateMinimumFeature,
  fitsDisplay,
  flattenGds,
  parseGds,
  placementAnchorOf,
  transformPlacedPoint,
} from "@/lib/gds.js";
import { buildGooFile, encodeBinaryLayer, MARS_4_9K, validateGooFile } from "@/lib/goo.js";
import { createCalibrationShapes, createOrientationCheckShapes, parseExposureSeries } from "@/lib/calibration.js";
import { createRunManifest, parseRunManifest } from "@/lib/manifest.js";
import { createMonochromePreview, rasterizeBinaryMask } from "@/lib/raster.js";
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

const INSPECTOR_SIZE = 64;

const SUBSTRATE_TEMPLATES = [
  { id: "wafer-1", label: "1-inch wafer · Ø25.4 mm", shape: "circle", width: 25.4, height: 25.4 },
  { id: "wafer-2", label: "2-inch wafer · Ø50.8 mm", shape: "circle", width: 50.8, height: 50.8 },
  { id: "wafer-3", label: "3-inch wafer · Ø76.2 mm", shape: "circle", width: 76.2, height: 76.2 },
  { id: "slide-75x25", label: "Microscope slide · 75 × 25 mm", shape: "rectangle", width: 75, height: 25 },
] as const;

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

function drawMask(
  canvas: HTMLCanvasElement,
  shapes: ReturnType<typeof flattenGds>,
  settings: MaskSettings,
  width: number,
  height: number,
) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create the mask canvas.");
  const anchor = placementAnchorOf(shapes, settings.anchor);
  const pixelsPerMicrometer = width / (MARS_4_9K.sizeX * 1000);
  const map = (point: { x: number; y: number }) => {
    const transformed = transformPlacedPoint(point, anchor, settings);
    return {
      x: width / 2 + transformed.x * pixelsPerMicrometer,
      y: height / 2 - transformed.y * pixelsPerMicrometer,
    };
  };

  context.fillStyle = settings.inverted ? "#fff" : "#000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = settings.inverted ? "#000" : "#fff";
  context.strokeStyle = context.fillStyle;
  context.lineJoin = "miter";

  for (const shape of shapes) {
    const first = map(shape.points[0]);
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let i = 1; i < shape.points.length; i += 1) {
      const point = map(shape.points[i]);
      context.lineTo(point.x, point.y);
    }
    if (shape.kind === "polygon") {
      context.closePath();
      context.fill("evenodd");
    } else {
      context.lineWidth = Math.max(1, shape.width * pixelsPerMicrometer);
      context.lineCap = shape.pathType === 1 ? "round" : shape.pathType === 2 ? "square" : "butt";
      context.stroke();
    }
  }
  return context;
}

function nativeMask(shapes: ReturnType<typeof flattenGds>, settings: MaskSettings) {
  return rasterizeBinaryMask(shapes, settings, {
    width: MARS_4_9K.width,
    height: MARS_4_9K.height,
    pixelMicrometers: MARS_4_9K.pixelMicrometers,
  });
}

function rasterizeMask(shapes: ReturnType<typeof flattenGds>, settings: MaskSettings) {
  const pixels = nativeMask(shapes, settings);
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

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const runInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const inspector = useRef<HTMLCanvasElement>(null);
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
  const [substrateTemplateId, setSubstrateTemplateId] = useState("");
  const [inspection, setInspection] = useState({ x: Math.floor(MARS_4_9K.width / 2), y: Math.floor(MARS_4_9K.height / 2) });
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationSeries, setCalibrationSeries] = useState("5, 7, 9, 11, 13");
  const [processMetadata, setProcessMetadata] = useState(DEFAULT_PROCESS);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);

  const layers = useMemo(() => [...new Set(shapes.map((shape) => shape.layer))].sort((a, b) => a - b), [shapes]);
  const visibleShapes = useMemo(
    () => shapes.filter((shape) => selectedLayers.includes(shape.layer)),
    [shapes, selectedLayers],
  );
  const bounds = useMemo(() => visibleShapes.length ? boundsOf(visibleShapes) : null, [visibleShapes]);
  const minimumFeature = useMemo(
    () => visibleShapes.length ? estimateMinimumFeature(visibleShapes) : null,
    [visibleShapes],
  );
  const substrateTemplate = SUBSTRATE_TEMPLATES.find(({ id }) => id === substrateTemplateId);
  const outsideScreen = Boolean(visibleShapes.length && !fitsDisplay(
    visibleShapes,
    settings,
    MARS_4_9K.sizeX * 1000,
    MARS_4_9K.sizeY * 1000,
  ));

  useEffect(() => {
    if (!preview.current || !visibleShapes.length) return;
    drawMask(preview.current, visibleShapes, settings, 1400, 710);
  }, [visibleShapes, settings]);

  useEffect(() => {
    if (!inspector.current || !visibleShapes.length) return;
    const offsetX = Math.max(0, Math.min(MARS_4_9K.width - INSPECTOR_SIZE, inspection.x - INSPECTOR_SIZE / 2));
    const offsetY = Math.max(0, Math.min(MARS_4_9K.height - INSPECTOR_SIZE, inspection.y - INSPECTOR_SIZE / 2));
    const pixels = rasterizeBinaryMask(visibleShapes, settings, {
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
  }, [visibleShapes, settings, inspection]);

  function inspectPreview(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setInspection({
      x: Math.max(0, Math.min(MARS_4_9K.width - 1, Math.floor((event.clientX - rect.left) / rect.width * MARS_4_9K.width))),
      y: Math.max(0, Math.min(MARS_4_9K.height - 1, Math.floor((event.clientY - rect.top) / rect.height * MARS_4_9K.height))),
    });
  }

  function updateShapes(nextModel: ReturnType<typeof parseGds>, cell: string) {
    const flattened = flattenGds(nextModel, cell);
    const nextLayers = [...new Set(flattened.map((shape) => shape.layer))].sort((a, b) => a - b);
    setShapes(flattened);
    setSelectedLayers(nextLayers);
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
      setCalibrationMode(false);
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
    setCalibrationMode(kind === "generated-calibration");
    setFileName(name);
    setSourceInfo({ kind, name, sizeBytes: null, sha256: null });
    setTopCell("");
    setShapes(generatedShapes);
    setSelectedLayers(generatedLayers);
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
        geometryCount: visibleShapes.length,
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

  async function exportGoo() {
    if (!visibleShapes.length || outsideScreen) return;
    setBusy(true);
    setMessage("Rasterizing 36.8 million pixels locally…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const raster = rasterizeMask(visibleShapes, settings);
      const { goo, check } = buildValidatedGoo(raster, settings.exposure);
      const baseName = outputBaseName();
      const gooName = `${baseName}.goo`;
      saveFile(goo, gooName, "application/octet-stream");
      saveFile(JSON.stringify(buildManifest([settings.exposure], [gooName]), null, 2), `${baseName}.run.json`, "application/json");
      setMessage(`GOO validated: ${check.pixels.toLocaleString("en-US")} pixels, 1 layer, ${settings.exposure} s.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The GOO file could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function exportCalibrationSeries() {
    if (!calibrationMode || !visibleShapes.length || outsideScreen) return;
    try {
      const exposures = parseExposureSeries(calibrationSeries);
      setBusy(true);
      setMessage(`Rasterizing calibration series for ${exposures.length} exposure(s)…`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const raster = rasterizeMask(visibleShapes, settings);
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The calibration series could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle() {
    if (!visibleShapes.length || outsideScreen) return;
    setBusy(true);
    setMessage("Building reproducible experiment package…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const raster = rasterizeMask(visibleShapes, settings);
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The experiment package could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function exportPng() {
    if (!visibleShapes.length || outsideScreen) return;
    setBusy(true);
    setMessage("Generating 9K verification PNG…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const png = await encodePng(nativeMask(visibleShapes, settings));
      saveFile(png, `${fileName.replace(/\.gds(ii)?$/i, "") || "mask"}-8520x4320.png`, "image/png");
      setMessage("9K PNG generated. Use it to verify orientation and polarity.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The PNG could not be generated.");
    } finally {
      setBusy(false);
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
          <h1>From GDS layout to the <em>UV display.</em></h1>
        </div>
        <p className="hero-copy">Rasterize physical geometries at native pixel resolution and generate a single-layer <code>.goo</code> exposure for the Mars 4 9K.</p>
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
            <li><span>03</span><div><strong>Place the mask</strong><p>Set the anchor, rotation, mirrors and offsets. Export remains disabled if geometry is clipped.</p></div></li>
            <li><span>04</span><div><strong>Calibrate the dose</strong><p>Use the built-in pattern and an exposure series for each resist, thickness, bake and development process.</p></div></li>
            <li><span>05</span><div><strong>Inspect and record</strong><p>Check polarity and native pixels, then download the experiment ZIP and print the run sheet.</p></div></li>
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

          <div className={`status ${outsideScreen ? "error" : ""}`} role="status">
            <span>{outsideScreen ? "!" : busy ? "…" : "✓"}</span>
            <p>{outsideScreen ? "The mask exceeds the physical display area." : message}</p>
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

        <section className="preview-panel">
          <div className="preview-toolbar">
            <div><span className="live-dot" /> LCD PREVIEW</div>
            <div className="preview-tools">
              <p>153.36 × 77.76 mm <b>·</b> 8520 × 4320 px</p>
              <label className="zoom-control">
                <span>ZOOM</span>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="0.5"
                  value={previewZoom}
                  disabled={!visibleShapes.length}
                  onChange={(event) => setPreviewZoom(Number(event.target.value))}
                />
                <output>{previewZoom.toFixed(1)}×</output>
              </label>
              <label className="grid-control" title="Native 8520 × 4320 LCD pixel grid; enabling it sets zoom to 8×">
                <input
                  type="checkbox"
                  checked={showPreviewGrid}
                  disabled={!visibleShapes.length}
                  onChange={(event) => {
                    setShowPreviewGrid(event.target.checked);
                    if (event.target.checked) setPreviewZoom(8);
                  }}
                />
                <span>PIXEL GRID</span>
              </label>
              <label className="template-control" title="Centred physical outline for placement only; never included in exports">
                <span>SUBSTRATE OUTLINE</span>
                <select value={substrateTemplateId} onChange={(event) => setSubstrateTemplateId(event.target.value)}>
                  <option value="">None</option>
                  {SUBSTRATE_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="lcd-shell">
            <div className="lcd-grid">
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
                        {substrateTemplate.shape === "circle" ? (
                          <circle
                            cx={MARS_4_9K.sizeX / 2}
                            cy={MARS_4_9K.sizeY / 2}
                            r={substrateTemplate.width / 2}
                          />
                        ) : (
                          <rect
                            x={(MARS_4_9K.sizeX - substrateTemplate.width) / 2}
                            y={(MARS_4_9K.sizeY - substrateTemplate.height) / 2}
                            width={substrateTemplate.width}
                            height={substrateTemplate.height}
                            rx="0.5"
                          />
                        )}
                        <path d={`M ${MARS_4_9K.sizeX / 2 - 2} ${MARS_4_9K.sizeY / 2} h 4 M ${MARS_4_9K.sizeX / 2} ${MARS_4_9K.sizeY / 2 - 2} v 4`} />
                      </svg>
                      <span style={{ top: `${(MARS_4_9K.sizeY - substrateTemplate.height) / 2 / MARS_4_9K.sizeY * 100}%` }}>
                        {substrateTemplate.label} · PREVIEW ONLY
                      </span>
                    </div>
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
        <p>Based on Wu et al., <i>Small Methods</i> 9 (2025), e01336. The optimum dose must be recalibrated for each photoresist, thickness, LCD and development process.</p>
        <p><a href="https://jorpago2.github.io/jorpago2/">A tool by Jorge Parra</a><br />405 nm · local-first · experimental use</p>
      </footer>
    </main>
  );
}
