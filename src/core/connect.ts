/**
 * Fences, panes, bars, walls and stairs joining up.
 *
 * These blocks carry their connections in the blockstate — `oak_fence[north=true,
 * east=true]`, `oak_stairs[shape=inner_left]` — and Minecraft never asks the
 * player for them: the game works them out from the neighbours the moment a
 * block is placed, and again whenever one of those neighbours changes. A
 * schematic editor has to do the same, or a fence comes out as a row of
 * unconnected posts and a staircase turns a corner with a square bite out of it.
 *
 * So every edit runs through {@link repairConnections}: it takes the cells an
 * edit is about to write, adds the ring of cells around them, and rewrites the
 * connections of anything in that set that has them. Because it works on the
 * pending write set rather than the applied build, the fixes ride along in the
 * same edit and undo with it.
 */

import { lookFor } from "./blockLook";
import { AIR, baseName, isAir, stateKey, type BlockState, type Build } from "./model";

type Kind = "fence" | "pane" | "wall" | "gate" | "stairs" | "none";

const SIDES = [
  { key: "north", dx: 0, dz: -1 },
  { key: "east", dx: 1, dz: 0 },
  { key: "south", dx: 0, dz: 1 },
  { key: "west", dx: -1, dz: 0 },
] as const;

type Side = (typeof SIDES)[number];

type Facing = (typeof SIDES)[number]["key"];

/** Step from a cell to its neighbour on the named side, as [dx, dz]. */
const STEP: Record<Facing, readonly [number, number]> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
};

const BACK: Record<Facing, Facing> = {
  north: "south", south: "north", east: "west", west: "east",
};

/** A quarter turn anticlockwise about Y — the side a `_left` shape names. */
const LEFT_OF: Record<Facing, Facing> = {
  north: "west", west: "south", south: "east", east: "north",
};

function isFacing(value: string | undefined): value is Facing {
  return value === "north" || value === "east" || value === "south" || value === "west";
}

function kindOf(id: string): Kind {
  if (id.endsWith("_fence_gate")) return "gate";
  if (id.endsWith("_fence")) return "fence";
  if (id.endsWith("_wall")) return "wall";
  if (id.endsWith("_pane") || id.endsWith("_bars")) return "pane";
  if (id.endsWith("_stairs")) return "stairs";
  return "none";
}

/**
 * Wooden fences join each other whatever the wood; the nether brick fence keeps
 * to its own kind, exactly as in the game.
 */
function fenceClass(id: string): string {
  return id.includes("nether_brick") ? "nether" : "wood";
}

/** A full cube worth connecting to. Air fills the whole cell but is not a block. */
function isSolid(state: BlockState): boolean {
  return !isAir(state.name) && lookFor(state).solid;
}

/**
 * Blocks whose shape fills the cube but which the game refuses to connect to —
 * a fence beside a pumpkin stays a post.
 */
const NO_CONNECT = new Set([
  "barrier", "carved_pumpkin", "jack_o_lantern", "pumpkin", "melon",
  "shulker_box", "beacon", "tinted_glass",
]);

function refuses(id: string): boolean {
  return NO_CONNECT.has(id) || id.endsWith("_shulker_box") || id.endsWith("_leaves");
}

/**
 * A gate's posts stand on the two sides square to the way it faces, so that is
 * where a fence or wall meets it.
 */
function gateFaces(gate: BlockState, side: Side): boolean {
  const facing = gate.properties?.facing ?? "north";
  const gateAlongZ = facing === "north" || facing === "south";
  const sideAlongZ = side.dz !== 0;
  return gateAlongZ !== sideAlongZ;
}

function connects(kind: Kind, selfId: string, neighbour: BlockState, side: Side): boolean {
  if (isAir(neighbour.name)) return false;
  const id = baseName(neighbour.name);
  const other = kindOf(id);

  if (kind === "fence") {
    // Fences keep to fences of their own material, gates square to them, and
    // anything solid. They do not join walls, which is a game rule rather than
    // an oversight — the two never met at the same height.
    if (other === "fence") return fenceClass(id) === fenceClass(selfId);
    if (other === "gate") return gateFaces(neighbour, side);
    if (other === "wall" || other === "pane") return false;
    return !refuses(id) && isSolid(neighbour);
  }

  if (kind === "pane") {
    if (other === "pane" || other === "wall") return true;
    if (other === "fence" || other === "gate") return false;
    return !refuses(id) && isSolid(neighbour);
  }

  // Walls.
  if (other === "wall" || other === "pane") return true;
  if (other === "gate") return gateFaces(neighbour, side);
  if (other === "fence") return false;
  return !refuses(id) && isSolid(neighbour);
}

/** Reads a cell of the build with the pending writes laid over it. */
type Reader = (x: number, y: number, z: number) => BlockState;

/* ---------------------------------------------------------------- stairs */

/** The two properties a stair's corner is worked out from. */
interface Stair {
  facing: Facing;
  half: string;
}

/**
 * A neighbour read as a stair, or null if it isn't one. Missing properties fall
 * back to the block's default state — schematics written from bare block ids
 * carry none at all, and `north`/`bottom` is what the game would hold.
 */
function asStair(state: BlockState): Stair | null {
  if (kindOf(baseName(state.name)) !== "stairs") return null;
  const facing = state.properties?.facing;
  return {
    facing: isFacing(facing) ? facing : "north",
    half: state.properties?.half === "top" ? "top" : "bottom",
  };
}

function sameAxis(a: Facing, b: Facing): boolean {
  return a === b || a === BACK[b];
}

/**
 * The corner a stair should be cut to, following the game's own rule.
 *
 * A stair turns where the flight either meets it head-on or leaves it sideways:
 * a stair in front of this one running across it takes a bite out of the outer
 * corner, one behind it running across adds the inner quarter back. Which of the
 * two `_left`/`_right` names applies is the side that other stair points to,
 * read as a quarter turn from this one's own facing.
 *
 * The extra `free` test is the part that keeps a run of three from collapsing:
 * a stair that already has an identical stair squarely across the turn is part
 * of a straight line rather than a corner, and stays straight.
 */
function stairShape(self: Stair, x: number, y: number, z: number, read: Reader): string {
  const at = (dir: Facing) => asStair(read(x + STEP[dir][0], y, z + STEP[dir][1]));
  const free = (dir: Facing) => {
    const other = at(dir);
    return !other || other.facing !== self.facing || other.half !== self.half;
  };

  const front = at(self.facing);
  if (front && front.half === self.half && !sameAxis(front.facing, self.facing)
      && free(BACK[front.facing])) {
    return front.facing === LEFT_OF[self.facing] ? "outer_left" : "outer_right";
  }

  const back = at(BACK[self.facing]);
  if (back && back.half === self.half && !sameAxis(back.facing, self.facing)
      && free(back.facing)) {
    return back.facing === LEFT_OF[self.facing] ? "inner_left" : "inner_right";
  }

  return "straight";
}

/**
 * The connection properties a block should be carrying, or null when it has
 * none. Only the computed properties are returned; everything else the state
 * holds — `waterlogged`, a gate's `facing` and `open` — is kept as it was.
 */
function connectionsOf(
  state: BlockState,
  x: number,
  y: number,
  z: number,
  read: Reader,
): Record<string, string> | null {
  const id = baseName(state.name);
  const kind = kindOf(id);
  if (kind === "none") return null;

  if (kind === "stairs") {
    const self = asStair(state);
    return self ? { shape: stairShape(self, x, y, z, read) } : null;
  }

  if (kind === "gate") {
    // A gate drops to meet a wall beside it, on either of its post sides.
    const inWall = SIDES.some(
      (side) =>
        gateFaces(state, side) &&
        kindOf(baseName(read(x + side.dx, y, z + side.dz).name)) === "wall",
    );
    return { in_wall: String(inWall) };
  }

  const joined = SIDES.map((side) => connects(kind, id, read(x + side.dx, y, z + side.dz), side));

  if (kind !== "wall") {
    const out: Record<string, string> = {};
    SIDES.forEach((side, i) => { out[side.key] = String(joined[i]); });
    return out;
  }

  // A wall grows to full height where something sits on top of it, and loses its
  // post where it runs straight through with nothing above — which is what makes
  // a long wall read as a wall rather than a line of pillars.
  const above = read(x, y + 1, z);
  const covered = !isAir(above.name) && (isSolid(above) || kindOf(baseName(above.name)) === "wall");
  const [north, east, south, west] = joined;
  const straight = (north && south && !east && !west) || (east && west && !north && !south);

  const out: Record<string, string> = { up: String(covered || !straight) };
  SIDES.forEach((side, i) => {
    out[side.key] = joined[i] ? (covered ? "tall" : "low") : "none";
  });
  return out;
}

/**
 * Whether this build has anything that connects at all. Checked before an edit
 * bothers collecting neighbours, so a build with no fences in it — and no fence
 * loaded to place — pays nothing for any of this.
 */
export function hasConnectors(build: Build): boolean {
  for (const state of build.palette) {
    if (state && kindOf(baseName(state.name)) !== "none") return true;
  }
  return false;
}

/**
 * Adds to `writes` whatever connection fixes the edit implies — for the cells
 * being written and for the ring of cells around them, since a fence already
 * standing has to reach out to a new neighbour just as the new one reaches back.
 */
export function repairConnections(build: Build, writes: Map<number, number>): void {
  if (writes.size === 0) return;

  // Which palette entries are even capable of connecting. Checked once here
  // rather than per cell: a wide fill touches far more cells than the palette
  // has entries, and the id parsing is the expensive part.
  let anyConnector = false;
  const kinds: Kind[] = build.palette.map((state) => {
    const kind = state ? kindOf(baseName(state.name)) : "none";
    if (kind !== "none") anyConnector = true;
    return kind;
  });
  if (!anyConnector) return;

  const read: Reader = (x, y, z) => {
    if (!build.inBounds(x, y, z)) return AIR;
    const index = build.index(x, y, z);
    const value = writes.get(index) ?? build.data[index];
    return build.palette[value] ?? AIR;
  };

  // The cells worth re-examining: everything written, plus its horizontal
  // neighbours, plus the cell under each written one — a block landing on top of
  // a wall is what turns that wall's sides tall.
  const candidates = new Set<number>();
  for (const index of writes.keys()) {
    const [x, y, z] = build.positionOf(index);
    candidates.add(index);
    for (const side of SIDES) {
      const nx = x + side.dx, nz = z + side.dz;
      if (build.inBounds(nx, y, nz)) candidates.add(build.index(nx, y, nz));
    }
    if (build.inBounds(x, y - 1, z)) candidates.add(build.index(x, y - 1, z));
  }

  for (const index of candidates) {
    const value = writes.get(index) ?? build.data[index];
    if (kinds[value] === undefined || kinds[value] === "none") continue;
    const state = build.palette[value];
    const [x, y, z] = build.positionOf(index);
    const wanted = connectionsOf(state, x, y, z, read);
    if (!wanted) continue;

    const next: BlockState = { name: state.name, properties: { ...state.properties, ...wanted } };
    if (stateKey(next) === stateKey(state)) continue;
    writes.set(index, build.paletteIndexFor(next));
  }
}
