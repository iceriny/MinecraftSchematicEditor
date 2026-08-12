/**
 * Reading distances and centres off a build instead of counting blocks by eye.
 *
 * Block coordinates name cells, not points: cell `n` occupies the world span
 * `n .. n+1`. That distinction is the whole reason centring is fiddly by hand —
 * a box of even width has its centre on a seam between two blocks, not on one —
 * so both answers are given: where the centre actually falls, and which cell or
 * pair of cells straddles it.
 */

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Measurement {
  a: [number, number, number];
  b: [number, number, number];
  /** Signed steps from a to b: how far you would walk. */
  delta: [number, number, number];
  /** Inclusive block counts, the way a bill of materials counts them. */
  span: [number, number, number];
  /** Straight-line distance between the two cell centres. */
  straight: number;
  /** Distance along the axes, which is what a builder actually walks. */
  manhattan: number;
  /** Where the halfway point falls, in world coordinates. */
  midpoint: [number, number, number];
}

export function measure(
  a: [number, number, number],
  b: [number, number, number],
): Measurement {
  const delta = [0, 1, 2].map((i) => b[i] - a[i]) as [number, number, number];
  const span = delta.map((d) => Math.abs(d) + 1) as [number, number, number];
  const straight = Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2);
  const manhattan = Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]);
  // Cell centres sit half a block in, so the midpoint of two cells lands on a
  // whole or half coordinate in world terms.
  const midpoint = [0, 1, 2].map((i) => (a[i] + b[i]) / 2 + 0.5) as [number, number, number];
  return { a, b, delta, span, straight, manhattan, midpoint };
}

export interface AxisCentre {
  /** Where the centre falls in world coordinates. */
  world: number;
  /** The cell, or the pair of cells, the centre sits on or between. */
  cells: number[];
  /** True when the box is an even number of blocks and has no single middle. */
  even: boolean;
}

export interface Centre {
  axes: [AxisCentre, AxisCentre, AxisCentre];
  size: [number, number, number];
  /** Inclusive box of the centre column, full height of the source box. */
  column: Box;
}

/**
 * The centre of an inclusive block box. An odd span has one middle cell; an
 * even one has two, and the centre line runs between them — which is the answer
 * you need before deciding whether to shift the build a block to make it
 * symmetrical.
 */
export function centreOf(box: Box): Centre {
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i] + 1) as [number, number, number];
  const axes = [0, 1, 2].map((i) => {
    const even = size[i] % 2 === 0;
    const world = box.min[i] + size[i] / 2;
    const cells = even
      ? [box.min[i] + size[i] / 2 - 1, box.min[i] + size[i] / 2]
      : [box.min[i] + (size[i] - 1) / 2];
    return { world, cells, even };
  }) as [AxisCentre, AxisCentre, AxisCentre];

  return {
    axes,
    size,
    column: {
      min: [axes[0].cells[0], box.min[1], axes[2].cells[0]],
      max: [axes[0].cells[axes[0].cells.length - 1], box.max[1], axes[2].cells[axes[2].cells.length - 1]],
    },
  };
}

/**
 * The middle block itself, as a box. One cell per axis where the span is odd,
 * the two straddling the seam where it is even — so an all-odd box gives a
 * single block and an all-even one gives the 2×2×2 cluster around the middle.
 *
 * This is the answer to "which block is the centre"; {@link Centre.column} is
 * the taller answer, for standing a marker pillar up through the build.
 */
export function centreCell(box: Box): Box {
  const { axes } = centreOf(box);
  return {
    min: [axes[0].cells[0], axes[1].cells[0], axes[2].cells[0]],
    max: [0, 1, 2].map((i) => axes[i].cells[axes[i].cells.length - 1]) as [number, number, number],
  };
}

/** `12.5` or `12` — a centre reads better without a trailing `.0`. */
export function formatCentre(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
