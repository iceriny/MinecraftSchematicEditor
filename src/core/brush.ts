/**
 * The footprint a single click covers. One block at a time is right for detail
 * work and hopeless for a wall, so every block tool takes a size and a shape
 * and writes the whole cluster in one edit.
 */

import type { Build } from "./model";

export type BrushShape = "cube" | "sphere";

/** Widest brush the size control offers. */
export const MAX_BRUSH = 15;
/**
 * Widest push brush. Shoving a tree's canopy about wants a bigger footprint
 * than block work does — the brush has to hold a whole branch to move one.
 */
export const MAX_PUSH = 25;

/**
 * Brushes are odd-width only. An even width has no middle cell to sit on, so it
 * rounds to the same footprint as the odd size below it — offering both would
 * put two settings on the slider that draw exactly the same thing.
 */
export function snapOdd(size: number, max: number): number {
  const rounded = Math.round(size);
  const odd = rounded % 2 === 0 ? rounded + 1 : rounded;
  return Math.max(1, Math.min(max, odd));
}

export function snapBrushSize(size: number): number {
  return snapOdd(size, MAX_BRUSH);
}

export function snapPushSize(size: number): number {
  return snapOdd(size, MAX_PUSH);
}

export interface BrushOptions {
  /** Width in blocks: 1 is a single cell, 3 is a 3×3 cluster. */
  size: number;
  shape: BrushShape;
  /**
   * Collapses the brush to one slab. Placing against a face uses this so a
   * 5-wide brush paints a flat patch on the wall rather than a ball that buries
   * itself in it.
   */
  plane?: { axis: 0 | 1 | 2; value: number } | null;
}

/**
 * Block indices the brush covers, centred on `(cx, cy, cz)` and clipped to the
 * build. The centre comes first so callers that care about a single
 * representative cell — the stroke plane, the hover readout — can take `[0]`.
 */
export function brushIndices(
  build: Build,
  cx: number,
  cy: number,
  cz: number,
  { size, shape, plane }: BrushOptions,
): number[] {
  // Snapped against the widest brush anything asks for rather than the block
  // tools' own limit: the push brush shares this footprint and is allowed to be
  // bigger than the paint one.
  const width = snapOdd(size, MAX_PUSH);
  if (width === 1) {
    return build.inBounds(cx, cy, cz) ? [build.index(cx, cy, cz)] : [];
  }

  const radius = (width - 1) / 2;
  // Half a block of slack: it puts the sphere's equator through the middle of
  // the outermost cells instead of shaving them off.
  const limit = (radius + 0.5) * (radius + 0.5);
  const low = Math.ceil(-radius);
  const high = Math.floor(radius);

  const centre: [number, number, number] = [cx, cy, cz];
  const out: number[] = [];
  if (build.inBounds(cx, cy, cz)) out.push(build.index(cx, cy, cz));

  for (let dy = low; dy <= high; dy++) {
    if (plane?.axis === 1 && dy !== 0) continue;
    for (let dz = low; dz <= high; dz++) {
      if (plane?.axis === 2 && dz !== 0) continue;
      for (let dx = low; dx <= high; dx++) {
        if (plane?.axis === 0 && dx !== 0) continue;
        if (dx === 0 && dy === 0 && dz === 0) continue; // already pushed
        if (shape === "sphere" && dx * dx + dy * dy + dz * dz > limit) continue;
        const x = centre[0] + dx, y = centre[1] + dy, z = centre[2] + dz;
        if (!build.inBounds(x, y, z)) continue;
        out.push(build.index(x, y, z));
      }
    }
  }
  return out;
}

/** The axis a face normal points along, for pinning a place brush to that face. */
export function normalAxis(normal: { x: number; y: number; z: number }): 0 | 1 | 2 {
  if (Math.abs(Math.round(normal.x)) === 1) return 0;
  if (Math.abs(Math.round(normal.y)) === 1) return 1;
  return 2;
}
