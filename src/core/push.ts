/**
 * The push brush's arithmetic: which blocks the brush drags along with it, and
 * where they land.
 *
 * The whole behaviour rests on moving one cell at a time. A pointer that jumped
 * four blocks between two frames must not teleport its load four blocks — the
 * brush would sweep straight past everything in between and pick none of it up.
 * Stepping instead makes it a plough: each step re-reads what the brush covers,
 * so blocks it has already moved stay under it and fresh ones join the pile as
 * it reaches them.
 */

import { brushIndices, type BrushShape } from "./brush";
import type { Build } from "./model";

export interface PushOptions {
  /** Width of the brush in blocks. */
  size: number;
  shape: BrushShape;
}

export type Step = [number, number, number];

/**
 * Cap on the cells one pointer move may push through. A flick of the mouse
 * across a big build can span a hundred cells, and grinding out every one of
 * them would stall the frame for a gesture nobody could aim anyway.
 */
export const MAX_PUSH_STEPS = 24;

/**
 * The unit steps that walk `from` to `to`, always spending the axis with the
 * most ground left to cover. That interleaves a diagonal drag into a staircase
 * rather than doing all of one axis and then all of the next.
 */
export function pushSteps(from: Step, to: Step, limit = MAX_PUSH_STEPS): Step[] {
  const remaining: Step = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const steps: Step[] = [];
  while (steps.length < limit) {
    let axis = 0;
    for (let a = 1; a < 3; a++) {
      if (Math.abs(remaining[a]) > Math.abs(remaining[axis])) axis = a;
    }
    if (remaining[axis] === 0) break;
    const step: Step = [0, 0, 0];
    step[axis] = Math.sign(remaining[axis]);
    remaining[axis] -= step[axis];
    steps.push(step);
  }
  return steps;
}

/**
 * Moves everything the brush covers one cell along `step`, accumulating into
 * `writes` so a whole drag lands as one edit.
 *
 * Cells are read through `writes` first: several steps run inside a single
 * pointer move, and a block that has already shifted has to be found where it
 * now is rather than where the grid still says it was. Blocks whose next cell
 * would leave the build stay put — the box does not grow to meet them — and
 * whatever the load lands on is written over.
 *
 * Returns how many blocks moved.
 */
export function pushOnce(
  build: Build,
  centre: Step,
  step: Step,
  { size, shape }: PushOptions,
  writes: Map<number, number>,
): number {
  const moved: { from: number; to: number; value: number }[] = [];

  for (const from of brushIndices(build, centre[0], centre[1], centre[2], { size, shape })) {
    const value = writes.get(from) ?? build.data[from];
    if (value === 0) continue;
    const [x, y, z] = build.positionOf(from);
    const tx = x + step[0], ty = y + step[1], tz = z + step[2];
    if (!build.inBounds(tx, ty, tz)) continue;
    moved.push({ from, to: build.index(tx, ty, tz), value });
  }
  if (moved.length === 0) return 0;

  // Clear first, set second. Where the load overlaps itself — which is most of
  // it, one cell being a small move — the arriving block has to win, or the
  // pile would erase its own leading edge.
  for (const move of moved) writes.set(move.from, 0);
  for (const move of moved) writes.set(move.to, move.value);
  return moved.length;
}

/**
 * Snaps a drag to the axis it has travelled furthest along. Nudging a branch
 * straight up is a common thing to want and an awkward thing to aim, since the
 * brush otherwise follows the screen rather than the grid.
 */
export function axisLock(from: Step, to: Step): Step {
  const delta: Step = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  let axis = 0;
  for (let a = 1; a < 3; a++) {
    if (Math.abs(delta[a]) > Math.abs(delta[axis])) axis = a;
  }
  const out: Step = [...from];
  out[axis] = to[axis];
  return out;
}
