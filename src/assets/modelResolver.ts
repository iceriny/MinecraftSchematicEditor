/**
 * Turns a blockstate into the models that draw it.
 *
 * Mirrors the vanilla resolution order:
 *   blockstate JSON -> variant (or the matching multipart cases)
 *   -> model + x/y rotation + uvlock
 *   -> flatten the parent chain, merging texture maps
 *   -> resolve `#name` texture variables to real texture paths
 */

import { normalizeName, type BlockState } from "../core/model";
import { readObj, type MeshFace } from "./wavefront";
import { corroboratedRestPose } from "./kineticPartials";
import {
  qualify,
  type BlockstateDef,
  type Condition,
  type ElementDef,
  type ModelDef,
  type ResourcePack,
  type VariantDef,
} from "./pack";

export interface FlatModel {
  textures: Record<string, string>;
  elements: ElementDef[];
  mesh?: MeshFace[];
  ambientocclusion: boolean;
}

export interface Placement {
  model: FlatModel;
  /** Rotation about the block centre, in degrees; always a multiple of 90. */
  x: number;
  y: number;
  uvlock: boolean;
}

/**
 * One entry per part that draws — a plain block has one, a fence has a post
 * plus a side for each connection. Each part carries its weighted options,
 * which the baker picks between using the block position.
 */
export type ResolvedState = Placement[][];

const EMPTY: FlatModel = { textures: {}, elements: [], ambientocclusion: true };

/* --------------------------------------------------------------- matching */

function matchesCondition(
  condition: Condition | undefined,
  props: Record<string, string>,
): boolean {
  if (!condition) return true;
  const any = condition as { OR?: Condition[]; AND?: Condition[] };
  if (any.OR) return any.OR.some((c) => matchesCondition(c, props));
  if (any.AND) return any.AND.every((c) => matchesCondition(c, props));
  for (const key of Object.keys(condition)) {
    const expected = String((condition as Record<string, string>)[key]);
    const actual = props[key];
    if (actual === undefined) return false;
    const negative = expected.startsWith("!");
    const choices = negative ? expected.slice(1) : expected;
    if (choices.split("|").includes(actual) === negative) return false;
  }
  return true;
}

/**
 * The value each of these properties takes in a block's default state.
 *
 * Needed because a missing property is not a free pass. `oak_stairs` carrying
 * only `facing` and `half` matches every one of the five `shape=` variants
 * equally, and vanilla lists `inner_left` before `straight` — so whichever key
 * happened to come first won, and a straight flight drew as inner corners.
 * Falling back to the default state is what Minecraft itself would show.
 *
 * A default that doesn't apply to a given block costs nothing: it leaves that
 * block's keys tied, which is exactly where this started.
 */
const PROPERTY_DEFAULTS: Record<string, string> = {
  shape: "straight",
  half: "bottom",
  facing: "north",
  axis: "y",
  type: "bottom",
  waterlogged: "false",
  open: "false",
  powered: "false",
};

const multipartDefaults = new WeakMap<BlockstateDef, Record<string, string>>();

/** Evaluate every part against one state, even when the file omits flags. */
function multipartProperties(def: BlockstateDef, props: Record<string, string>): Record<string, string> {
  let defaults = multipartDefaults.get(def);
  if (!defaults) {
    const domains = new Map<string, Set<string>>();
    function collect(condition: Condition) {
      for (const [key, term] of Object.entries(condition)) {
        if (Array.isArray(term)) { term.forEach(collect); continue; }
        const values = domains.get(key) ?? new Set<string>();
        for (const value of String(term).replace(/^!/, "").split("|")) values.add(value);
        domains.set(key, values);
      }
    }
    for (const part of def.multipart ?? []) if (part.when) collect(part.when);
    defaults = {};
    // Wall sides use none/low/tall; an isolated wall has a central post.
    const wall = ["north","east","south","west"].every(k =>
      domains.get(k)?.has("low") && domains.get(k)?.has("tall"));
    for (const [key, values] of domains) {
      if (wall && key === "up") defaults[key] = "true";
      else if ([...values].every(v => v === "false" || v === "true")) defaults[key] = "false";
      else if (wall && values.has("low")) defaults[key] = "none";
      else if (key in PROPERTY_DEFAULTS) defaults[key] = PROPERTY_DEFAULTS[key];
      // An unfamiliar enum has no registry default in a resource pack. Use
      // one declared value consistently rather than drawing exclusive shapes.
      else defaults[key] = [...values][0];
    }
    multipartDefaults.set(def, defaults);
  }
  return { ...defaults, ...props };
}

/** A property the blockstate actually carries is worth more than a fallback. */
const STATED = 2;
const DEFAULTED = 1;

/**
 * Scores a `variants` key against a blockstate. Schematics routinely omit
 * properties — a `.schem` may hold plain `oak_stairs` with none at all — so a
 * key that only mentions properties we don't have still counts as a candidate,
 * and the best-matching key wins. A contradiction disqualifies outright.
 */
function scoreVariantKey(key: string, props: Record<string, string>): number {
  if (key === "") return 0;
  let score = 0;
  for (const pair of key.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const actual = props[name];
    if (actual === undefined) {
      // No stated value to contradict, so prefer the key asking for whatever
      // the block's default state would hold. Anything else is a poorer fit
      // rather than a contradiction — the property may simply not be ours.
      if (PROPERTY_DEFAULTS[name] === value) score += DEFAULTED;
      continue;
    }
    if (actual !== value) return -1;
    score += STATED;
  }
  return score;
}

/* ------------------------------------------------------------- flattening */

/** Flattens a model's parent chain. Child `elements` replace the parent's. */
function flatten(pack: ResourcePack, path: string, cache: Map<string, FlatModel>, depth = 0): FlatModel {
  const key = qualify(path);
  const cached = cache.get(key);
  if (cached) return cached;
  if (depth > 16) return EMPTY;

  const def: ModelDef | undefined = pack.models.get(key);
  if (!def) return EMPTY;

  const parent = def.parent ? flatten(pack, def.parent, cache, depth + 1) : EMPTY;
  const model: FlatModel = {
    textures: { ...parent.textures, ...def.textures },
    // Vanilla takes elements from the nearest ancestor that declares them;
    // they are never merged across the chain.
    elements: def.elements ?? parent.elements,
    mesh: def.loader === "neoforge:obj" && def.model
      ? readObj(pack.wavefront, qualify(def.model), def.flip_v === true)
      : def.elements ? undefined : parent.mesh,
    ambientocclusion: def.ambientocclusion ?? parent.ambientocclusion,
  };
  cache.set(key, model);
  return model;
}

/** Follows `#name` indirection to a concrete texture path, or null. */
export function resolveTexture(textures: Record<string, string>, ref: string): string | null {
  let value = ref;
  for (let i = 0; i < 8; i++) {
    if (!value.startsWith("#")) return qualify(value);
    const next = textures[value.slice(1)];
    if (next === undefined) return null;
    value = next;
  }
  return null;
}

// Match what is drawn, including each face's material and UVs. Exporter
// labels, JSON key order and #variable names may differ between the models.
function elementKey(e: ElementDef, textures: FlatModel["textures"]): string {
  const rotation = e.rotation;
  const faces = Object.entries(e.faces).sort(([a], [b]) => a.localeCompare(b)).map(([side, f]) => [
    side, resolveTexture(textures, f.texture), f.uv, f.rotation ?? 0, f.cullface, f.tintindex,
  ]);
  return JSON.stringify([e.from, e.to, e.shade !== false, rotation?.angle
    ? [rotation.axis, rotation.angle, rotation.origin, !!rotation.rescale] : null, faces]);
}

/** Infer the unanimated pieces only when the item shares the world's frame of reference. */
function restPoseParts(pack: ResourcePack, id: string, worldPath: string, cache: Map<string, FlatModel>): FlatModel {
  const cacheKey = "@rest/" + id;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  cache.set(cacheKey, EMPTY);
  const [ns, name] = id.split(":");
  const itemPath = ns + ":item/" + name;
  if (!pack.models.has(itemPath)) return EMPTY;
  const variants = pack.blockstates.get(id)?.variants;
  if (!variants || !Object.entries(variants).every(([key, v]) =>
    !Array.isArray(v) && v.model === worldPath &&
    (!key || key.split(",").every(pair => /=(?:up|down|north|south|east|west|x|y|z)$/.test(pair) ||
      /^waterlogged=(?:true|false)$/.test(pair))))) return EMPTY;

  // Resolve an inherited model family too (e.g. differently coloured casings).
  const seen = new Set<string>();
  let hasRenderer = false;
  for (let path: string | undefined = qualify(worldPath); path && !seen.has(path);) {
    seen.add(path);
    const [domain, local] = path.split(":");
    if (local.split("/").slice(1).some(segment => pack.rendererFamilies.has(domain + ":" + segment)))
      hasRenderer = true;
    const parent: string | undefined = pack.models.get(path)?.parent;
    path = parent ? qualify(parent) : undefined;
  }
  if (!hasRenderer) return EMPTY;
  seen.clear();
  for (let path: string | undefined = itemPath; path;) {
    const def: ModelDef | undefined = pack.models.get(path);
    if (!def || seen.has(path) || def.loader || def.overrides) return EMPTY;
    seen.add(path);
    path = def.parent ? qualify(def.parent) : undefined;
  }

  const base = flatten(pack, worldPath, cache);
  const item = flatten(pack, itemPath, cache);
  if (base.mesh?.length || !base.elements.length || item.elements.length <= base.elements.length) return EMPTY;
  // Subtract a multiset, keeping the world's original faces for all shared elements.
  let extra = [...item.elements];
  const keys = extra.map(e => elementKey(e, item.textures));
  for (const element of base.elements) {
    const index = keys.indexOf(elementKey(element, base.textures));
    if (index < 0) {
      const partial = corroboratedRestPose(pack, worldPath, base, item, elementKey, seen);
      if (!partial) return EMPTY;
      extra = partial.elements;
      break;
    }
    keys.splice(index, 1);
    extra.splice(index, 1);
  }
  if (extra.some(e => Object.values(e.faces).some(f =>
    !pack.textures.has(resolveTexture(item.textures, f.texture) ?? "")))) return EMPTY;
  const result = { ...item, elements: extra };
  cache.set(cacheKey, result);
  return result;
}

/* ---------------------------------------------------------------- resolve */

function toPlacements(
  pack: ResourcePack,
  apply: VariantDef | VariantDef[],
  cache: Map<string, FlatModel>,
): Placement[] {
  const options = Array.isArray(apply) ? apply : [apply];
  const out: Placement[] = [];
  for (const option of options) {
    const model = flatten(pack, option.model, cache);
    if (model.elements.length === 0 && !model.mesh?.length) continue;
    out.push({
      model,
      x: ((option.x ?? 0) % 360 + 360) % 360,
      y: ((option.y ?? 0) % 360 + 360) % 360,
      uvlock: option.uvlock ?? false,
    });
  }
  return out;
}

/**
 * The texture a block entity is made of.
 *
 * Signs, beds, banners, heads and chests are drawn by the game from a
 * hand-written mesh, so their models carry no elements and resolve to nothing.
 * What those models do carry is `particle` — the texture the game throws when
 * you break the block — and that names the material: oak planks for an oak
 * sign, wool for a bed. It is the only thing in the pack that says what the
 * block is made of, so it is what a stand-in should be painted with.
 */
export function particleTexture(
  pack: ResourcePack,
  state: BlockState,
  cache: Map<string, FlatModel>,
): string | null {
  const def = pack.blockstates.get(normalizeName(state.name));
  if (!def) return null;

  const models: string[] = [];
  if (def.variants) {
    for (const apply of Object.values(def.variants)) {
      const first = Array.isArray(apply) ? apply[0] : apply;
      if (first?.model) models.push(first.model);
    }
  }
  if (def.multipart) {
    for (const part of def.multipart) {
      const first = Array.isArray(part.apply) ? part.apply[0] : part.apply;
      if (first?.model) models.push(first.model);
    }
  }

  for (const model of models) {
    const particle = flatten(pack, model, cache).textures.particle;
    // An unresolved `#variable` names nothing that can be drawn.
    if (particle && !particle.startsWith("#")) return qualify(particle);
  }
  return null;
}

/** Resolves a blockstate to the parts that draw it, or null if unknown. */
export function resolveState(
  pack: ResourcePack,
  state: BlockState,
  cache: Map<string, FlatModel>,
): ResolvedState | null {
  const def = pack.blockstates.get(normalizeName(state.name));
  if (!def) return null;
  const props = state.properties ?? {};

  if (def.multipart) {
    const parts: ResolvedState = [];
    const effective = multipartProperties(def, props);
    for (const part of def.multipart) {
      if (!matchesCondition(part.when, effective)) continue;
      const placements = toPlacements(pack, part.apply, cache);
      if (placements.length) parts.push(placements);
    }
    return parts.length ? parts : null;
  }

  if (!def.variants) return null;
  let bestKey: string | null = null;
  let bestScore = -1;
  for (const key of Object.keys(def.variants)) {
    const score = scoreVariantKey(key, props);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  if (bestKey === null) return null;
  const variant = def.variants[bestKey];
  const placements = toPlacements(pack, variant, cache);
  const parts = placements.length ? [placements] : [];
  if (!Array.isArray(variant) && placements.length === 1) {
    const extra = restPoseParts(pack, normalizeName(state.name), variant.model, cache);
    if (extra.elements.length) parts.push([{ ...placements[0], model: extra }]);
  }
  if (state.name === "create:water_wheel") {
    // Its blockstate supplies the stationary gearbox; Create renders this separate
    // rotor at the same orientation in the block-entity renderer.
    const options = (Array.isArray(variant) ? variant : [variant])
      .map(option => ({...option, model: "create:block/water_wheel/wheel"}));
    const rotor = toPlacements(pack, options, cache);
    if (rotor.length) parts.push(rotor);
  }
  return parts.length ? parts : null;
}
