/** MCEdit / Schematica `.schematic` reader (legacy numeric block ids). */

import { asNumber, asString, type NbtCompound } from "../nbt/nbt";
import { AIR, Build, stateKey, type BlockState } from "../core/model";
import { legacyState } from "./legacyIds";

export function isClassic(root: NbtCompound): boolean {
  return root.Blocks instanceof Int8Array && "Width" in root;
}

export function readClassic(root: NbtCompound): Build {
  const width = asNumber(root.Width);
  const height = asNumber(root.Height);
  const length = asNumber(root.Length);
  const blocks = root.Blocks as Int8Array;
  if (!width || !height || !length || !(blocks instanceof Int8Array)) {
    throw new Error("Classic schematic is missing its size or block array.");
  }

  const meta = root.Data instanceof Int8Array ? root.Data : new Int8Array(blocks.length);
  // Ids above 255 live in a separate array: Schematica packs two per byte,
  // MCEdit's older `Add` uses one byte each.
  const addNibbles = root.AddBlocks instanceof Int8Array ? root.AddBlocks : null;
  const addBytes = root.Add instanceof Int8Array ? root.Add : null;

  const count = Math.min(width * height * length, blocks.length);
  const palette: BlockState[] = [AIR];
  const paletteIndex = new Map<string, number>([["minecraft:air", 0]]);
  const data = new Uint16Array(width * height * length);
  // id:meta -> palette index, so each distinct pair is only resolved once.
  const seen = new Map<number, number>();

  for (let i = 0; i < count; i++) {
    let id = blocks[i] & 0xff;
    if (addNibbles) {
      const packed = addNibbles[i >> 1] & 0xff;
      id |= ((i & 1) === 0 ? (packed >> 4) & 0x0f : packed & 0x0f) << 8;
    } else if (addBytes && i < addBytes.length) {
      id |= (addBytes[i] & 0xff) << 8;
    }
    if (id === 0) continue;

    const value = meta[i] & 0x0f;
    const cacheKey = (id << 4) | value;
    let index = seen.get(cacheKey);
    if (index === undefined) {
      const state = legacyState(id, value);
      const key = stateKey(state);
      if (key === "minecraft:air") {
        index = 0;
      } else {
        index = paletteIndex.get(key) ?? -1;
        if (index === -1) {
          index = palette.length;
          palette.push(state);
          paletteIndex.set(key, index);
        }
      }
      seen.set(cacheKey, index);
    }
    data[i] = index;
  }

  return new Build(width, height, length, palette, data, {
    name: asString(root.Name, "Untitled"),
    author: asString(root.Author),
    format: "schematic",
    dataVersion: 1343, // 1.12.2, the last version that used numeric ids
  });
}
