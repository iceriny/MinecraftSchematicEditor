import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createBuild } from "../core/model";
import type { Box } from "../core/region";
import type { BakedBlock, BakedPalette, BakedQuad } from "../render/bake";
import { captureMeshes, captureRegion } from "./capture-region";

function opaqueCube(): BakedPalette {
  const single: BakedQuad[] = Array.from({ length: 6 }, (_, dir) => ({
    pos: new Float32Array(12), uv: new Float32Array(8), dir, cull: dir,
    edge: true, tr: 1, tg: 1, tb: 1, shade: 1, layer: 0,
  }));
  const cube: BakedBlock = {
    parts: [], single, occludes: new Uint8Array(6).fill(1), layer: 0, ao: true, empty: false, fromModel: true,
  };
  return {
    blocks: [{ ...cube, empty: true, occludes: new Uint8Array(6) }, cube],
    texture: new THREE.DataArrayTexture(), texturePaths: [], textured: false, missing: [],
  };
}

test("cutaway reveals cut faces at world coordinates, including above the visible layer", () => {
  const build = createBuild(36, 4, 3);
  const id = build.paletteIndexFor({ name: "minecraft:stone" });
  build.data.fill(id);
  const box: Box = { min: [1, 2, 1], max: [33, 2, 1] };
  const visible = captureRegion(build, 0);
  assert.equal(visible.max[1], 0);
  const cut = captureRegion(build, 0, box);
  const chunks = [...captureMeshes(build, opaqueCube(), cut)];
  const meshes = chunks.flatMap(chunk => chunk.layers.filter(mesh => mesh !== null));
  // One 33-block beam crosses the chunk seam; the two cut end faces must remain.
  assert.equal(meshes.reduce((total, mesh) => total + mesh.quadBlocks.length, 0), 33 * 4 + 2);
  assert.equal(meshes.flatMap(mesh => [...mesh.quadBlocks]).includes(build.index(33, 2, 1)), true);
  assert.deepEqual([...meshes[0].positions.slice(0, 3)], box.min);
  // Surrounding, invisible stone must neither hide nor shade the cut faces.
  assert.ok(meshes.every(mesh => mesh.colors.every(value => value === 1)));
});

test("an immediate recapture sees changes to the same build without a viewer frame", () => {
  const build = createBuild(3, 3, 3);
  const id = build.paletteIndexFor({ name: "minecraft:stone" });
  const box: Box = { min: [1, 1, 1], max: [1, 1, 1] };
  const capture = () => [...captureMeshes(build, opaqueCube(), box)][0].layers[0]?.quadBlocks.length ?? 0;
  assert.equal(capture(), 0);
  const index = Uint32Array.of(build.index(1, 1, 1));
  build.applyChanges(index, Uint16Array.of(id));
  assert.equal(capture(), 6);
  build.applyChanges(index, Uint16Array.of(0));
  assert.equal(capture(), 0);
});

test("cutaway rejects empty, reversed, fractional or out-of-bounds coordinates", () => {
  const build = createBuild(5, 5, 5);
  for (const box of [
    { min: [0, 0, 1], max: [4, 4, 0] }, { min: [0, -1, 0], max: [1, 2, 3] },
    { min: [], max: [1, 2, 3] }, { min: [0, 0, 0], max: [4, 5, 4] },
    { min: [0, 0, 0], max: [4, 4, 1.5] }, { min: [0, NaN, 0], max: [1, 1, 1] },
  ]) assert.throws(() => captureRegion(build, 4, box as Box), /inside the current build/);
});
