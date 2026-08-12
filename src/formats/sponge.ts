/** Sponge schematic (`.schem`) reader and writer — WorldEdit's format. */

import {
  asCompound, asNumber, asString, nbt, TAG, type NbtCompound, type Tagged,
} from "../nbt/nbt";
import { AIR, Build, parseStateKey, stateKey, type BlockState } from "../core/model";
import { readVarints, writeVarints } from "./bitpack";

/** Version 3 nests everything under `Schematic`; 1 and 2 sit at the root. */
export function isSponge(root: NbtCompound): boolean {
  const body = asCompound(root.Schematic) ?? root;
  return "Palette" in body || "BlockData" in body || "Blocks" in body;
}

export function readSponge(root: NbtCompound): Build {
  const body = asCompound(root.Schematic) ?? root;
  const width = asNumber(body.Width);
  const height = asNumber(body.Height);
  const length = asNumber(body.Length);
  if (!width || !height || !length) throw new Error("Sponge schematic has no size.");

  // v3 moved the palette and data into a `Blocks` container.
  const blocks = asCompound(body.Blocks);
  const rawPalette = asCompound(blocks?.Palette ?? body.Palette);
  const rawData = (blocks?.Data ?? body.BlockData) as Int8Array | undefined;
  if (!rawPalette || !(rawData instanceof Int8Array)) {
    throw new Error("Sponge schematic is missing its palette or block data.");
  }

  // The on-disk palette maps name -> index, so invert it.
  let maxIndex = 0;
  for (const key of Object.keys(rawPalette)) {
    maxIndex = Math.max(maxIndex, asNumber(rawPalette[key]));
  }
  const source: BlockState[] = new Array(maxIndex + 1).fill(AIR);
  for (const key of Object.keys(rawPalette)) {
    source[asNumber(rawPalette[key])] = parseStateKey(key);
  }

  const raw = readVarints(rawData, width * height * length);

  // Re-key onto a palette whose index 0 is air, the invariant Build relies on.
  const palette: BlockState[] = [AIR];
  const remap = new Uint16Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const key = stateKey(source[i]);
    if (key === "minecraft:air") continue;
    remap[i] = palette.length;
    palette.push(source[i]);
  }
  const data = new Uint16Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = remap[raw[i]] ?? 0;

  const metadata = asCompound(body.Metadata) ?? {};
  return new Build(width, height, length, palette, data, {
    name: asString(metadata.Name, asString(metadata.name, "Untitled")),
    author: asString(metadata.Author, asString(metadata.author)),
    format: "schem",
    dataVersion: asNumber(body.DataVersion, 3953),
  });
}

/** Writes version 2, which every current WorldEdit build reads. */
export function writeSponge(build: Build): Tagged {
  const palette: Record<string, Tagged> = {};
  build.palette.forEach((state, index) => {
    palette[stateKey(state)] = nbt.int(index);
  });

  return nbt.compound({
    Version: nbt.int(2),
    DataVersion: nbt.int(build.meta.dataVersion),
    Width: nbt.short(build.width),
    Height: nbt.short(build.height),
    Length: nbt.short(build.length),
    Offset: nbt.intArray([0, 0, 0]),
    PaletteMax: nbt.int(build.palette.length),
    Palette: nbt.compound(palette),
    BlockData: nbt.byteArray(writeVarints(build.data)),
    BlockEntities: nbt.list(TAG.Compound, []),
    Metadata: nbt.compound({
      Name: nbt.string(build.meta.name),
      Author: nbt.string(build.meta.author),
      WEOffsetX: nbt.int(0),
      WEOffsetY: nbt.int(0),
      WEOffsetZ: nbt.int(0),
    }),
  });
}
