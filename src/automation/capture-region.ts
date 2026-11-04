import type { Build } from "../core/model";
import type { Box } from "../core/region";
import type { BakedPalette } from "../render/bake";
import { meshRegion } from "../render/mesher";

/** An explicit box defines all six cut planes, independently of the UI layer slider. */
export function captureRegion(build: Build, layer: number, box?: Box): Box {
  const size = [build.width, build.height, build.length];
  if (box === undefined) return { min: [0, 0, 0], max: [build.width - 1, Math.min(layer, build.height - 1), build.length - 1] };
  if (!box || ![box.min, box.max].every(point =>
    Array.isArray(point) && point.length === 3 &&
    point.every((coordinate, axis) => Number.isSafeInteger(coordinate) && coordinate >= 0 && coordinate < size[axis])
  ) || box.min.some((value, axis) => value > box.max[axis])) {
    throw new Error("capture box needs ordered inclusive integer corners inside the current build.");
  }
  return box;
}

/** Mesh the current voxel data directly so captures are independent of viewport animation frames. */
export function* captureMeshes(build: Build, baked: BakedPalette, box: Box) {
  const step = 32;
  for (let y = box.min[1]; y <= box.max[1]; y += step) {
    for (let z = box.min[2]; z <= box.max[2]; z += step) {
      for (let x = box.min[0]; x <= box.max[0]; x += step) {
        yield meshRegion(build, baked, x, y, z, step, step, step, box.max[1], box);
      }
    }
  }
}
