import assert from "node:assert/strict";
import test from "node:test";
import { connectedTextureIndex } from "./connectedTexture";

type Point = [number, number, number];
const at = (...points: Point[]) => (x: number, y: number, z: number) =>
  points.some(([px, py, pz]) => x === px && y === py && z === pz);

test("a neighbouring tile selects the matching edge in the sprite plane of each face", () => {
  const spriteRight: Point[] = [[0,0,-1], [0,0,1], [1,0,0], [1,0,0], [1,0,0], [-1,0,0]];
  const spriteUp: Point[] = [[0,1,0], [0,1,0], [0,0,-1], [0,0,1], [0,1,0], [0,1,0]];
  for (let face = 0; face < 6; face++) {
    assert.equal(connectedTextureIndex("RECTANGLE", face, at(spriteRight[face], spriteUp[face])), 9);
    assert.equal(connectedTextureIndex("HORIZONTAL_KRYPPERS", face, at(spriteRight[face])), 2);
    assert.equal(connectedTextureIndex("VERTICAL", face, at(spriteUp[face])), 1);
  }
});

test("omnidirectional sprites join a diagonal only through both visible edges", () => {
  const up: Point = [0,1,0], right: Point = [1,0,0], corner: Point = [1,1,0];
  assert.equal(connectedTextureIndex("OMNIDIRECTIONAL", 4, at(corner)), 0);
  assert.equal(connectedTextureIndex("OMNIDIRECTIONAL", 4, at(up, right)), 17);
  assert.equal(connectedTextureIndex("OMNIDIRECTIONAL", 4, at(up, right, corner)), 20);
  // A matching cube one step towards the viewer hides the neighbour's front.
  assert.equal(connectedTextureIndex("OMNIDIRECTIONAL", 4, at(up, right, corner, [1,0,1])), 1);
  assert.equal(connectedTextureIndex("OMNIDIRECTIONAL", 4, at(up, right, corner, [1,1,1])), 17);
});
