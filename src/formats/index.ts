/** Format detection, loading, and saving. */

import { decompress, gzip } from "../nbt/compress";
import { parseNbt, writeNbt, type NbtCompound } from "../nbt/nbt";
import type { Build } from "../core/model";
import { readLitematic, writeLitematic } from "./litematic";
import { isSponge, readSponge, writeSponge } from "./sponge";
import { isStructure, readStructure, writeStructure } from "./structure";
import { isClassic, readClassic } from "./classic";

export type SaveFormat = "litematic" | "schem" | "nbt";

export const ACCEPTED_EXTENSIONS = [".litematic", ".schem", ".schematic", ".nbt"];

function detect(root: NbtCompound): string {
  if ("Regions" in root && "Metadata" in root) return "litematic";
  if (isClassic(root)) return "schematic";
  if (isSponge(root)) return "schem";
  if (isStructure(root)) return "nbt";
  return "unknown";
}

/** Parses any supported schematic file into a {@link Build}. */
export async function loadBuild(file: File): Promise<Build> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let root: NbtCompound;
  try {
    root = parseNbt(await decompress(bytes)).root;
  } catch (cause) {
    throw new Error(
      `${file.name} isn't readable NBT. Litematica and WorldEdit files are gzipped NBT — ` +
        `check the file isn't a zip or a renamed world save.`,
      { cause },
    );
  }

  const format = detect(root);
  const build = (() => {
    switch (format) {
      case "litematic": return readLitematic(root);
      case "schematic": return readClassic(root);
      case "schem": return readSponge(root);
      case "nbt": return readStructure(root);
      default:
        throw new Error(
          `${file.name} is NBT but not a schematic this app recognises. ` +
            `Supported: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
        );
    }
  })();

  if (build.meta.name === "Untitled") {
    build.meta.name = file.name.replace(/\.[^.]+$/, "");
  }
  return build;
}

/** Serialises a build, gzipped the way every tool in this space expects. */
export async function saveBuild(source: Build, format: SaveFormat): Promise<Blob> {
  const build = source.compacted();
  const rootName = format === "schem" ? "Schematic" : "";
  const tagged =
    format === "litematic" ? writeLitematic(build)
    : format === "schem" ? writeSponge(build)
    : writeStructure(build);
  const packed = await gzip(writeNbt(tagged, rootName));
  return new Blob([packed.slice().buffer as ArrayBuffer], { type: "application/octet-stream" });
}

export function suggestFilename(build: Build, format: SaveFormat): string {
  const stem = (build.meta.name || "build").replace(/[^\w\-. ]+/g, "_").trim() || "build";
  return `${stem}.${format}`;
}
