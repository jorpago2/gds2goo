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
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  WIDTH: 0x0f,
  XY: 0x10,
  ENDEL: 0x11,
  SNAME: 0x12,
  COLROW: 0x13,
  STRANS: 0x1a,
  MAG: 0x1b,
  ANGLE: 0x1c,
  PATHTYPE: 0x21,
  BOX: 0x2d,
  BOXTYPE: 0x2e,
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

  while (offset + 4 <= view.byteLength) {
    const length = view.getUint16(offset, false);
    if (length < 4 || offset + length > view.byteLength) {
      throw new Error(`Invalid GDS record at byte ${offset}.`);
    }
    const type = view.getUint8(offset + 2);
    const start = offset + 4;
    const end = offset + length;
    records += 1;

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
        mag: 1,
        angle: 0,
      };
    } else if (element && type === RECORD.LAYER) {
      element.layer = view.getInt16(start, false);
    } else if (element && (type === RECORD.DATATYPE || type === RECORD.BOXTYPE)) {
      element.datatype = view.getInt16(start, false);
    } else if (element && type === RECORD.WIDTH) {
      element.width = Math.abs(view.getInt32(start, false));
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
      element.reflect = Boolean(view.getUint16(start, false) & 0x8000);
    } else if (element && type === RECORD.MAG) {
      element.mag = real8(view, start);
    } else if (element && type === RECORD.ANGLE) {
      element.angle = real8(view, start);
    } else if (type === RECORD.ENDEL && element && structure) {
      structure.elements.push(element);
      element = null;
    }
    offset = end;
  }

  if (records === 0 || structures.size === 0) throw new Error("The file contains no readable GDSII structures.");
  const topCells = [...structures.keys()].filter((name) => !referenced.has(name));
  return {
    structures,
    topCells: topCells.length ? topCells : [...structures.keys()].slice(-1),
    unitMicrometers,
    records,
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
export function flattenGds(model, topCell) {
  /** @type {Shape[]} */
  const output = [];
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  function visit(name, matrix, stack) {
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
