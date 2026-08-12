/**
 * Symmetry mode: every stroke repeated across one or more mirror planes.
 *
 * A cell is reflected by subtraction — `x' = pivot - x` — with the pivot held
 * as an integer so cells always land on cells rather than between them. The
 * plane itself sits at `(pivot + 1) / 2`: a block boundary when the pivot is
 * odd, the middle of a column when it is even. Both are wanted, which is why
 * the pivot rather than the plane is the stored value.
 */

export interface MirrorConfig {
  /** Which axes are mirrored, as X, Y, Z. */
  axes: [boolean, boolean, boolean];
  /** Reflection pivot per axis; see the note above on why it is an integer. */
  pivot: [number, number, number];
}

export const MIRROR_AXES = [
  { index: 0 as const, name: "X", className: "ax-x", hint: "Mirror east to west" },
  { index: 1 as const, name: "Y", className: "ax-y", hint: "Mirror up to down" },
  { index: 2 as const, name: "Z", className: "ax-z", hint: "Mirror north to south" },
];

export function mirrorActive(config: MirrorConfig): boolean {
  return config.axes[0] || config.axes[1] || config.axes[2];
}

/** The pivot that reflects a span of `size` blocks onto itself. */
export function centrePivot(size: [number, number, number]): [number, number, number] {
  return [size[0] - 1, size[1] - 1, size[2] - 1];
}

/** Where a pivot's plane sits in world coordinates. */
export function planePosition(pivot: number): number {
  return (pivot + 1) / 2;
}

export interface MirrorImage {
  position: [number, number, number];
  /** Axes flipped to reach it, so the blockstate can be turned to match. */
  flipped: [boolean, boolean, boolean];
}

/**
 * Every reflection of a cell, the cell itself excluded. One enabled axis gives
 * one image, two give three (four-way symmetry), three give seven.
 *
 * A cell sitting on a plane reflects onto itself along that axis, which would
 * otherwise produce duplicate images; those are dropped here so callers do not
 * have to think about it.
 */
export function mirrorImages(
  config: MirrorConfig,
  at: [number, number, number],
): MirrorImage[] {
  const out: MirrorImage[] = [];
  const seen = new Set<string>([`${at[0]},${at[1]},${at[2]}`]);

  // One image per non-empty subset of the enabled axes: the bits of `mask` say
  // which axes that image is flipped on.
  for (let mask = 1; mask < 8; mask++) {
    const position: [number, number, number] = [at[0], at[1], at[2]];
    const flipped: [boolean, boolean, boolean] = [false, false, false];
    let usable = true;
    for (let axis = 0; axis < 3; axis++) {
      if ((mask & (1 << axis)) === 0) continue;
      if (!config.axes[axis]) {
        usable = false;
        break;
      }
      position[axis] = config.pivot[axis] - at[axis];
      flipped[axis] = true;
    }
    if (!usable) continue;
    const key = `${position[0]},${position[1]},${position[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ position, flipped });
  }
  return out;
}

/** How many copies a stroke lands, counting the one under the pointer. */
export function mirrorCopies(config: MirrorConfig): number {
  let copies = 1;
  for (const on of config.axes) if (on) copies *= 2;
  return copies;
}
