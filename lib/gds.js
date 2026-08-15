/** @typedef {{x:number, y:number}} Point */
/** @typedef {{kind:"polygon"|"path", layer:number, datatype:number, points:Point[], width:number, pathType:number}} Shape */

const RECORD = {
  UNITS: 0x03,
  BGNSTR: 0x05,
  STRNAME: 0x06,
  ENDSTR: 0x07,
  BOUNDARY: 0x08,
  PATH: 0x09,
  SREF: 0x0a,
  AREF: 0x0b,
  TEXT: 0x0c,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  WIDTH: 0x0f,
  XY: 0x10,
  ENDEL: 0x11,
  SNAME: 0x12,
  COLROW: 0x13,
  NODE: 0x15,
  STRANS: 0x1a,
  MAG: 0x1b,
  ANGLE: 0x1c,
  PATHTYPE: 0x21,
  BOX: 0x2d,
  BOXTYPE: 0x2e,
  BGNEXTN: 0x30,
  ENDEXTN: 0x31,
};

function real8(view, offset) {
  const first = view.getUint8(offset);
  if (first === 0) return 0;
  const sign = first & 0x80 ? -1 : 1;
  const exponent = (first & 0x7f) - 64;
  let mantissa = 0;
  for (let i = 1; i < 8; i += 1) mantissa = mantissa * 256 + view.getUint8(offset + i);
  return sign * (mantissa / 2 ** 56) * 16 ** exponent;
}

function ascii(bytes) {
  return new TextDecoder("ascii").decode(bytes).replace(/\0+$/, "");
}

/** Parse a binary GDSII stream without uploading it anywhere. */
export function parseGds(buffer) {
  const view = new DataView(buffer);
  const structures = new Map();
  const referenced = new Set();
  let unitMicrometers = 0.001;
  let offset = 0;
  let records = 0;
  let structure = null;
  let element = null;
  const recordCounts = {};
  let pathType4Count = 0;
  let absoluteWidthCount = 0;
  let absoluteMagnificationCount = 0;
  let absoluteAngleCount = 0;

  while (offset + 4 <= view.byteLength) {
    const length = view.getUint16(offset, false);
    if (length < 4 || offset + length > view.byteLength) {
      throw new Error(`Invalid GDS record at byte ${offset}.`);
    }
    const type = view.getUint8(offset + 2);
    const start = offset + 4;
    const end = offset + length;
    records += 1;
    recordCounts[type] = (recordCounts[type] ?? 0) + 1;

    if (type === RECORD.UNITS && end - start >= 16) {
      const databaseUnitMeters = real8(view, start + 8);
      if (databaseUnitMeters > 0) unitMicrometers = databaseUnitMeters * 1e6;
    } else if (type === RECORD.BGNSTR) {
      structure = { name: "", elements: [] };
    } else if (type === RECORD.STRNAME && structure) {
      structure.name = ascii(new Uint8Array(buffer, start, end - start));
    } else if (type === RECORD.ENDSTR && structure) {
      if (!structure.name) throw new Error("A GDS structure without a name was found.");
      structures.set(structure.name, structure);
      structure = null;
    } else if ([RECORD.BOUNDARY, RECORD.PATH, RECORD.SREF, RECORD.AREF, RECORD.BOX].includes(type)) {
      element = {
        kind: type,
        layer: 0,
        datatype: 0,
        width: 0,
        pathType: 0,
        points: [],
        sname: "",
        columns: 1,
        rows: 1,
        reflect: false,
        absoluteMagnification: false,
        absoluteAngle: false,
        mag: 1,
        angle: 0,
      };
    } else if (element && type === RECORD.LAYER) {
      element.layer = view.getInt16(start, false);
    } else if (element && (type === RECORD.DATATYPE || type === RECORD.BOXTYPE)) {
      element.datatype = view.getInt16(start, false);
    } else if (element && type === RECORD.WIDTH) {
      const width = view.getInt32(start, false);
      if (width < 0) absoluteWidthCount += 1;
      element.width = Math.abs(width);
    } else if (element && type === RECORD.PATHTYPE) {
      element.pathType = view.getInt16(start, false);
    } else if (element && type === RECORD.XY) {
      element.points = [];
      for (let i = start; i + 7 < end; i += 8) {
        element.points.push({ x: view.getInt32(i, false), y: view.getInt32(i + 4, false) });
      }
    } else if (element && type === RECORD.SNAME) {
      element.sname = ascii(new Uint8Array(buffer, start, end - start));
      referenced.add(element.sname);
    } else if (element && type === RECORD.COLROW) {
      element.columns = Math.max(1, view.getUint16(start, false));
      element.rows = Math.max(1, view.getUint16(start + 2, false));
    } else if (element && type === RECORD.STRANS) {
      const flags = view.getUint16(start, false);
      element.reflect = Boolean(flags & 0x8000);
      element.absoluteMagnification = Boolean(flags & 0x0004);
      element.absoluteAngle = Boolean(flags & 0x0002);
    } else if (element && type === RECORD.MAG) {
      element.mag = real8(view, start);
    } else if (element && type === RECORD.ANGLE) {
      element.angle = real8(view, start);
    } else if (type === RECORD.ENDEL && element && structure) {
      if (element.kind === RECORD.PATH && element.pathType === 4) pathType4Count += 1;
      if (element.absoluteMagnification) absoluteMagnificationCount += 1;
      if (element.absoluteAngle) absoluteAngleCount += 1;
      structure.elements.push(element);
      element = null;
    }
    offset = end;
  }

  if (records === 0 || structures.size === 0) throw new Error("The file contains no readable GDSII structures.");
  const topCells = [...structures.keys()].filter((name) => !referenced.has(name));
  const elementCounts = {
    boundaries: recordCounts[RECORD.BOUNDARY] ?? 0,
    boxes: recordCounts[RECORD.BOX] ?? 0,
    paths: recordCounts[RECORD.PATH] ?? 0,
    references: (recordCounts[RECORD.SREF] ?? 0) + (recordCounts[RECORD.AREF] ?? 0),
    texts: recordCounts[RECORD.TEXT] ?? 0,
    nodes: recordCounts[RECORD.NODE] ?? 0,
  };
  const datatypesByLayer = new Map();
  for (const currentStructure of structures.values()) {
    for (const currentElement of currentStructure.elements) {
      if (![RECORD.BOUNDARY, RECORD.BOX, RECORD.PATH].includes(currentElement.kind)) continue;
      if (!datatypesByLayer.has(currentElement.layer)) datatypesByLayer.set(currentElement.layer, new Set());
      datatypesByLayer.get(currentElement.layer).add(currentElement.datatype);
    }
  }
  const mixedDatatypeLayers = [...datatypesByLayer.entries()].filter(([, datatypes]) => datatypes.size > 1).map(([layer]) => layer);
  const warnings = [];
  if (elementCounts.texts) warnings.push(`${elementCounts.texts} TEXT element(s) are not rasterized and will be omitted.`);
  if (elementCounts.nodes) warnings.push(`${elementCounts.nodes} NODE element(s) are unsupported and will be ignored.`);
  if (pathType4Count || recordCounts[RECORD.BGNEXTN] || recordCounts[RECORD.ENDEXTN]) {
    const customPathCount = Math.max(pathType4Count, recordCounts[RECORD.BGNEXTN] ?? 0, recordCounts[RECORD.ENDEXTN] ?? 0);
    warnings.push(`${customPathCount} PATH element(s) use custom extensions; extensions are ignored and ends are rasterized flush.`);
  }
  if (absoluteMagnificationCount || absoluteAngleCount) {
    warnings.push(`${Math.max(absoluteMagnificationCount, absoluteAngleCount)} reference(s) use absolute MAG/ANGLE flags, which are not applied through nested hierarchy.`);
  }
  if (absoluteWidthCount) warnings.push(`${absoluteWidthCount} PATH element(s) use absolute WIDTH; referenced magnification is currently applied to that width.`);
  if (mixedDatatypeLayers.length) warnings.push(`Layer(s) ${mixedDatatypeLayers.join(", ")} contain multiple datatypes; selecting a layer exposes all of them together.`);
  return {
    structures,
    topCells: topCells.length ? topCells : [...structures.keys()].slice(-1),
    unitMicrometers,
    records,
    compatibility: { elementCounts, warnings },
  };
}

function multiply(a, b) {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

function referenceMatrix(point, element) {
  const radians = (element.angle * Math.PI) / 180;
  const cos = Math.cos(radians) * element.mag;
  const sin = Math.sin(radians) * element.mag;
  const reflect = element.reflect ? -1 : 1;
  return { a: cos, b: sin, c: -sin * reflect, d: cos * reflect, e: point.x, f: point.y };
}

function apply(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

/** Flatten one GDS cell, including SREF/AREF hierarchy, into physical micrometers. */
export function flattenGds(model, topCell, limits = {}) {
  /** @type {Shape[]} */
  const output = [];
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const maxShapes = limits.maxShapes ?? 250_000;
  const maxInstances = limits.maxInstances ?? 250_000;
  const maxPoints = limits.maxPoints ?? 2_000_000;
  let visitedInstances = 0;
  let emittedPoints = 0;

  if (![maxShapes, maxInstances, maxPoints].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("GDS expansion limits must be positive safe integers.");
  }

  function visit(name, matrix, stack) {
    visitedInstances += 1;
    if (visitedInstances > maxInstances) throw new Error(`GDS expansion exceeds the ${maxInstances.toLocaleString()} instance safety limit.`);
    if (stack.length > 64) throw new Error("The GDS hierarchy exceeds 64 levels.");
    if (stack.includes(name)) throw new Error(`Circular GDS reference: ${[...stack, name].join(" → ")}.`);
    const structure = model.structures.get(name);
    if (!structure) throw new Error(`Referenced cell “${name}” does not exist.`);

    for (const element of structure.elements) {
      if ([RECORD.BOUNDARY, RECORD.BOX, RECORD.PATH].includes(element.kind)) {
        let points = element.points.map((point) => apply(matrix, point));
        if (element.kind !== RECORD.PATH && points.length > 2) {
          const first = points[0];
          const last = points.at(-1);
          if (last && first.x === last.x && first.y === last.y) points = points.slice(0, -1);
        }
        if (points.length >= (element.kind === RECORD.PATH ? 2 : 3)) {
          if (output.length >= maxShapes) throw new Error(`GDS expansion exceeds the ${maxShapes.toLocaleString()} shape safety limit.`);
          emittedPoints += points.length;
          if (emittedPoints > maxPoints) throw new Error(`GDS expansion exceeds the ${maxPoints.toLocaleString()} point safety limit.`);
          const scale = Math.hypot(matrix.a, matrix.b);
          output.push({
            kind: element.kind === RECORD.PATH ? "path" : "polygon",
            layer: element.layer,
            datatype: element.datatype,
            points: points.map((point) => ({
              x: point.x * model.unitMicrometers,
              y: point.y * model.unitMicrometers,
            })),
            width: element.width * scale * model.unitMicrometers,
            pathType: element.pathType,
          });
        }
      } else if (element.kind === RECORD.SREF && element.points[0]) {
        visit(element.sname, multiply(matrix, referenceMatrix(element.points[0], element)), [...stack, name]);
      } else if (element.kind === RECORD.AREF && element.points.length >= 3) {
        const arrayInstances = element.rows * element.columns;
        if (!Number.isSafeInteger(arrayInstances) || visitedInstances + arrayInstances > maxInstances) {
          throw new Error(`AREF ${element.columns} × ${element.rows} exceeds the ${maxInstances.toLocaleString()} instance safety limit.`);
        }
        const [origin, columnEnd, rowEnd] = element.points;
        const column = { x: (columnEnd.x - origin.x) / element.columns, y: (columnEnd.y - origin.y) / element.columns };
        const row = { x: (rowEnd.x - origin.x) / element.rows, y: (rowEnd.y - origin.y) / element.rows };
        for (let y = 0; y < element.rows; y += 1) {
          for (let x = 0; x < element.columns; x += 1) {
            const point = { x: origin.x + column.x * x + row.x * y, y: origin.y + column.y * x + row.y * y };
            visit(element.sname, multiply(matrix, referenceMatrix(point, element)), [...stack, name]);
          }
        }
      }
    }
  }

  visit(topCell, identity, []);
  if (!output.length) throw new Error(`Cell “${topCell}” contains no rasterizable BOUNDARY, BOX or PATH elements.`);
  return output;
}

export function boundsOf(shapes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    const margin = shape.kind === "path" ? shape.width / 2 : 0;
    for (const point of shape.points) {
      minX = Math.min(minX, point.x - margin);
      minY = Math.min(minY, point.y - margin);
      maxX = Math.max(maxX, point.x + margin);
      maxY = Math.max(maxY, point.y + margin);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Return the layout point used as the placement reference. */
export function placementAnchorOf(shapes, mode = "center") {
  if (!shapes.length) throw new Error("At least one shape is required for placement.");
  const bounds = boundsOf(shapes);
  if (mode === "gds-origin") return { x: 0, y: 0 };
  if (mode === "lower-left") return { x: bounds.minX, y: bounds.minY };
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Transform one physical GDS point into LCD-centred micrometre coordinates. */
export function transformPlacedPoint(point, anchor, settings) {
  let x = point.x - anchor.x;
  let y = point.y - anchor.y;
  if (settings.mirrorX) x *= -1;
  if (settings.mirrorY) y *= -1;
  if (settings.rotation === 90) [x, y] = [-y, x];
  else if (settings.rotation === 180) [x, y] = [-x, -y];
  else if (settings.rotation === 270) [x, y] = [y, -x];
  return { x: x + settings.offsetX, y: y + settings.offsetY };
}

/** Bounds after anchor selection, mirroring, rotation and translation. */
export function placedBoundsOf(shapes, settings) {
  const anchor = placementAnchorOf(shapes, settings.anchor);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    const margin = shape.kind === "path" ? shape.width / 2 : 0;
    for (const point of shape.points) {
      const placed = transformPlacedPoint(point, anchor, settings);
      minX = Math.min(minX, placed.x - margin);
      minY = Math.min(minY, placed.y - margin);
      maxX = Math.max(maxX, placed.x + margin);
      maxY = Math.max(maxY, placed.y + margin);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function fitsDisplay(shapes, settings, widthMicrometers, heightMicrometers) {
  const bounds = placedBoundsOf(shapes, settings);
  return bounds.minX >= -widthMicrometers / 2 && bounds.maxX <= widthMicrometers / 2
    && bounds.minY >= -heightMicrometers / 2 && bounds.maxY <= heightMicrometers / 2;
}

export function estimateMinimumFeature(shapes) {
  let minimum = Infinity;
  for (const shape of shapes) {
    if (shape.kind === "path" && shape.width > 0) minimum = Math.min(minimum, shape.width);
    else {
      const bounds = boundsOf([shape]);
      minimum = Math.min(minimum, bounds.width, bounds.height);
    }
  }
  return Number.isFinite(minimum) ? minimum : null;
}
