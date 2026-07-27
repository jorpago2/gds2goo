"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, estimateMinimumFeature, flattenGds, parseGds } from "@/lib/gds.js";
import { buildGooFile, encodeBinaryLayer, MARS_4_9K, validateGooFile } from "@/lib/goo.js";

type MaskSettings = {
  exposure: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  inverted: boolean;
};

const DEFAULT_SETTINGS: MaskSettings = {
  exposure: 9,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
  inverted: false,
};

function transformedPoint(point: { x: number; y: number }, center: { x: number; y: number }, settings: MaskSettings) {
  let x = point.x - center.x;
  let y = point.y - center.y;
  if (settings.mirrorX) x *= -1;
  if (settings.mirrorY) y *= -1;
  if (settings.rotation === 90) [x, y] = [-y, x];
  else if (settings.rotation === 180) [x, y] = [-x, -y];
  else if (settings.rotation === 270) [x, y] = [y, -x];
  return { x: x + settings.offsetX, y: y + settings.offsetY };
}

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
  if (!context) throw new Error("El navegador no permite crear el lienzo de máscara.");
  const bounds = boundsOf(shapes);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const pixelsPerMicrometer = width / (MARS_4_9K.sizeX * 1000);
  const map = (point: { x: number; y: number }) => {
    const transformed = transformedPoint(point, center, settings);
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

function previewPixels(shapes: ReturnType<typeof flattenGds>, settings: MaskSettings, width: number, height: number) {
  const canvas = document.createElement("canvas");
  const context = drawMask(canvas, shapes, settings, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint16Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = rgba[i * 4] > 127 ? 0xffff : 0x0000;
  return pixels;
}

function saveFile(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [model, setModel] = useState<ReturnType<typeof parseGds> | null>(null);
  const [fileName, setFileName] = useState("");
  const [topCell, setTopCell] = useState("");
  const [shapes, setShapes] = useState<ReturnType<typeof flattenGds>>([]);
  const [selectedLayers, setSelectedLayers] = useState<number[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [message, setMessage] = useState("Carga un GDSII para comenzar.");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

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
  const rotatedWidth = bounds && [90, 270].includes(settings.rotation) ? bounds.height : bounds?.width;
  const rotatedHeight = bounds && [90, 270].includes(settings.rotation) ? bounds.width : bounds?.height;
  const outsideScreen = Boolean(rotatedWidth && rotatedHeight && (
    rotatedWidth > MARS_4_9K.sizeX * 1000 || rotatedHeight > MARS_4_9K.sizeY * 1000
  ));

  useEffect(() => {
    if (!preview.current || !visibleShapes.length) return;
    drawMask(preview.current, visibleShapes, settings, 1400, 710);
  }, [visibleShapes, settings]);

  function updateShapes(nextModel: ReturnType<typeof parseGds>, cell: string) {
    const flattened = flattenGds(nextModel, cell);
    const nextLayers = [...new Set(flattened.map((shape) => shape.layer))].sort((a, b) => a - b);
    setShapes(flattened);
    setSelectedLayers(nextLayers);
    setMessage(`${flattened.length.toLocaleString("es-ES")} geometrías listas en ${nextLayers.length} capa(s).`);
  }

  async function loadFile(file?: File) {
    if (!file) return;
    if (!/\.gds(ii)?$/i.test(file.name)) {
      setMessage("Selecciona un archivo .gds o .gdsii.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setMessage("El GDS supera el límite local de 100 MB.");
      return;
    }
    try {
      setBusy(true);
      setMessage("Leyendo jerarquía GDSII…");
      const parsed = parseGds(await file.arrayBuffer());
      const cell = parsed.topCells.at(-1) ?? "";
      setModel(parsed);
      setFileName(file.name);
      setTopCell(cell);
      updateShapes(parsed, cell);
    } catch (error) {
      setModel(null);
      setShapes([]);
      setMessage(error instanceof Error ? error.message : "No se pudo leer el GDS.");
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files[0]);
  }

  function changeTopCell(cell: string) {
    if (!model) return;
    try {
      setTopCell(cell);
      updateShapes(model, cell);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo aplanar la celda.");
    }
  }

  function toggleLayer(layer: number) {
    setSelectedLayers((current) => current.includes(layer)
      ? current.filter((value) => value !== layer)
      : [...current, layer].sort((a, b) => a - b));
  }

  async function exportGoo() {
    if (!visibleShapes.length || outsideScreen) return;
    setBusy(true);
    setMessage("Rasterizando 36,8 millones de píxeles localmente…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const canvas = document.createElement("canvas");
    try {
      const context = drawMask(canvas, visibleShapes, settings, MARS_4_9K.width, MARS_4_9K.height);
      const encoded = encodeBinaryLayer((y: number) => {
        const rgba = context.getImageData(0, y, MARS_4_9K.width, 1).data;
        const row = new Uint8Array(MARS_4_9K.width);
        for (let x = 0; x < row.length; x += 1) row[x] = rgba[x * 4] > 127 ? 1 : 0;
        return row;
      }, MARS_4_9K.width, MARS_4_9K.height);
      const goo = buildGooFile({
        layerData: encoded.data,
        exposureSeconds: settings.exposure,
        whitePixels: encoded.whitePixels,
        smallPreview: previewPixels(visibleShapes, settings, 116, 116),
        bigPreview: previewPixels(visibleShapes, settings, 290, 290),
      });
      const check = validateGooFile(goo);
      saveFile(goo, `${fileName.replace(/\.gds(ii)?$/i, "") || "mask"}.goo`, "application/octet-stream");
      setMessage(`GOO validado: ${check.pixels.toLocaleString("es-ES")} píxeles, 1 capa, ${settings.exposure} s.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar el GOO.");
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      setBusy(false);
    }
  }

  async function exportPng() {
    if (!visibleShapes.length || outsideScreen) return;
    setBusy(true);
    setMessage("Generando PNG 9K de control…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const canvas = document.createElement("canvas");
    try {
      drawMask(canvas, visibleShapes, settings, MARS_4_9K.width, MARS_4_9K.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("El navegador no pudo codificar el PNG.");
      saveFile(blob, `${fileName.replace(/\.gds(ii)?$/i, "") || "mask"}-8520x4320.png`, "image/png");
      setMessage("PNG 9K generado. Úsalo para verificar orientación y polaridad.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar el PNG.");
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="GDS2GOO, inicio">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          GDS<span>2</span>GOO
        </a>
        <div className="device-pill"><span /> Elegoo Mars 4 · 9K</div>
        <p>Conversión local · ningún archivo sale del navegador</p>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">MASKLESS PHOTOLITHOGRAPHY TOOL</p>
          <h1>Del layout GDS a la<br />pantalla <em>UV.</em></h1>
        </div>
        <p className="hero-copy">Rasteriza geometrías físicas a píxel nativo y genera una exposición <code>.goo</code> de una sola capa para la Mars 4 9K.</p>
      </section>

      <section className="workspace" aria-label="Conversor GDS a GOO">
        <aside className="controls">
          <div className="step-heading"><span>01</span><div><p>ENTRADA</p><h2>Archivo y capas</h2></div></div>
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
            <strong>{fileName || "Arrastra tu .gds"}</strong>
            <small>{fileName ? "Haz clic para sustituirlo" : "o haz clic para seleccionarlo · máx. 100 MB"}</small>
          </div>

          {model && (
            <div className="file-options">
              <label>Celda superior
                <select value={topCell} onChange={(event) => changeTopCell(event.target.value)}>
                  {model.topCells.map((cell) => <option key={cell}>{cell}</option>)}
                </select>
              </label>
              <fieldset>
                <legend>Capas a exponer</legend>
                <div className="layer-list">
                  {layers.map((layer) => (
                    <button
                      type="button"
                      key={layer}
                      className={selectedLayers.includes(layer) ? "active" : ""}
                      onClick={() => toggleLayer(layer)}
                      aria-pressed={selectedLayers.includes(layer)}
                    >L{layer}</button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          <div className="divider" />
          <div className="step-heading"><span>02</span><div><p>MÁSCARA</p><h2>Exposición y orientación</h2></div></div>
          <div className="settings-grid">
            <label>Exposición <span>s</span>
              <input type="number" min="0.1" max="600" step="0.1" value={settings.exposure}
                onChange={(event) => setSettings({ ...settings, exposure: Number(event.target.value) })} />
            </label>
            <label>Rotación
              <select value={settings.rotation} onChange={(event) => setSettings({ ...settings, rotation: Number(event.target.value) })}>
                {[0, 90, 180, 270].map((angle) => <option key={angle} value={angle}>{angle}°</option>)}
              </select>
            </label>
            <label>Desplaz. X <span>µm</span>
              <input type="number" step="18" value={settings.offsetX}
                onChange={(event) => setSettings({ ...settings, offsetX: Number(event.target.value) })} />
            </label>
            <label>Desplaz. Y <span>µm</span>
              <input type="number" step="18" value={settings.offsetY}
                onChange={(event) => setSettings({ ...settings, offsetY: Number(event.target.value) })} />
            </label>
          </div>
          <div className="toggle-row">
            <button type="button" className={settings.mirrorX ? "active" : ""} onClick={() => setSettings({ ...settings, mirrorX: !settings.mirrorX })}>↔ Espejo X</button>
            <button type="button" className={settings.mirrorY ? "active" : ""} onClick={() => setSettings({ ...settings, mirrorY: !settings.mirrorY })}>↕ Espejo Y</button>
          </div>
          <label className="switch-row">
            <input type="checkbox" checked={settings.inverted} onChange={(event) => setSettings({ ...settings, inverted: event.target.checked })} />
            <span className="switch" />
            Invertir polaridad <small>{settings.inverted ? "fondo expuesto" : "geometría expuesta"}</small>
          </label>

          <div className={`status ${outsideScreen ? "error" : ""}`} role="status">
            <span>{outsideScreen ? "!" : busy ? "…" : "✓"}</span>
            <p>{outsideScreen ? "La máscara excede el área física de la pantalla." : message}</p>
          </div>
          <button className="primary-action" type="button" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportGoo()}>
            {busy ? "Procesando…" : "Generar archivo .GOO"}<span>→</span>
          </button>
          <button className="secondary-action" type="button" disabled={busy || !visibleShapes.length || outsideScreen} onClick={() => void exportPng()}>
            Descargar PNG 9K de control
          </button>
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar">
            <div><span className="live-dot" /> PREVISUALIZACIÓN LCD</div>
            <p>153,36 × 77,76 mm <b>·</b> 8520 × 4320 px</p>
          </div>
          <div className="lcd-shell">
            <div className="lcd-grid">
              {visibleShapes.length ? <canvas ref={preview} aria-label="Previsualización de la máscara LCD" /> : (
                <div className="empty-preview">
                  <div className="empty-pattern"><i /><i /><i /><i /><i /></div>
                  <strong>LCD READY</strong>
                  <p>La máscara aparecerá aquí a escala física.</p>
                </div>
              )}
            </div>
            <div className="screen-axis"><span>0,0</span><span>X · 153,36 mm</span></div>
          </div>
          <div className="metrics">
            <article><p>TAMAÑO DEL LAYOUT</p><strong>{bounds ? `${(bounds.width / 1000).toFixed(3)} × ${(bounds.height / 1000).toFixed(3)} mm` : "—"}</strong></article>
            <article><p>FEATURE MÍNIMA*</p><strong className={minimumFeature !== null && minimumFeature < 36 ? "warn" : ""}>{minimumFeature === null ? "—" : `${minimumFeature.toFixed(1)} µm`}</strong></article>
            <article><p>PÍXEL LCD</p><strong>18 × 18 µm</strong></article>
            <article><p>CAPAS ACTIVAS</p><strong>{selectedLayers.length || "—"}</strong></article>
          </div>
          <p className="metric-note">*Estimación por anchura de PATH o caja mínima de cada polígono. El paper apenas resolvió 1 píxel; usa ≥2 píxeles (36 µm) para mayor robustez.</p>
        </section>
      </section>

      <section className="science-strip">
        <div><span>01</span><p><b>GDSII</b>Jerarquía, BOUNDARY, BOX, PATH, SREF y AREF</p></div>
        <i>→</i>
        <div><span>02</span><p><b>RASTER 1:1</b>18 µm/píxel · sin reescalado automático</p></div>
        <i>→</i>
        <div><span>03</span><p><b>GOO V3.0</b>Una capa de 0,05 mm · RLE y checksum verificados</p></div>
      </section>

      <footer>
        <p>Basado en Wu et al., <i>Small Methods</i> 9 (2025), e01336. La dosis óptima debe recalibrarse para cada resist, espesor, LCD y revelado.</p>
        <p>405 nm · local-first · uso experimental</p>
      </footer>
    </main>
  );
}
