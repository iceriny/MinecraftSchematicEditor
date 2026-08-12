import type { Tool } from "../store";
import {
  IconBrush, IconClone, IconCursor, IconDropper, IconEraser, IconFloor,
  IconMarquee, IconPlace, IconPush, IconRuler, IconStairs, IconThrough,
} from "./icons";

export interface ToolSpec {
  id: Tool;
  /** The key that reaches it, as printed on the rail and in the panel. */
  key: string;
  /** One word, for a heading. */
  label: string;
  /** What it does, in one line — the rail's tooltip and the panel's subtitle. */
  blurb: string;
  icon: typeof IconCursor;
}

/**
 * Every tool in one place. The rail draws it, the panel names the current one,
 * and the settings sections say which tools they belong to — all three used to
 * carry their own copy of this, which is how a tool ends up called one thing on
 * the rail and another in the panel.
 */
export const TOOLS: ToolSpec[] = [
  { id: "move", key: "V", label: "Move", blurb: "Orbit and inspect without editing", icon: IconCursor },
  { id: "place", key: "P", label: "Place", blurb: "Click or drag to add the paint material against a face", icon: IconPlace },
  { id: "erase", key: "E", label: "Erase", blurb: "Click or drag to remove blocks", icon: IconEraser },
  { id: "paint", key: "B", label: "Paint", blurb: "Click or drag to swap in the paint material", icon: IconBrush },
  { id: "eyedropper", key: "I", label: "Pick", blurb: "Take a block off the build as the paint material, and carry on with the tool you were using — Alt-click does the same without leaving it", icon: IconDropper },
  { id: "floor", key: "H", label: "Floor", blurb: "Drag out a rectangle to lay a flat course at one height", icon: IconFloor },
  { id: "push", key: "U", label: "Push", blurb: "Drag the brush and everything it covers goes with it", icon: IconPush },
  { id: "stairs", key: "S", label: "Stairs", blurb: "Click the bottom step, then the top one, and the flight is fitted between them", icon: IconStairs },
  { id: "measure", key: "K", label: "Ruler", blurb: "Click two blocks to read the distance between them", icon: IconRuler },
  { id: "select", key: "M", label: "Select", blurb: "Click a corner, then shift-click the opposite one", icon: IconMarquee },
  { id: "through", key: "X", label: "Select through", blurb: "Drag a box on screen and every block inside it is caught, however deep or hidden", icon: IconThrough },
  { id: "clone", key: "C", label: "Clone", blurb: "Stamp the copied selection — Ctrl+C copies one", icon: IconClone },
];

const BY_ID = new Map(TOOLS.map((spec) => [spec.id, spec]));

export function toolSpec(id: Tool): ToolSpec {
  return BY_ID.get(id) ?? TOOLS[0];
}

/** "Place, erase and paint" — for saying which tools a setting governs. */
export function toolNames(ids: Tool[]): string {
  const names = ids.map((id) => toolSpec(id).label.toLowerCase());
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
