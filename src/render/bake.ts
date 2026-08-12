/**
 * Bakes each palette entry into the quads that draw it.
 *
 * With a resource pack loaded this follows vanilla's model pipeline exactly:
 * element boxes, per-face UVs and rotations, uvlock, cullface, tint and shade.
 * Without one it falls back to the built-in colour and box table, producing the
 * same quad shape so the mesher only has one code path.
 *
 * Rotation conventions were calibrated against the vanilla assets:
 *   y: +X -> +Z at 90 deg  (block/stairs step is +X, facing=south uses y=90)
 *   x: +Y -> -Z at 90 deg  (block/end_rod points +Y, facing=north uses x=90)
 *   applied x first, then y, about the block centre.
 */

import * as THREE from "three";
import { baseName, type BlockState, type Build } from "../core/model";
import { FULL_BOX, lookFor, type Box } from "../core/blockLook";
import type { ElementDef, FaceName, ResourcePack } from "../assets/pack";
import {
  particleTexture, resolveState, resolveTexture, type FlatModel, type Placement,
} from "../assets/modelResolver";
import { GRAIN_LAYER, TextureArrayBuilder } from "../assets/textures";
import { tintFor } from "./tint";

/** Direction indices used everywhere downstream. */
export const EAST = 0, WEST = 1, UP = 2, DOWN = 3, SOUTH = 4, NORTH = 5;

export const DIR_VECTORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Minecraft's per-orientation brightness, baked into vertex colour. */
const DIR_SHADE = [0.8, 0.8, 1, 0.5, 0.6, 0.6];

const FACE_NAMES: Record<FaceName, number> = {
  east: EAST, west: WEST, up: UP, down: DOWN, south: SOUTH, north: NORTH,
};

/**
 * Corner order per face, as component indices into `[x0,y0,z0,x1,y1,z1]`.
 * Taken from vanilla's FaceInfo so the UV convention lines up.
 */
const FACE_CORNERS: Record<number, readonly number[]> = {
  [DOWN]:  [0, 1, 5, 0, 1, 2, 3, 1, 2, 3, 1, 5],
  [UP]:    [0, 4, 2, 0, 4, 5, 3, 4, 5, 3, 4, 2],
  [NORTH]: [3, 4, 2, 3, 1, 2, 0, 1, 2, 0, 4, 2],
  [SOUTH]: [0, 4, 5, 0, 1, 5, 3, 1, 5, 3, 4, 5],
  [WEST]:  [0, 4, 2, 0, 1, 2, 0, 1, 5, 0, 4, 5],
  [EAST]:  [3, 4, 5, 3, 1, 5, 3, 1, 2, 3, 4, 2],
};

export interface BakedQuad {
  /** 4 corners, xyz, in block space 0..1. */
  pos: Float32Array;
  uv: Float32Array;
  layer: number;
  /** Direction whose neighbour can hide this quad, or -1. */
  cull: number;
  /** Direction used for shading and ambient occlusion. */
  dir: number;
  /** Quad lies flat on the block boundary, so AO applies. */
  edge: boolean;
  shade: number;
  tr: number;
  tg: number;
  tb: number;
}

/** 0 opaque, 1 alpha-tested cutout, 2 blended. */
export type RenderLayer = 0 | 1 | 2;

export interface BakedBlock {
  /** One list per part; a fence is a post plus one side per connection. */
  parts: BakedQuad[][][];
  /** Fast path: every part has a single option, already concatenated. */
  single: BakedQuad[] | null;
  /** Per direction: does this block hide the neighbour's face there? */
  occludes: Uint8Array;
  layer: RenderLayer;
  ao: boolean;
  empty: boolean;
  /** False when this came from the built-in box table rather than a model. */
  fromModel: boolean;
}

export interface BakedPalette {
  blocks: BakedBlock[];
  texture: THREE.DataArrayTexture;
  /** Layer index -> pack texture path, for diagnostics. */
  texturePaths: string[];
  /** True when a resource pack supplied the geometry. */
  textured: boolean;
  /** Names the pack had no blockstate for. */
  missing: string[];
}

/* ------------------------------------------------------------- transforms */

function rotateX(v: number[], degrees: number) {
  if (degrees === 0) return;
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const y = v[1], z = v[2];
  v[1] = y * c + z * s;
  v[2] = -y * s + z * c;
}

function rotateY(v: number[], degrees: number) {
  if (degrees === 0) return;
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const x = v[0], z = v[2];
  v[0] = x * c - z * s;
  v[2] = x * s + z * c;
}

function rotateAxis(v: number[], axis: "x" | "y" | "z", degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  if (axis === "x") {
    const y = v[1], z = v[2];
    v[1] = y * c - z * s;
    v[2] = y * s + z * c;
  } else if (axis === "y") {
    const x = v[0], z = v[2];
    v[0] = x * c + z * s;
    v[2] = -x * s + z * c;
  } else {
    const x = v[0], y = v[1];
    v[0] = x * c - y * s;
    v[1] = x * s + y * c;
  }
}

/** Snaps a rotated direction vector back to the axis it now points along. */
function snapDirection(v: number[]): number {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] > 0 ? EAST : WEST;
  if (ay >= az) return v[1] > 0 ? UP : DOWN;
  return v[2] > 0 ? SOUTH : NORTH;
}

/* ----------------------------------------------------------------- baking */

/** Default UVs vanilla derives from an element's extent when `uv` is absent. */
function defaultUv(dir: number, from: number[], to: number[]): [number, number, number, number] {
  switch (dir) {
    case DOWN: return [from[0], 16 - to[2], to[0], 16 - from[2]];
    case UP: return [from[0], from[2], to[0], to[2]];
    case NORTH: return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
    case SOUTH: return [from[0], 16 - to[1], to[0], 16 - from[1]];
    case WEST: return [from[2], 16 - to[1], to[2], 16 - from[1]];
    default: return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
  }
}

/**
 * uvlock keeps the texture aligned to the world when a model is rotated. Only
 * faces whose normal is parallel to the rotation axis spin in their own plane,
 * so only those need the counter-rotation.
 */
function uvlockShift(dir: number, x: number, y: number): number {
  let shift = 0;
  if (y !== 0 && (dir === UP || dir === DOWN)) {
    shift += dir === UP ? -y / 90 : y / 90;
  }
  if (x !== 0 && (dir === EAST || dir === WEST)) {
    shift += dir === EAST ? -x / 90 : x / 90;
  }
  return shift;
}

function bakeElement(
  element: ElementDef,
  placement: Placement,
  model: FlatModel,
  textures: TextureArrayBuilder,
  tint: [number, number, number],
  out: BakedQuad[],
) {
  const from = element.from;
  const to = element.to;
  const box = [from[0], from[1], from[2], to[0], to[1], to[2]];
  const rotation = element.rotation;
  const elementShade = element.shade !== false;

  for (const name of Object.keys(element.faces) as FaceName[]) {
    const face = element.faces[name];
    if (!face) continue;
    const baseDir = FACE_NAMES[name];
    const texturePath = resolveTexture(model.textures, face.texture);
    const layer = textures.layerFor(texturePath);

    const uv = face.uv ?? defaultUv(baseDir, from, to);
    let shift = (face.rotation ?? 0) / 90;
    if (placement.uvlock) shift += uvlockShift(baseDir, placement.x, placement.y);
    shift = ((shift % 4) + 4) % 4;

    const corners = FACE_CORNERS[baseDir];
    const pos = new Float32Array(12);
    const uvs = new Float32Array(8);

    for (let i = 0; i < 4; i++) {
      const v = [box[corners[i * 3]], box[corners[i * 3 + 1]], box[corners[i * 3 + 2]]];

      if (rotation) {
        const o = rotation.origin;
        v[0] -= o[0]; v[1] -= o[1]; v[2] -= o[2];
        rotateAxis(v, rotation.axis, rotation.angle);
        if (rotation.rescale) {
          const factor = 1 / Math.cos((Math.abs(rotation.angle) * Math.PI) / 180);
          if (rotation.axis !== "x") v[0] *= factor;
          if (rotation.axis !== "y") v[1] *= factor;
          if (rotation.axis !== "z") v[2] *= factor;
        }
        v[0] += o[0]; v[1] += o[1]; v[2] += o[2];
      }

      v[0] = v[0] / 16 - 0.5;
      v[1] = v[1] / 16 - 0.5;
      v[2] = v[2] / 16 - 0.5;
      rotateX(v, placement.x);
      rotateY(v, placement.y);
      pos[i * 3] = v[0] + 0.5;
      pos[i * 3 + 1] = v[1] + 0.5;
      pos[i * 3 + 2] = v[2] + 0.5;

      // Vanilla's BlockFaceUV corner mapping. Model UVs put their origin at
      // the texture's top-left, and a DataArrayTexture is uploaded unflipped
      // (three ignores `flipY` for data textures), so V maps straight across —
      // inverting it here would stand every texture on its head.
      const index = (i + shift) % 4;
      const u = uv[index !== 0 && index !== 1 ? 2 : 0];
      const w = uv[index !== 0 && index !== 3 ? 3 : 1];
      uvs[i * 2] = u / 16;
      uvs[i * 2 + 1] = w / 16;
    }

    const normal = [...DIR_VECTORS[baseDir]];
    rotateX(normal, placement.x);
    rotateY(normal, placement.y);
    const dir = snapDirection(normal);

    let cull = -1;
    if (face.cullface) {
      const cullVector = [...DIR_VECTORS[FACE_NAMES[face.cullface]]];
      rotateX(cullVector, placement.x);
      rotateY(cullVector, placement.y);
      cull = snapDirection(cullVector);
    }

    const axis = dir === EAST || dir === WEST ? 0 : dir === UP || dir === DOWN ? 1 : 2;
    const plane = dir === EAST || dir === UP || dir === SOUTH ? 1 : 0;
    let edge = true;
    for (let i = 0; i < 4; i++) {
      if (Math.abs(pos[i * 3 + axis] - plane) > 1e-4) {
        edge = false;
        break;
      }
    }

    const shade = elementShade ? DIR_SHADE[dir] : 1;
    const tinted = (face.tintindex ?? -1) >= 0;
    out.push({
      pos, uv: uvs, layer, cull, dir, edge, shade,
      tr: tinted ? tint[0] : 1,
      tg: tinted ? tint[1] : 1,
      tb: tinted ? tint[2] : 1,
    });
  }
}

/** True when the quad covers its whole boundary square. */
function coversFace(quad: BakedQuad): boolean {
  if (!quad.edge) return false;
  const axisA = quad.dir === EAST || quad.dir === WEST ? 1 : 0;
  const axisB = quad.dir === SOUTH || quad.dir === NORTH ? 1 : 2;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (let i = 0; i < 4; i++) {
    const a = quad.pos[i * 3 + axisA];
    const b = quad.pos[i * 3 + axisB];
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minB = Math.min(minB, b); maxB = Math.max(maxB, b);
  }
  return minA < 1e-4 && maxA > 1 - 1e-4 && minB < 1e-4 && maxB > 1 - 1e-4;
}

/* ----------------------------------------------------------- fallback path */

/** Quads for the built-in box table, used when no pack supplies a model. */
function bakeFallback(state: BlockState): { quads: BakedQuad[]; layer: RenderLayer; occludes: Uint8Array } {
  const look = lookFor(state);
  const r = ((look.color >> 16) & 0xff) / 255;
  const g = ((look.color >> 8) & 0xff) / 255;
  const b = (look.color & 0xff) / 255;
  const quads: BakedQuad[] = [];

  for (const box of look.boxes) {
    const components = [box[0] * 16, box[1] * 16, box[2] * 16, box[3] * 16, box[4] * 16, box[5] * 16];
    for (let dir = 0; dir < 6; dir++) {
      const corners = FACE_CORNERS[dir];
      const pos = new Float32Array(12);
      const uvs = new Float32Array(8);
      const uv = defaultUv(dir, [components[0], components[1], components[2]], [components[3], components[4], components[5]]);
      for (let i = 0; i < 4; i++) {
        pos[i * 3] = components[corners[i * 3]] / 16;
        pos[i * 3 + 1] = components[corners[i * 3 + 1]] / 16;
        pos[i * 3 + 2] = components[corners[i * 3 + 2]] / 16;
        const u = uv[i !== 0 && i !== 1 ? 2 : 0];
        const w = uv[i !== 0 && i !== 3 ? 3 : 1];
        uvs[i * 2] = u / 16;
        uvs[i * 2 + 1] = w / 16;
      }
      const axis = dir === EAST || dir === WEST ? 0 : dir === UP || dir === DOWN ? 1 : 2;
      const plane = dir === EAST || dir === UP || dir === SOUTH ? 1 : 0;
      const edge = Math.abs(pos[axis] - plane) < 1e-4;
      const glow = look.glow;
      const shade = glow > 0 ? DIR_SHADE[dir] + (1 - DIR_SHADE[dir]) * glow : DIR_SHADE[dir];
      quads.push({
        pos, uv: uvs, layer: GRAIN_LAYER,
        cull: edge ? dir : -1,
        dir, edge, shade, tr: r, tg: g, tb: b,
      });
    }
  }

  const occludes = new Uint8Array(6);
  if (look.solid && look.transparency === "opaque") occludes.fill(1);
  return { quads, layer: look.transparency === "opaque" ? 0 : 2, occludes };
}

/* -------------------------------------------------------------- synthetic */

/**
 * Fluids have no model JSON — the game renders them with dedicated code — so
 * a plain cube using the still texture stands in. Everything else the pipeline
 * can't resolve falls back to the built-in colour box.
 */
const FLUID_TEXTURES: Record<string, string> = {
  water: "minecraft:block/water_still",
  flowing_water: "minecraft:block/water_flow",
  lava: "minecraft:block/lava_still",
  flowing_lava: "minecraft:block/lava_flow",
};

function fluidModel(texture: string): FlatModel {
  return boxModel(texture, [FULL_BOX]);
}

/**
 * A model built from the built-in box table and painted with one texture, for
 * the blocks the pack describes but never draws — the block entities. It gives
 * a sign the shape this app knows and the wood the pack knows, which together
 * are much closer to the block than a flat-coloured stand-in.
 *
 * Only a face flush with the edge of the cell claims a `cullface`: an inner
 * face of a small box is never hidden by the neighbour, and saying otherwise
 * would open holes in it.
 */
function boxModel(texture: string, boxes: readonly Box[]): FlatModel {
  return {
    textures: { all: texture },
    ambientocclusion: true,
    elements: boxes.map((box) => {
      const from: [number, number, number] = [box[0] * 16, box[1] * 16, box[2] * 16];
      const to: [number, number, number] = [box[3] * 16, box[4] * 16, box[5] * 16];
      const face = (flush: boolean, cullface: FaceName) => ({
        texture: "#all",
        tintindex: 0,
        ...(flush ? { cullface } : {}),
      });
      return {
        from,
        to,
        faces: {
          down: face(from[1] <= 0, "down"),
          up: face(to[1] >= 16, "up"),
          north: face(from[2] <= 0, "north"),
          south: face(to[2] >= 16, "south"),
          west: face(from[0] <= 0, "west"),
          east: face(to[0] >= 16, "east"),
        },
      };
    }),
  };
}

/* ------------------------------------------------------------------ entry */

/** Blocks vanilla blends rather than alpha-tests. */
const BLENDED = new Set([
  "water", "flowing_water", "ice", "frosted_ice", "slime_block", "honey_block",
  "nether_portal", "bubble_column", "tinted_glass",
]);

function isBlended(id: string): boolean {
  return BLENDED.has(id) || id.endsWith("stained_glass") || id.endsWith("stained_glass_pane");
}

export async function bakePalette(build: Build, pack: ResourcePack | null): Promise<BakedPalette> {
  const textures = new TextureArrayBuilder(pack);
  const modelCache = new Map<string, FlatModel>();
  const blocks: BakedBlock[] = [];
  const missing: string[] = [];
  let textured = false;

  for (let i = 0; i < build.palette.length; i++) {
    const state = build.palette[i];
    if (i === 0) {
      blocks.push({
        parts: [], single: [], occludes: new Uint8Array(6),
        layer: 0, ao: true, empty: true, fromModel: false,
      });
      continue;
    }

    const id = baseName(state.name);
    let resolved = pack ? resolveState(pack, state, modelCache) : null;

    const fluid = FLUID_TEXTURES[id];
    if (!resolved && pack && fluid && pack.textures.has(fluid)) {
      resolved = [[{ model: fluidModel(fluid), x: 0, y: 0, uvlock: false }]];
    }

    // A block entity: the pack knows the block and what it is made of, but has
    // no geometry for it. Ours plus its texture beats a flat colour.
    if (!resolved && pack) {
      const particle = particleTexture(pack, state, modelCache);
      if (particle && pack.textures.has(particle)) {
        const look = lookFor(state);
        resolved = [[{ model: boxModel(particle, look.boxes), x: 0, y: 0, uvlock: false }]];
      }
    }

    if (!resolved) {
      if (pack) missing.push(state.name);
      const fallback = bakeFallback(state);
      blocks.push({
        parts: [[fallback.quads]],
        single: fallback.quads,
        occludes: fallback.occludes,
        layer: fallback.layer,
        ao: true,
        empty: fallback.quads.length === 0,
        fromModel: false,
      });
      continue;
    }

    textured = true;
    const tint = tintFor(state.name, state.properties);
    const parts: BakedQuad[][][] = [];
    let ao = true;

    for (const part of resolved) {
      const options: BakedQuad[][] = [];
      for (const placement of part) {
        const quads: BakedQuad[] = [];
        for (const element of placement.model.elements) {
          bakeElement(element, placement, placement.model, textures, tint, quads);
        }
        if (placement.model.ambientocclusion === false) ao = false;
        options.push(quads);
      }
      if (options.length) parts.push(options);
    }

    const single = parts.every((options) => options.length === 1)
      ? parts.flatMap((options) => options[0])
      : null;

    blocks.push({
      parts,
      single,
      occludes: new Uint8Array(6),
      layer: isBlended(id) ? 2 : 0,
      ao,
      empty: parts.length === 0,
      fromModel: true,
    });
  }

  const built = await textures.build();

  // Whether a block is opaque, cut out or blended depends on the alpha of the
  // textures it actually uses, so both that and occlusion wait for decoding.
  for (const block of blocks) {
    if (!block.fromModel) continue;
    const quads = block.single ?? block.parts.flatMap((options) => options[0] ?? []);
    if (quads.length === 0) continue;

    if (block.layer !== 2) {
      block.layer = quads.some((quad) => !built.opaque[quad.layer]) ? 1 : 0;
    }

    for (const quad of quads) {
      if (quad.cull < 0 || !built.opaque[quad.layer]) continue;
      if (coversFace(quad)) block.occludes[quad.cull] = 1;
    }
  }

  return { blocks, texture: built.texture, texturePaths: built.paths, textured, missing };
}
