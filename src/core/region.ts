/**
 * Which cells of a selection box an operation actually touches. Filling a box
 * solid is only occasionally what you want — a room is walls, a frame is edges
 * — so the shell shapes live here rather than being four separate actions.
 */

import type { Build } from "./model";

export type FillMode = "solid" | "hollow" | "walls" | "outline" | "air";

export const FILL_MODES: { id: FillMode; label: string; hint: string }[] = [
  { id: "solid", label: "Solid", hint: "Every cell in the box" },
  { id: "hollow", label: "Hollow", hint: "The six faces, leaving the inside empty" },
  { id: "walls", label: "Walls", hint: "The four upright sides — no floor, no ceiling" },
  { id: "outline", label: "Outline", hint: "The twelve edges only" },
  { id: "air", label: "Into gaps", hint: "Only the cells that are empty right now" },
];

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Block indices inside `box` selected by `mode`. A box that is already flat on
 * an axis has no inside on that axis, so `hollow` on a single-layer slab is the
 * whole slab rather than nothing.
 */
export function regionCells(build: Build, box: Box, mode: FillMode): Uint32Array {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  const out: number[] = [];

  for (let y = y0; y <= y1; y++) {
    const edgeY = y === y0 || y === y1;
    for (let z = z0; z <= z1; z++) {
      const edgeZ = z === z0 || z === z1;
      const row = (y * build.length + z) * build.width;
      for (let x = x0; x <= x1; x++) {
        const edgeX = x === x0 || x === x1;
        let keep: boolean;
        switch (mode) {
          case "solid":
            keep = true;
            break;
          case "air":
            keep = build.data[row + x] === 0;
            break;
          case "hollow":
            keep = edgeX || edgeY || edgeZ;
            break;
          case "walls":
            keep = edgeX || edgeZ;
            break;
          case "outline":
            // An edge of the box is where two of the three axes are at a limit.
            keep = (edgeX ? 1 : 0) + (edgeY ? 1 : 0) + (edgeZ ? 1 : 0) >= 2;
            break;
        }
        if (keep) out.push(row + x);
      }
    }
  }
  return Uint32Array.from(out);
}

/** Inclusive size of a box, per axis. */
export function boxSize(box: Box): [number, number, number] {
  return [
    box.max[0] - box.min[0] + 1,
    box.max[1] - box.min[1] + 1,
    box.max[2] - box.min[2] + 1,
  ];
}
