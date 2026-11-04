import type { ResourcePack } from "./pack";

// WindowGen.woodenWindowBlock supplies a cube_column with this pair of sprites.
// AllSpriteShifts.getWoodenWindow registers the side as VERTICAL. Other window
// factories assign different behaviours, even when they share a base sprite.
export const WINDOW_FACTORY = "com/simibubi/create/foundation/data/WindowGen.class";
export const WINDOW_SHIFTS = "com/simibubi/create/AllSpriteShifts.class";

export function hasWoodenWindowFactory(files: Record<string, Uint8Array>): boolean {
  const factory = files[WINDOW_FACTORY], shifts = files[WINDOW_SHIFTS];
  if (!factory || !shifts) return false;
  const decoder = new TextDecoder("latin1");
  const registration = decoder.decode(factory), registry = decoder.decode(shifts);
  return registration.includes("woodenWindowBlock") && registration.includes("getWoodenWindow") &&
    registry.includes("getWoodenWindow") && registry.includes("WOODEN_WINDOWS") &&
    registry.includes("palettes/\x01_window") && registry.includes("vertical");
}

export function squarePngSize(bytes: Uint8Array | undefined): number {
  if (!bytes || bytes.length < 24) return 0;
  const header = new DataView(bytes.buffer, bytes.byteOffset, 24);
  if (header.getUint32(0) !== 0x89504e47 || header.getUint32(12) !== 0x49484452) return 0;
  const width = header.getUint32(16);
  return width === header.getUint32(20) ? width : 0;
}

export function woodenWindowSprites(pack: ResourcePack, id: string) {
  const wood = /^create:([a-z0-9_]+)_window$/.exec(id)?.[1];
  if (!wood) return;
  const variants = pack.blockstates.get(id)?.variants;
  if (!variants || Object.keys(variants).length !== 1) return;
  const variant = variants[""];
  const modelId = `create:block/${wood}_window`;
  if (!variant || Array.isArray(variant) || variant.model !== modelId || variant.x || variant.y) return;
  const model = pack.models.get(modelId);
  const side = `create:block/palettes/${wood}_window`;
  if (model?.parent !== "minecraft:block/cube_column" || model.elements || model.loader ||
      model.textures?.end !== `minecraft:block/${wood}_planks` || model.textures.side !== side) return;
  const atlas = side + "_connected";
  const size = squarePngSize(pack.textures.get(side));
  if (size === 0 || squarePngSize(pack.textures.get(atlas)) !== size * 2 ||
      pack.animated.has(atlas) || pack.animated.has(side)) return;
  return { side, atlas };
}
