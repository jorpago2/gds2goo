import { placementAnchorOf, transformPlacedPoint } from "./gds.js";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function fillPolygon(pixels, width, height, points, value) {
  if (points.length < 3) return;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (const point of points) {
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
  }
  const firstRow = clamp(Math.ceil(minimumY - 0.5), 0, height);
  const lastRow = clamp(Math.ceil(maximumY - 0.5), 0, height);

  for (let y = firstRow; y < lastRow; y += 1) {
    const pixelY = y + 0.5;
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if ((start.y <= pixelY && end.y > pixelY) || (end.y <= pixelY && start.y > pixelY)) {
        intersections.push(start.x + (pixelY - start.y) * (end.x - start.x) / (end.y - start.y));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const firstColumn = clamp(Math.ceil(intersections[index] - 0.5), 0, width);
      const lastColumn = clamp(Math.ceil(intersections[index + 1] - 0.5), 0, width);
      pixels.fill(value, y * width + firstColumn, y * width + lastColumn);
    }
  }
}

function fillCircle(pixels, width, height, center, radius, value) {
  const firstRow = clamp(Math.ceil(center.y - radius - 0.5), 0, height);
  const lastRow = clamp(Math.floor(center.y + radius - 0.5) + 1, 0, height);
  const radiusSquared = radius * radius;
  for (let y = firstRow; y < lastRow; y += 1) {
    const verticalDistance = y + 0.5 - center.y;
    const horizontalRadius = Math.sqrt(Math.max(0, radiusSquared - verticalDistance * verticalDistance));
    const firstColumn = clamp(Math.ceil(center.x - horizontalRadius - 0.5), 0, width);
    const lastColumn = clamp(Math.floor(center.x + horizontalRadius - 0.5) + 1, 0, width);
    pixels.fill(value, y * width + firstColumn, y * width + lastColumn);
  }
}

function lineIntersection(originA, directionA, originB, directionB) {
  const determinant = directionA.x * directionB.y - directionA.y * directionB.x;
  if (Math.abs(determinant) < 1e-12) return null;
  const deltaX = originB.x - originA.x;
  const deltaY = originB.y - originA.y;
  const distance = (deltaX * directionB.y - deltaY * directionB.x) / determinant;
  return { x: originA.x + distance * directionA.x, y: originA.y + distance * directionA.y };
}

function pathOutline(points, radius, pathType) {
  const segments = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0) {
      const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      segments.push({ start, end, direction, normal: { x: -direction.y * radius, y: direction.x * radius } });
    }
  }
  if (!segments.length) return null;

  const offsetJoin = (point, previous, next, side) => {
    const previousOffset = {
      x: point.x + previous.normal.x * side,
      y: point.y + previous.normal.y * side,
    };
    const nextOffset = {
      x: point.x + next.normal.x * side,
      y: point.y + next.normal.y * side,
    };
    const intersection = lineIntersection(previousOffset, previous.direction, nextOffset, next.direction);
    if (!intersection || Math.hypot(intersection.x - point.x, intersection.y - point.y) > radius * 10) {
      return [previousOffset, nextOffset];
    }
    return [intersection];
  };

  const first = segments[0];
  const last = segments.at(-1);
  const startShift = pathType === 2 ? { x: -first.direction.x * radius, y: -first.direction.y * radius } : { x: 0, y: 0 };
  const endShift = pathType === 2 ? { x: last.direction.x * radius, y: last.direction.y * radius } : { x: 0, y: 0 };
  const left = [{
    x: first.start.x + first.normal.x + startShift.x,
    y: first.start.y + first.normal.y + startShift.y,
  }];
  const right = [{
    x: first.start.x - first.normal.x + startShift.x,
    y: first.start.y - first.normal.y + startShift.y,
  }];

  for (let index = 1; index < segments.length; index += 1) {
    left.push(...offsetJoin(segments[index].start, segments[index - 1], segments[index], 1));
    right.push(...offsetJoin(segments[index].start, segments[index - 1], segments[index], -1));
  }
  left.push({ x: last.end.x + last.normal.x + endShift.x, y: last.end.y + last.normal.y + endShift.y });
  right.push({ x: last.end.x - last.normal.x + endShift.x, y: last.end.y - last.normal.y + endShift.y });
  return [...left, ...right.reverse()];
}

/**
 * Rasterize GDS geometry with an explicit pixel-centre rule. A pixel is on when
 * its centre lies inside the geometry, using a half-open boundary convention.
 */
export function rasterizeBinaryMask(shapes, settings, options) {
  const {
    width,
    height,
    fullWidth = width,
    fullHeight = height,
    offsetX = 0,
    offsetY = 0,
    pixelMicrometers,
  } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Raster dimensions must be positive integers.");
  }
  if (!(pixelMicrometers > 0)) throw new Error("Pixel pitch must be greater than zero.");
  if (!shapes.length) throw new Error("At least one shape is required for rasterization.");

  const background = settings.inverted ? 1 : 0;
  const foreground = background ? 0 : 1;
  const pixels = new Uint8Array(width * height);
  if (background) pixels.fill(background);
  const anchor = placementAnchorOf(shapes, settings.anchor);
  const map = (point) => {
    const placed = transformPlacedPoint(point, anchor, settings);
    return {
      x: fullWidth / 2 + placed.x / pixelMicrometers - offsetX,
      y: fullHeight / 2 - placed.y / pixelMicrometers - offsetY,
    };
  };

  for (const shape of shapes) {
    const points = shape.points.map(map);
    if (shape.kind === "polygon") {
      fillPolygon(pixels, width, height, points, foreground);
      continue;
    }
    const radius = Math.max(0.5, shape.width / pixelMicrometers / 2);
    const outline = pathOutline(points, radius, shape.pathType);
    if (!outline) continue;
    fillPolygon(pixels, width, height, outline, foreground);
    if (shape.pathType === 1) {
      fillCircle(pixels, width, height, points[0], radius, foreground);
      fillCircle(pixels, width, height, points.at(-1), radius, foreground);
    }
  }
  return pixels;
}

/** Create a nearest-neighbour, aspect-preserving GOO preview from native pixels. */
export function createMonochromePreview(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight, background = 0) {
  if (pixels.length !== sourceWidth * sourceHeight) throw new Error("The native mask has an invalid size.");
  const preview = new Uint16Array(targetWidth * targetHeight);
  if (background) preview.fill(0xffff);
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const left = (targetWidth - renderedWidth) / 2;
  const top = (targetHeight - renderedHeight) / 2;

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.floor((y + 0.5 - top) / scale);
    if (sourceY < 0 || sourceY >= sourceHeight) continue;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.floor((x + 0.5 - left) / scale);
      if (sourceX >= 0 && sourceX < sourceWidth) {
        preview[y * targetWidth + x] = pixels[sourceY * sourceWidth + sourceX] ? 0xffff : 0;
      }
    }
  }
  return preview;
}
