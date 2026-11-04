/**
 * Turns a region of a build into triangles.
 *
 * Consumes the baked quads from `bake.ts`, so the textured and untextured
 * paths are the same code — with a resource pack loaded the quads come from
 * vanilla models, without one they come from the built-in box table.
 *
 * Shading follows Minecraft: a fixed per-orientation tint plus corner ambient
 * occlusion, baked into vertex colours, so the viewport needs no lights.
 */

import type { Build } from "../core/model";
import type { Box } from "../core/region";
import { DIR_VECTORS, type BakedPalette, type BakedQuad } from "./bake";

export interface MeshData {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  layers: Float32Array;
  indices: Uint32Array;
  /** Quad index -> linear block index, for turning a raycast hit into a block. */
  quadBlocks: Uint32Array;
}

export interface ChunkMeshResult {
  /** Indexed by render layer: 0 opaque, 1 cutout, 2 blended. */
  layers: (MeshData | null)[];
}

const AO_LEVELS = [0.48, 0.68, 0.85, 1];

/**
 * Corner offsets for ambient occlusion, per face direction. Each entry lists
 * the two in-plane axes; the four corners are their sign combinations, in the
 * same order as the quad's vertices.
 */
const AO_AXES: readonly (readonly [number, number])[] = [
  [2, 1], // east:  z, y
  [2, 1], // west
  [0, 2], // up:    x, z
  [0, 2], // down
  [0, 1], // south: x, y
  [0, 1], // north
];

class QuadBuffer {
  positions = new Float32Array(1024 * 12);
  colors = new Float32Array(1024 * 12);
  uvs = new Float32Array(1024 * 8);
  layerIds = new Float32Array(1024 * 4);
  quadBlocks = new Uint32Array(1024);
  quads = 0;

  ensure() {
    if (this.quads < this.quadBlocks.length) return;
    const capacity = this.quadBlocks.length * 2;
    const grow = <T extends Float32Array | Uint32Array>(source: T, stride: number): T => {
      const next = new (source.constructor as new (n: number) => T)(capacity * stride);
      next.set(source);
      return next;
    };
    this.positions = grow(this.positions, 12);
    this.colors = grow(this.colors, 12);
    this.uvs = grow(this.uvs, 8);
    this.layerIds = grow(this.layerIds, 4);
    this.quadBlocks = grow(this.quadBlocks, 1);
  }

  finish(): MeshData | null {
    if (this.quads === 0) return null;
    const indices = new Uint32Array(this.quads * 6);
    for (let q = 0; q < this.quads; q++) {
      const v = q * 4;
      const i = q * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    }
    return {
      positions: this.positions.slice(0, this.quads * 12),
      colors: this.colors.slice(0, this.quads * 12),
      uvs: this.uvs.slice(0, this.quads * 8),
      layers: this.layerIds.slice(0, this.quads * 4),
      indices,
      quadBlocks: this.quadBlocks.slice(0, this.quads),
    };
  }
}

/** Deterministic per-position pick for blocks with weighted model variants. */
function positionHash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 3129871) ^ Math.imul(z, 116129781) ^ Math.imul(y, 1234567);
  h = Math.imul(h, h) + Math.imul(h, 11);
  return (h >>> 16) & 0x7fffffff;
}

/**
 * Meshes the box starting at `x0,y0,z0` with extent `sx,sy,sz`.
 * Blocks above `yMax` are treated as absent, which is what drives layer view.
 */
export function meshRegion(
  build: Build,
  baked: BakedPalette,
  x0: number, y0: number, z0: number,
  sx: number, sy: number, sz: number,
  yMax: number,
  clip?: Box,
): ChunkMeshResult {
  const buffers = [new QuadBuffer(), new QuadBuffer(), new QuadBuffer()];
  const { width, height, length } = build;
  const data = build.data;
  const blocks = baked.blocks;

  // A block only casts ambient occlusion if it is a full opaque cube.
  const solid = new Uint8Array(blocks.length);
  for (let i = 1; i < blocks.length; i++) {
    const occludes = blocks[i].occludes;
    solid[i] = occludes[0] && occludes[1] && occludes[2] && occludes[3] && occludes[4] && occludes[5] ? 1 : 0;
  }

  // Apply the same limits to neighbor and AO samples as to emitted blocks.
  // Otherwise a wall outside a cutaway would hide the freshly exposed face.
  const [minX, minY, minZ] = clip?.min ?? [0, 0, 0];
  const maxX = Math.min(width - 1, clip?.max[0] ?? width - 1);
  const maxY = Math.min(height - 1, yMax, clip?.max[1] ?? yMax);
  const maxZ = Math.min(length - 1, clip?.max[2] ?? length - 1);
  const at = (x: number, y: number, z: number) =>
    x < minX || y < minY || z < minZ || x > maxX || y > maxY || z > maxZ
      ? 0
      : data[(y * length + z) * width + x];

  const xEnd = Math.min(x0 + sx, maxX + 1);
  const zEnd = Math.min(z0 + sz, maxZ + 1);
  const yEnd = Math.min(y0 + sy, maxY + 1);

  for (let y = Math.max(y0, minY); y < yEnd; y++) {
    for (let z = Math.max(z0, minZ); z < zEnd; z++) {
      const row = (y * length + z) * width;
      for (let x = Math.max(x0, minX); x < xEnd; x++) {
        const value = data[row + x];
        if (value === 0) continue;
        // Guard against a palette that outran the bake; the viewer normally
        // holds meshing back until they line up again.
        const block = blocks[value];
        if (block === undefined || block.empty) continue;

        const target = buffers[block.layer];
        const blockIndex = row + x;
        const applyAo = block.ao;

        const emit = (quads: BakedQuad[]) => {
          for (let qi = 0; qi < quads.length; qi++) {
            const quad = quads[qi];

            if (quad.cull >= 0) {
              const dir = DIR_VECTORS[quad.cull];
              const neighbour = at(x + dir[0], y + dir[1], z + dir[2]);
              if (neighbour !== 0 && blocks[neighbour] !== undefined) {
                // `cull ^ 1` is the opposite direction — the neighbour's face
                // that would sit against this one.
                if (blocks[neighbour].occludes[quad.cull ^ 1]) continue;
                // A run of glass hides its own interior faces the way vanilla does.
                if (neighbour === value && block.layer === 2) continue;
              }
            }

            target.ensure();
            const q = target.quads;
            const p = q * 12;
            const t = q * 8;
            const positions = target.positions;
            const colors = target.colors;
            const uvs = target.uvs;
            const layerIds = target.layerIds;

            const aoDir = DIR_VECTORS[quad.dir];
            const nx = x + aoDir[0], ny = y + aoDir[1], nz = z + aoDir[2];
            const axes = AO_AXES[quad.dir];

            for (let c = 0; c < 4; c++) {
              positions[p + c * 3] = x + quad.pos[c * 3];
              positions[p + c * 3 + 1] = y + quad.pos[c * 3 + 1];
              positions[p + c * 3 + 2] = z + quad.pos[c * 3 + 2];
              uvs[t + c * 2] = quad.uv[c * 2];
              uvs[t + c * 2 + 1] = quad.uv[c * 2 + 1];
              layerIds[q * 4 + c] = quad.layer;

              let shade = quad.shade;
              if (applyAo && quad.edge) {
                // Corner signs come from which side of the face centre this
                // vertex sits on, so they follow whatever winding the model used.
                const sa = quad.pos[c * 3 + axes[0]] > 0.5 ? 1 : -1;
                const sb = quad.pos[c * 3 + axes[1]] > 0.5 ? 1 : -1;
                const ax = axes[0] === 0 ? sa : 0;
                const ay = axes[0] === 1 ? sa : 0;
                const az = axes[0] === 2 ? sa : 0;
                const bx = axes[1] === 0 ? sb : 0;
                const by = axes[1] === 1 ? sb : 0;
                const bz = axes[1] === 2 ? sb : 0;
                const side1 = solid[at(nx + ax, ny + ay, nz + az)];
                const side2 = solid[at(nx + bx, ny + by, nz + bz)];
                const corner = solid[at(nx + ax + bx, ny + ay + by, nz + az + bz)];
                shade *= AO_LEVELS[side1 && side2 ? 0 : 3 - (side1 + side2 + corner)];
              }

              colors[p + c * 3] = quad.tr * shade;
              colors[p + c * 3 + 1] = quad.tg * shade;
              colors[p + c * 3 + 2] = quad.tb * shade;
            }

            target.quadBlocks[q] = blockIndex;
            target.quads = q + 1;
          }
        };

        if (block.single) {
          emit(block.single);
        } else {
          const hash = positionHash(x, y, z);
          for (let pi = 0; pi < block.parts.length; pi++) {
            const options = block.parts[pi];
            emit(options[hash % options.length]);
          }
        }
      }
    }
  }

  return { layers: buffers.map((buffer) => buffer.finish()) };
}
