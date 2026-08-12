/**
 * Turning a flat list of block ids into groups worth browsing.
 *
 * The curated set in {@link ./commonBlocks} is a starting list rather than
 * vanilla's full inventory, and a thousand ids written out by hand would go
 * stale with every release. A loaded resource pack already carries the complete
 * list for its own version — one blockstate file per block — so when there is a
 * pack the picker offers everything in it, and this is what sorts those ids into
 * groups instead of one wall of buttons.
 */

import { baseName, normalizeName } from "./model";
import type { BlockGroup } from "./commonBlocks";

/**
 * Blocks that cannot stand on their own. Air and the portal interiors have no
 * shape, and the piston's moving halves only exist mid-animation — a schematic
 * holding one is a schematic of a broken piston. Water, lava and fire are *not*
 * here: they are placed in builds often enough to be worth browsing to.
 */
const NOT_PLACEABLE = new Set([
  "air", "cave_air", "void_air", "moving_piston", "piston_head",
  "bubble_column", "end_gateway", "end_portal", "nether_portal",
  "structure_void", "light",
]);

/**
 * Ids that are the wall-mounted or planted form of a block already listed, and
 * would otherwise double every sign, banner and flower in the picker. They are
 * still reachable by typing, and a schematic that holds them loads and renders
 * as normal.
 */
const REDUNDANT = [
  /^potted_/,
  /(^|_)wall_(banner|torch|fan|head|skull)$/,
  /_wall_sign$/,
  /_wall_hanging_sign$/,
  /^attached_(melon|pumpkin)_stem$/,
  /_cake$/,
];

const ends = (id: string, ...suffixes: string[]) => suffixes.some((s) => id.endsWith(s));
const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

interface Category {
  name: string;
  match: (id: string) => boolean;
}

/**
 * First match wins, so the order is the specification: `_wall_sign` has to reach
 * the sign bucket before `_wall` claims it, and `crimson_planks` the wood bucket
 * before the nether one.
 *
 * Names are deliberately the curated groups' names where the two overlap. The
 * picker merges a catalogue group into the curated group it shares a name with,
 * so the walls the shelf lists and the walls it misses end up under one heading
 * rather than two.
 */
const CATEGORIES: Category[] = [
  { name: "Walls", match: (id) => ends(id, "_wall") },
  { name: "Stairs & slabs", match: (id) => ends(id, "_stairs", "_slab") },
  { name: "Fences & gates", match: (id) => ends(id, "_fence", "_fence_gate") },
  { name: "Doors & trapdoors", match: (id) => ends(id, "_door", "_trapdoor") },
  { name: "Panes & bars", match: (id) => ends(id, "_pane", "_bars") || id === "iron_bars" },
  {
    name: "Wood",
    match: (id) => ends(id, "_planks", "_log", "_wood", "_stem", "_hyphae", "_mosaic"),
  },
  { name: "Nature", match: (id) => ends(id, "_leaves", "_sapling", "_propagule") },
  { name: "Signs", match: (id) => ends(id, "_sign") },
  { name: "Banners, heads & pots", match: (id) => ends(id, "_banner", "_head", "_skull", "_pot") },
  { name: "Buttons & plates", match: (id) => ends(id, "_button", "_pressure_plate") },
  {
    name: "Redstone",
    match: (id) =>
      ends(id, "_rail") || id === "rail" ||
      has(id, "redstone", "piston", "command_block", "tripwire") ||
      ["observer", "lever", "dispenser", "dropper", "repeater", "comparator",
        "daylight_detector", "target", "note_block", "hopper", "sculk_sensor",
        "calibrated_sculk_sensor", "lightning_rod", "crafter", "jigsaw",
        "structure_block"].includes(id),
  },
  { name: "Wool", match: (id) => ends(id, "_wool", "_carpet") || id === "moss_carpet" },
  { name: "Concrete", match: (id) => has(id, "concrete") },
  { name: "Terracotta", match: (id) => has(id, "terracotta") },
  { name: "Glass", match: (id) => has(id, "glass") },
  { name: "Copper", match: (id) => has(id, "copper") },
  { name: "Beds & shulker boxes", match: (id) => ends(id, "_bed", "_shulker_box") },
  { name: "Candles", match: (id) => ends(id, "_candle") || id === "candle" },
  { name: "Coral", match: (id) => has(id, "coral") },
  {
    name: "Metal & mineral",
    match: (id) =>
      ends(id, "_ore") || id.startsWith("raw_") ||
      has(id, "amethyst", "ancient_debris", "netherite", "iron", "gold", "diamond",
        "emerald", "lapis", "coal_block", "bone_block"),
  },
  {
    name: "Nether & End",
    match: (id) =>
      has(id, "nether", "blackstone", "basalt", "soul_", "warped", "crimson",
        "shroomlight", "chorus", "purpur", "end_stone", "quartz", "magma",
        "glowstone", "gilded", "obsidian"),
  },
  {
    name: "Plants & fungi",
    match: (id) =>
      has(id, "flower", "tulip", "orchid", "mushroom", "fern", "grass", "vine",
        "kelp", "seagrass", "bamboo", "cactus", "sugar_cane", "lily", "roots",
        "sprouts", "bush", "berries", "moss", "azalea", "dripleaf", "lichen",
        "sculk", "wart", "cocoa", "melon", "pumpkin", "crop", "wheat", "carrots",
        "potatoes", "beetroots", "torchflower", "pitcher", "hanging_roots",
        "spore_blossom", "chorus", "sponge", "algae"),
  },
  {
    name: "Ground",
    match: (id) =>
      has(id, "dirt", "sand", "gravel", "clay", "mud", "ice", "snow", "podzol",
        "mycelium", "farmland", "path", "soil"),
  },
  {
    name: "Stone",
    match: (id) =>
      has(id, "stone", "deepslate", "granite", "diorite", "andesite", "tuff",
        "calcite", "dripstone", "brick", "prismarine", "bedrock", "cobble",
        "basalt", "obsidian", "resin"),
  },
];

const OTHER = "Other blocks";

/**
 * Groups in the order they are offered, with the buckets nothing fell into
 * dropped.
 *
 * Ids keep the namespace they came in with. A mod block written out as
 * `minecraft:aspen_planks` is a block no game can load, so the picker has to
 * carry `biomeswevegone:aspen_planks` through to the palette and the export.
 * The categories still match on the bare id: a mod's stairs are stairs.
 */
export function groupBlocks(ids: Iterable<string>, skip?: Set<string>): BlockGroup[] {
  const skipped = new Set<string>();
  if (skip) for (const id of skip) skipped.add(normalizeName(id));

  const buckets = new Map<string, string[]>();
  for (const category of CATEGORIES) buckets.set(category.name, []);
  buckets.set(OTHER, []);

  for (const raw of ids) {
    const name = normalizeName(raw);
    const id = baseName(name);
    if (skipped.has(name)) continue;
    if (NOT_PLACEABLE.has(id)) continue;
    if (REDUNDANT.some((pattern) => pattern.test(id))) continue;
    skipped.add(name); // a pack layered over another can list the same block twice
    const category = CATEGORIES.find((entry) => entry.match(id));
    buckets.get(category?.name ?? OTHER)!.push(name);
  }

  const out: BlockGroup[] = [];
  for (const [name, blocks] of buckets) {
    if (blocks.length === 0) continue;
    out.push({ name, blocks: blocks.sort() });
  }
  return out;
}

/**
 * A mod jar's filename as a heading a builder would recognise. The namespace
 * inside the jar is written for the game rather than for reading —
 * `biomeswevegone` — while the filename usually spells the name out, once the
 * loader and version tokens the release process bolted on are taken back off:
 * `Oh-The-Biomes-Weve-Gone-Fabric-2.5.4.jar` -> `Oh The Biomes Weve Gone`.
 */
const BUILD_TOKENS = /^(v?\d[\d.+]*|fabric|forge|neoforge|quilt|mc\d.*|\d.*)$/i;

export function modLabel(fileName: string): string {
  const words = fileName
    .replace(/\.(jar|zip)$/i, "")
    .split(/[-_+ ]+/)
    .filter((word) => word && !BUILD_TOKENS.test(word));
  if (words.length === 0) return fileName.replace(/\.(jar|zip)$/i, "");
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
