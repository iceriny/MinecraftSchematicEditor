/**
 * Writes public/samples/orientation.litematic — a row of blocks whose textures
 * make their orientation obvious, for checking UV mapping against the game.
 *
 *   node scripts/make-orientation-test.mjs
 */

import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");

class Out {
  constructor() { this.parts = []; }
  raw(b) { this.parts.push(b); return this; }
  u8(v) { return this.raw(Buffer.from([v & 0xff])); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); return this.raw(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); return this.raw(b); }
  i64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, v)); return this.raw(b); }
  str(s) { const b = Buffer.from(s, "utf8"); this.i16(b.length); return this.raw(b); }
  done() { return Buffer.concat(this.parts); }
}

const T = { Int: 3, Long: 4, String: 8, List: 9, Compound: 10, LongArray: 12 };
const Int = (v) => ({ t: T.Int, v });
const Long = (v) => ({ t: T.Long, v });
const Str = (v) => ({ t: T.String, v });
const Compound = (v) => ({ t: T.Compound, v });
const List = (itemType, v) => ({ t: T.List, itemType, v });
const LongArray = (v) => ({ t: T.LongArray, v });

function payload(out, tag) {
  switch (tag.t) {
    case T.Int: out.i32(tag.v); break;
    case T.Long: out.i64(tag.v); break;
    case T.String: out.str(tag.v); break;
    case T.List:
      out.u8(tag.v.length ? tag.v[0].t : tag.itemType);
      out.i32(tag.v.length);
      for (const item of tag.v) payload(out, item);
      break;
    case T.Compound:
      for (const [k, child] of Object.entries(tag.v)) { out.u8(child.t); out.str(k); payload(out, child); }
      out.u8(0);
      break;
    case T.LongArray: out.i32(tag.v.length); for (const n of tag.v) out.i64(n); break;
    default: throw new Error(`tag ${tag.t}`);
  }
}

function encode(root, name = "") {
  const out = new Out();
  out.u8(T.Compound);
  out.str(name);
  payload(out, root);
  return out.done();
}

function stateTag(key) {
  const open = key.indexOf("[");
  if (open === -1) return Compound({ Name: Str(key) });
  const props = {};
  for (const pair of key.slice(open + 1, -1).split(",")) {
    const [k, v] = pair.split("=");
    props[k] = Str(v);
  }
  return Compound({ Name: Str(key.slice(0, open)), Properties: Compound(props) });
}

const bitsFor = (n) => Math.max(2, 32 - Math.clz32(Math.max(1, n - 1)));

function packLongs(values, bits) {
  const words = Math.ceil((values.length * bits) / 64);
  const out = new Array(words).fill(0n);
  for (let i = 0; i < values.length; i++) {
    const value = BigInt(values[i]);
    const start = i * bits;
    const word = Math.floor(start / 64);
    const offset = BigInt(start % 64);
    out[word] = BigInt.asUintN(64, out[word] | BigInt.asUintN(64, value << offset));
    if (Number(offset) + bits > 64) out[word + 1] |= value >> BigInt(64 - Number(offset));
  }
  return out.map((v) => BigInt.asIntN(64, v));
}

/*
 * Each block below is asymmetric in a way that pins down one axis:
 *   grass_block   green fringe must sit at the TOP of every side
 *   oak_log       rings on top and bottom, vertical grain on the sides
 *   furnace       the opening faces `facing`, and sits low on that face
 *   crafting_table front and side textures differ, top is its own
 *   tnt           lettering band runs horizontally, right way up
 *   bookshelf     shelves run horizontally
 *   sandstone     the banded top differs from the sides
 *   jukebox / note_block   distinct top
 */
const BLOCKS = [
  "minecraft:grass_block",
  "minecraft:oak_log[axis=y]",
  "minecraft:oak_log[axis=x]",
  "minecraft:oak_log[axis=z]",
  "minecraft:furnace[facing=south,lit=false]",
  "minecraft:furnace[facing=east,lit=false]",
  "minecraft:crafting_table",
  "minecraft:tnt",
  "minecraft:bookshelf",
  "minecraft:sandstone",
  "minecraft:jukebox",
  "minecraft:pumpkin",
  "minecraft:carved_pumpkin[facing=south]",
  "minecraft:oak_stairs[facing=south,half=bottom,shape=straight]",
  "minecraft:oak_slab[type=bottom]",
];

// One block per cell with a gap between, so no face is ever culled.
const STRIDE = 2;
const W = BLOCKS.length * STRIDE;
const H = 1;
const L = 1;

const palette = ["minecraft:air", ...BLOCKS];
const data = new Uint16Array(W * H * L);
BLOCKS.forEach((_, i) => { data[i * STRIDE] = i + 1; });

const bits = bitsFor(palette.length);
const now = BigInt(Date.now());
const root = Compound({
  MinecraftDataVersion: Int(3953),
  Version: Int(5),
  Metadata: Compound({
    Name: Str("Orientation test"),
    Author: Str("test"),
    Description: Str("Blocks whose textures reveal their orientation"),
    EnclosingSize: Compound({ x: Int(W), y: Int(H), z: Int(L) }),
    RegionCount: Int(1),
    TotalBlocks: Int(BLOCKS.length),
    TotalVolume: Int(W * H * L),
    TimeCreated: Long(now),
    TimeModified: Long(now),
  }),
  Regions: Compound({
    Test: Compound({
      Position: Compound({ x: Int(0), y: Int(0), z: Int(0) }),
      Size: Compound({ x: Int(W), y: Int(H), z: Int(L) }),
      BlockStatePalette: List(T.Compound, palette.map(stateTag)),
      BlockStates: LongArray(packLongs(data, bits)),
      Entities: List(T.Compound, []),
      TileEntities: List(T.Compound, []),
      PendingBlockTicks: List(T.Compound, []),
      PendingFluidTicks: List(T.Compound, []),
    }),
  }),
});

mkdirSync(OUT, { recursive: true });
const bytes = gzipSync(encode(root));
writeFileSync(join(OUT, "orientation.litematic"), bytes);
console.log(`orientation.litematic  ${bytes.length} bytes  ${W}x${H}x${L}`);
BLOCKS.forEach((b, i) => console.log(`  x=${i * STRIDE}  ${b}`));
