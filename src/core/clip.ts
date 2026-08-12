/**
 * A detached box of blocks — what copy puts on the clipboard and the clone
 * tool stamps back down. It carries its own palette so it keeps working after
 * the build it came from has been edited.
 */

import { AIR, type BlockState, type Build } from "./model";

export interface Clip {
  width: number;
  height: number;
  length: number;
  /** Index 0 is always air, like a build's palette. */
  palette: BlockState[];
  /** Palette indices in YZX order, same layout as `Build.data`. */
  data: Uint16Array;
  /** Non-air blocks, for the readout. */
  count: number;
}

/** Lifts an inclusive box out of a build. */
export function extractClip(
  build: Build,
  min: [number, number, number],
  max: [number, number, number],
): Clip {
  const width = max[0] - min[0] + 1;
  const height = max[1] - min[1] + 1;
  const length = max[2] - min[2] + 1;
  const data = new Uint16Array(width * height * length);
  const palette: BlockState[] = [AIR];
  // Only the states the box actually uses come along, so a clip stays small
  // even when it was cut out of a build with a thousand-entry palette.
  const remap = new Map<number, number>([[0, 0]]);
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const value = build.at(min[0] + x, min[1] + y, min[2] + z);
        if (value === 0) continue;
        let mapped = remap.get(value);
        if (mapped === undefined) {
          mapped = palette.length;
          palette.push(copyState(build.palette[value]));
          remap.set(value, mapped);
        }
        data[(y * length + z) * width + x] = mapped;
        count++;
      }
    }
  }

  return { width, height, length, palette, data, count };
}

function copyState(state: BlockState): BlockState {
  return { name: state.name, properties: state.properties && { ...state.properties } };
}

/* ------------------------------------------------------------- transforms */

type Facing = "north" | "east" | "south" | "west";

/**
 * Everything a 90° turn or a mirror does to a blockstate, in one place: where
 * each compass direction ends up, whether the X/Z axes swap, how the 16-step
 * `rotation` property moves, and whether left and right change hands.
 */
interface Transform {
  dir: Record<Facing, Facing>;
  swapAxes: boolean;
  rotation: (value: number) => number;
  swapHand: boolean;
}

// `rotation` counts clockwise from south: 0 south, 4 west, 8 north, 12 east.
const CLOCKWISE: Transform = {
  dir: { north: "east", east: "south", south: "west", west: "north" },
  swapAxes: true,
  rotation: (r) => (r + 4) % 16,
  swapHand: false,
};

const MIRROR_X: Transform = {
  dir: { north: "north", east: "west", south: "south", west: "east" },
  swapAxes: false,
  rotation: (r) => (16 - r) % 16,
  swapHand: true,
};

const MIRROR_Z: Transform = {
  dir: { north: "south", east: "east", south: "north", west: "west" },
  swapAxes: false,
  rotation: (r) => (24 - r) % 16,
  swapHand: true,
};

const FACINGS: Facing[] = ["north", "east", "south", "west"];

function isFacing(value: string): value is Facing {
  return (FACINGS as string[]).includes(value);
}

/**
 * Rail and wall `shape` values name directions — `east_west`,
 * `ascending_north`, `south_east` — so they turn with everything else. Stair
 * shapes (`inner_left`) are relative to the block's own facing and only care
 * about handedness.
 */
function turnShape(shape: string, t: Transform): string {
  if (shape.startsWith("ascending_")) {
    const dir = shape.slice("ascending_".length);
    return isFacing(dir) ? `ascending_${t.dir[dir]}` : shape;
  }
  const parts = shape.split("_");
  if (parts.length === 2 && parts.every(isFacing)) {
    const mapped = (parts as Facing[]).map((p) => t.dir[p]);
    const ns = mapped.find((p) => p === "north" || p === "south");
    const ew = mapped.find((p) => p === "east" || p === "west");
    // `north_south` maps to itself or to `east_west`; corners keep the
    // north/south-then-east/west order Minecraft uses.
    if (ns && ew) return `${ns}_${ew}`;
    return mapped[0] === "north" || mapped[0] === "south" ? "north_south" : "east_west";
  }
  if (t.swapHand) {
    if (shape.endsWith("_left")) return `${shape.slice(0, -5)}_right`;
    if (shape.endsWith("_right")) return `${shape.slice(0, -6)}_left`;
  }
  return shape;
}

/** Turns one blockstate's properties, leaving anything orientation-free alone. */
function turnState(state: BlockState, t: Transform): BlockState {
  const props = state.properties;
  if (!props) return state;
  const next: Record<string, string> = {};
  let changed = false;

  for (const [key, value] of Object.entries(props)) {
    // Fences, walls, panes and redstone hang their connections off the four
    // compass names, so the property *keys* rotate rather than the values.
    if (isFacing(key)) {
      next[t.dir[key]] = value;
      if (t.dir[key] !== key) changed = true;
      continue;
    }
    if (key === "facing" && isFacing(value)) {
      next[key] = t.dir[value];
    } else if (key === "axis" && t.swapAxes && (value === "x" || value === "z")) {
      next[key] = value === "x" ? "z" : "x";
    } else if (key === "rotation") {
      const parsed = Number.parseInt(value, 10);
      next[key] = Number.isNaN(parsed) ? value : String(t.rotation(parsed));
    } else if (key === "shape") {
      next[key] = turnShape(value, t);
    } else if (key === "hinge" && t.swapHand) {
      next[key] = value === "left" ? "right" : value === "right" ? "left" : value;
    } else {
      next[key] = value;
    }
    if (next[key] !== value) changed = true;
  }

  return changed ? { name: state.name, properties: next } : state;
}

function turnPalette(clip: Clip, t: Transform): BlockState[] {
  return clip.palette.map((state, i) => (i === 0 ? AIR : turnState(state, t)));
}

/**
 * Property values that swap when a block is turned upside down. `half` on a
 * door is `lower`/`upper` rather than `bottom`/`top` and is deliberately absent:
 * flipping one half of a door on its own would only produce a broken door.
 */
const VERTICAL_FLIP: Record<string, Record<string, string>> = {
  half: { bottom: "top", top: "bottom" },
  type: { bottom: "top", top: "bottom" },
  facing: { up: "down", down: "up" },
  vertical_direction: { up: "down", down: "up" },
};

function flipStateVertically(state: BlockState): BlockState {
  const props = state.properties;
  if (!props) return state;
  const next: Record<string, string> = {};
  let changed = false;
  for (const [key, value] of Object.entries(props)) {
    const mapped = VERTICAL_FLIP[key]?.[value] ?? value;
    next[key] = mapped;
    if (mapped !== value) changed = true;
  }
  return changed ? { name: state.name, properties: next } : state;
}

/**
 * One blockstate reflected across an axis — what symmetry mode needs so the
 * mirrored half of a build gets stairs, doors and signs facing back the way
 * they came rather than copied verbatim.
 */
export function mirrorState(state: BlockState, axis: "x" | "y" | "z"): BlockState {
  if (axis === "y") return flipStateVertically(state);
  return turnState(state, axis === "x" ? MIRROR_X : MIRROR_Z);
}

/**
 * One blockstate turned a quarter clockwise about Y — the same turn a clip gets,
 * applied to a single state. The paint material's turn button and the R key run
 * on this, so a stair, a log and a wall's connections all turn by the one rule
 * rather than by a second set of tables in the orientation control.
 */
export function rotateStateY(state: BlockState): BlockState {
  return turnState(state, CLOCKWISE);
}

/** 90° clockwise about Y, seen from above. Width and length swap. */
export function rotateClipY(clip: Clip): Clip {
  const { width: w, height: h, length: l } = clip;
  const width = l;
  const length = w;
  const data = new Uint16Array(clip.data.length);
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        // (x, z) -> (l - 1 - z, x): a row along X becomes a row along Z.
        const nx = l - 1 - z;
        const nz = x;
        data[(y * length + nz) * width + nx] = clip.data[(y * l + z) * w + x];
      }
    }
  }
  return { width, height: h, length, palette: turnPalette(clip, CLOCKWISE), data, count: clip.count };
}

/** Mirrors across the given axis: `x` swaps east and west, `z` north and south. */
export function mirrorClip(clip: Clip, axis: "x" | "z"): Clip {
  const { width: w, height: h, length: l } = clip;
  const data = new Uint16Array(clip.data.length);
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        const nx = axis === "x" ? w - 1 - x : x;
        const nz = axis === "z" ? l - 1 - z : z;
        data[(y * l + nz) * w + nx] = clip.data[(y * l + z) * w + x];
      }
    }
  }
  const t = axis === "x" ? MIRROR_X : MIRROR_Z;
  return { width: w, height: h, length: l, palette: turnPalette(clip, t), data, count: clip.count };
}
