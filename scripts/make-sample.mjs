/**
 * Writes sample builds into public/samples/.
 *
 * This is a deliberately separate NBT implementation from the one in src/ —
 * if a file written here loads correctly in the app, both sides agree on the
 * format rather than on the same bug.
 *
 *   node scripts/make-sample.mjs
 */

import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");

/* --------------------------------------------------------------- NBT out */

class Out {
  constructor() {
    this.parts = [];
  }
  raw(buf) { this.parts.push(buf); return this; }
  u8(v) { return this.raw(Buffer.from([v & 0xff])); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); return this.raw(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); return this.raw(b); }
  i64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, v)); return this.raw(b); }
  str(s) { const b = Buffer.from(s, "utf8"); this.i16(b.length); return this.raw(b); }
  done() { return Buffer.concat(this.parts); }
}

const T = { Byte: 1, Short: 2, Int: 3, Long: 4, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12 };

const Int = (v) => ({ t: T.Int, v });
const Short = (v) => ({ t: T.Short, v });
const Long = (v) => ({ t: T.Long, v });
const Str = (v) => ({ t: T.String, v });
const Byte = (v) => ({ t: T.Byte, v });
const Compound = (v) => ({ t: T.Compound, v });
const List = (itemType, v) => ({ t: T.List, itemType, v });
const IntArray = (v) => ({ t: T.IntArray, v });
const LongArray = (v) => ({ t: T.LongArray, v });
const ByteArray = (v) => ({ t: 7, v });

function payload(out, tag) {
  switch (tag.t) {
    case T.Byte: out.u8(tag.v); break;
    case T.Short: out.i16(tag.v); break;
    case T.Int: out.i32(tag.v); break;
    case T.Long: out.i64(tag.v); break;
    case T.String: out.str(tag.v); break;
    case 7: out.i32(tag.v.length); out.raw(Buffer.from(tag.v)); break;
    case T.List:
      out.u8(tag.v.length ? tag.v[0].t : tag.itemType);
      out.i32(tag.v.length);
      for (const item of tag.v) payload(out, item);
      break;
    case T.Compound:
      for (const [key, child] of Object.entries(tag.v)) {
        out.u8(child.t);
        out.str(key);
        payload(out, child);
      }
      out.u8(0);
      break;
    case T.IntArray: out.i32(tag.v.length); for (const n of tag.v) out.i32(n); break;
    case T.LongArray: out.i32(tag.v.length); for (const n of tag.v) out.i64(n); break;
    default: throw new Error(`unhandled tag ${tag.t}`);
  }
}

function encode(root, rootName = "") {
  const out = new Out();
  out.u8(T.Compound);
  out.str(rootName);
  payload(out, root);
  return out.done();
}

/* ------------------------------------------------------------- the build */

class Grid {
  constructor(w, h, l) {
    this.w = w; this.h = h; this.l = l;
    this.palette = ["minecraft:air"];
    this.data = new Uint16Array(w * h * l);
  }
  id(name) {
    const found = this.palette.indexOf(name);
    if (found !== -1) return found;
    this.palette.push(name);
    return this.palette.length - 1;
  }
  set(x, y, z, name) {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.l) return;
    this.data[(y * this.l + z) * this.w + x] = this.id(name);
  }
  box(x0, y0, z0, x1, y1, z1, name) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, name);
  }
  hollowBox(x0, y0, z0, x1, y1, z1, name) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const onEdge = x === x0 || x === x1 || z === z0 || z === z1;
          if (onEdge) this.set(x, y, z, name);
        }
  }
}

function cottage() {
  const W = 17, H = 13, L = 15;
  const g = new Grid(W, H, L);

  // Ground and footing
  g.box(0, 0, 0, W - 1, 0, L - 1, "minecraft:grass_block");
  g.box(1, 0, 1, W - 2, 0, L - 2, "minecraft:stone_bricks");
  g.box(2, 1, 2, W - 3, 1, L - 3, "minecraft:spruce_planks");

  // Walls
  for (let y = 2; y <= 6; y++) g.hollowBox(2, y, 2, W - 3, y, L - 3, "minecraft:white_terracotta");
  // Corner posts and a beam course
  for (const [x, z] of [[2, 2], [2, L - 3], [W - 3, 2], [W - 3, L - 3]]) {
    for (let y = 2; y <= 6; y++) g.set(x, y, z, "minecraft:dark_oak_log");
  }
  g.hollowBox(2, 6, 2, W - 3, 6, L - 3, "minecraft:dark_oak_planks");

  // Windows
  for (const z of [4, 6, 8, 10]) {
    for (let y = 4; y <= 5; y++) {
      g.set(2, y, z, "minecraft:glass_pane");
      g.set(W - 3, y, z, "minecraft:glass_pane");
    }
  }
  for (const x of [5, 7, 11, 13]) {
    for (let y = 4; y <= 5; y++) g.set(x, y, L - 3, "minecraft:glass_pane");
  }

  // Doorway with a stone step
  g.set(8, 2, 2, "minecraft:air");
  g.set(8, 3, 2, "minecraft:air");
  g.set(8, 4, 2, "minecraft:oak_door");
  g.set(8, 1, 1, "minecraft:stone_brick_stairs");

  // Gabled roof in stairs, stepping in on each course
  let inset = 1;
  for (let y = 7; y <= 10; y++) {
    const x0 = 2 - inset + (y - 6) * 1;
    const x1 = W - 3 + inset - (y - 6) * 1;
    const z0 = 2 - inset + (y - 6) * 1;
    const z1 = L - 3 + inset - (y - 6) * 1;
    if (x0 > x1 || z0 > z1) break;
    g.hollowBox(x0, y, z0, x1, y, z1, "minecraft:deepslate_tiles");
    for (let x = x0; x <= x1; x++) {
      g.set(x, y, z0, "minecraft:deepslate_tile_stairs");
      g.set(x, y, z1, "minecraft:deepslate_tile_stairs");
    }
  }
  g.box(6, 11, 6, W - 7, 11, L - 7, "minecraft:deepslate_tiles");

  // Chimney
  g.box(4, 7, 4, 5, 12, 5, "minecraft:bricks");
  g.box(4, 12, 4, 5, 12, 5, "minecraft:campfire");

  // Interior
  g.set(4, 3, 11, "minecraft:crafting_table");
  g.set(5, 3, 11, "minecraft:furnace");
  g.set(12, 3, 11, "minecraft:chest");
  g.set(12, 3, 4, "minecraft:bookshelf");
  g.set(11, 3, 4, "minecraft:bookshelf");
  g.set(8, 6, 8, "minecraft:glowstone");
  g.box(6, 2, 6, 7, 2, 7, "minecraft:oak_planks");

  // Garden
  for (const [x, z] of [[1, 1], [W - 2, 1], [1, L - 2], [W - 2, L - 2]]) {
    g.set(x, 1, z, "minecraft:oak_log");
    g.set(x, 2, z, "minecraft:oak_leaves");
  }
  g.box(13, 1, 12, 15, 1, 13, "minecraft:water");
  for (const x of [3, 5, 12]) g.set(x, 1, 13, "minecraft:poppy");
  for (const x of [4, 11]) g.set(x, 1, 13, "minecraft:dandelion");

  return g;
}

/**
 * A big build, for checking the viewer stays responsive: layered terrain with
 * a lake, a walled tower, and scattered trees.
 */
function citadel() {
  const W = 96, H = 48, L = 96;
  const g = new Grid(W, H, L);
  const SEA = 7;

  const height = (x, z) => {
    const n =
      Math.sin(x * 0.11) * 2.6 +
      Math.cos(z * 0.09) * 2.4 +
      Math.sin((x + z) * 0.05) * 3.2 +
      Math.cos((x - z) * 0.16) * 1.1;
    return Math.round(9 + n);
  };

  for (let x = 0; x < W; x++) {
    for (let z = 0; z < L; z++) {
      const top = Math.max(1, height(x, z));
      for (let y = 0; y <= top; y++) {
        const depth = top - y;
        const name =
          depth === 0 ? (top <= SEA ? "minecraft:sand" : "minecraft:grass_block")
          : depth < 3 ? (top <= SEA ? "minecraft:sand" : "minecraft:dirt")
          : depth < 7 ? "minecraft:stone"
          : "minecraft:deepslate";
        g.set(x, y, z, name);
      }
      for (let y = top + 1; y <= SEA; y++) g.set(x, y, z, "minecraft:water");
    }
  }

  // Curtain wall with crenellations
  const wall = (x0, z0, x1, z1) => {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
        const base = Math.max(height(x, z), SEA) + 1;
        for (let y = base; y < base + 6; y++) g.set(x, y, z, "minecraft:stone_bricks");
        if ((x + z) % 2 === 0) g.set(x, base + 6, z, "minecraft:stone_brick_wall");
      }
    }
  };
  wall(20, 20, 75, 75);

  // Corner towers
  for (const [cx, cz] of [[20, 20], [75, 20], [20, 75], [75, 75]]) {
    const base = Math.max(height(cx, cz), SEA) + 1;
    for (let y = base; y < base + 14; y++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx * dx + dz * dz > 6) continue;
          const solid = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          if (solid) g.set(cx + dx, y, cz + dz, "minecraft:deepslate_bricks");
        }
      }
    }
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz > 6) continue;
        g.set(cx + dx, base + 14, cz + dz, "minecraft:dark_oak_planks");
      }
    }
  }

  // Central keep
  const kx = 48, kz = 48;
  const kBase = Math.max(height(kx, kz), SEA) + 1;
  for (let y = kBase; y < kBase + 24; y++) {
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const edge = Math.abs(dx) === 6 || Math.abs(dz) === 6;
        if (!edge) continue;
        const window = y % 5 === 2 && (dx % 4 === 0 || dz % 4 === 0);
        g.set(kx + dx, y, kz + dz, window ? "minecraft:glass" : "minecraft:polished_andesite");
      }
    }
    if ((y - kBase) % 8 === 0) {
      for (let dx = -6; dx <= 6; dx++)
        for (let dz = -6; dz <= 6; dz++) g.set(kx + dx, y, kz + dz, "minecraft:spruce_planks");
    }
  }
  for (let step = 0; step <= 6; step++) {
    const r = 6 - step;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) g.set(kx + dx, kBase + 24 + step, kz + dz, "minecraft:deepslate_tiles");
  }
  g.set(kx, kBase + 31, kz, "minecraft:sea_lantern");

  // Trees outside the wall
  let seed = 1337;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 90; i++) {
    const x = 3 + Math.floor(rand() * (W - 6));
    const z = 3 + Math.floor(rand() * (L - 6));
    if (x > 17 && x < 78 && z > 17 && z < 78) continue;
    const top = height(x, z);
    if (top <= SEA) continue;
    const trunk = 4 + Math.floor(rand() * 3);
    for (let y = top + 1; y <= top + trunk; y++) g.set(x, y, z, "minecraft:oak_log");
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (dx * dx + dz * dz + dy * dy * 3 > 6) continue;
          g.set(x + dx, top + trunk + dy, z + dz, "minecraft:oak_leaves");
        }
  }

  return g;
}

/* ---------------------------------------------------------------- output */

function bitsFor(size) {
  return Math.max(2, 32 - Math.clz32(Math.max(1, size - 1)));
}

function packLongs(values, bits) {
  const total = values.length * bits;
  const words = Math.ceil(total / 64);
  const out = new Array(words).fill(0n);
  for (let i = 0; i < values.length; i++) {
    const value = BigInt(values[i]);
    const start = i * bits;
    const word = Math.floor(start / 64);
    const offset = BigInt(start % 64);
    out[word] = BigInt.asUintN(64, out[word] | BigInt.asUintN(64, value << offset));
    const spill = Number(offset) + bits - 64;
    if (spill > 0) out[word + 1] |= value >> BigInt(64 - Number(offset));
  }
  return out.map((v) => BigInt.asIntN(64, v));
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

function writeLitematic(g, name) {
  const bits = bitsFor(g.palette.length);
  const now = BigInt(Date.now());
  let blocks = 0;
  for (const v of g.data) if (v !== 0) blocks++;

  const root = Compound({
    MinecraftDataVersion: Int(3953),
    Version: Int(5),
    Metadata: Compound({
      Name: Str(name),
      Author: Str("sample generator"),
      Description: Str("Bundled sample build"),
      EnclosingSize: Compound({ x: Int(g.w), y: Int(g.h), z: Int(g.l) }),
      RegionCount: Int(1),
      TotalBlocks: Int(blocks),
      TotalVolume: Int(g.w * g.h * g.l),
      TimeCreated: Long(now),
      TimeModified: Long(now),
    }),
    Regions: Compound({
      [name]: Compound({
        Position: Compound({ x: Int(0), y: Int(0), z: Int(0) }),
        Size: Compound({ x: Int(g.w), y: Int(g.h), z: Int(g.l) }),
        BlockStatePalette: List(T.Compound, g.palette.map(stateTag)),
        BlockStates: LongArray(packLongs(g.data, bits)),
        Entities: List(T.Compound, []),
        TileEntities: List(T.Compound, []),
        PendingBlockTicks: List(T.Compound, []),
        PendingFluidTicks: List(T.Compound, []),
      }),
    }),
  });
  return gzipSync(encode(root));
}

function writeSchem(g, name) {
  const varints = [];
  for (const value of g.data) {
    let v = value;
    while (v & ~0x7f) {
      varints.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    varints.push(v);
  }
  const palette = {};
  g.palette.forEach((key, index) => { palette[key] = Int(index); });

  const root = Compound({
    Version: Int(2),
    DataVersion: Int(3953),
    Width: Short(g.w),
    Height: Short(g.h),
    Length: Short(g.l),
    Offset: IntArray([0, 0, 0]),
    PaletteMax: Int(g.palette.length),
    Palette: Compound(palette),
    BlockData: ByteArray(varints),
    BlockEntities: List(T.Compound, []),
    Metadata: Compound({ Name: Str(name), Author: Str("sample generator") }),
  });
  return gzipSync(encode(root, "Schematic"));
}

/** MCEdit-era file, so the legacy id path gets exercised too. */
function writeClassic(g, name) {
  const LEGACY = {
    "minecraft:air": [0, 0],
    "minecraft:grass_block": [2, 0],
    "minecraft:stone_bricks": [98, 0],
    "minecraft:spruce_planks": [5, 1],
    "minecraft:white_terracotta": [159, 0],
    "minecraft:dark_oak_log": [162, 1],
    "minecraft:dark_oak_planks": [5, 5],
    "minecraft:glass_pane": [102, 0],
    "minecraft:oak_door": [64, 0],
    "minecraft:stone_brick_stairs": [109, 0],
    "minecraft:deepslate_tiles": [98, 2],
    "minecraft:deepslate_tile_stairs": [109, 0],
    "minecraft:bricks": [45, 0],
    "minecraft:campfire": [50, 0],
    "minecraft:crafting_table": [58, 0],
    "minecraft:furnace": [61, 0],
    "minecraft:chest": [54, 0],
    "minecraft:bookshelf": [47, 0],
    "minecraft:glowstone": [89, 0],
    "minecraft:oak_planks": [5, 0],
    "minecraft:oak_log": [17, 0],
    "minecraft:oak_leaves": [18, 0],
    "minecraft:water": [9, 0],
    "minecraft:poppy": [38, 0],
    "minecraft:dandelion": [37, 0],
  };
  const ids = Buffer.alloc(g.data.length);
  const meta = Buffer.alloc(g.data.length);
  for (let i = 0; i < g.data.length; i++) {
    const [id, value] = LEGACY[g.palette[g.data[i]]] ?? [1, 0];
    ids[i] = id & 0xff;
    meta[i] = value;
  }
  const root = Compound({
    Width: Short(g.w),
    Height: Short(g.h),
    Length: Short(g.l),
    Materials: Str("Alpha"),
    Blocks: ByteArray(ids),
    Data: ByteArray(meta),
    Entities: List(T.Compound, []),
    TileEntities: List(T.Compound, []),
    Name: Str(name),
  });
  return gzipSync(encode(root, "Schematic"));
}

mkdirSync(OUT_DIR, { recursive: true });

const g = cottage();
const big = citadel();
const files = [
  ["cottage.litematic", writeLitematic(g, "Terracotta Cottage")],
  ["cottage.schem", writeSchem(g, "Terracotta Cottage")],
  ["cottage.schematic", writeClassic(g, "Terracotta Cottage")],
  ["citadel.litematic", writeLitematic(big, "Lakeside Citadel")],
];
for (const [name, bytes] of files) {
  writeFileSync(join(OUT_DIR, name), bytes);
  console.log(`${name.padEnd(22)} ${bytes.length.toLocaleString()} bytes`);
}
for (const [label, grid] of [["cottage", g], ["citadel", big]]) {
  let blocks = 0;
  for (const v of grid.data) if (v !== 0) blocks++;
  console.log(
    `${label.padEnd(10)} ${grid.w}x${grid.h}x${grid.l}  ` +
      `${blocks.toLocaleString()} blocks, ${grid.palette.length} palette entries`,
  );
}
