/** Vanilla structure block `.nbt` reader and writer. */

import {
  asCompound, asList, asNumber, asString, nbt, TAG,
  type NbtCompound, type NbtValue, type Tagged,
} from "../nbt/nbt";
import { AIR, Build, stateKey, type BlockState } from "../core/model";

export function isStructure(root: NbtCompound): boolean {
  return "size" in root && "blocks" in root && "palette" in root;
}

function readVec(value: NbtValue | undefined): [number, number, number] {
  if (value instanceof Int32Array) return [value[0], value[1], value[2]];
  if (Array.isArray(value)) return [asNumber(value[0]), asNumber(value[1]), asNumber(value[2])];
  return [0, 0, 0];
}

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

export function readStructure(root: NbtCompound): Build {
  const [width, height, length] = readVec(root.size);
  if (!width || !height || !length) throw new Error("Structure has no size.");

  const source = asList(root.palette).map(readState);
  const palette: BlockState[] = [AIR];
  const remap = new Uint16Array(source.length);
  for (let i = 0; i < source.length; i++) {
    if (stateKey(source[i]) === "minecraft:air") continue;
    remap[i] = palette.length;
    palette.push(source[i]);
  }

  // Structures store a sparse list of placed blocks rather than a dense array.
  const data = new Uint16Array(width * height * length);
  for (const entry of asList(root.blocks)) {
    const c = asCompound(entry);
    if (!c) continue;
    const [x, y, z] = readVec(c.pos);
    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= length) continue;
    data[(y * length + z) * width + x] = remap[asNumber(c.state)] ?? 0;
  }

  return new Build(width, height, length, palette, data, {
    name: "Untitled",
    author: asString(root.author),
    format: "nbt",
    dataVersion: asNumber(root.DataVersion, 3953),
  });
}

export function writeStructure(build: Build): Tagged {
  const blocks: Tagged[] = [];
  for (let y = 0; y < build.height; y++) {
    for (let z = 0; z < build.length; z++) {
      for (let x = 0; x < build.width; x++) {
        const value = build.data[(y * build.length + z) * build.width + x];
        if (value === 0) continue;
        blocks.push(
          nbt.compound({
            state: nbt.int(value),
            pos: nbt.list(TAG.Int, [nbt.int(x), nbt.int(y), nbt.int(z)]),
          }),
        );
      }
    }
  }

  const palette = build.palette.map((state) => {
    const fields: Record<string, Tagged> = { Name: nbt.string(state.name) };
    if (state.properties && Object.keys(state.properties).length) {
      const props: Record<string, Tagged> = {};
      for (const key of Object.keys(state.properties)) props[key] = nbt.string(state.properties[key]);
      fields.Properties = nbt.compound(props);
    }
    return nbt.compound(fields);
  });

  return nbt.compound({
    DataVersion: nbt.int(build.meta.dataVersion),
    size: nbt.list(TAG.Int, [nbt.int(build.width), nbt.int(build.height), nbt.int(build.length)]),
    palette: nbt.list(TAG.Compound, palette),
    blocks: nbt.list(TAG.Compound, blocks),
    entities: nbt.list(TAG.Compound, []),
    author: nbt.string(build.meta.author || "schematic-editor"),
  });
}

export type { NbtCompound };
