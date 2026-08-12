/**
 * Which properties turn a block, and what the clicked face says about them.
 *
 * Orientation lives in the blockstate — `oak_stairs[facing=east,half=top]`,
 * `oak_log[axis=x]` — so the only way to set one used to be typing the whole
 * state into the picker. This is the table behind the orientation control: per
 * block family, the properties worth turning, and the rule for reading them off
 * the face a click landed on.
 *
 * Nothing here invents a property a block does not have. Values are checked
 * against the family's own list before they are written, so a rule that would
 * put `facing=up` on a stair, or `half=top` on a door, writes nothing instead.
 */

import { mirrorState, rotateStateY } from "./clip";
import { baseName, type BlockState } from "./model";

/** How a property's values are offered in the panel. */
export type OrientKind = "compass" | "row" | "toggle" | "select";

export interface OrientValue {
  value: string;
  label: string;
  hint?: string;
}

export interface OrientProp {
  key: string;
  label: string;
  kind: OrientKind;
  values: OrientValue[];
  /** What the block behaves as when the property is absent from the state. */
  fallback: string;
}

/**
 * Where each property comes from when a block is placed against a face. Every
 * field is optional: a family only opts into the readings that make sense for
 * it, and anything it leaves out keeps whatever the paint material already says.
 */
export interface FaceRule {
  /**
   * `look` turns the block away from the camera (stairs climb away from you),
   * `front` turns its front towards the camera (a chest opens to face you), and
   * `normal` points it out of the surface it was placed against (a torch, a
   * piston head). `normal` falls back to the camera when the face is horizontal
   * and the block cannot point up or down.
   */
  facing?: "look" | "front" | "normal";
  /** `half` or `type`: a click under a block gives the top half. */
  half?: "half" | "type";
  /** `axis` follows the axis of the face that was clicked. */
  axis?: boolean;
  /** `face=floor|wall|ceiling`, for buttons and levers. */
  face?: boolean;
  /** `attachment=floor|ceiling|single_wall`, for bells. */
  attachment?: boolean;
  /** `hanging`, for lanterns under a ceiling. */
  hanging?: boolean;
  /** `vertical_direction`, for pointed dripstone. */
  verticalDirection?: boolean;
  /** The 16-step `rotation` of a standing sign, turned to face the camera. */
  rotation?: boolean;
}

export interface Orientation {
  props: OrientProp[];
  face: FaceRule;
  /** Said in the panel, where a block has properties nobody chooses by hand. */
  note?: string;
}

/* ------------------------------------------------------------ value tables */

const FACING_4: OrientValue[] = [
  { value: "north", label: "N", hint: "north  ·  −Z" },
  { value: "east", label: "E", hint: "east  ·  +X" },
  { value: "south", label: "S", hint: "south  ·  +Z" },
  { value: "west", label: "W", hint: "west  ·  −X" },
];

const FACING_6: OrientValue[] = [
  ...FACING_4,
  { value: "up", label: "Up", hint: "up  ·  +Y" },
  { value: "down", label: "Dn", hint: "down  ·  −Y" },
];

/** Hoppers point down or sideways, never up. */
const FACING_5: OrientValue[] = [
  ...FACING_4,
  { value: "down", label: "Dn", hint: "down  ·  −Y" },
];

const HALVES: OrientValue[] = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
];

const SLAB_TYPES: OrientValue[] = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "double", label: "Double", hint: "Both halves — a full block" },
];

const DOOR_HALVES: OrientValue[] = [
  { value: "lower", label: "Lower" },
  { value: "upper", label: "Upper" },
];

const AXES: OrientValue[] = [
  { value: "x", label: "X", hint: "Lying east–west" },
  { value: "y", label: "Y", hint: "Standing upright" },
  { value: "z", label: "Z", hint: "Lying north–south" },
];

const BOOL: OrientValue[] = [
  { value: "false", label: "No" },
  { value: "true", label: "Yes" },
];

const HINGES: OrientValue[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

const MOUNT_FACES: OrientValue[] = [
  { value: "floor", label: "Floor" },
  { value: "wall", label: "Wall" },
  { value: "ceiling", label: "Ceiling" },
];

const BELL_ATTACHMENTS: OrientValue[] = [
  { value: "floor", label: "Floor" },
  { value: "ceiling", label: "Ceiling" },
  { value: "single_wall", label: "Wall" },
  { value: "double_wall", label: "Two walls" },
];

const BED_PARTS: OrientValue[] = [
  { value: "foot", label: "Foot" },
  { value: "head", label: "Head" },
];

const DRIPSTONE_DIRECTIONS: OrientValue[] = [
  { value: "up", label: "Up", hint: "Growing from the floor" },
  { value: "down", label: "Down", hint: "Hanging from the ceiling" },
];

const DRIPSTONE_THICKNESS: OrientValue[] = [
  { value: "tip", label: "Tip" },
  { value: "frustum", label: "Frustum" },
  { value: "middle", label: "Middle" },
  { value: "base", label: "Base" },
  { value: "tip_merge", label: "Tip merge" },
];

/** `rotation` counts clockwise from south in sixteenths of a turn. */
const ROTATION_16: OrientValue[] = Array.from({ length: 16 }, (_, i) => {
  const compass = ["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE"][i];
  return { value: String(i), label: `${i} · ${compass}` };
});

const RAIL_SHAPES: OrientValue[] = [
  { value: "north_south", label: "North–south" },
  { value: "east_west", label: "East–west" },
  { value: "ascending_north", label: "Rising north" },
  { value: "ascending_south", label: "Rising south" },
  { value: "ascending_east", label: "Rising east" },
  { value: "ascending_west", label: "Rising west" },
];

/** Only plain rail curves. */
const RAIL_CURVES: OrientValue[] = [
  ...RAIL_SHAPES,
  { value: "south_east", label: "Curve south–east" },
  { value: "south_west", label: "Curve south–west" },
  { value: "north_west", label: "Curve north–west" },
  { value: "north_east", label: "Curve north–east" },
];

/* ------------------------------------------------------------ prop builders */

const facing = (values = FACING_4, label = "Facing"): OrientProp =>
  ({ key: "facing", label, kind: "compass", values, fallback: "north" });

const row = (key: string, label: string, values: OrientValue[], fallback: string): OrientProp =>
  ({ key, label, kind: "row", values, fallback });

const toggle = (key: string, label: string, fallback = "false"): OrientProp =>
  ({ key, label, kind: "toggle", values: BOOL, fallback });

const select = (key: string, label: string, values: OrientValue[], fallback: string): OrientProp =>
  ({ key, label, kind: "select", values, fallback });

/**
 * Only offered to families where every member takes it. A mixed family — six-way
 * facing covers both the waterloggable lightning rod and the shulker box that
 * isn't — leaves it off, since writing `waterlogged` onto a block without one
 * makes a state no exporter can round-trip.
 */
const WATERLOGGED = toggle("waterlogged", "Waterlogged");

/** The four connection properties fences, panes and walls hang off. */
function sides(values: OrientValue[], fallback: string): OrientProp[] {
  return [
    row("north", "North", values, fallback),
    row("east", "East", values, fallback),
    row("south", "South", values, fallback),
    row("west", "West", values, fallback),
  ];
}

/* ---------------------------------------------------------------- families */

interface Family {
  match: (id: string) => boolean;
  props: OrientProp[];
  face: FaceRule;
  note?: string;
}

/**
 * Said of the blocks whose shape comes from their neighbours rather than from a
 * choice. Offering their connection properties as controls would only be offering
 * settings that the next edit overwrites — see {@link ./connect}.
 */
const JOINS_ITSELF = "Which sides it joins is worked out from the blocks around it.";

/** Blocks that lie down on an axis without being logs. */
const PILLARS = new Set([
  "quartz_pillar", "purpur_pillar", "bone_block", "basalt", "polished_basalt",
  "deepslate", "infested_deepslate", "hay_block", "chain", "bamboo_block",
  "stripped_bamboo_block", "muddy_mangrove_roots", "ochre_froglight",
  "verdant_froglight", "pearlescent_froglight",
]);

/** Six-way `facing`: it points wherever it was stuck. */
const SIX_WAY = new Set([
  "observer", "piston", "sticky_piston", "piston_head", "moving_piston",
  "dispenser", "dropper", "end_rod", "lightning_rod", "barrel",
  "amethyst_cluster", "small_amethyst_bud", "medium_amethyst_bud",
  "large_amethyst_bud", "command_block", "chain_command_block",
  "repeating_command_block",
]);

/**
 * Four-way `facing` where the *front* is the side that turns to the camera.
 * Workstations without a `facing` at all — jukebox, smithing table, beacon —
 * are deliberately absent: offering a turn for them would write a property the
 * block does not have and no exporter could round-trip.
 */
const FRONT_FACING = new Set([
  "furnace", "blast_furnace", "smoker", "chest", "trapped_chest", "ender_chest",
  "carved_pumpkin", "jack_o_lantern", "loom", "lectern", "beehive", "bee_nest",
  "anvil", "chipped_anvil", "damaged_anvil", "stonecutter", "campfire",
  "soul_campfire", "chiseled_bookshelf", "cocoa", "big_dripleaf",
  "small_dripleaf", "repeater", "comparator",
]);

/** Mounted on the surface behind it, so `facing` points out of that surface. */
const WALL_MOUNTED = /(^|_)wall_(sign|hanging_sign|banner|torch|fan|head|skull)$/;

/** Standing signs, banners and heads turn in sixteenths rather than quarters. */
const ROTATED = /(^|_)(sign|hanging_sign|banner|head|skull)$/;

const ends = (id: string, ...suffixes: string[]) => suffixes.some((s) => id.endsWith(s));

/**
 * First match wins, so the order is the specification: `oak_wall_sign` has to
 * be caught before `_sign`, `_fence_gate` before `_fence`, and `melon_stem`
 * kept clear of the log family it would otherwise land in.
 */
const FAMILIES: Family[] = [
  {
    match: (id) => ends(id, "_stairs"),
    props: [facing(), row("half", "Half", HALVES, "bottom"), WATERLOGGED],
    face: { facing: "look", half: "half" },
    // The `shape` control that used to sit here was a setting the next edit
    // overwrote: a stair's corner is cut from the flight around it, not chosen.
    note: "Whether it cuts a corner is worked out from the stairs around it.",
  },
  {
    match: (id) => ends(id, "_slab"),
    props: [row("type", "Half", SLAB_TYPES, "bottom"), WATERLOGGED],
    face: { half: "type" },
  },
  {
    match: (id) => ends(id, "_trapdoor"),
    props: [facing(), row("half", "Half", HALVES, "bottom"),
      toggle("open", "Open"), WATERLOGGED],
    face: { facing: "look", half: "half" },
  },
  {
    match: (id) => ends(id, "_fence_gate"),
    props: [facing(), toggle("open", "Open")],
    face: { facing: "look" },
  },
  {
    match: (id) => ends(id, "_door"),
    props: [facing(), row("hinge", "Hinge", HINGES, "left"),
      row("half", "Half", DOOR_HALVES, "lower"), toggle("open", "Open")],
    face: { facing: "look" },
  },
  {
    match: (id) => WALL_MOUNTED.test(id) || id === "tripwire_hook",
    props: [facing(FACING_4, "Points")],
    face: { facing: "normal" },
  },
  {
    match: (id) => ROTATED.test(id),
    props: [select("rotation", "Turn", ROTATION_16, "0")],
    face: { rotation: true },
  },
  {
    match: (id) => ends(id, "_wall", "_fence", "_pane", "_bars"),
    props: [WATERLOGGED],
    face: {},
    note: JOINS_ITSELF,
  },
  {
    match: (id) => id === "vine",
    props: [toggle("up", "Up"), ...sides(BOOL, "false")],
    face: {},
  },
  {
    match: (id) => id === "glow_lichen" || id === "sculk_vein" || ends(id, "_lichen"),
    props: [toggle("up", "Up"), toggle("down", "Down"),
      ...sides(BOOL, "false"), WATERLOGGED],
    face: {},
  },
  {
    match: (id) => ends(id, "_button") || id === "lever",
    props: [row("face", "Mounted on", MOUNT_FACES, "wall"), facing()],
    face: { face: true, facing: "normal" },
  },
  {
    match: (id) => id === "grindstone",
    props: [row("face", "Mounted on", MOUNT_FACES, "wall"), facing()],
    face: { face: true, facing: "normal" },
  },
  {
    match: (id) => id === "bell",
    props: [row("attachment", "Hung from", BELL_ATTACHMENTS, "floor"), facing()],
    face: { attachment: true, facing: "normal" },
  },
  {
    match: (id) => id === "ladder",
    props: [facing(FACING_4, "Points"), WATERLOGGED],
    face: { facing: "normal" },
  },
  {
    match: (id) => id === "lantern" || id === "soul_lantern",
    props: [toggle("hanging", "Hanging"), WATERLOGGED],
    face: { hanging: true },
  },
  {
    match: (id) => id === "pointed_dripstone",
    props: [row("vertical_direction", "Grows", DRIPSTONE_DIRECTIONS, "up"),
      select("thickness", "Thickness", DRIPSTONE_THICKNESS, "tip"), WATERLOGGED],
    face: { verticalDirection: true },
  },
  {
    match: (id) => id === "rail",
    props: [select("shape", "Shape", RAIL_CURVES, "north_south"), WATERLOGGED],
    face: {},
  },
  {
    match: (id) => ends(id, "_rail"),
    props: [select("shape", "Shape", RAIL_SHAPES, "north_south"), WATERLOGGED],
    face: {},
  },
  {
    match: (id) => id === "hopper",
    props: [facing(FACING_5, "Spout")],
    face: { facing: "normal" },
  },
  {
    match: (id) => ends(id, "_bed"),
    props: [facing(), row("part", "Part", BED_PARTS, "foot")],
    face: { facing: "front" },
  },
  {
    match: (id) =>
      ends(id, "_log", "_wood", "_hyphae") ||
      (ends(id, "_stem") && !ends(id, "melon_stem", "pumpkin_stem")) ||
      PILLARS.has(id),
    props: [row("axis", "Lying along", AXES, "y")],
    face: { axis: true },
  },
  {
    match: (id) => SIX_WAY.has(id) || ends(id, "_shulker_box") || id === "shulker_box",
    props: [facing(FACING_6, "Points")],
    face: { facing: "normal" },
  },
  {
    match: (id) => FRONT_FACING.has(id) || ends(id, "_glazed_terracotta"),
    props: [facing(FACING_4, "Front")],
    face: { facing: "front" },
  },
];

/* ---------------------------------------------------------------- read-out */

const cache = new Map<string, Orientation | null>();

/** The orientable properties of a block, or null when it has none. */
export function orientationOf(state: BlockState): Orientation | null {
  const id = baseName(state.name);
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const family = FAMILIES.find((entry) => entry.match(id)) ?? null;
  const found = family
    ? { props: family.props, face: family.face, note: family.note }
    : null;
  cache.set(id, found);
  return found;
}

export function isOrientable(state: BlockState): boolean {
  return orientationOf(state) !== null;
}

/** The value in force for a property: what the state says, or the fallback. */
export function propertyValue(state: BlockState, prop: OrientProp): string {
  return state.properties?.[prop.key] ?? prop.fallback;
}

/**
 * The state with one property set. Only the property touched is written — the
 * rest are left absent rather than filled in with defaults, so a state stays as
 * short as what was actually chosen and the model resolver's own defaults cover
 * the gaps.
 */
export function withProperty(state: BlockState, key: string, value: string): BlockState {
  if (state.properties?.[key] === value) return state;
  return { name: state.name, properties: { ...state.properties, [key]: value } };
}

/**
 * Strips every orientation property, back to the plain block — the way out of a
 * state that has been fiddled into a corner, without a trip back through the
 * picker. Properties outside this family's list are left alone.
 */
export function withoutOrientation(state: BlockState): BlockState {
  const orientation = orientationOf(state);
  const props = state.properties;
  if (!orientation || !props) return state;
  const keys = new Set(orientation.props.map((prop) => prop.key));
  const next: Record<string, string> = {};
  let stripped = false;
  for (const [key, value] of Object.entries(props)) {
    if (keys.has(key)) stripped = true;
    else next[key] = value;
  }
  // Returning the state itself when there was nothing to strip is what lets the
  // panel tell whether the control has anything left to do.
  if (!stripped) return state;
  return Object.keys(next).length ? { name: state.name, properties: next } : { name: state.name };
}

/* --------------------------------------------------------- turn and flip */

/** Properties a quarter turn about Y can move. */
const TURNABLE = ["facing", "axis", "shape", "rotation", "hinge", "north", "east", "south", "west"];

/** Properties turning a block upside down can move. */
const FLIPPABLE = ["half", "type", "facing", "vertical_direction", "hanging"];

/**
 * The state with the properties a turn is about to act on written out. A block
 * picked straight from the list carries no properties at all, and a turn applied
 * to nothing comes back unchanged — so the values already in force are written
 * down first and the turn then has something to move.
 */
function seed(state: BlockState, keys: string[]): BlockState {
  const orientation = orientationOf(state);
  if (!orientation) return state;
  let next = state;
  for (const prop of orientation.props) {
    if (!keys.includes(prop.key)) continue;
    if (next.properties?.[prop.key] !== undefined) continue;
    next = withProperty(next, prop.key, prop.fallback);
  }
  return next;
}

function offersKey(state: BlockState, key: string): boolean {
  return !!orientationOf(state)?.props.some((prop) => prop.key === key);
}

/**
 * One step round. A block with a `facing` turns a quarter clockwise, as a whole
 * clip does; a log or a pillar — whose only orientation is which way it lies —
 * steps to the next axis instead, since turning an upright log about Y leaves it
 * exactly where it was.
 */
export function turnOrientation(state: BlockState): BlockState {
  if (!isOrientable(state)) return state;
  if (offersKey(state, "axis") && !offersKey(state, "facing")) {
    const order = ["y", "x", "z"];
    const current = state.properties?.axis ?? "y";
    const at = order.indexOf(current);
    return withProperty(state, "axis", order[(at + 1) % order.length]);
  }
  const seeded = seed(state, TURNABLE);
  const turned = rotateStateY(seeded);
  // Seeding writes down the values already in force so the turn has something to
  // move. When the turn moves nothing after all, that write goes back rather than
  // being left behind as a property nobody asked for.
  return turned === seeded ? state : turned;
}

/** Upside down: a bottom slab becomes a top one, a stair hangs from the ceiling. */
export function flipOrientation(state: BlockState): BlockState {
  if (!isOrientable(state)) return state;
  // A lantern is flipped by where it is fixed rather than by a mirrored
  // property, so it is turned over here rather than by the shared reflection.
  if (offersKey(state, "hanging")) {
    const hanging = (state.properties?.hanging ?? "false") === "true";
    return withProperty(state, "hanging", hanging ? "false" : "true");
  }
  const seeded = seed(state, FLIPPABLE);
  const flipped = mirrorState(seeded, "y");
  return flipped === seeded ? state : flipped;
}

/** True when a turn or a flip would actually change this block. */
export function canTurn(state: BlockState): boolean {
  return isOrientable(state) && TURNABLE.some((key) => offersKey(state, key));
}

/**
 * A `facing` counts only while it already points up or down, since that is all a
 * flip can swap: a piston aimed east is turned by the compass, not by being
 * stood on its head. Anything else would be a control that does nothing.
 */
export function canFlip(state: BlockState): boolean {
  const orientation = orientationOf(state);
  if (!orientation) return false;
  return orientation.props.some((prop) => {
    if (prop.key === "half" || prop.key === "type") return true;
    if (prop.key === "vertical_direction" || prop.key === "hanging") return true;
    if (prop.key !== "facing") return false;
    const value = propertyValue(state, prop);
    return value === "up" || value === "down";
  });
}

/* ------------------------------------------------------- face orientation */

export type Direction = [number, number, number];

const COMPASS: { name: string; vector: Direction }[] = [
  { name: "north", vector: [0, 0, -1] },
  { name: "south", vector: [0, 0, 1] },
  { name: "east", vector: [1, 0, 0] },
  { name: "west", vector: [-1, 0, 0] },
];

/** The compass name of a horizontal direction, or null when it is vertical. */
function compassOf(direction: Direction): string | null {
  const found = COMPASS.find(
    ({ vector }) => vector[0] === Math.sign(direction[0]) && vector[2] === Math.sign(direction[2]),
  );
  return found?.name ?? null;
}

/** `rotation` values by the direction the front ends up looking. */
const ROTATION_BY_FACING: Record<string, string> = {
  south: "0", west: "4", north: "8", east: "12",
};

/**
 * The paint material turned to suit the face that was clicked.
 *
 * `normal` is the face's own direction — where the new block sits relative to
 * what was clicked — and `forward` is the way the camera looks, snapped to a
 * grid axis. Between them they stand in for Minecraft's own placement rules:
 * what a block is stuck to decides the properties that surface can dictate, and
 * the camera stands in for the player's yaw for the ones it cannot.
 *
 * Values are checked against the family's own list, so a family that cannot
 * take a reading simply does not get one.
 */
export function orientToFace(
  state: BlockState,
  normal: Direction,
  forward: Direction,
): BlockState {
  const orientation = orientationOf(state);
  if (!orientation) return state;
  const { props, face } = orientation;

  const up = Math.sign(normal[1]);
  const patch: Record<string, string> = {};

  if (face.axis) patch.axis = up !== 0 ? "y" : Math.sign(normal[0]) !== 0 ? "x" : "z";
  // Only a horizontal surface says which half a block wants. Minecraft reads
  // the rest off where on the face the click landed, which is finer than the
  // cell the picker reports, so a side face leaves the half as it was set.
  if (face.half && up !== 0) patch[face.half] = up < 0 ? "top" : "bottom";
  if (face.face) patch.face = up > 0 ? "floor" : up < 0 ? "ceiling" : "wall";
  if (face.attachment) patch.attachment = up > 0 ? "floor" : up < 0 ? "ceiling" : "single_wall";
  if (face.hanging) patch.hanging = up < 0 ? "true" : "false";
  if (face.verticalDirection) patch.vertical_direction = up < 0 ? "down" : "up";

  if (face.facing) {
    if (face.facing === "normal") {
      // Out of the surface it was placed against; a block that cannot point up
      // or down falls back to the camera, which is all a flat face leaves.
      const along = up > 0 ? "up" : up < 0 ? "down" : compassOf(normal);
      patch.facing = along ?? "north";
      if (up !== 0 && !offers(props, "facing", patch.facing)) {
        patch.facing = compassOf(forward) ?? "north";
      }
    } else {
      const aim: Direction =
        face.facing === "look" ? forward : [-forward[0], -forward[1], -forward[2]];
      patch.facing = compassOf(aim) ?? "north";
    }
  }

  if (face.rotation) {
    const front = compassOf([-forward[0], -forward[1], -forward[2]]);
    if (front) patch.rotation = ROTATION_BY_FACING[front];
  }

  let next = state;
  for (const [key, value] of Object.entries(patch)) {
    if (!offers(props, key, value)) continue;
    next = withProperty(next, key, value);
  }
  return next;
}

function offers(props: OrientProp[], key: string, value: string): boolean {
  const prop = props.find((entry) => entry.key === key);
  return !!prop && prop.values.some((option) => option.value === value);
}
