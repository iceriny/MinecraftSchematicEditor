/**
 * Builds the texture array the block shader samples.
 *
 * One layer per texture rather than one atlas: a 2D array has no bleeding
 * between neighbours, so mipmaps work without gutter padding, and Minecraft
 * textures are all the same size within a pack anyway.
 */

import * as THREE from "three";
import type { ResourcePack } from "./pack";

export interface DecodedTexture {
  size: number;
  rgba: Uint8ClampedArray;
  /** No pixel is even slightly transparent. */
  opaque: boolean;
}

async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" });
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  // close() zeroes the bitmap's width and height, so read them first.
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, width, height);
  bitmap.close();
  return { width, height, data: image.data };
}

/**
 * Decodes one texture, cropping animated strips to their first frame. Vanilla
 * stores animations as a vertical filmstrip, so an unhandled water texture
 * would otherwise render as 32 squashed frames.
 */
let decodeWarned = false;

export async function decodeTexture(bytes: Uint8Array): Promise<DecodedTexture | null> {
  let decoded;
  try {
    decoded = await decodePng(bytes);
  } catch (cause) {
    // One warning is enough; a broken pack fails the same way for every file.
    if (!decodeWarned) {
      decodeWarned = true;
      console.warn("Texture decode failed, falling back to flat colours:", cause);
    }
    return null;
  }
  const { width, height, data } = decoded;
  if (width === 0 || height === 0) return null;

  const size = height > width && height % width === 0 ? width : Math.min(width, height);
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = y * width * 4;
    rgba.set(data.subarray(src, src + size * 4), y * size * 4);
  }

  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  return { size, rgba, opaque };
}

/** Nearest-neighbour resize, so pixel art stays pixel art. */
function upscale(source: DecodedTexture, target: number): Uint8ClampedArray {
  if (source.size === target) return source.rgba;
  const out = new Uint8ClampedArray(target * target * 4);
  const scale = source.size / target;
  for (let y = 0; y < target; y++) {
    const sy = Math.min(source.size - 1, (y * scale) | 0);
    for (let x = 0; x < target; x++) {
      const sx = Math.min(source.size - 1, (x * scale) | 0);
      const src = (sy * source.size + sx) * 4;
      const dst = (y * target + x) * 4;
      out[dst] = source.rgba[src];
      out[dst + 1] = source.rgba[src + 1];
      out[dst + 2] = source.rgba[src + 2];
      out[dst + 3] = source.rgba[src + 3];
    }
  }
  return out;
}

/** Faint noise used when a block has no texture, so flat colour isn't flat. */
function grainLayer(size: number): DecodedTexture {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const n = 222 + ((Math.random() * 34) | 0);
    rgba[i * 4] = n;
    rgba[i * 4 + 1] = n;
    rgba[i * 4 + 2] = n;
    rgba[i * 4 + 3] = 255;
  }
  return { size, rgba, opaque: true };
}

export interface BuiltTextures {
  texture: THREE.DataArrayTexture;
  /** Per layer: whether every pixel is fully opaque. */
  opaque: boolean[];
  /** Per layer: the pack path it came from. Layer 0 is the fallback grain. */
  paths: string[];
  size: number;
}

/** Layer 0 is always the fallback grain, so an untextured block still draws. */
export const GRAIN_LAYER = 0;

/**
 * Collects texture paths on demand while models are baked, then decodes only
 * the ones actually used — a client jar holds ~1200 block textures and a build
 * typically touches a few dozen.
 */
export class TextureArrayBuilder {
  private order: string[] = [];
  private index = new Map<string, number>();

  constructor(private pack: ResourcePack | null) {}

  /** Returns the layer for a texture path, reserving one if it is new. */
  layerFor(path: string | null): number {
    if (!path || !this.pack?.textures.has(path)) return GRAIN_LAYER;
    const existing = this.index.get(path);
    if (existing !== undefined) return existing;
    const layer = this.order.length + 1;
    this.index.set(path, layer);
    this.order.push(path);
    return layer;
  }

  async build(): Promise<BuiltTextures> {
    const decoded: (DecodedTexture | null)[] = await Promise.all(
      this.order.map((path) => {
        const bytes = this.pack!.textures.get(path)!;
        return decodeTexture(bytes);
      }),
    );

    const failed = decoded.filter((entry) => entry === null).length;
    if (failed > 0) {
      console.warn(
        `${failed} of ${decoded.length} pack textures could not be decoded; ` +
          `those blocks fall back to flat colour.`,
      );
    }

    let size = 16;
    for (const entry of decoded) if (entry) size = Math.max(size, entry.size);

    const layers = [grainLayer(size), ...decoded.map((entry) => entry ?? grainLayer(size))];
    const data = new Uint8Array(size * size * 4 * layers.length);
    const opaque: boolean[] = [];
    layers.forEach((layer, i) => {
      data.set(upscale(layer, size), i * size * size * 4);
      opaque.push(layer.opaque);
    });

    const texture = new THREE.DataArrayTexture(data, size, size, layers.length);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    return { texture, opaque, paths: ["<fallback>", ...this.order], size };
  }
}
