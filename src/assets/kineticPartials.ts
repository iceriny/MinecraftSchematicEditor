import type { FlatModel } from "./modelResolver";
import { qualify, type ElementDef, type ResourcePack } from "./pack";

const worldModels = new WeakMap<ResourcePack, Set<string>>();

function referencedWorldModels(pack: ResourcePack): Set<string> {
  const cached = worldModels.get(pack);
  if (cached) return cached;
  const referenced = new Set<string>();
  for (const state of pack.blockstates.values()) {
    const alternatives = [
      ...Object.values(state.variants ?? {}),
      ...(state.multipart ?? []).map(part => part.apply),
    ];
    for (const variant of alternatives.flat()) {
      if (!variant?.model) continue;
      let path: string | undefined = qualify(variant.model);
      while (path && !referenced.has(path)) {
        referenced.add(path);
        const parent: string | undefined = pack.models.get(path)?.parent;
        path = parent ? qualify(parent) : undefined;
      }
    }
  }
  worldModels.set(pack, referenced);
  return referenced;
}

function shapeKey(element: ElementDef): string {
  const r = element.rotation;
  return JSON.stringify([element.from, element.to, r?.angle
    ? [r.axis, r.angle, r.origin, !!r.rescale] : null, Object.keys(element.faces).sort()]);
}

type ElementKey = (element: ElementDef, textures: FlatModel["textures"]) => string;

/**
 * Sometimes the inventory shell has different face artwork but is in the
 * exact same pose. In that case only accept added surfaces independently
 * authored in both the item and a separate part in the world model's folder.
 * All coordinates, rotations, UVs and materials of those surfaces must agree.
 */
export function corroboratedRestPose(
  pack: ResourcePack, worldPath: string, base: FlatModel, item: FlatModel,
  elementKey: ElementKey, itemModelPaths: ReadonlySet<string>,
): FlatModel | undefined {
  const path = qualify(worldPath);
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  if (!/^[^:]+:block\/.+\/$/.test(folder) || base.mesh?.length || item.mesh?.length ||
      base.elements.length < 2 || item.elements.length <= base.elements.length) return;

  const shell = new Set(base.elements.map(shapeKey));
  const extras = new Map(item.elements.map(e => [shapeKey(e), e]));
  // Ambiguous overlapping elements make subtraction unreliable.
  if (shell.size !== base.elements.length || extras.size !== item.elements.length) return;
  let anchors = 0;
  for (const element of base.elements) {
    const key = shapeKey(element);
    const peer = extras.get(key);
    if (!peer) return;
    if (elementKey(element, base.textures) === elementKey(peer, item.textures)) anchors++;
    extras.delete(key);
  }
  if (anchors < 2) return;

  const expected = new Map([...extras.values()].map(e => [elementKey(e, item.textures), e]));
  const referenced = referencedWorldModels(pack);
  let selected: ElementDef[] | undefined;
  for (const [candidate, def] of pack.models) {
    if (!candidate.startsWith(folder) || candidate.slice(folder.length).includes("/") ||
        referenced.has(candidate) || itemModelPaths.has(candidate) || def.loader || def.overrides ||
        (def.parent && qualify(def.parent) !== "minecraft:block/block") || !def.elements?.length ||
        def.elements.some(e => shell.has(shapeKey(e)))) continue;

    const matched = new Set<ElementDef>();
    for (const partElement of def.elements) {
      const peer = expected.get(elementKey(partElement, def.textures ?? {}));
      if (peer) matched.add(peer);
    }
    if (matched.size < 2) continue;
    // Alternate moving parts in the same folder may represent exclusive poses.
    if (selected) return;
    selected = [...matched];
  }
  return selected ? { ...item, elements: selected } : undefined;
}
