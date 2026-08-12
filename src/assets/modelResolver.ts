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
import {
  qualify,
  type Condition,
  type ElementDef,
  type ModelDef,
  type ResourcePack,
  type VariantDef,
} from "./pack";

export interface FlatModel {
  textures: Record<string, string>;
  elements: ElementDef[];
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

/**
 * `lenient` treats a property the blockstate doesn't carry as satisfied. Used
 * as a second pass when strict matching finds nothing, which happens with
 * files that store bare block ids — every part of a wall's multipart is
 * conditional, so a property-less `stone_brick_wall` would otherwise vanish.
 */
function matchesCondition(
  condition: Condition | undefined,
  props: Record<string, string>,
  lenient: boolean,
): boolean {
  if (!condition) return true;
  const any = condition as { OR?: Condition[]; AND?: Condition[] };
  if (any.OR) return any.OR.some((c) => matchesCondition(c, props, lenient));
  if (any.AND) return any.AND.every((c) => matchesCondition(c, props, lenient));
  for (const key of Object.keys(condition)) {
    const expected = String((condition as Record<string, string>)[key]);
    const actual = props[key];
    if (actual === undefined) {
      if (lenient) continue;
      return false;
    }
    if (!expected.split("|").includes(actual)) return false;
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
    if (model.elements.length === 0) continue;
    out.push({
      model,
      x: ((option.x ?? 0) % 360 + 360) % 360,
      y: ((option.y ?? 0) % 360 + 360) % 360,
      uvlock: option.uvlock ?? false,
    });
  }
  return out;
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
    for (const lenient of [false, true]) {
      const parts: ResolvedState = [];
      for (const part of def.multipart) {
        if (!matchesCondition(part.when, props, lenient)) continue;
        const placements = toPlacements(pack, part.apply, cache);
        if (placements.length) parts.push(placements);
      }
      if (parts.length) return parts;
    }
    return null;
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
  const placements = toPlacements(pack, def.variants[bestKey], cache);
  return placements.length ? [placements] : null;
}
