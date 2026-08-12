/**
 * The block list offered by the material picker, grouped for browsing.
 *
 * This is a builder's shelf rather than the whole game: the shapes and materials
 * reached for most often, in an order that reads. Everything else comes from the
 * loaded resource pack, which carries one blockstate file per block and is the
 * only complete, version-accurate list to hand — see {@link ./blockCatalog}. Any
 * block at all can also be typed straight into the picker's field.
 */

const DYES = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
];

const WOODS = [
  "oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "pale_oak",
  "mangrove", "cherry", "crimson", "warped",
];

/** Stone-like materials vanilla cuts into both stairs and slabs. */
const CUT_STONE = [
  "stone", "cobblestone", "mossy_cobblestone", "stone_brick", "mossy_stone_brick",
  "granite", "polished_granite", "diorite", "polished_diorite", "andesite",
  "polished_andesite", "cobbled_deepslate", "polished_deepslate", "deepslate_brick",
  "deepslate_tile", "brick", "mud_brick", "sandstone", "smooth_sandstone",
  "red_sandstone", "smooth_red_sandstone", "prismarine", "prismarine_brick",
  "dark_prismarine", "nether_brick", "red_nether_brick", "quartz", "smooth_quartz",
  "purpur", "end_stone_brick", "blackstone", "polished_blackstone",
  "polished_blackstone_brick", "tuff", "polished_tuff", "tuff_brick",
];

/**
 * Materials that also come as a wall. A shorter list than {@link CUT_STONE} on
 * purpose — vanilla has no polished granite wall, no quartz wall and no purpur
 * wall, and offering them would only write blocks no game could load.
 */
const WALLED = [
  "cobblestone", "mossy_cobblestone", "stone_brick", "mossy_stone_brick",
  "granite", "diorite", "andesite", "cobbled_deepslate", "polished_deepslate",
  "deepslate_brick", "deepslate_tile", "brick", "mud_brick", "sandstone",
  "red_sandstone", "prismarine", "nether_brick", "red_nether_brick",
  "end_stone_brick", "blackstone", "polished_blackstone",
  "polished_blackstone_brick", "tuff", "polished_tuff", "tuff_brick",
];

/** Woods that grow leaves — the two nether ones have stems and no canopy. */
const TREES = WOODS.filter((w) => w !== "crimson" && w !== "warped");

const family = (suffix: string) => DYES.map((dye) => `minecraft:${dye}_${suffix}`);
const wood = (suffix: string) => WOODS.map((w) => `minecraft:${w}_${suffix}`);
const tree = (suffix: string) => TREES.map((w) => `minecraft:${w}_${suffix}`);
const cut = (suffix: string) => CUT_STONE.map((m) => `minecraft:${m}_${suffix}`);
const ids = (...names: string[]) => names.map((n) => `minecraft:${n}`);

export interface BlockGroup {
  name: string;
  blocks: string[];
}

/**
 * What the hotbar holds on an empty canvas. A build with blocks in it seeds the
 * hotbar from its own materials; a new one has none, and nine empty slots plus
 * no paint material is a dead end rather than a start.
 */
export const STARTER_BLOCKS = [
  "minecraft:stone",
  "minecraft:cobblestone",
  "minecraft:stone_bricks",
  "minecraft:oak_planks",
  "minecraft:oak_log",
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:sand",
  "minecraft:glass",
];

export const BLOCK_GROUPS: BlockGroup[] = [
  {
    name: "Stone",
    blocks: [
      "minecraft:stone", "minecraft:smooth_stone", "minecraft:cobblestone",
      "minecraft:mossy_cobblestone", "minecraft:stone_bricks",
      "minecraft:mossy_stone_bricks", "minecraft:cracked_stone_bricks",
      "minecraft:chiseled_stone_bricks", "minecraft:granite",
      "minecraft:polished_granite", "minecraft:diorite", "minecraft:polished_diorite",
      "minecraft:andesite", "minecraft:polished_andesite", "minecraft:deepslate",
      "minecraft:cobbled_deepslate", "minecraft:polished_deepslate",
      "minecraft:deepslate_bricks", "minecraft:deepslate_tiles",
      "minecraft:tuff", "minecraft:calcite", "minecraft:dripstone_block",
      "minecraft:blackstone", "minecraft:polished_blackstone",
      "minecraft:polished_blackstone_bricks", "minecraft:basalt",
      "minecraft:smooth_basalt", "minecraft:obsidian", "minecraft:bricks",
      "minecraft:mud_bricks", "minecraft:packed_mud",
    ],
  },
  {
    name: "Stairs & slabs",
    blocks: [
      ...cut("stairs"), ...cut("slab"),
      ...ids("smooth_stone_slab", "cut_sandstone_slab", "cut_red_sandstone_slab",
        "petrified_oak_slab"),
    ],
  },
  { name: "Walls", blocks: WALLED.map((m) => `minecraft:${m}_wall`) },
  {
    name: "Wood",
    blocks: [...wood("planks"), ...wood("log"), ...wood("slab"), ...wood("stairs")]
      .filter((id) => !id.includes("crimson_log") && !id.includes("warped_log"))
      .concat(ids("crimson_stem", "warped_stem", "bamboo_planks", "bamboo_mosaic",
        "bamboo_stairs", "bamboo_slab", "bookshelf", "chiseled_bookshelf")),
  },
  {
    name: "Fences & gates",
    blocks: [
      ...wood("fence"), ...wood("fence_gate"),
      ...ids("bamboo_fence", "bamboo_fence_gate", "nether_brick_fence"),
    ],
  },
  {
    name: "Doors & trapdoors",
    blocks: [
      ...wood("door"), ...wood("trapdoor"),
      ...ids("bamboo_door", "bamboo_trapdoor", "iron_door", "iron_trapdoor",
        "copper_door", "copper_trapdoor"),
    ],
  },
  {
    name: "Buttons & plates",
    blocks: [
      ...wood("button"), ...wood("pressure_plate"),
      ...ids("bamboo_button", "bamboo_pressure_plate", "stone_button",
        "stone_pressure_plate", "polished_blackstone_button",
        "polished_blackstone_pressure_plate", "light_weighted_pressure_plate",
        "heavy_weighted_pressure_plate", "lever"),
    ],
  },
  {
    name: "Signs",
    blocks: [...wood("sign"), ...wood("hanging_sign"), ...ids("bamboo_sign", "bamboo_hanging_sign")],
  },
  { name: "Wool", blocks: family("wool") },
  { name: "Concrete", blocks: family("concrete") },
  { name: "Terracotta", blocks: ["minecraft:terracotta", ...family("terracotta")] },
  { name: "Glazed terracotta", blocks: family("glazed_terracotta") },
  { name: "Glass", blocks: ["minecraft:glass", "minecraft:tinted_glass", ...family("stained_glass")] },
  {
    name: "Ground",
    blocks: [
      "minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt",
      "minecraft:podzol", "minecraft:rooted_dirt", "minecraft:mud",
      "minecraft:sand", "minecraft:red_sand", "minecraft:sandstone",
      "minecraft:smooth_sandstone", "minecraft:cut_sandstone",
      "minecraft:red_sandstone", "minecraft:gravel", "minecraft:clay",
      "minecraft:moss_block", "minecraft:snow_block", "minecraft:ice",
      "minecraft:packed_ice", "minecraft:blue_ice", "minecraft:dirt_path",
      "minecraft:mycelium", "minecraft:farmland",
    ],
  },
  {
    name: "Nature",
    blocks: [
      ...tree("leaves"), ...tree("sapling"),
      "minecraft:hay_block", "minecraft:melon", "minecraft:pumpkin",
      "minecraft:carved_pumpkin", "minecraft:cactus", "minecraft:sugar_cane",
      "minecraft:bamboo", "minecraft:vine", "minecraft:lily_pad",
      "minecraft:dried_kelp_block", "minecraft:sponge", "minecraft:cobweb",
    ],
  },
  {
    name: "Nether & End",
    blocks: [
      "minecraft:netherrack", "minecraft:nether_bricks",
      "minecraft:red_nether_bricks", "minecraft:chiseled_nether_bricks",
      "minecraft:soul_sand", "minecraft:soul_soil", "minecraft:magma_block",
      "minecraft:nether_wart_block", "minecraft:warped_wart_block",
      "minecraft:end_stone", "minecraft:end_stone_bricks",
      "minecraft:purpur_block", "minecraft:purpur_pillar", "minecraft:chorus_plant",
    ],
  },
  {
    name: "Metal & mineral",
    blocks: [
      "minecraft:iron_block", "minecraft:gold_block", "minecraft:diamond_block",
      "minecraft:emerald_block", "minecraft:lapis_block", "minecraft:redstone_block",
      "minecraft:netherite_block",
      "minecraft:coal_block", "minecraft:quartz_block", "minecraft:smooth_quartz",
      "minecraft:quartz_bricks", "minecraft:amethyst_block", "minecraft:bone_block",
      "minecraft:raw_iron_block", "minecraft:raw_copper_block", "minecraft:raw_gold_block",
      "minecraft:prismarine", "minecraft:prismarine_bricks", "minecraft:dark_prismarine",
      "minecraft:slime_block", "minecraft:honey_block",
    ],
  },
  {
    // Copper is its own group because it is really four materials: the same
    // block at four stages of weathering, each of which also comes cut, and
    // waxed to hold it there.
    name: "Copper",
    blocks: [
      ...["copper_block", "exposed_copper", "weathered_copper", "oxidized_copper"]
        .flatMap((id) => [`minecraft:${id}`, `minecraft:waxed_${id}`]),
      ...["cut_copper", "exposed_cut_copper", "weathered_cut_copper", "oxidized_cut_copper"]
        .flatMap((id) => [
          `minecraft:${id}`, `minecraft:${id}_stairs`, `minecraft:${id}_slab`,
          `minecraft:waxed_${id}`, `minecraft:waxed_${id}_stairs`, `minecraft:waxed_${id}_slab`,
        ]),
      ...ids("chiseled_copper", "copper_grate", "copper_bulb", "lightning_rod",
        "raw_copper_block", "copper_ore"),
    ],
  },
  {
    name: "Light",
    blocks: [
      "minecraft:glowstone", "minecraft:sea_lantern", "minecraft:shroomlight",
      "minecraft:redstone_lamp", "minecraft:jack_o_lantern", "minecraft:torch",
      "minecraft:lantern", "minecraft:soul_lantern", "minecraft:end_rod",
      "minecraft:ochre_froglight", "minecraft:verdant_froglight",
      "minecraft:pearlescent_froglight", "minecraft:beacon",
    ],
  },
  {
    name: "Utility",
    blocks: [
      "minecraft:crafting_table", "minecraft:furnace", "minecraft:chest",
      "minecraft:barrel", "minecraft:iron_bars", "minecraft:chain",
      "minecraft:ladder", "minecraft:scaffolding", "minecraft:glass_pane",
      "minecraft:hopper", "minecraft:observer", "minecraft:piston",
      "minecraft:sticky_piston", "minecraft:note_block", "minecraft:jukebox",
      "minecraft:tnt", "minecraft:target", "minecraft:sculk",
    ],
  },
];

export const ALL_COMMON_BLOCKS = BLOCK_GROUPS.flatMap((group) => group.blocks);
