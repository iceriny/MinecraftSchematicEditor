/** Create AllCTTypes atlas widths, measured in sprites. */
export const CT_SHEET_SIZE = {
  HORIZONTAL: 2, HORIZONTAL_KRYPPERS: 2, VERTICAL: 2,
  OMNIDIRECTIONAL: 8, RECTANGLE: 4, CROSS: 4, ROOF: 4, ROOF_STAIR: 4,
} as const;
export type CTType = keyof typeof CT_SHEET_SIZE;

type Offset = readonly [number, number, number];
type FaceBasis = { normal: Offset; right: Offset; up: Offset };

// Indexed in mesh face order: EAST, WEST, UP, DOWN, SOUTH, NORTH.
// "Right" and "up" are the sprite's axes as viewed from outside the block.
const FACE_BASIS: readonly FaceBasis[] = [
  { normal: [1,0,0],  right: [0,0,-1], up: [0,1,0] },
  { normal: [-1,0,0], right: [0,0,1],  up: [0,1,0] },
  { normal: [0,1,0],  right: [1,0,0],  up: [0,0,-1] },
  { normal: [0,-1,0], right: [1,0,0],  up: [0,0,1] },
  { normal: [0,0,1],  right: [1,0,0],  up: [0,1,0] },
  { normal: [0,0,-1], right: [-1,0,0], up: [0,1,0] },
];

const ROOF_STAIRS = [[1,6,9,4], [14,12,13,15], [2,10,8,0], [5,5,5,5]];
const KRYPPERS_COLUMNS = [0,2,3,1]; // neither, right, left, both
const RECT_COLUMNS = [0,1,3,2];      // neither, right, left, both
const RECT_ROWS = [3,2,0,1];         // neither, up, down, both

/**
 * Return the row-major atlas tile for a face with Create's standard CT behaviour.
 * Both predicates sample offsets in the complete world, even for a cutaway.
 * A matching block in front hides a connection only when its rear face is full.
 * For full-block materials that predicate is the same identity check.
 */
export function connectedTextureIndex(
  type: CTType,
  face: number,
  sameAt: (dx: number, dy: number, dz: number) => boolean,
  matchingFullFaceAt = sameAt,
): number {
  const basis = FACE_BASIS[face];
  function connects(h: number, v: number): number {
    const dx = h * basis.right[0] + v * basis.up[0];
    const dy = h * basis.right[1] + v * basis.up[1];
    const dz = h * basis.right[2] + v * basis.up[2];
    return Number(sameAt(dx, dy, dz) &&
      !matchingFullFaceAt(dx + basis.normal[0], dy + basis.normal[1], dz + basis.normal[2]));
  }

  if (type === "VERTICAL") return connects(0, 1) + 2 * connects(0, -1);
  const left = connects(-1, 0), right = connects(1, 0);
  const horizontal = right + 2 * left;
  if (type === "HORIZONTAL") return horizontal;
  if (type === "HORIZONTAL_KRYPPERS") return KRYPPERS_COLUMNS[horizontal];

  const up = connects(0, 1), down = connects(0, -1);
  const vertical = up + 2 * down;
  if (type === "RECTANGLE") return RECT_COLUMNS[horizontal] + 4 * RECT_ROWS[vertical];
  if (type === "CROSS") return vertical + 4 * left + 8 * right;
  if (type === "ROOF_STAIR") return ROOF_STAIRS[2 * up + right][2 * left + down];

  // A corner can join only if both edges leading to it already join.
  const nw = up && left && connects(-1, 1), ne = up && right && connects(1, 1);
  const sw = down && left && connects(-1, -1), se = down && right && connects(1, -1);
  if (type === "ROOF") {
    if (down && !up && (left || right)) {
      if (!left) return se ? 0 : 5;
      if (!right) return sw ? 2 : 5;
      return 1;
    }
    if (up && !down && (left || right)) {
      if (!left) return ne ? 8 : 5;
      if (!right) return nw ? 10 : 5;
      return 9;
    }
    if ((up || down) && !left && right) return 4;
    if ((up || down) && left && !right) return 6;
    if (up && down && left && right) {
      if (sw && ne && !(nw && se)) return nw ? 12 : se ? 15 : 7;
      if (se && nw && !(ne && sw)) return ne ? 13 : sw ? 14 : 11;
    }
    return 5;
  }

  // OMNIDIRECTIONAL. The first 4×4 region stores just the cardinal
  // connections. The remainder of the 8×8 sheet adds corner combinations.
  const cardinalCount = up + down + left + right;
  const edgesTile = vertical + 8 * (left + 2 * right);
  if (cardinalCount === 4) return edgesTile + ne + 2 * nw + 8 * (sw + 2 * se);
  if (cardinalCount === 3) {
    if (!right && (nw || sw)) return 4 * 8 - 1 + sw + 2 * nw;
    if (!left && (ne || se)) return 5 * 8 - 1 + se + 2 * ne;
    if (!down && (nw || ne)) return 6 * 8 - 1 + nw + 2 * ne;
    if (!up && (sw || se)) return 7 * 8 - 1 + sw + 2 * se;
  }
  if (cardinalCount === 2 && (nw || ne || sw || se)) return edgesTile + 3;
  return edgesTile;
}
