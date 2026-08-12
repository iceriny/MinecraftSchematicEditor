/**
 * The editor's internal build representation. Every loader converts into this
 * and every exporter converts out of it, so the viewer and the tools only ever
 * deal with one shape.
 */

export interface BlockState {
  /** Namespaced id, e.g. `minecraft:oak_stairs`. */
  name: string;
  /** Blockstate properties, e.g. `{ facing: "north", half: "top" }`. */
  properties?: Record<string, string>;
}

export const AIR: BlockState = { name: "minecraft:air" };

export interface BuildMeta {
  name: string;
  author: string;
  description: string;
  /** Which loader produced this build. */
  format: string;
  dataVersion: number;
}

/**
 * Blocks are stored as palette indices in YZX order — the same order every
 * schematic format on disk uses, so loading and saving are straight copies.
 * Index 0 of the palette is always air.
 */
export class Build {
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly data: Uint16Array;
  palette: BlockState[];
  meta: BuildMeta;

  constructor(
    width: number,
    height: number,
    length: number,
    palette: BlockState[],
    data: Uint16Array,
    meta: Partial<BuildMeta> = {},
  ) {
    this.width = width;
    this.height = height;
    this.length = length;
    this.palette = palette;
    this.data = data;
    this.meta = {
      name: meta.name ?? "Untitled",
      author: meta.author ?? "",
      description: meta.description ?? "",
      format: meta.format ?? "unknown",
      dataVersion: meta.dataVersion ?? DEFAULT_DATA_VERSION,
    };
  }

  get volume() {
    return this.width * this.height * this.length;
  }

  index(x: number, y: number, z: number) {
    return (y * this.length + z) * this.width + x;
  }

  inBounds(x: number, y: number, z: number) {
    return (
      x >= 0 && y >= 0 && z >= 0 && x < this.width && y < this.height && z < this.length
    );
  }

  /** Palette index at a position; 0 (air) when out of bounds. */
  at(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    return this.data[this.index(x, y, z)];
  }

  positionOf(index: number): [number, number, number] {
    const x = index % this.width;
    const z = ((index - x) / this.width) % this.length;
    const y = (index - x - z * this.width) / (this.width * this.length);
    return [x, y, z];
  }

  /** Returns the palette index for a state, appending to the palette if new. */
  paletteIndexFor(state: BlockState): number {
    const key = stateKey(state);
    for (let i = 0; i < this.palette.length; i++) {
      if (stateKey(this.palette[i]) === key) return i;
    }
    this.palette.push(state);
    return this.palette.length - 1;
  }

  // Counting every block on each edit is too slow to do per pointer move on a
  // large build, so the tallies are kept up to date as blocks change.
  private counts: Uint32Array | null = null;
  private total = 0;

  private ensureCounts(): Uint32Array {
    if (this.counts && this.counts.length >= this.palette.length) return this.counts;
    const counts = new Uint32Array(this.palette.length);
    let total = 0;
    for (let i = 0; i < this.data.length; i++) {
      const value = this.data[i];
      if (value === 0) continue;
      counts[value]++;
      total++;
    }
    this.counts = counts;
    this.total = total;
    return counts;
  }

  /** Non-air block count per palette index. Index 0 is always 0. */
  countByPalette(): Uint32Array {
    return this.ensureCounts();
  }

  totalBlocks(): number {
    this.ensureCounts();
    return this.total;
  }

  /** The only supported way to change blocks; keeps the tallies honest. */
  applyChanges(indices: Uint32Array, values: Uint16Array) {
    const counts = this.ensureCounts();
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const next = values[i];
      const previous = this.data[index];
      if (previous === next) continue;
      if (previous !== 0) {
        counts[previous]--;
        this.total--;
      }
      if (next !== 0) {
        counts[next]++;
        this.total++;
      }
      this.data[index] = next;
    }
  }

  /**
   * A copy with unused palette entries dropped. Editing can leave entries
   * behind — replacing every oak plank strands the oak plank entry — and
   * exports should not carry them.
   */
  compacted(): Build {
    const counts = this.ensureCounts();
    const remap = new Uint16Array(this.palette.length);
    const palette: BlockState[] = [AIR];
    for (let i = 1; i < this.palette.length; i++) {
      if (counts[i] === 0) continue;
      remap[i] = palette.length;
      palette.push(this.palette[i]);
    }
    if (palette.length === this.palette.length) return this;

    const data = new Uint16Array(this.data.length);
    for (let i = 0; i < data.length; i++) data[i] = remap[this.data[i]];
    return new Build(this.width, this.height, this.length, palette, data, { ...this.meta });
  }

  /** Inclusive bounds of the non-air blocks, or null when the build is empty. */
  occupiedBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let z = 0; z < this.length; z++) {
        const row = (y * this.length + z) * this.width;
        for (let x = 0; x < this.width; x++) {
          if (this.data[row + x] === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    }
    if (minX === Infinity) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  clone(): Build {
    return new Build(
      this.width,
      this.height,
      this.length,
      this.palette.map((s) => ({ ...s, properties: s.properties && { ...s.properties } })),
      this.data.slice(),
      { ...this.meta },
    );
  }
}

export const DEFAULT_DATA_VERSION = 3953; // 1.21.1

/* ------------------------------------------------------------- creation */

/** The largest build we will allocate, so a typo in the size dialog can't wedge the tab. */
export const MAX_VOLUME = 24_000_000;

export class BuildTooLargeError extends Error {
  constructor(volume: number) {
    super(
      `That would be ${volume.toLocaleString()} cells — over the ${MAX_VOLUME.toLocaleString()} limit. ` +
        `Try a smaller box.`,
    );
    this.name = "BuildTooLargeError";
  }
}

/** An empty build of the given size, for starting something from nothing. */
export function createBuild(
  width: number,
  height: number,
  length: number,
  meta: Partial<BuildMeta> = {},
): Build {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const l = Math.max(1, Math.floor(length));
  const volume = w * h * l;
  if (volume > MAX_VOLUME) throw new BuildTooLargeError(volume);
  return new Build(w, h, l, [AIR], new Uint16Array(volume), { name: "Untitled", ...meta });
}

/**
 * A copy of `build` re-cut to the inclusive box `min..max`, given in the
 * *source* build's coordinates. Corners outside the original are legal and come
 * back as air — that is how the canvas grows — and corners inside it crop.
 * Palette entries are carried over as-is; `compacted()` drops any the crop
 * orphaned.
 */
export function resizeBuild(
  build: Build,
  min: [number, number, number],
  max: [number, number, number],
): Build {
  const width = max[0] - min[0] + 1;
  const height = max[1] - min[1] + 1;
  const length = max[2] - min[2] + 1;
  if (width < 1 || height < 1 || length < 1) {
    throw new Error("A build needs at least one cell on every axis.");
  }
  const volume = width * height * length;
  if (volume > MAX_VOLUME) throw new BuildTooLargeError(volume);

  const data = new Uint16Array(volume);
  // Only the overlap between the old box and the new one carries any blocks;
  // walking just that range keeps a big pad cheap.
  const x0 = Math.max(0, min[0]), x1 = Math.min(build.width - 1, max[0]);
  const y0 = Math.max(0, min[1]), y1 = Math.min(build.height - 1, max[1]);
  const z0 = Math.max(0, min[2]), z1 = Math.min(build.length - 1, max[2]);

  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      const from = (y * build.length + z) * build.width;
      const to = ((y - min[1]) * length + (z - min[2])) * width - min[0];
      for (let x = x0; x <= x1; x++) data[to + x] = build.data[from + x];
    }
  }

  return new Build(
    width, height, length,
    build.palette.map((s) => ({ ...s, properties: s.properties && { ...s.properties } })),
    data,
    { ...build.meta },
  );
}

/* --------------------------------------------------------- state helpers */

/** Canonical string for a blockstate: `minecraft:stone[facing=north]`. */
export function stateKey(state: BlockState): string {
  const props = state.properties;
  if (!props) return state.name;
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return state.name;
  return `${state.name}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]`;
}

/** Inverse of {@link stateKey}. */
export function parseStateKey(key: string): BlockState {
  const open = key.indexOf("[");
  if (open === -1) return { name: normalizeName(key) };
  const name = normalizeName(key.slice(0, open));
  const body = key.slice(open + 1, key.lastIndexOf("]"));
  const properties: Record<string, string> = {};
  for (const pair of body.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    properties[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return Object.keys(properties).length ? { name, properties } : { name };
}

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(":") ? trimmed : `minecraft:${trimmed}`;
}

/** Strips the namespace: `minecraft:oak_stairs` -> `oak_stairs`. */
export function baseName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Human label: `minecraft:oak_stairs` -> `Oak Stairs`. */
export function displayName(state: BlockState): string {
  return baseName(state.name)
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Short property summary for the material list, e.g. `north · top`. */
export function propertySummary(state: BlockState): string {
  const props = state.properties;
  if (!props) return "";
  const skip = new Set(["waterlogged", "powered", "lit", "open", "occupied"]);
  const parts = Object.keys(props)
    .filter((k) => !skip.has(k))
    .map((k) => props[k])
    .filter((v) => v !== "false" && v !== "none");
  return parts.join(" · ");
}

export function isAir(name: string): boolean {
  const base = baseName(name);
  return base === "air" || base === "cave_air" || base === "void_air" || base === "structure_void";
}
