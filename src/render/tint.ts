/**
 * Biome tint.
 *
 * Grass, leaves, vines and water ship as greyscale textures and get their
 * colour at render time from a biome colormap. A schematic carries no biome,
 * so everything is pinned to plains — the same choice Litematica's own
 * preview makes, and the one that matches what most builders picture.
 */

const WHITE: [number, number, number] = [1, 1, 1];

const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

/** Plains: temperature 0.8, downfall 0.4, read off the three colormaps. */
const GRASS = rgb(0x91bd59);
const FOLIAGE = rgb(0x77ab2f);
const DRY_FOLIAGE = rgb(0xa37546);
const WATER = rgb(0x3f76e4);

/** Blocks vanilla tints with a fixed colour rather than the biome map. */
const FIXED: Record<string, [number, number, number]> = {
  birch_leaves: rgb(0x80a755),
  spruce_leaves: rgb(0x619961),
  lily_pad: rgb(0x208030),
  attached_melon_stem: rgb(0xe0c71c),
  attached_pumpkin_stem: rgb(0xe0c71c),
};

/**
 * The leaves the game actually runs through the foliage colormap, named one by
 * one rather than matched on `_leaves`.
 *
 * The greyscale-mask arrangement is now the exception rather than the rule.
 * Cherry, pale oak and both azaleas ship their leaves already coloured — the
 * cherry texture has no grey pixel in it — and vanilla registers no tint for
 * any of them, so a blanket `_leaves` rule repainted pink blossom, pale grey
 * and azalea green all the same plains green. Leaves added from here on are far
 * likelier to follow cherry than oak, so an unknown one is left alone.
 */
const FOLIAGE_LEAVES = new Set([
  "oak_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves",
  "mangrove_leaves",
]);

const GRASS_TINTED = new Set([
  "grass_block", "short_grass", "grass", "tall_grass", "fern", "large_fern",
  "potted_fern", "sugar_cane", "pink_petals", "wildflowers", "bush",
  "firefly_bush",
]);

const WATER_TINTED = new Set([
  "water", "flowing_water", "bubble_column", "water_cauldron",
]);

/** Redstone dust brightens with signal strength. */
function redstone(power: number): [number, number, number] {
  const t = power / 15;
  const r = 0.3 + t * 0.7;
  return [Math.min(1, r * 0.9 + 0.15), t * t * 0.28, t * t * 0.28];
}

/** Stems fade from green to their fruit colour as they grow. */
function stem(age: number): [number, number, number] {
  const t = age / 7;
  return [(0.35 + t * 0.6), (0.75 - t * 0.35), 0.2 * (1 - t)];
}

/**
 * Biome tint is a vanilla arrangement: a greyscale texture plus a colour looked
 * up per biome. Mods overwhelmingly ship their leaves already coloured and
 * register their own fixed colour instead — Oh The Biomes We've Gone has blue
 * spruce, purple jacaranda and brown oak — so laying the plains foliage green
 * over them would repaint every one of them the same shade. A modded block
 * keeps its texture's own colour unless its model says otherwise.
 */
export function tintFor(
  name: string,
  properties?: Record<string, string>,
): [number, number, number] {
  const colon = name.indexOf(":");
  const id = colon === -1 ? name : name.slice(colon + 1);
  if (colon !== -1 && name.slice(0, colon) !== "minecraft") return WHITE;

  const fixed = FIXED[id];
  if (fixed) return fixed;
  if (GRASS_TINTED.has(id)) return GRASS;
  if (WATER_TINTED.has(id)) return WATER;
  if (FOLIAGE_LEAVES.has(id) || id === "vine") return FOLIAGE;
  // Fallen leaves have their own colormap — the pale garden's dead brown rather
  // than a living green. Its texture is greyscale, so leaving it untinted drew
  // it as dark slate.
  if (id === "leaf_litter") return DRY_FOLIAGE;
  if (id === "redstone_wire") return redstone(Number(properties?.power ?? 0));
  if (id === "melon_stem" || id === "pumpkin_stem") return stem(Number(properties?.age ?? 0));
  return WHITE;
}
