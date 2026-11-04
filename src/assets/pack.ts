/**
 * Resource pack loading.
 *
 * A Minecraft client jar and a resource pack zip have the same internal
 * layout, so one loader reads both. Nothing from either is bundled with this
 * app — the user supplies their own copy.
 *
 * Only the block-rendering assets are unpacked; a 30 MB client jar is mostly
 * sounds, GUI art and item models we never touch.
 *
 * A mod jar has the same layout under its own namespace, so it loads through
 * the same path and is layered over the vanilla pack. That is why every key
 * here carries its namespace: strip it and two mods that both ship a
 * `block/willow_stairs` quietly overwrite each other.
 */

import { unzip } from "fflate";

export interface BlockstateDef {
  variants?: Record<string, VariantDef | VariantDef[]>;
  multipart?: MultipartCase[];
}

export interface VariantDef {
  model: string;
  x?: number;
  y?: number;
  uvlock?: boolean;
  weight?: number;
}

export interface MultipartCase {
  when?: Condition;
  apply: VariantDef | VariantDef[];
}

export type Condition =
  | { OR: Condition[] }
  | { AND: Condition[] }
  | Record<string, string>;

export type FaceName = "down" | "up" | "north" | "south" | "west" | "east";

export interface FaceDef {
  uv?: [number, number, number, number];
  texture: string;
  cullface?: FaceName;
  rotation?: number;
  tintindex?: number;
}

export interface ElementDef {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: {
    origin: [number, number, number];
    axis: "x" | "y" | "z";
    angle: number;
    rescale?: boolean;
  };
  shade?: boolean;
  faces: Partial<Record<FaceName, FaceDef>>;
}

export interface ModelDef {
  parent?: string;
  ambientocclusion?: boolean;
  textures?: Record<string, string>;
  elements?: ElementDef[];
}

export interface ResourcePack {
  name: string;
  /** Keyed by namespaced block id, e.g. `minecraft:oak_stairs`. */
  blockstates: Map<string, BlockstateDef>;
  /** Keyed by namespaced resource path, e.g. `minecraft:block/stairs`. */
  models: Map<string, ModelDef>;
  /** PNG bytes keyed like models, e.g. `minecraft:block/oak_planks`. */
  textures: Map<string, Uint8Array>;
  /** Frame count for animated textures, keyed the same way. */
  animated: Set<string>;
  /**
   * Namespaces that contributed blockstates, in the order first seen. A client
   * jar has just `minecraft`; a mod jar has its own, which is what the picker
   * heads its section with.
   */
  namespaces: string[];
  counts: { blockstates: number; models: number; textures: number };
}

const BLOCKSTATE = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/;
const MODEL = /^assets\/([^/]+)\/models\/(block\/.+)\.json$/;
const TEXTURE = /^assets\/([^/]+)\/textures\/(block\/.+)\.png$/;
const TEXTURE_META = /^assets\/([^/]+)\/textures\/(block\/.+)\.png\.mcmeta$/;

/**
 * Fills in the namespace a resource id leaves out: `block/x` -> `minecraft:block/x`.
 *
 * Minecraft resolves an unqualified id against `minecraft`, not against the
 * pack it was written in — a mod model saying `"parent": "block/cube_all"`
 * means the vanilla one — so this is the same rule the game applies.
 */
export function qualify(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** The namespace part of a resource id, `minecraft` when it carries none. */
export function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? "minecraft" : id.slice(0, colon);
}

function decodeJson<T>(bytes: Uint8Array, path: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    console.warn(`Skipping malformed JSON in pack: ${path}`);
    return null;
  }
}

/** Shapes the "nothing usable in here" message for what the user was adding. */
export type PackRole = "pack" | "mod";

/** Reads a `.jar` or `.zip` into the subset of assets the renderer needs. */
export async function loadPack(file: File, role: PackRole = "pack"): Promise<ResourcePack> {
  return loadPackBytes(file.name, new Uint8Array(await file.arrayBuffer()), role);
}

const JARJAR_METADATA = "META-INF/jarjar/metadata.json";
const JARJAR_MEMBER = /^META-INF\/jarjar\/[^/]+\.jar$/;

async function unpackAssets(
  bytes: Uint8Array,
  name: string,
  includeMods: boolean,
): Promise<Record<string, Uint8Array>> {
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, {
      filter: ({ name: path }) => BLOCKSTATE.test(path) || MODEL.test(path) ||
        TEXTURE.test(path) || TEXTURE_META.test(path) ||
        (includeMods && (path === JARJAR_METADATA || JARJAR_MEMBER.test(path))),
    }, (error, entries) => {
      if (error) reject(new Error(`${name} isn't a readable zip. Point at a Minecraft client .jar or a resource pack .zip.`, { cause: error }));
      else resolve(entries);
    });
  });
  const metadata = files[JARJAR_METADATA];
  if (!metadata) return files;

  // NeoForge dependencies are full mod jars. Merge their assets in declaration order,
  // allowing the enclosing mod to replace any shared resources.
  const manifest = decodeJson<{ jars?: { path?: string }[] }>(metadata, JARJAR_METADATA);
  const nested: Record<string, Uint8Array> = {};
  if (Array.isArray(manifest?.jars)) {
    for (const entry of manifest.jars) {
      const path = entry?.path;
      if (typeof path === "string" && JARJAR_MEMBER.test(path) && files[path]) {
        Object.assign(nested, await unpackAssets(files[path], path, true));
      }
    }
  }
  for (const path of Object.keys(files)) {
    if (path === JARJAR_METADATA || JARJAR_MEMBER.test(path)) delete files[path];
  }
  return Object.assign(nested, files);
}

/** As {@link loadPack}, for bytes that never came from a file input. */
export async function loadPackBytes(
  packName: string,
  bytes: Uint8Array,
  role: PackRole = "pack",
): Promise<ResourcePack> {
  const files = await unpackAssets(bytes, packName, role === "mod");
  const pack: ResourcePack = {
    name: packName,
    blockstates: new Map(),
    models: new Map(),
    textures: new Map(),
    animated: new Set(),
    namespaces: [],
    counts: { blockstates: 0, models: 0, textures: 0 },
  };
  const seenNamespaces = new Set<string>();

  for (const path of Object.keys(files)) {
    const entry = files[path];
    let match = BLOCKSTATE.exec(path);
    if (match) {
      const def = decodeJson<BlockstateDef>(entry, path);
      if (!def) continue;
      pack.blockstates.set(`${match[1]}:${match[2]}`, def);
      if (!seenNamespaces.has(match[1])) {
        seenNamespaces.add(match[1]);
        pack.namespaces.push(match[1]);
      }
      continue;
    }
    match = MODEL.exec(path);
    if (match) {
      const def = decodeJson<ModelDef>(entry, path);
      if (def) pack.models.set(`${match[1]}:${match[2]}`, def);
      continue;
    }
    match = TEXTURE.exec(path);
    if (match) {
      pack.textures.set(`${match[1]}:${match[2]}`, entry);
      continue;
    }
    match = TEXTURE_META.exec(path);
    if (match) {
      const meta = decodeJson<{ animation?: unknown }>(entry, path);
      if (meta?.animation !== undefined) pack.animated.add(`${match[1]}:${match[2]}`);
    }
  }

  pack.counts = {
    blockstates: pack.blockstates.size,
    models: pack.models.size,
    textures: pack.textures.size,
  };

  // A mod is judged on blockstates alone: plenty of block-adding mods
  // reuse vanilla textures, and a mod that adds no blocks at all — a HUD,
  // a sound pack — is the case worth naming.
  const empty =
    role === "mod"
      ? pack.blockstates.size === 0
      : pack.blockstates.size === 0 || pack.textures.size === 0;
  if (empty) {
    throw new Error(
      role === "mod"
        ? `${packName} adds no blocks — nothing here to build with. ` +
          `Mods that only change the interface or the sounds have no block assets.`
        : `${packName} has no block assets. A client .jar works; so does ` +
          `a resource pack, as long as it contains block textures.`,
    );
  }
  return pack;
}

/* ------------------------------------------------------- local discovery */

export interface InstalledVersion {
  id: string;
  size: number;
  modified: number;
}

/**
 * Asks the dev server what Minecraft versions are installed. Returns an empty
 * list in a built copy, where the endpoint doesn't exist.
 */
export async function findInstalledVersions(): Promise<InstalledVersion[]> {
  try {
    const response = await fetch("/__mc/versions");
    if (!response.ok) return [];
    const body = (await response.json()) as { versions?: InstalledVersion[] };
    return body.versions ?? [];
  } catch {
    return [];
  }
}

/** Fetches an installed version's jar bytes from the dev server. */
export async function fetchInstalledVersion(id: string): Promise<Uint8Array> {
  const response = await fetch(`/__mc/jar?id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Could not read the ${id} jar (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** A modded profile the dev server found — a CurseForge, MultiMC or Prism instance. */
export interface InstalledInstance {
  id: string;
  name: string;
  /** Jars in its `mods` folder, in name order. */
  mods: { file: string; size: number }[];
}

/**
 * Asks the dev server which modded instances are installed. Empty in a built
 * copy, where mod jars are added through the file picker instead.
 */
export async function findInstances(): Promise<InstalledInstance[]> {
  try {
    const response = await fetch("/__mc/instances");
    if (!response.ok) return [];
    const body = (await response.json()) as { instances?: InstalledInstance[] };
    return body.instances ?? [];
  } catch {
    return [];
  }
}

/** Fetches one mod jar's bytes from an instance the scan reported. */
export async function fetchInstanceMod(instance: string, file: string): Promise<Uint8Array> {
  const response = await fetch(
    `/__mc/mod?instance=${encodeURIComponent(instance)}&file=${encodeURIComponent(file)}`,
  );
  if (!response.ok) throw new Error(`Could not read ${file} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Merges a partial pack over a base one, so a resource pack that only
 * overrides a handful of textures still renders every other block.
 */
export function layerPacks(base: ResourcePack, over: ResourcePack): ResourcePack {
  const merged: ResourcePack = {
    name: `${over.name} over ${base.name}`,
    blockstates: new Map(base.blockstates),
    models: new Map(base.models),
    textures: new Map(base.textures),
    animated: new Set(base.animated),
    namespaces: [...base.namespaces],
    counts: { blockstates: 0, models: 0, textures: 0 },
  };
  for (const [key, value] of over.blockstates) merged.blockstates.set(key, value);
  for (const [key, value] of over.models) merged.models.set(key, value);
  for (const [key, value] of over.textures) merged.textures.set(key, value);
  for (const key of over.animated) merged.animated.add(key);
  for (const namespace of over.namespaces) {
    if (!merged.namespaces.includes(namespace)) merged.namespaces.push(namespace);
  }
  merged.counts = {
    blockstates: merged.blockstates.size,
    models: merged.models.size,
    textures: merged.textures.size,
  };
  return merged;
}

/**
 * The vanilla pack with every enabled mod stacked on it, later ones winning.
 * Returns the base itself when there are no mods, so the common case allocates
 * nothing.
 */
export function stackPacks(base: ResourcePack | null, mods: ResourcePack[]): ResourcePack | null {
  if (!base) return mods.length ? mods.reduce(layerPacks) : null;
  return mods.reduce(layerPacks, base);
}

/** Every block id the pack carries in one namespace, namespaced. */
export function blocksInNamespace(pack: ResourcePack, namespace: string): string[] {
  const out: string[] = [];
  for (const id of pack.blockstates.keys()) {
    if (namespaceOf(id) === namespace) out.push(id);
  }
  return out;
}
