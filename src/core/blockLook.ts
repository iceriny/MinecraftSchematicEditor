/**
 * How a blockstate should look in the viewport: a colour, a transparency
 * class, and the boxes that make up its shape.
 *
 * Colours are hand-picked averages of the vanilla textures. No game assets
 * ship with this app, so the viewer is a colour-accurate approximation rather
 * than a texture-accurate one. Load a resource pack if you need the real thing.
 */

import { baseName, isAir, stateKey, type BlockState } from "./model";

/** `[x0, y0, z0, x1, y1, z1]` in unit-cube space. */
export type Box = readonly [number, number, number, number, number, number];

export const FULL_BOX: Box = [0, 0, 0, 1, 1, 1];
const FULL_BOXES: Box[] = [FULL_BOX];

export interface BlockLook {
  color: number;
  /** `opaque` occludes everything; `translucent` only occludes its own kind. */
  transparency: "opaque" | "translucent";
  boxes: Box[];
  /** True when the shape fills the cube and can hide its neighbours' faces. */
  solid: boolean;
  /** 0–1; lifts the block out of the lighting model so lamps read as lamps. */
  glow: number;
}

/* ---------------------------------------------------------------- colours */

const DYE = {
  white: 0xe9ecec,
  orange: 0xf07613,
  magenta: 0xbd44b3,
  light_blue: 0x3aafd9,
  yellow: 0xf8c627,
  lime: 0x70b919,
  pink: 0xed8dac,
  gray: 0x3e4447,
  light_gray: 0x8e8e86,
  cyan: 0x158991,
  purple: 0x792aac,
  blue: 0x35399d,
  brown: 0x724728,
  green: 0x546d1b,
  red: 0xa12722,
  black: 0x141519,
} as const;

const CONCRETE = {
  white: 0xcfd5d6,
  orange: 0xe06101,
  magenta: 0xa9309f,
  light_blue: 0x2489c7,
  yellow: 0xf1af15,
  lime: 0x5ea918,
  pink: 0xd6658f,
  gray: 0x36393d,
  light_gray: 0x7d7d73,
  cyan: 0x157788,
  purple: 0x64209c,
  blue: 0x2c2e8f,
  brown: 0x603c20,
  green: 0x495b24,
  red: 0x8e2121,
  black: 0x080a0f,
} as const;

const TERRACOTTA = {
  white: 0xd1b1a1,
  orange: 0xa05325,
  magenta: 0x95576c,
  light_blue: 0x706c8a,
  yellow: 0xba8524,
  lime: 0x677535,
  pink: 0xa14e4e,
  gray: 0x392a24,
  light_gray: 0x876b62,
  cyan: 0x575b5b,
  purple: 0x764656,
  blue: 0x4a3b5b,
  brown: 0x4d3323,
  green: 0x4c532a,
  red: 0x8e3c2e,
  black: 0x251610,
} as const;

type DyeName = keyof typeof DYE;
const DYE_NAMES = Object.keys(DYE) as DyeName[];

function mix(color: number, target: number, amount: number): number {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const tr = (target >> 16) & 0xff, tg = (target >> 8) & 0xff, tb = target & 0xff;
  const lerp = (a: number, t: number) => Math.round(a + (t - a) * amount);
  return (lerp(r, tr) << 16) | (lerp(g, tg) << 8) | lerp(b, tb);
}

const lighten = (c: number, a: number) => mix(c, 0xffffff, a);
const darken = (c: number, a: number) => mix(c, 0x000000, a);

/** Base colours keyed by unnamespaced id. */
const COLORS: Record<string, number> = {
  // stone family
  stone: 0x7e7e7e,
  smooth_stone: 0x9e9e9e,
  cobblestone: 0x7a7a7a,
  mossy_cobblestone: 0x6c7a5e,
  stone_bricks: 0x7a7a7a,
  mossy_stone_bricks: 0x6f7a68,
  cracked_stone_bricks: 0x767674,
  chiseled_stone_bricks: 0x787876,
  granite: 0x9a6b5d,
  polished_granite: 0xa0705f,
  diorite: 0xbfbfc0,
  polished_diorite: 0xc7c7c9,
  andesite: 0x8a8a8a,
  polished_andesite: 0x969696,
  deepslate: 0x5a5a5e,
  cobbled_deepslate: 0x4d4d51,
  polished_deepslate: 0x504f53,
  deepslate_bricks: 0x4b4b4f,
  deepslate_tiles: 0x37373a,
  chiseled_deepslate: 0x37373a,
  reinforced_deepslate: 0x4b4f4b,
  calcite: 0xdfdeda,
  tuff: 0x6c6e64,
  dripstone_block: 0x866b5e,
  bedrock: 0x565656,
  obsidian: 0x14121f,
  crying_obsidian: 0x22124d,
  smooth_basalt: 0x48484e,
  basalt: 0x4c4a4f,
  polished_basalt: 0x565258,
  blackstone: 0x2b2426,
  polished_blackstone: 0x30292f,
  polished_blackstone_bricks: 0x2c2429,
  gilded_blackstone: 0x3b2a24,

  // ground
  dirt: 0x866043,
  coarse_dirt: 0x77553a,
  rooted_dirt: 0x90674b,
  podzol: 0x5b3d1f,
  mud: 0x3c3a3e,
  packed_mud: 0x8f6a4f,
  mud_bricks: 0x8a6a50,
  grass_block: 0x7cbd6b,
  dirt_path: 0x967f4b,
  farmland: 0x5a3b22,
  mycelium: 0x6e6265,
  sand: 0xdbd3a0,
  red_sand: 0xbe6721,
  sandstone: 0xdcd3a2,
  smooth_sandstone: 0xe0d6a8,
  chiseled_sandstone: 0xd8cf9e,
  cut_sandstone: 0xdad1a1,
  red_sandstone: 0xc1662b,
  smooth_red_sandstone: 0xc46a2e,
  gravel: 0x837b7b,
  clay: 0xa0a6b4,
  terracotta: 0x985e44,
  moss_block: 0x596e29,
  moss_carpet: 0x596e29,
  snow_block: 0xf0fafa,
  snow: 0xf0fafa,
  ice: 0x7daeff,
  packed_ice: 0x7eaaf0,
  blue_ice: 0x74a8fb,
  frosted_ice: 0x7daeff,

  // nether & end
  netherrack: 0x6d3634,
  nether_bricks: 0x2c161a,
  red_nether_bricks: 0x460709,
  chiseled_nether_bricks: 0x30181c,
  cracked_nether_bricks: 0x2a1519,
  soul_sand: 0x533b32,
  soul_soil: 0x4a3a2f,
  magma_block: 0x8e3f09,
  glowstone: 0xb79a6a,
  shroomlight: 0xf19749,
  nether_wart_block: 0x740000,
  warped_wart_block: 0x167770,
  end_stone: 0xdde0a4,
  end_stone_bricks: 0xdbe1a4,
  purpur_block: 0xa97ca9,
  purpur_pillar: 0xab7fab,
  chorus_plant: 0x5a375a,

  // minerals
  coal_ore: 0x6b6b6b,
  iron_ore: 0x927f6e,
  copper_ore: 0x93756a,
  gold_ore: 0x9b8a54,
  redstone_ore: 0x8b6c6c,
  lapis_ore: 0x6b7c97,
  diamond_ore: 0x6e9997,
  emerald_ore: 0x6e9b7c,
  nether_quartz_ore: 0x7a4744,
  nether_gold_ore: 0x7a4a3b,
  ancient_debris: 0x5c4137,
  coal_block: 0x101010,
  iron_block: 0xd8d8d8,
  gold_block: 0xf9ec4e,
  diamond_block: 0x63e5da,
  emerald_block: 0x43d47f,
  lapis_block: 0x1f479b,
  redstone_block: 0xa61b08,
  netherite_block: 0x443c3d,
  quartz_block: 0xe9e4db,
  smooth_quartz: 0xece7de,
  chiseled_quartz_block: 0xe7e2d8,
  quartz_pillar: 0xe9e4db,
  quartz_bricks: 0xe8e3d9,
  copper_block: 0xc06a50,
  exposed_copper: 0x9a7b6c,
  weathered_copper: 0x6e9a78,
  oxidized_copper: 0x52a284,
  cut_copper: 0xbf6a4f,
  amethyst_block: 0x8a65c4,
  budding_amethyst: 0x8a65c4,
  bone_block: 0xe1ddca,
  raw_iron_block: 0xa6805a,
  raw_copper_block: 0x9b5f45,
  raw_gold_block: 0xdeaf2e,
  slime_block: 0x71c078,
  honey_block: 0xfca800,
  sponge: 0xc3c34f,
  wet_sponge: 0xa2a63e,

  // building
  bricks: 0x96574a,
  prismarine: 0x63a597,
  prismarine_bricks: 0x62a9a0,
  dark_prismarine: 0x345c4a,
  sea_lantern: 0xb6ccc5,
  hay_block: 0xa78d18,
  melon: 0x7bb026,
  pumpkin: 0xc07615,
  carved_pumpkin: 0xc07615,
  jack_o_lantern: 0xe0a64a,
  tnt: 0xa72e1a,
  bookshelf: 0x6b5334,
  crafting_table: 0x7b4b2a,
  furnace: 0x6b6b6b,
  chest: 0x8b6a2f,
  barrel: 0x6b5232,
  ladder: 0x7b5b33,
  scaffolding: 0xc7a458,
  iron_bars: 0x7b7b7b,
  chain: 0x3b3f4d,
  lantern: 0xc67f3b,
  soul_lantern: 0x3a8e90,
  torch: 0xffd966,
  wall_torch: 0xffd966,
  soul_torch: 0x50c7d6,
  redstone_torch: 0xc82a1b,
  redstone_lamp: 0x6b3d22,
  redstone_wire: 0xaa0f01,
  repeater: 0xa8a3a0,
  comparator: 0xa8a3a0,
  observer: 0x646464,
  piston: 0x8f7748,
  sticky_piston: 0x769256,
  piston_head: 0x9c7f4e,
  hopper: 0x40474d,
  dispenser: 0x6b6b6b,
  dropper: 0x6b6b6b,
  rail: 0x8a7a55,
  powered_rail: 0x9c7c4b,
  detector_rail: 0x9a7a5a,
  activator_rail: 0x8a6a4a,
  water: 0x3f5cdb,
  lava: 0xd45b12,
  glass: 0xc7e8e8,
  glass_pane: 0xc7e8e8,
  tinted_glass: 0x2b2724,
  sculk: 0x0f1f26,
  sculk_catalyst: 0x103444,
  sculk_sensor: 0x11424a,
  sculk_vein: 0x11333c,
  cobweb: 0xdcebeb,
  vine: 0x386b1a,
  lily_pad: 0x2e6d18,
  bamboo: 0x7b9a2b,
  cactus: 0x51862c,
  sugar_cane: 0x92b96a,
  dried_kelp_block: 0x33452b,
  target: 0xd0b39b,
  note_block: 0x5b3d29,
  jukebox: 0x584030,
  beacon: 0x71dbd4,
  conduit: 0x9c8977,
  spawner: 0x1b2839,
  ochre_froglight: 0xf1e0af,
  verdant_froglight: 0xd6f0c6,
  pearlescent_froglight: 0xf3dff0,

  // workstations and fittings
  campfire: 0x9a6a3c,
  soul_campfire: 0x3d8f96,
  lectern: 0x8b7042,
  smoker: 0x5b4a3a,
  blast_furnace: 0x5a5a5c,
  cartography_table: 0x6b5a44,
  fletching_table: 0xc9b98a,
  smithing_table: 0x3b3743,
  loom: 0x9a7f55,
  composter: 0x6b5333,
  grindstone: 0x8a8a8a,
  stonecutter: 0x7a7a7c,
  anvil: 0x494949,
  enchanting_table: 0x7a2f34,
  brewing_stand: 0x7d6b53,
  cauldron: 0x4b4b4b,
  bell: 0xf0c33a,
  flower_pot: 0x9a5c43,
  lodestone: 0x8a8b8f,
  respawn_anchor: 0x36196a,
  dragon_egg: 0x100b13,
  decorated_pot: 0xb3785c,
  sculk_shrieker: 0x3c4a4a,
  mangrove_roots: 0x5a4632,
  muddy_mangrove_roots: 0x4a3a2c,
  azalea: 0x7d9a4e,
  flowering_azalea: 0x9b6fb0,
  big_dripleaf: 0x6d9042,
  small_dripleaf: 0x5f8a3c,
  sea_pickle: 0x60682b,
  turtle_egg: 0xe0dcb0,
  tube_coral_block: 0x3054c4,
  brain_coral_block: 0xcd5aa8,
  bubble_coral_block: 0x9b2ba6,
  fire_coral_block: 0xa32a29,
  horn_coral_block: 0xd2c744,
  amethyst_cluster: 0xb47ee0,
  pointed_dripstone: 0x866b5e,
  soul_fire: 0x2ec5d8,
  fire: 0xe0902a,
};

/** Wood families: `[planks, log side, leaves]`. */
const WOODS: Record<string, [number, number, number]> = {
  oak: [0xb18c55, 0x6b5330, 0x4e8c25],
  spruce: [0x6d5233, 0x4a331b, 0x3e5f3e],
  birch: [0xc6b180, 0xc8c29e, 0x7fa352],
  jungle: [0x9a6a44, 0x55442a, 0x359a17],
  acacia: [0xb05b32, 0x676157, 0x62883c],
  dark_oak: [0x4b3316, 0x3b2a17, 0x3e7a15],
  pale_oak: [0xe9e0d2, 0x6f665a, 0x88a45c],
  mangrove: [0x773932, 0x52252b, 0x5c9536],
  cherry: [0xe2b4aa, 0x37232b, 0xec9ac8],
  bamboo: [0xc5b34c, 0x7b9a2b, 0x7b9a2b],
  crimson: [0x6a344b, 0x6a344b, 0x8b3352],
  warped: [0x2b6c63, 0x39514e, 0x1a8377],
  azalea: [0x7d9a4e, 0x6b5330, 0x5e8b33],
  flowering_azalea: [0x7d9a4e, 0x6b5330, 0x9b6fb0],
};

const DYE_FAMILIES: Record<string, (dye: DyeName) => number> = {
  wool: (d) => DYE[d],
  carpet: (d) => DYE[d],
  bed: (d) => DYE[d],
  banner: (d) => DYE[d],
  wall_banner: (d) => DYE[d],
  candle: (d) => DYE[d],
  shulker_box: (d) => mix(DYE[d], 0x9a6d9a, 0.25),
  concrete: (d) => CONCRETE[d],
  concrete_powder: (d) => lighten(CONCRETE[d], 0.18),
  terracotta: (d) => TERRACOTTA[d],
  glazed_terracotta: (d) => lighten(TERRACOTTA[d], 0.25),
  stained_glass: (d) => lighten(DYE[d], 0.2),
  stained_glass_pane: (d) => lighten(DYE[d], 0.2),
};

const GLOW: Record<string, number> = {
  glowstone: 1,
  sea_lantern: 1,
  shroomlight: 0.9,
  jack_o_lantern: 0.9,
  lantern: 0.8,
  soul_lantern: 0.7,
  torch: 0.9,
  wall_torch: 0.9,
  soul_torch: 0.7,
  redstone_torch: 0.55,
  lava: 1,
  magma_block: 0.6,
  beacon: 0.9,
  conduit: 0.7,
  end_rod: 0.9,
  ochre_froglight: 1,
  verdant_froglight: 1,
  pearlescent_froglight: 1,
  crying_obsidian: 0.35,
  amethyst_cluster: 0.4,
  campfire: 0.7,
  soul_campfire: 0.55,
  fire: 1,
  soul_fire: 1,
  respawn_anchor: 0.3,
  sea_pickle: 0.3,
};

const TRANSLUCENT = new Set([
  "glass", "glass_pane", "tinted_glass", "water", "ice", "frosted_ice",
  "slime_block", "honey_block", "nether_portal", "bubble_column",
]);

/** Suffixes that inherit their colour from the material before them. */
const DERIVED_SUFFIXES = [
  "_stairs", "_slab", "_wall", "_fence_gate", "_fence", "_button",
  "_pressure_plate", "_trapdoor", "_door", "_hanging_sign", "_wall_sign",
  "_sign", "_wall_hanging_sign",
];

function hashColor(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return hslToRgb(hue / 360, 0.32, 0.55);
}

function hslToRgb(h: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Resolves the base colour for an id, following family rules then suffixes. */
function colorFor(id: string, depth = 0): number {
  const direct = COLORS[id];
  if (direct !== undefined) return direct;

  for (const dye of DYE_NAMES) {
    if (!id.startsWith(dye + "_")) continue;
    const family = id.slice(dye.length + 1);
    const rule = DYE_FAMILIES[family];
    if (rule) return rule(dye);
  }

  for (const wood of Object.keys(WOODS)) {
    if (id !== wood && !id.startsWith(wood + "_") && !id.startsWith("stripped_" + wood)) continue;
    const [planks, log, leaves] = WOODS[wood];
    if (id.endsWith("_leaves")) return leaves;
    if (id.endsWith("_log") || id.endsWith("_wood") || id.endsWith("_stem") || id.endsWith("_hyphae")) {
      return id.startsWith("stripped_") ? lighten(log, 0.22) : log;
    }
    if (id.endsWith("_sapling") || id.endsWith("_propagule")) return leaves;
    return planks;
  }

  if (depth < 2) {
    for (const suffix of DERIVED_SUFFIXES) {
      if (!id.endsWith(suffix)) continue;
      const stem = id.slice(0, -suffix.length);
      // `stone_brick_stairs` -> `stone_bricks`, `quartz_slab` -> `quartz_block`
      for (const candidate of [stem, stem + "s", stem + "_block", stem + "es"]) {
        if (COLORS[candidate] !== undefined) return COLORS[candidate];
      }
      return colorFor(stem, depth + 1);
    }
    if (id.startsWith("infested_")) return colorFor(id.slice(9), depth + 1);
    if (id.startsWith("waxed_")) return colorFor(id.slice(6), depth + 1);
    if (id.startsWith("cut_") || id.startsWith("smooth_") || id.startsWith("polished_")) {
      const stem = id.slice(id.indexOf("_") + 1);
      if (COLORS[stem] !== undefined) return lighten(COLORS[stem], 0.08);
    }
    if (id.startsWith("deepslate_") && COLORS[id.slice(10)] !== undefined) {
      return mix(COLORS[id.slice(10)], COLORS.deepslate, 0.55);
    }
  }

  if (id.includes("flower") || id.includes("tulip") || id.includes("orchid")) return 0xd05a7a;
  if (id.includes("grass") || id.includes("fern") || id.includes("kelp")) return 0x5aa02c;
  if (id.includes("coral")) return 0xd0507a;
  if (id.includes("copper")) return 0xc06a50;

  return hashColor(id);
}

/* ----------------------------------------------------------------- shapes */

const THIN_TOP: Box = [0, 0, 0, 1, 1 / 16, 1];
const POST: Box = [5 / 16, 0, 5 / 16, 11 / 16, 1, 11 / 16];
const PLANT: Box = [5 / 16, 0, 5 / 16, 11 / 16, 13 / 16, 11 / 16];
const TORCH_BOX: Box = [7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16];

const THIN_BLOCKS = new Set([
  "carpet", "moss_carpet", "pale_moss_carpet", "snow", "rail", "powered_rail",
  "detector_rail", "activator_rail", "lily_pad", "pressure_plate", "tripwire",
  "sculk_vein", "redstone_wire",
]);

const PLANT_BLOCKS = new Set([
  "sapling", "flower", "tulip", "orchid", "dandelion", "poppy", "allium",
  "azure_bluet", "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose",
  "mushroom", "fern", "short_grass", "tall_grass", "grass", "seagrass", "wheat",
  "carrots", "potatoes", "beetroots", "nether_wart", "sweet_berry_bush",
  "dead_bush", "sugar_cane", "bamboo", "cocoa", "crimson_roots", "warped_roots",
  "nether_sprouts", "sea_pickle", "hanging_roots", "spore_blossom", "pitcher_crop",
  "torchflower", "chorus_flower", "kelp", "kelp_plant", "vine", "glow_lichen",
  "cave_vines", "cave_vines_plant", "twisting_vines", "weeping_vines",
]);

function anyMatch(id: string, set: Set<string>): boolean {
  if (set.has(id)) return true;
  for (const token of set) if (id.endsWith("_" + token)) return true;
  return false;
}

const HORIZONTAL: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
};

const OPPOSITE: Record<string, string> = {
  north: "south", south: "north", east: "west", west: "east",
};

/** Slab of thickness `depth` against the wall on the given horizontal side. */
function sideBox(facing: string, depth: number, y0 = 0, y1 = 1): Box {
  const dir = HORIZONTAL[facing] ?? HORIZONTAL.north;
  if (dir[0] === 1) return [1 - depth, y0, 0, 1, y1, 1];
  if (dir[0] === -1) return [0, y0, 0, depth, y1, 1];
  if (dir[1] === 1) return [0, y0, 1 - depth, 1, y1, 1];
  return [0, y0, 0, 1, y1, depth];
}

/**
 * Doors, ladders and open trapdoors face away from the surface they hang on,
 * so their geometry sits on the side opposite `facing`.
 */
function backingBox(facing: string | undefined, depth: number): Box {
  return sideBox(OPPOSITE[facing ?? "north"] ?? "south", depth);
}

/** A quarter turn clockwise about Y — the side a `_right` shape names. */
const CLOCKWISE: Record<string, string> = {
  north: "east", east: "south", south: "west", west: "north",
};

function overlap(a: Box, b: Box): Box {
  return [
    Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]),
    Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5]),
  ];
}

/**
 * A stair is a half slab with a step sitting on it. The step of a straight
 * flight is the half toward `facing`; a corner keeps only the quarter of it on
 * the named side (`outer`) or adds the quarter behind that side back on
 * (`inner`). Split the same way vanilla's own models are, so no two boxes
 * overlap and their shared faces never fight.
 */
function stairBoxes(props: Record<string, string> | undefined): Box[] {
  const top = props?.half === "top";
  const y0 = top ? 0 : 0.5;
  const y1 = top ? 0.5 : 1;
  const slab: Box = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];

  const facing = props?.facing ?? "north";
  const shape = props?.shape ?? "straight";
  const front = sideBox(facing, 0.5, y0, y1);
  if (!shape.startsWith("inner_") && !shape.startsWith("outer_")) return [slab, front];

  const right = CLOCKWISE[facing] ?? "east";
  const side = shape.endsWith("_left") ? (OPPOSITE[right] ?? "west") : right;
  const along = sideBox(side, 0.5, y0, y1);

  if (shape.startsWith("outer_")) return [slab, overlap(front, along)];
  return [slab, front, overlap(along, sideBox(OPPOSITE[facing] ?? "south", 0.5, y0, y1))];
}

function shapeFor(id: string, props: Record<string, string> | undefined): { boxes: Box[]; solid: boolean } {
  if (id.endsWith("_slab") || id === "snow_layer") {
    const type = props?.type ?? "bottom";
    if (type === "double") return { boxes: FULL_BOXES, solid: true };
    const box: Box = type === "top" ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    return { boxes: [box], solid: false };
  }
  if (id.endsWith("_stairs")) return { boxes: stairBoxes(props), solid: false };

  if (id === "snow") {
    const layers = Number(props?.layers ?? 1);
    if (layers >= 8) return { boxes: FULL_BOXES, solid: true };
    return { boxes: [[0, 0, 0, 1, layers / 8, 1]], solid: false };
  }
  if (anyMatch(id, THIN_BLOCKS)) return { boxes: [THIN_TOP], solid: false };

  if (id.endsWith("_fence") || id.endsWith("_wall") || id === "iron_bars" || id.endsWith("_fence_gate")) {
    return { boxes: [POST], solid: false };
  }
  if (id.endsWith("_pane") || id === "glass_pane") {
    return {
      boxes: [
        [7 / 16, 0, 0, 9 / 16, 1, 1],
        [0, 0, 7 / 16, 1, 1, 9 / 16],
      ],
      solid: false,
    };
  }
  if (id === "chain") return { boxes: [[6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16]], solid: false };
  if (id === "end_rod" || id === "lightning_rod") {
    return { boxes: [[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]], solid: false };
  }
  if (id.endsWith("torch")) return { boxes: [TORCH_BOX], solid: false };
  if (id === "lantern" || id === "soul_lantern") {
    return { boxes: [[5 / 16, 0, 5 / 16, 11 / 16, 9 / 16, 11 / 16]], solid: false };
  }
  if (id.endsWith("_door")) {
    return { boxes: [backingBox(props?.facing, 3 / 16)], solid: false };
  }
  if (id.endsWith("_trapdoor")) {
    if (props?.open === "true") {
      return { boxes: [backingBox(props?.facing, 3 / 16)], solid: false };
    }
    const box: Box = props?.half === "top" ? [0, 13 / 16, 0, 1, 1, 1] : [0, 0, 0, 1, 3 / 16, 1];
    return { boxes: [box], solid: false };
  }
  if (id === "ladder") {
    return { boxes: [backingBox(props?.facing, 3 / 16)], solid: false };
  }
  if (id.endsWith("_button")) {
    return { boxes: [[5 / 16, 0, 6 / 16, 11 / 16, 2 / 16, 10 / 16]], solid: false };
  }
  if (id === "cactus") return { boxes: [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]], solid: false };
  if (id === "chest" || id === "trapped_chest" || id === "ender_chest") {
    return { boxes: [[1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16]], solid: false };
  }
  if (id === "hopper") {
    return {
      boxes: [
        [0, 10 / 16, 0, 1, 1, 1],
        [4 / 16, 4 / 16, 4 / 16, 12 / 16, 10 / 16, 12 / 16],
      ],
      solid: false,
    };
  }
  if (id === "cobweb") return { boxes: FULL_BOXES, solid: false };
  if (id === "repeater" || id === "comparator") {
    return { boxes: [[0, 0, 0, 1, 2 / 16, 1]], solid: false };
  }
  if (anyMatch(id, PLANT_BLOCKS)) return { boxes: [PLANT], solid: false };

  return { boxes: FULL_BOXES, solid: true };
}

/* ---------------------------------------------------------------- lookup */

const cache = new Map<string, BlockLook>();

export function lookFor(state: BlockState): BlockLook {
  const key = stateKey(state);
  const cached = cache.get(key);
  if (cached) return cached;

  const id = baseName(state.name);
  const { boxes, solid } = shapeFor(id, state.properties);
  const translucent = TRANSLUCENT.has(id) || id.endsWith("_stained_glass") || id.endsWith("stained_glass_pane");
  const look: BlockLook = {
    color: colorFor(id),
    transparency: translucent ? "translucent" : "opaque",
    boxes,
    solid: solid && !translucent ? true : solid,
    glow: GLOW[id] ?? 0,
  };
  cache.set(key, look);
  return look;
}

/** CSS colour for the material list swatches. */
export function cssColor(state: BlockState): string {
  return "#" + lookFor(state).color.toString(16).padStart(6, "0");
}

export function isAirState(state: BlockState): boolean {
  return isAir(state.name);
}

/** Slightly darkened colour, for text that has to sit on the swatch. */
export function contrastText(color: number): string {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? "#12161c" : "#e8eef6";
}

export { darken, lighten, mix };
