import { extractClip, mirrorClip, rotateClipY, type Clip } from "../core/clip";
import { hasConnectors, repairConnections } from "../core/connect";
import { Build, createBuild, MAX_VOLUME, parseStateKey, stateKey, type BlockState } from "../core/model";
import { regionCells, type FillMode } from "../core/region";
import { loadBuild, saveBuild, suggestFilename } from "../formats";
import { decompress } from "../nbt/compress";
import { asCompound, asList, asNumber, asVec3, parseNbt, type NbtCompound, type NbtValue } from "../nbt/nbt";
import type { Box, EditorCommand, EditorHost, EditOperation, Vec3 } from "./protocol";

const MAX_PALETTE = 65_536;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CHANGED_CELLS = 1_000_000;
const SHAPES: FillMode[] = ["solid", "hollow", "walls", "outline", "air"];

function integer(value: number, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}

function vector(value: Vec3, label: string, min = 0): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain x, y, z.`);
  return value.map((v, axis) => integer(v, `${label}[${axis}]`, min)) as Vec3;
}

function dimensions(value: Vec3): Vec3 {
  const size = vector(value, "size", 1);
  if (size[0] * size[1] * size[2] > MAX_VOLUME) throw new Error(`Build exceeds ${MAX_VOLUME} cells.`);
  return size;
}

function whole(build: Build): Box {
  return { min: [0, 0, 0], max: [build.width - 1, build.height - 1, build.length - 1] };
}

function checkedBox(build: Build, box: Box): Box {
  if (!box || typeof box !== "object") throw new Error("A box with min and max is required.");
  const min = vector(box.min, "box.min");
  const max = vector(box.max, "box.max");
  if (min.some((v, a) => v > max[a]) || !build.inBounds(...min) || !build.inBounds(...max)) {
    throw new Error("Box must have ordered corners inside the build.");
  }
  return { min, max };
}

function editBox(build: Build, box: Box): Box {
  const checked = checkedBox(build, box);
  const volume = checked.max.reduce((product, value, a) => product * (value - checked.min[a] + 1), 1);
  if (volume > MAX_CHANGED_CELLS) throw new Error(`One operation may touch at most ${MAX_CHANGED_CELLS} cells.`);
  return checked;
}

function write(writes: Map<number, number>, index: number, value: number): void {
  if (writes.size >= MAX_CHANGED_CELLS && !writes.has(index)) throw new Error(`One operation may touch at most ${MAX_CHANGED_CELLS} cells.`);
  writes.set(index, value);
}

function blockState(raw: string): BlockState {
  if (typeof raw !== "string" || raw.length > 2048 || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+(?:\[[a-z0-9_]+=[a-z0-9_.:/-]+(?:,[a-z0-9_]+=[a-z0-9_.:/-]+)*\])?$/.test(raw)) {
    throw new Error(`Invalid blockstate: ${String(raw).slice(0, 100)}`);
  }
  const properties = raw.includes("[") ? raw.slice(raw.indexOf("[") + 1, -1).split(",").map((pair) => pair.split("=")[0]) : [];
  if (new Set(properties).size !== properties.length) throw new Error("Blockstate properties must be unique.");
  return parseStateKey(raw);
}

function paletteIndex(build: Build, state: BlockState): number {
  const key = stateKey(state);
  const index = build.palette.findIndex((entry) => stateKey(entry) === key);
  if (index >= 0) return index;
  if (build.palette.length >= MAX_PALETTE) throw new Error("Build palette exceeds 65536 states.");
  return build.paletteIndexFor(state);
}

function applyWrites(build: Build, writes: Map<number, number>): void {
  if (writes.size > MAX_CHANGED_CELLS) throw new Error(`One operation may touch at most ${MAX_CHANGED_CELLS} cells.`);
  build.applyChanges(Uint32Array.from(writes.keys()), Uint16Array.from(writes.values()));
}

function stamp(build: Build, clip: Clip, to: Vec3, includeAir: boolean, writes: Map<number, number>): void {
  vector(to, "to");
  const end: Vec3 = [to[0] + clip.width - 1, to[1] + clip.height - 1, to[2] + clip.length - 1];
  if (!build.inBounds(...to) || !build.inBounds(...end)) throw new Error("Pasted region must fit entirely inside the build.");
  const remap = clip.palette.map((state) => paletteIndex(build, state));
  for (let y = 0; y < clip.height; y++) for (let z = 0; z < clip.length; z++) for (let x = 0; x < clip.width; x++) {
    const value = clip.data[(y * clip.length + z) * clip.width + x];
    if (value === 0 && !includeAir) continue;
    write(writes, build.index(to[0] + x, to[1] + y, to[2] + z), remap[value]);
  }
}

function offsetOperation(op: EditOperation, origin: Vec3): EditOperation {
  const point = (v: Vec3): Vec3 => [v[0]+origin[0], v[1]+origin[1], v[2]+origin[2]];
  const box = (b: Box): Box => ({ min: point(b.min), max: point(b.max) });
  switch (op.type) {
    case "fill": return { ...op, box: box(op.box) };
    case "set": return { ...op, blocks: op.blocks.map(entry => ({ ...entry, at: point(entry.at) })) };
    case "paint": return { ...op, at: op.at.map(point) };
    case "replace": return op.box ? { ...op, box: box(op.box) } : op;
    case "copy":
    case "move": return { ...op, box: box(op.box), to: point(op.to) };
  }
}

function planOperation(build: Build, operation: EditOperation): void {
  const writes = new Map<number, number>();
  switch (operation.type) {
    case "fill": {
      const box = editBox(build, operation.box);
      const shape = operation.shape ?? "solid";
      if (!SHAPES.includes(shape)) throw new Error("Unknown fill shape.");
      const value = paletteIndex(build, blockState(operation.block));
      for (const index of regionCells(build, box, shape)) write(writes, index, value);
      break;
    }
    case "set": {
      if (!Array.isArray(operation.blocks) || operation.blocks.length > MAX_CHANGED_CELLS) throw new Error("Invalid set block list.");
      const states = new Map<string, number>();
      for (const entry of operation.blocks) {
        const at = vector(entry.at, "at");
        if (!build.inBounds(...at)) throw new Error("Block position is outside the build.");
        let value = states.get(entry.block);
        if (value === undefined) {
          value = paletteIndex(build, blockState(entry.block));
          states.set(entry.block, value);
        }
        write(writes, build.index(...at), value);
      }
      break;
    }
    case "paint": {
      if (!Array.isArray(operation.at) || !operation.at.length || operation.at.length > MAX_CHANGED_CELLS) throw new Error("Invalid paint position list.");
      const value = paletteIndex(build, blockState(operation.block));
      for (const point of operation.at) {
        const at = vector(point, "at");
        if (!build.inBounds(...at)) throw new Error("Block position is outside the build.");
        write(writes, build.index(...at), value);
      }
      break;
    }
    case "replace": {
      const box = operation.box ? checkedBox(build, operation.box) : whole(build);
      const from = stateKey(blockState(operation.from));
      const to = paletteIndex(build, blockState(operation.to));
      const matches = new Set(build.palette.flatMap((state, index) => stateKey(state) === from ? [index] : []));
      for (let y = box.min[1]; y <= box.max[1]; y++) for (let z = box.min[2]; z <= box.max[2]; z++) for (let x = box.min[0]; x <= box.max[0]; x++) {
        const index = build.index(x, y, z);
        if (matches.has(build.data[index]) && build.data[index] !== to) write(writes, index, to);
      }
      break;
    }
    case "copy":
    case "move": {
      const box = editBox(build, operation.box);
      let clip = extractClip(build, box.min, box.max);
      if (operation.type === "copy") {
        const turns = integer(operation.rotate ?? 0, "rotate", 0, 3);
        for (let turn = 0; turn < turns; turn++) clip = rotateClipY(clip);
        if (operation.mirror !== undefined) {
          if (operation.mirror !== "x" && operation.mirror !== "z") throw new Error("mirror must be x or z.");
          clip = mirrorClip(clip, operation.mirror);
        }
      } else {
        for (const index of regionCells(build, box, "solid")) write(writes, index, 0);
      }
      stamp(build, clip, operation.to, operation.type === "move" || (operation.includeAir ?? false), writes);
      break;
    }
    default: throw new Error("Unknown edit operation.");
  }
  applyWrites(build, writes);
}

export function checkDocument(host: EditorHost, expectedDocumentId?: string): string | null {
  const documentId = host.getDocumentId?.() ?? null;
  if (expectedDocumentId !== undefined && expectedDocumentId !== documentId) {
    throw new Error(`Document conflict: expected ${expectedDocumentId}, active ${documentId ?? "(none)"}.`);
  }
  return documentId;
}

function requireBuild(host: EditorHost): Build {
  const build = host.getBuild();
  if (!build) throw new Error("No build is open. Create or open one first.");
  return build;
}

function status(host: EditorHost) {
  const build = host.getBuild();
  if (!build) return { open: false, revision: host.getRevision(), history: host.getHistory() };
  const counts = build.countByPalette();
  return {
    open: true, size: [build.width, build.height, build.length], name: build.meta.name,
    dataVersion: build.meta.dataVersion, blocks: build.totalBlocks(), revision: host.getRevision(),
    history: host.getHistory(), materials: build.palette.flatMap((state, index) => counts[index] ? [{ state: stateKey(state), count: counts[index] }] : []),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 32_768) binary += String.fromCharCode(...bytes.subarray(at, at + 32_768));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  if (typeof data !== "string" || data.length % 4 !== 0 || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("File must be valid base64 and at most 64 MiB.");
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

/** Refuse data the upstream block-only model would otherwise silently discard. */
function rejectExtraData(value: NbtValue, path = "root"): void {
  if (ArrayBuffer.isView(value) || typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) rejectExtraData(value[i], `${path}[${i}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:entities|tileentities|blockentities|pendingblockticks|pendingfluidticks)$/i.test(key) &&
      ((Array.isArray(child) && child.length > 0) || (asCompound(child) && Object.keys(child).length > 0))) {
      throw new Error(`Unsupported entity, block-entity or scheduled-tick data at ${path}.${key}; refusing to discard it.`);
    }
    if (key === "nbt" && asCompound(child) && Object.keys(child).length > 0) throw new Error(`Unsupported block-entity data at ${path}.nbt; refusing to discard it.`);
    rejectExtraData(child, `${path}.${key}`);
  }
}

function paletteSize(size: number): void {
  if (size < 0 || size >= MAX_PALETTE) throw new Error("Input palette is too large for the editor.");
}

/** Check dimensions before the format readers allocate dense block arrays. */
function preflight(root: NbtCompound): void {
  rejectExtraData(root);
  const regions = asCompound(root.Regions);
  if (regions) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let total = 0, totalPalette = 0;
    for (const value of Object.values(regions)) {
      const region = asCompound(value);
      if (!region) continue;
      const raw = asVec3(region.Size), position = asVec3(region.Position);
      const size = dimensions(raw.map(Math.abs) as Vec3);
      position.forEach((n, a) => integer(n, `Position[${a}]`, -Number.MAX_SAFE_INTEGER));
      total += size[0] * size[1] * size[2];
      if (total > MAX_VOLUME) throw new Error("Combined input regions exceed the cell limit.");
      paletteSize(asList(region.BlockStatePalette).length);
      totalPalette += asList(region.BlockStatePalette).length;
      if (totalPalette >= MAX_PALETTE) throw new Error("Combined input region palettes are too large.");
      for (let a = 0; a < 3; a++) {
        const start = raw[a] < 0 ? position[a] + raw[a] + 1 : position[a];
        min[a] = Math.min(min[a], start); max[a] = Math.max(max[a], start + size[a]);
      }
    }
    dimensions(max.map((n, a) => n - min[a]) as Vec3);
    return;
  }
  const body = asCompound(root.Schematic) ?? root;
  if ("Width" in body) {
    dimensions([asNumber(body.Width), asNumber(body.Height), asNumber(body.Length)]);
    const blocks = asCompound(body.Blocks);
    const palette = asCompound(blocks?.Palette ?? body.Palette);
    if (palette) {
      paletteSize(Object.keys(palette).length);
      for (const value of Object.values(palette)) integer(asNumber(value, -1), "palette index", 0, MAX_PALETTE - 2);
    }
    return;
  }
  if ("size" in root) {
    const raw = root.size;
    const size = (Array.isArray(raw) || raw instanceof Int32Array) ? Array.from(raw as number[]) : [];
    dimensions(size as Vec3);
    paletteSize(asList(root.palette).length);
  }
}

export async function executeCommand(command: EditorCommand, host: EditorHost): Promise<any> {
  switch (command.action) {
    case "status": return status(host);
    case "new": {
      const size = dimensions(command.size);
      const build = createBuild(...size, { name: command.name ?? "Untitled" });
      host.adoptBuild(build, null, command.newTab ?? true);
      return status(host);
    }
    case "open": {
      const bytes = fromBase64(command.data);
      const unpacked = await decompress(bytes);
      if (unpacked.byteLength > 256 * 1024 * 1024) throw new Error("Uncompressed file exceeds 256 MiB.");
      preflight(parseNbt(unpacked).root);
      const build = await loadBuild(new File([unpacked.buffer as ArrayBuffer], command.name));
      dimensions([build.width, build.height, build.length]);
      if (build.palette.length > MAX_PALETTE) throw new Error("Input palette exceeds 65536 states.");
      host.adoptBuild(build, command.name, command.newTab ?? true);
      return status(host);
    }
    case "export": {
      const build = requireBuild(host);
      const documentId = checkDocument(host, command.expectedDocumentId);
      const revision = host.getRevision();
      if (command.expectedRevision !== undefined && command.expectedRevision !== revision) {
        throw new Error(`Revision conflict: expected ${command.expectedRevision}, current ${revision}.`);
      }
      if (!["litematic", "schem", "nbt"].includes(command.format)) throw new Error("Unsupported export format.");
      if (command.format === "schem" && Math.max(build.width, build.height, build.length) > 32767) throw new Error("Schem dimensions must fit signed 16-bit integers.");
      const name = suggestFilename(build, command.format);
      // saveBuild serializes block data synchronously before its first await (gzip).
      const bytes = new Uint8Array(await (await saveBuild(build, command.format)).arrayBuffer());
      return { name, format: command.format, data: toBase64(bytes), bytes: bytes.length, revision, documentId };
    }
    case "inspect": {
      const build = requireBuild(host);
      const box = command.box ? checkedBox(build, command.box) : whole(build);
      const limit = integer(command.limit ?? 100, "limit", 1, 4096), offset = integer(command.offset ?? 0, "offset");
      const blocks: { at: Vec3; block: string }[] = [];
      const histogram = new Map<number, number>();
      let total = 0;
      for (let y = box.min[1]; y <= box.max[1]; y++) for (let z = box.min[2]; z <= box.max[2]; z++) for (let x = box.min[0]; x <= box.max[0]; x++) {
        const value = build.at(x, y, z);
        if (!command.includeAir && value === 0) continue;
        if (command.mode === "materials") histogram.set(value, (histogram.get(value) ?? 0) + 1);
        else if (total >= offset && blocks.length < limit) blocks.push({ at: [x, y, z], block: stateKey(build.palette[value]) });
        total++;
      }
      if (command.mode === "materials") {
        const sorted = [...histogram].sort(([a, ac], [b, bc]) => bc - ac || a - b);
        const entries = sorted.slice(offset, offset + limit).map(([id, count]) => ({ state: stateKey(build.palette[id]), count }));
        return { revision: host.getRevision(), box, blocksInRegion: total, materialCount: sorted.length, entries, offset,
          nextOffset: offset + entries.length < sorted.length ? offset + entries.length : null };
      }
      return { ...status(host), box, blocksInRegion: total, entries: blocks, offset, nextOffset: offset + blocks.length < total ? offset + blocks.length : null };
    }
    case "edit": {
      const original = requireBuild(host);
      checkDocument(host, command.expectedDocumentId);
      const origin = command.origin && vector(command.origin, "origin");
      if (origin && !original.inBounds(...origin)) throw new Error("Edit origin must be inside the build.");
      if (command.expectedRevision !== undefined && integer(command.expectedRevision, "expectedRevision") !== host.getRevision()) throw new Error(`Revision conflict: expected ${command.expectedRevision}, current ${host.getRevision()}.`);
      if (!Array.isArray(command.operations) || command.operations.length < 1 || command.operations.length > 128) throw new Error("A batch needs 1 to 128 operations.");
      const working = original.clone();
      for (const [index, operation] of command.operations.entries()) {
        try { planOperation(working, origin ? offsetOperation(operation, origin) : operation); }
        catch (error) { throw new Error(`Operation ${index + 1} (${operation.type}): ${error instanceof Error ? error.message : error}`); }
      }
      const writes = new Map<number, number>();
      for (let i = 0; i < original.volume; i++) if (original.data[i] !== working.data[i]) write(writes, i, working.data[i]);
      if (hasConnectors(working)) repairConnections(working, writes);
      if (working.palette.length > MAX_PALETTE) throw new Error("Build palette exceeds 65536 states.");
      for (const [index, value] of writes) if (original.data[index] === value) writes.delete(index);
      if (writes.size > MAX_CHANGED_CELLS) throw new Error(`A batch may change at most ${MAX_CHANGED_CELLS} cells.`);
      if (writes.size) {
        const oldPalette = original.palette;
        original.palette = working.palette;
        try { host.commit(command.label ?? "MCP edit", Uint32Array.from(writes.keys()), Uint16Array.from(writes.values())); }
        catch (error) { original.palette = oldPalette; throw error; }
      }
      return { ...status(host), changed: writes.size };
    }
    case "history": {
      if (command.direction !== "undo" && command.direction !== "redo") throw new Error("History direction must be undo or redo.");
      const steps = integer(command.steps ?? 1, "steps", 1, 50);
      const available = host.getHistory()[command.direction];
      if (steps > available) throw new Error(`Only ${available} ${command.direction} steps available.`);
      for (let i = 0; i < steps; i++) host[command.direction]();
      return status(host);
    }
    case "resources":
    case "view": throw new Error("This command requires a connected browser editor.");
    default: throw new Error("Unknown editor command.");
  }
}

interface HistoryEntry { indices: Uint32Array; before: Uint16Array; after: Uint16Array }

export class MemoryEditor implements EditorHost {
  private build: Build | null = null;
  private revision = 0;
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  getBuild() { return this.build; }
  getRevision() { return this.revision; }
  getHistory() { return { undo: this.undoEntries.length, redo: this.redoEntries.length }; }
  adoptBuild(build: Build, _fileName: string | null, _newTab: boolean) {
    this.build = build; this.undoEntries = []; this.redoEntries = []; this.revision++;
  }
  commit(_label: string, indices: Uint32Array, values: Uint16Array) {
    const build = requireBuild(this);
    const before = Uint16Array.from(indices, (index) => build.data[index]);
    build.applyChanges(indices, values);
    this.undoEntries.push({ indices: indices.slice(), before, after: values.slice() });
    this.undoEntries = this.undoEntries.slice(-50); this.redoEntries = []; this.revision++;
  }
  undo() {
    const entry = this.undoEntries.pop();
    if (!entry) return;
    requireBuild(this).applyChanges(entry.indices, entry.before); this.redoEntries.push(entry); this.revision++;
  }
  redo() {
    const entry = this.redoEntries.pop();
    if (!entry) return;
    requireBuild(this).applyChanges(entry.indices, entry.after); this.undoEntries.push(entry); this.revision++;
  }
}
