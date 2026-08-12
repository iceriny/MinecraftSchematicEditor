/** Litematica `.litematic` reader and writer. */

import {
  asCompound, asList, asNumber, asString, asVec3, nbt, TAG,
  type NbtCompound, type NbtValue, type Tagged,
} from "../nbt/nbt";
import { AIR, Build, stateKey, type BlockState } from "../core/model";
import { bitsForPalette, pack, unpack } from "./bitpack";

/** Litematica reads 4, 5 and 6; 5 is understood by the widest range of builds. */
const WRITE_VERSION = 5;

function readState(value: NbtValue): BlockState {
  const c = asCompound(value);
  if (!c) return AIR;
  const name = asString(c.Name, "minecraft:air");
  const props = asCompound(c.Properties);
  if (!props) return { name };
  const properties: Record<string, string> = {};
  for (const key of Object.keys(props)) properties[key] = asString(props[key]);
  return Object.keys(properties).length ? { name, properties } : { name };
}

function writeState(state: BlockState): Tagged {
  const fields: Record<string, Tagged> = { Name: nbt.string(state.name) };
  if (state.properties && Object.keys(state.properties).length) {
    const props: Record<string, Tagged> = {};
    for (const key of Object.keys(state.properties)) props[key] = nbt.string(state.properties[key]);
    fields.Properties = nbt.compound(props);
  }
  return nbt.compound(fields);
}

interface Region {
  min: [number, number, number];
  size: [number, number, number];
  palette: BlockState[];
  indices: Uint16Array;
}

function readRegion(raw: NbtCompound): Region | null {
  const position = asVec3(raw.Position);
  const rawSize = asVec3(raw.Size);
  const size: [number, number, number] = [
    Math.abs(rawSize[0]),
    Math.abs(rawSize[1]),
    Math.abs(rawSize[2]),
  ];
  if (size[0] === 0 || size[1] === 0 || size[2] === 0) return null;

  // A negative extent means the region runs back from Position; the packed
  // array always starts at the minimum corner.
  const min: [number, number, number] = [0, 1, 2].map((axis) =>
    rawSize[axis] < 0 ? position[axis] + rawSize[axis] + 1 : position[axis],
  ) as [number, number, number];

  const palette = asList(raw.BlockStatePalette).map(readState);
  const longs = raw.BlockStates;
  const count = size[0] * size[1] * size[2];
  const indices =
    longs instanceof BigInt64Array
      ? unpack(longs, bitsForPalette(palette.length), count)
      : new Uint16Array(count);

  return { min, size, palette, indices };
}

export function readLitematic(root: NbtCompound): Build {
  const metadata = asCompound(root.Metadata) ?? {};
  const regionsRaw = asCompound(root.Regions);
  if (!regionsRaw) throw new Error("Litematic has no Regions compound.");

  const regions: Region[] = [];
  for (const name of Object.keys(regionsRaw)) {
    const raw = asCompound(regionsRaw[name]);
    if (!raw) continue;
    const region = readRegion(raw);
    if (region) regions.push(region);
  }
  if (regions.length === 0) throw new Error("Litematic contains no non-empty regions.");

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const region of regions) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], region.min[a]);
      max[a] = Math.max(max[a], region.min[a] + region.size[a]);
    }
  }

  const width = max[0] - min[0];
  const height = max[1] - min[1];
  const length = max[2] - min[2];

  const palette: BlockState[] = [AIR];
  const paletteIndex = new Map<string, number>([[stateKey(AIR), 0]]);
  const data = new Uint16Array(width * height * length);

  for (const region of regions) {
    // Map this region's palette onto the shared one once, not per block.
    const remap = new Uint16Array(region.palette.length);
    for (let i = 0; i < region.palette.length; i++) {
      const state = region.palette[i];
      const key = stateKey(state);
      if (key === "minecraft:air") {
        remap[i] = 0;
        continue;
      }
      let index = paletteIndex.get(key);
      if (index === undefined) {
        index = palette.length;
        palette.push(state);
        paletteIndex.set(key, index);
      }
      remap[i] = index;
    }

    const [rw, rh, rl] = region.size;
    const ox = region.min[0] - min[0];
    const oy = region.min[1] - min[1];
    const oz = region.min[2] - min[2];
    for (let y = 0; y < rh; y++) {
      for (let z = 0; z < rl; z++) {
        const src = (y * rl + z) * rw;
        const dst = ((y + oy) * length + (z + oz)) * width + ox;
        for (let x = 0; x < rw; x++) {
          const value = remap[region.indices[src + x]];
          if (value !== 0) data[dst + x] = value;
        }
      }
    }
  }

  return new Build(width, height, length, palette, data, {
    name: asString(metadata.Name, "Untitled"),
    author: asString(metadata.Author),
    description: asString(metadata.Description),
    format: "litematic",
    dataVersion: asNumber(root.MinecraftDataVersion, 3953),
  });
}

export function writeLitematic(build: Build): Tagged {
  const bits = bitsForPalette(build.palette.length);
  const now = BigInt(Date.now());
  const regionName = build.meta.name || "Build";

  const region = nbt.compound({
    Position: nbt.compound({ x: nbt.int(0), y: nbt.int(0), z: nbt.int(0) }),
    Size: nbt.compound({
      x: nbt.int(build.width),
      y: nbt.int(build.height),
      z: nbt.int(build.length),
    }),
    BlockStatePalette: nbt.list(TAG.Compound, build.palette.map(writeState)),
    BlockStates: nbt.longArray(pack(build.data, bits)),
    Entities: nbt.list(TAG.Compound, []),
    TileEntities: nbt.list(TAG.Compound, []),
    PendingBlockTicks: nbt.list(TAG.Compound, []),
    PendingFluidTicks: nbt.list(TAG.Compound, []),
  });

  return nbt.compound({
    MinecraftDataVersion: nbt.int(build.meta.dataVersion),
    Version: nbt.int(WRITE_VERSION),
    Metadata: nbt.compound({
      Name: nbt.string(build.meta.name),
      Author: nbt.string(build.meta.author),
      Description: nbt.string(build.meta.description),
      EnclosingSize: nbt.compound({
        x: nbt.int(build.width),
        y: nbt.int(build.height),
        z: nbt.int(build.length),
      }),
      RegionCount: nbt.int(1),
      TotalBlocks: nbt.int(build.totalBlocks()),
      TotalVolume: nbt.int(build.volume),
      TimeCreated: nbt.long(now),
      TimeModified: nbt.long(now),
    }),
    Regions: nbt.compound({ [regionName]: region }),
  });
}
