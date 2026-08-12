/**
 * Fitting a staircase between two points. Stepping a flight out by hand is the
 * slowest thing in the editor — every tread is a click, and every one of them
 * has to carry the right `facing` — so the tool takes the bottom step and the
 * top step and works out the rest.
 *
 * A tread is one rise: the cut step block the foot lands on, plus `run - 1`
 * full blocks behind it when the flight is a gentle one. Minecraft stairs put
 * their tall half on the side named by `facing`, so `facing` is simply the
 * direction the flight climbs in.
 */

import type { BlockState } from "./model";

export type StairStyle = "stairs" | "blocks";
/** What goes underneath the treads: nothing, a single course, or a solid mass. */
export type StairSupport = "none" | "under" | "solid";
export type Facing = "north" | "east" | "south" | "west";

export const MAX_STAIR_WIDTH = 16;
/** Widest tread the fit will produce — past this it is a floor, not a stair. */
export const MAX_STAIR_RUN = 8;

export const STAIR_STYLES: { id: StairStyle; label: string; hint: string }[] = [
  { id: "stairs", label: "Stairs", hint: "Cut stair blocks, turned to face the climb" },
  { id: "blocks", label: "Blocks", hint: "Full blocks — a stepped ramp rather than stairs" },
];

export const STAIR_SUPPORTS: { id: StairSupport; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Treads only — a floating flight" },
  { id: "under", label: "One course", hint: "A single block under every tread" },
  { id: "solid", label: "Solid", hint: "Filled all the way down to the bottom step" },
];

export interface StairOptions {
  /** Blocks across, measured square to the climb. */
  width: number;
  /** Horizontal blocks per rise. 0 fits the run to the two points. */
  run: number;
  style: StairStyle;
  support: StairSupport;
  /** The step block — a `*_stairs` id gets `facing` and `half` filled in. */
  step: BlockState;
  /** Landings between steps on a gentle run, and everything underneath. */
  fill: BlockState;
}

export type StairKind = "step" | "tread" | "support";

export interface StairCell {
  x: number;
  y: number;
  z: number;
  state: BlockState;
  kind: StairKind;
}

export interface StairPlan {
  cells: StairCell[];
  /** Treads in the flight, counting both the bottom and the top one. */
  treads: number;
  /** Blocks climbed from the bottom step to the top one. */
  rise: number;
  /** Horizontal blocks per rise, after fitting or clamping. */
  run: number;
  width: number;
  facing: Facing;
  /** True when `run` was fitted to the two points rather than given. */
  fitted: boolean;
  /** Bottom step, then top step, after the two clicks were sorted by height. */
  from: [number, number, number];
  to: [number, number, number];
  /** Inclusive box the flight occupies, before the build's edges clip it. */
  min: [number, number, number];
  max: [number, number, number];
}

export type StairResult =
  | { ok: true; plan: StairPlan }
  | { ok: false; reason: string };

/** Direction of travel per compass point, as [x, z]. */
const FACING_VECTOR: Record<Facing, [number, number]> = {
  east: [1, 0],
  west: [-1, 0],
  south: [0, 1],
  north: [0, -1],
};

export function facingVector(facing: Facing): [number, number] {
  return FACING_VECTOR[facing];
}

function plain(state: BlockState): BlockState {
  return { name: state.name, properties: state.properties && { ...state.properties } };
}

/**
 * The step block, turned to face the climb. Anything that isn't a stair id is
 * left exactly as chosen — a flight of quartz slabs is a legitimate thing to
 * ask for and inventing a `facing` on it would only corrupt the state.
 */
function stepBlock(options: StairOptions, facing: Facing): BlockState {
  if (options.style !== "stairs" || !options.step.name.endsWith("_stairs")) {
    return plain(options.step);
  }
  // `shape` is written out rather than left to default. A straight flight is
  // straight, and Minecraft's own states always carry it — leaving it off makes
  // the state ambiguous to anything matching on properties, this editor's model
  // resolver included.
  return {
    name: options.step.name,
    properties: { ...options.step.properties, facing, half: "bottom", shape: "straight" },
  };
}

/**
 * Works a flight out from the two clicked cells. Both are treated as step
 * blocks — the bottom one and the top one — so what you clicked is where the
 * stairs actually start and stop.
 */
export function planStairs(
  a: [number, number, number],
  b: [number, number, number],
  options: StairOptions,
): StairResult {
  // Clicking top-then-bottom is as natural as the other way round; the flight
  // always climbs, so the lower point is the one it starts from.
  const [lo, hi] = a[1] <= b[1] ? [a, b] : [b, a];
  const rise = hi[1] - lo[1];
  if (rise === 0) {
    return {
      ok: false,
      reason: "Both points are on the same level. Click the bottom step and the top step of the flight.",
    };
  }

  const dx = hi[0] - lo[0];
  const dz = hi[2] - lo[2];
  // The longer of the two horizontal deltas is the one the flight travels
  // along; a staircase that turned corners would be two flights, not one.
  const axis: 0 | 2 = Math.abs(dx) >= Math.abs(dz) ? 0 : 2;
  const delta = axis === 0 ? dx : dz;
  if (delta === 0) {
    return {
      ok: false,
      reason: "Both points are in the same column. Give the flight somewhere to travel — offset the top step from the bottom one.",
    };
  }

  const sign = delta > 0 ? 1 : -1;
  const facing: Facing =
    axis === 0 ? (sign > 0 ? "east" : "west") : sign > 0 ? "south" : "north";
  const span = Math.abs(delta);

  const fitted = options.run <= 0;
  const run = fitted
    ? Math.max(1, Math.min(MAX_STAIR_RUN, Math.round(span / rise)))
    : Math.max(1, Math.min(MAX_STAIR_RUN, Math.floor(options.run)));

  const width = Math.max(1, Math.min(MAX_STAIR_WIDTH, Math.floor(options.width)));
  // Centred on the clicked line, so widening a flight grows it either side
  // rather than walking it off to one hand.
  const sideStart = -((width - 1) >> 1);
  const sideAxis: 0 | 2 = axis === 0 ? 2 : 0;

  const stepState = stepBlock(options, facing);
  const treadState = options.style === "blocks" ? plain(options.step) : plain(options.fill);
  const fillState = plain(options.fill);

  const cells: StairCell[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const push = (x: number, y: number, z: number, state: BlockState, kind: StairKind) => {
    cells.push({ x, y, z, state, kind });
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  };

  for (let i = 0; i <= rise; i++) {
    const y = lo[1] + i;
    // The top tread is where the click landed, so it gets its step block and
    // nothing beyond it — a landing there would overshoot what was asked for.
    const treadLength = i === rise ? 1 : run;
    for (let j = 0; j < treadLength; j++) {
      const along = i * run + j;
      const x = lo[0] + (axis === 0 ? sign * along : 0);
      const z = lo[2] + (axis === 2 ? sign * along : 0);
      for (let w = 0; w < width; w++) {
        const off = sideStart + w;
        const cx = x + (sideAxis === 0 ? off : 0);
        const cz = z + (sideAxis === 2 ? off : 0);
        push(cx, y, cz, j === 0 ? stepState : treadState, j === 0 ? "step" : "tread");

        if (options.support === "under") {
          push(cx, y - 1, cz, fillState, "support");
        } else if (options.support === "solid") {
          for (let sy = y - 1; sy >= lo[1]; sy--) push(cx, sy, cz, fillState, "support");
        }
      }
    }
  }

  return {
    ok: true,
    plan: {
      cells,
      treads: rise + 1,
      rise,
      run,
      width,
      facing,
      fitted,
      from: [lo[0], lo[1], lo[2]],
      to: [hi[0], hi[1], hi[2]],
      min,
      max,
    },
  };
}

/** One-line summary of what a plan will lay down, for the panel and the notice. */
export function describeStairs(plan: StairPlan): string {
  const grade = plan.run === 1 ? "1:1" : `1:${plan.run}`;
  return `${plan.treads} treads · rise ${plan.rise} · ${grade} · ${plan.width} wide · ${plan.facing}`;
}
