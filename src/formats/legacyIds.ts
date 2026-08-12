/**
 * Legacy numeric block ids (pre-1.13) mapped to modern blockstates.
 *
 * Schematica and MCEdit `.schematic` files store `id + metadata` pairs, so
 * every one of them needs this table. It covers the vanilla 1.12 set; anything
 * unlisted falls back to a placeholder that still shows up in the material
 * list rather than silently vanishing.
 */

import type { BlockState } from "../core/model";

const DYES = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
];

const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"];
const STAIR_FACING = ["east", "west", "south", "north"];

/** Simple ids where metadata either doesn't matter or selects from a list. */
const SIMPLE: Record<number, string | string[]> = {
  0: "air",
  1: ["stone", "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite"],
  2: "grass_block",
  3: ["dirt", "coarse_dirt", "podzol"],
  4: "cobblestone",
  5: WOODS.map((w) => `${w}_planks`),
  6: WOODS.map((w) => `${w}_sapling`),
  7: "bedrock",
  8: "water", 9: "water",
  10: "lava", 11: "lava",
  12: ["sand", "red_sand"],
  13: "gravel",
  14: "gold_ore", 15: "iron_ore", 16: "coal_ore",
  19: ["sponge", "wet_sponge"],
  20: "glass",
  21: "lapis_ore", 22: "lapis_block",
  23: "dispenser",
  24: ["sandstone", "chiseled_sandstone", "cut_sandstone"],
  25: "note_block",
  26: "red_bed",
  27: "powered_rail", 28: "detector_rail",
  29: "sticky_piston",
  30: "cobweb",
  31: ["dead_bush", "short_grass", "fern"],
  32: "dead_bush",
  33: "piston", 34: "piston_head",
  35: DYES.map((d) => `${d}_wool`),
  36: "air",
  37: "dandelion",
  38: ["poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy"],
  39: "brown_mushroom", 40: "red_mushroom",
  41: "gold_block", 42: "iron_block",
  45: "bricks", 46: "tnt", 47: "bookshelf",
  48: "mossy_cobblestone", 49: "obsidian",
  50: "torch", 51: "fire", 52: "spawner",
  54: "chest", 55: "redstone_wire",
  56: "diamond_ore", 57: "diamond_block",
  58: "crafting_table", 59: "wheat", 60: "farmland",
  61: "furnace", 62: "furnace",
  63: "oak_sign", 64: "oak_door", 65: "ladder", 66: "rail",
  68: "oak_wall_sign", 69: "lever",
  70: "stone_pressure_plate", 71: "iron_door", 72: "oak_pressure_plate",
  73: "redstone_ore", 74: "redstone_ore",
  75: "redstone_torch", 76: "redstone_torch",
  77: "stone_button",
  79: "ice", 80: "snow_block", 81: "cactus", 82: "clay", 83: "sugar_cane",
  84: "jukebox", 85: "oak_fence", 86: "carved_pumpkin",
  87: "netherrack", 88: "soul_sand", 89: "glowstone", 90: "nether_portal",
  91: "jack_o_lantern", 92: "cake", 93: "repeater", 94: "repeater",
  95: DYES.map((d) => `${d}_stained_glass`),
  96: "oak_trapdoor", 97: "infested_stone",
  98: ["stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks"],
  99: "brown_mushroom_block", 100: "red_mushroom_block",
  101: "iron_bars", 102: "glass_pane",
  103: "melon", 104: "pumpkin_stem", 105: "melon_stem", 106: "vine",
  107: "oak_fence_gate",
  110: "mycelium", 111: "lily_pad", 112: "nether_bricks", 113: "nether_brick_fence",
  115: "nether_wart", 116: "enchanting_table", 117: "brewing_stand", 118: "cauldron",
  119: "end_portal", 120: "end_portal_frame", 121: "end_stone", 122: "dragon_egg",
  123: "redstone_lamp", 124: "redstone_lamp",
  127: "cocoa",
  129: "emerald_ore", 130: "ender_chest", 131: "tripwire_hook", 132: "tripwire",
  133: "emerald_block",
  137: "command_block", 138: "beacon",
  139: ["cobblestone_wall", "mossy_cobblestone_wall"],
  140: "flower_pot", 141: "carrots", 142: "potatoes", 143: "oak_button",
  144: "skeleton_skull", 145: "anvil", 146: "trapped_chest",
  147: "light_weighted_pressure_plate", 148: "heavy_weighted_pressure_plate",
  149: "comparator", 150: "comparator", 151: "daylight_detector",
  152: "redstone_block", 153: "nether_quartz_ore", 154: "hopper",
  155: ["quartz_block", "chiseled_quartz_block", "quartz_pillar"],
  157: "activator_rail", 158: "dropper",
  159: DYES.map((d) => `${d}_terracotta`),
  160: DYES.map((d) => `${d}_stained_glass_pane`),
  161: ["acacia_leaves", "dark_oak_leaves"],
  165: "slime_block", 166: "barrier", 167: "iron_trapdoor",
  168: ["prismarine", "prismarine_bricks", "dark_prismarine"],
  169: "sea_lantern", 170: "hay_block",
  171: DYES.map((d) => `${d}_carpet`),
  172: "terracotta", 173: "coal_block", 174: "packed_ice",
  175: ["sunflower", "lilac", "tall_grass", "large_fern", "rose_bush", "peony"],
  176: "white_banner", 177: "white_wall_banner", 178: "daylight_detector",
  179: ["red_sandstone", "chiseled_red_sandstone", "cut_red_sandstone"],
  183: "spruce_fence_gate", 184: "birch_fence_gate", 185: "jungle_fence_gate",
  186: "dark_oak_fence_gate", 187: "acacia_fence_gate",
  188: "spruce_fence", 189: "birch_fence", 190: "jungle_fence",
  191: "dark_oak_fence", 192: "acacia_fence",
  193: "spruce_door", 194: "birch_door", 195: "jungle_door",
  196: "acacia_door", 197: "dark_oak_door",
  198: "end_rod", 199: "chorus_plant", 200: "chorus_flower",
  201: "purpur_block", 202: "purpur_pillar",
  206: "end_stone_bricks", 207: "beetroots", 208: "dirt_path", 209: "end_gateway",
  210: "repeating_command_block", 211: "chain_command_block",
  212: "frosted_ice", 213: "magma_block", 214: "nether_wart_block",
  215: "red_nether_bricks", 216: "bone_block", 217: "structure_void",
  218: "observer", 255: "structure_block",
};

/** Ids whose metadata is a stair orientation. */
const STAIRS: Record<number, string> = {
  53: "oak_stairs", 67: "cobblestone_stairs", 108: "brick_stairs",
  109: "stone_brick_stairs", 114: "nether_brick_stairs", 128: "sandstone_stairs",
  134: "spruce_stairs", 135: "birch_stairs", 136: "jungle_stairs",
  156: "quartz_stairs", 163: "acacia_stairs", 164: "dark_oak_stairs",
  180: "red_sandstone_stairs", 203: "purpur_stairs",
};

const STONE_SLABS = [
  "smooth_stone", "sandstone", "oak_planks", "cobblestone",
  "bricks", "stone_bricks", "nether_bricks", "quartz_block",
];

/** `[materials, isDouble]` for the slab ids. */
const SLABS: Record<number, [string[], boolean]> = {
  43: [STONE_SLABS, true],
  44: [STONE_SLABS, false],
  125: [WOODS.map((w) => `${w}_planks`), true],
  126: [WOODS.map((w) => `${w}_planks`), false],
  181: [["red_sandstone"], true],
  182: [["red_sandstone"], false],
  204: [["purpur_block"], true],
  205: [["purpur_block"], false],
};

/** Turns a slab material id into its slab id: `oak_planks` -> `oak_slab`. */
function slabName(material: string): string {
  if (material.endsWith("_planks")) return material.replace("_planks", "_slab");
  if (material === "smooth_stone") return "smooth_stone_slab";
  if (material === "bricks") return "brick_slab";
  if (material === "nether_bricks") return "nether_brick_slab";
  if (material === "stone_bricks") return "stone_brick_slab";
  if (material === "quartz_block") return "quartz_slab";
  if (material === "purpur_block") return "purpur_slab";
  return material + "_slab";
}

function pick(list: string | string[], meta: number): string {
  if (typeof list === "string") return list;
  return list[meta] ?? list[0];
}

const AXIS = ["y", "x", "z"];

/** Converts a legacy `id:meta` pair to a modern blockstate. */
export function legacyState(id: number, meta: number): BlockState {
  const name = (base: string, properties?: Record<string, string>): BlockState =>
    properties ? { name: `minecraft:${base}`, properties } : { name: `minecraft:${base}` };

  // Logs carry their axis in the upper metadata bits; 12 means bark on all sides.
  if (id === 17 || id === 162) {
    const woods = id === 17 ? WOODS.slice(0, 4) : ["acacia", "dark_oak"];
    const wood = woods[meta & 3] ?? woods[0];
    const orientation = (meta >> 2) & 3;
    if (orientation === 3) return name(`${wood}_wood`);
    return name(`${wood}_log`, { axis: AXIS[orientation] });
  }
  if (id === 18 || id === 161) {
    const woods = id === 18 ? WOODS.slice(0, 4) : ["acacia", "dark_oak"];
    return name(`${woods[meta & 3] ?? woods[0]}_leaves`, {
      persistent: (meta & 4) !== 0 ? "true" : "false",
    });
  }

  const stair = STAIRS[id];
  if (stair) {
    return name(stair, {
      facing: STAIR_FACING[meta & 3],
      half: (meta & 4) !== 0 ? "top" : "bottom",
      shape: "straight",
    });
  }

  const slab = SLABS[id];
  if (slab) {
    const [materials, isDouble] = slab;
    const material = materials[meta & 7] ?? materials[0];
    return name(slabName(material), {
      type: isDouble ? "double" : (meta & 8) !== 0 ? "top" : "bottom",
    });
  }

  if (id === 78) return name("snow", { layers: String((meta & 7) + 1) });
  if (id >= 219 && id <= 234) return name(`${DYES[id - 219]}_shulker_box`);
  if (id >= 235 && id <= 250) return name(`${DYES[id - 235]}_glazed_terracotta`);
  if (id === 251) return name(`${DYES[meta & 15]}_concrete`);
  if (id === 252) return name(`${DYES[meta & 15]}_concrete_powder`);

  const simple = SIMPLE[id];
  if (simple !== undefined) return name(pick(simple, meta));

  return name(`legacy_block_${id}`, meta ? { meta: String(meta) } : undefined);
}
