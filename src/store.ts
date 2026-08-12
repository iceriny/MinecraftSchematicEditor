/**
 * Application state. The `Build` itself is mutated in place — copying a
 * multi-megabyte block array on every edit would be pointless — so `revision`
 * is the signal React re-renders on.
 */

import { create } from "zustand";
import {
  Build, createBuild, displayName, propertySummary, resizeBuild, stateKey,
  type BlockState,
} from "./core/model";
import {
  extractClip, mirrorClip as mirrorClipAxis, mirrorState, rotateClipY, type Clip,
} from "./core/clip";
import {
  flipOrientation, orientToFace, turnOrientation, withProperty,
} from "./core/orientation";
import { hasConnectors, repairConnections } from "./core/connect";
import {
  centrePivot, mirrorActive, mirrorImages, type MirrorConfig,
} from "./core/mirror";
import {
  brushIndices, normalAxis, snapBrushSize, snapPushSize, type BrushShape,
} from "./core/brush";
import { axisLock, pushOnce, pushSteps } from "./core/push";
import { boxSize, regionCells, type FillMode } from "./core/region";
import {
  describeStairs, planStairs, MAX_STAIR_RUN, MAX_STAIR_WIDTH,
  type StairPlan, type StairStyle, type StairSupport,
} from "./core/stairs";
import { centreCell, centreOf, measure, type Measurement } from "./core/measure";
import {
  buildFromSession, clearSession, readSession, writeSession, type SessionSnapshot,
} from "./core/session";
import { STARTER_BLOCKS } from "./core/commonBlocks";
import { cssColor } from "./core/blockLook";
import { loadBuild, saveBuild, suggestFilename, type SaveFormat } from "./formats";
import {
  blocksInNamespace, fetchInstalledVersion, fetchInstanceMod, findInstalledVersions,
  findInstances, loadPackBytes, stackPacks,
  type InstalledInstance, type InstalledVersion, type ResourcePack,
} from "./assets/pack";
import {
  clearCachedMods, clearCachedPack, deleteCachedMod, isAutoLoadDisabled, readCachedMods,
  readCachedPack, setAutoLoadDisabled, writeCachedMod, writeCachedPack,
} from "./assets/cache";
import { modLabel } from "./core/blockCatalog";
import { bakePalette } from "./render/bake";
import type { BlockHit, ThroughSelection, Viewer } from "./render/Viewer";

export type Tool =
  | "move" | "erase" | "paint" | "place" | "eyedropper"
  | "select" | "through" | "clone" | "stairs" | "measure"
  | "floor" | "push";

/** Tools that target empty space rather than an existing block. */
const PLACING_TOOLS: Tool[] = ["place", "clone", "stairs", "floor"];

/**
 * Tools that write the paint material. A pick made while one of these was in
 * hand hands the tool straight back, so lifting a block off the build and
 * putting it down again is one detour rather than two tool changes.
 */
const PAINT_TOOLS: Tool[] = ["place", "paint", "floor"];

/** Which box the centre guides are drawn around. */
export type CentreTarget = "build" | "selection";

/** What a click carries beyond the hit itself. */
export interface PickModifiers {
  shift: boolean;
  /**
   * Samples the block under the pointer into the paint material instead of
   * editing, whichever tool is in hand. Building in a material already standing
   * in front of you shouldn't cost a trip to another tool and back.
   */
  alt: boolean;
  /** True for the moves during a drag, false for the initial press. */
  drag: boolean;
}

export interface EditOp {
  label: string;
  indices: Uint32Array;
  before: Uint16Array;
  after: Uint16Array;
  /** Blocks touched during one drag share an id and undo together. */
  strokeId: number | null;
}

export interface Region {
  min: [number, number, number];
  max: [number, number, number];
}

/** One open document, as much of it as the tab strip needs to draw. */
export interface DocTab {
  id: string;
  fileName: string | null;
  name: string;
  size: [number, number, number];
}

/** A mod jar stacked over the base pack, as much of it as the UI needs. */
export interface ModPackInfo {
  /** The jar's filename. Its identity: what caches, lists and removes it. */
  file: string;
  /** `Oh-The-Biomes-Weve-Gone-Fabric-2.5.4.jar` -> `Oh The Biomes Weve Gone`. */
  label: string;
  /** The namespaces it adds blocks under, usually one. */
  namespaces: string[];
  blockCount: number;
}

/** One mod's blocks, as the picker heads and lists them. */
export interface ModBlockGroup {
  label: string;
  blocks: string[];
}

export interface MaterialRow {
  paletteIndex: number;
  state: BlockState;
  count: number;
  color: string;
  label: string;
  detail: string;
}

const HISTORY_LIMIT = 50;
/** Slots on the material hotbar, one per number key. */
export const HOTBAR_SLOTS = 9;
/** Quiet time after the last edit before the session snapshot is written. */
const AUTOSAVE_DELAY = 4000;

interface State {
  build: Build | null;
  /**
   * Every open document, in tab order. A second build is opened beside the
   * first rather than over it, which is how a piece that arrived the wrong size
   * gets cut down to fit before it is stamped into the build being worked on.
   */
  docs: DocTab[];
  activeDoc: string | null;
  revision: number;
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
  fileName: string | null;
  /** Transient one-line message: what a canvas edit did, or why it couldn't. */
  notice: string | null;

  tool: Tool;
  cameraMode: "orbit" | "fly";
  layerLimit: number;
  /** Highlighted in the viewport and targeted by the material actions. */
  selectedMaterial: number | null;
  /** What the paint tool writes. */
  paintMaterial: number | null;
  /**
   * Turns the placed block to suit the face it was clicked against — a stair
   * climbing away from the camera, a log lying along the face it was laid on.
   * Off writes the paint material exactly as it is set, which is what you want
   * once the orientation has been chosen by hand.
   */
  autoOrient: boolean;
  region: Region | null;
  regionAnchor: [number, number, number] | null;
  hover: { x: number; y: number; z: number; label: string } | null;
  meshingRemaining: number;

  /** Width in blocks of the cluster the block tools write per click. */
  brushSize: number;
  brushShape: BrushShape;
  /**
   * The push brush: how wide a bite it takes, and whether that bite is a ball
   * or a box. Held apart from the block brush because the two are used at
   * completely different scales — you paint with three cells and shove with
   * eleven.
   */
  pushSize: number;
  pushShape: BrushShape;
  /** Which cells of the selection box Fill and Erase touch. */
  fillMode: FillMode;
  /**
   * Nine materials on tap, so changing what you are placing is a keypress
   * instead of a trip through the picker. Held as blockstates rather than
   * palette indices: an index means nothing after a replace-all renumbers the
   * palette, and a slot should survive opening another build.
   */
  hotbar: (BlockState | null)[];
  /**
   * The slot in hand. Whatever becomes the paint material is written back into
   * it — from the picker, from the eyedropper, from turning a stair round — so
   * the hotbar holds what you are building with rather than a snapshot of what
   * the build happened to contain when it opened. The alternative was a hotbar
   * that quietly went stale: every material change left the slot showing the
   * old block, and the number key you pressed next threw the new one away.
   */
  hotbarSlot: number;

  /**
   * One step back from an edit that re-cut the whole grid. Block history is
   * indexed by position, so it cannot survive a resize — this catches the
   * accidental crop that would otherwise be unrecoverable.
   */
  structuralUndo: { build: Build; label: string; fileName: string | null } | null;
  /** A build found in storage from a previous session, waiting to be restored. */
  session: SessionSnapshot | null;

  /**
   * Placing tools write onto the plane at the layer limit instead of against
   * the block under the pointer — how a whole flat course gets drawn.
   */
  planeLock: boolean;
  /** The copied box the clone tool stamps. */
  clip: Clip | null;
  /** `merge` leaves the blocks under the clip's air alone; `replace` clears them. */
  pasteMode: "merge" | "replace";
  /**
   * Anchors the stamp on the block under the pointer instead of the empty cell
   * beside it, so a clip can be dropped where blocks already stand and write
   * over them.
   */
  pasteOverwrite: boolean;
  /**
   * A stamp position taken out of the pointer's hands. The pointer can only
   * anchor a clip against a surface it can actually hit, which leaves holes,
   * mid-air and the far side of a wall unreachable; pinning parks the ghost and
   * hands it to the arrow keys instead.
   */
  pastePin: [number, number, number] | null;
  /**
   * Blocks the pointer-driven ghost floats above the face it found. Pinning
   * solves the same problem by taking the pointer out of the loop entirely;
   * this keeps the aim on the mouse and moves only the height by key, which is
   * what stacking a copy a few storeys up actually needs.
   */
  pasteLift: number;
  /** Min corner the clipboard was copied from, for putting it back. */
  clipSource: [number, number, number] | null;
  /**
   * Where the clipboard came from, when that was a file rather than a
   * selection. An imported piece is kept around for a while and stamped more
   * than once, so it is worth being able to see what is loaded.
   */
  clipName: string | null;
  /** True while a file is being read into the clipboard. */
  importing: boolean;

  /**
   * The bottom step of the flight being drawn, waiting for its top step. Null
   * means the next click starts a flight rather than finishing one.
   */
  stairsFrom: [number, number, number] | null;
  /** The flight the next click would lay down, or why it can't be worked out. */
  stairsPlan: StairPlan | null;
  stairsProblem: string | null;
  stairsWidth: number;
  /** Horizontal blocks per rise. 0 fits the grade to the two clicks. */
  stairsRun: number;
  stairsStyle: StairStyle;
  stairsSupport: StairSupport;
  /** The cut step block. Kept as a state so it survives a palette renumber. */
  stairsMaterial: BlockState;
  /** Landings on a gentle run, and everything holding the flight up. */
  stairsFill: BlockState;

  /** The two ruler marks; B is null while only one has been dropped. */
  measureA: [number, number, number] | null;
  measureB: [number, number, number] | null;
  /** Centre lines drawn through the build, or through the selection. */
  centreGuides: boolean;
  centreTarget: CentreTarget;

  /**
   * Symmetry mode. The place, erase and paint brushes repeat their strokes
   * across whichever planes are on, turning blockstates to match.
   */
  mirror: MirrorConfig;

  /** Resource pack / client jar supplying real block models and textures. */
  packStatus: "none" | "loading" | "ready" | "error";
  packName: string | null;
  packError: string | null;
  packCounts: { blockstates: number; models: number; textures: number } | null;
  /** Where the current pack came from, for the chip's tooltip. */
  packSource: "auto" | "manual" | "cache" | null;
  /**
   * Every block the loaded pack knows about, as bare ids. A pack carries one
   * blockstate file per block, which is the only complete and version-accurate
   * block list to hand — the picker's own list is a curated starting set, and
   * writing out the whole game by hand would go stale every release.
   */
  packBlocks: string[];
  /**
   * Mod jars stacked over the base pack, in the order they were added. Each
   * brings its own namespace, so a modded block keeps its real id all the way
   * through to the exported schematic — writing `minecraft:aspen_planks` would
   * produce a file no game could load.
   */
  modPacks: ModPackInfo[];
  /** The modded blocks on offer, one entry per mod, for the picker. */
  modBlocks: ModBlockGroup[];
  /** Off hides modded blocks and renders vanilla only; the jars stay loaded. */
  modBlocksEnabled: boolean;
  /** True while a mod jar is being read. */
  modLoading: boolean;
  modError: string | null;
  /** Modded instances the dev server found, for the add-a-mod menu. */
  installedInstances: InstalledInstance[];
  /** Minecraft versions the dev server found installed. */
  installedVersions: InstalledVersion[];
  /** Off renders the built-in colours even while a pack is loaded. */
  texturesEnabled: boolean;
  /** True when the current bake actually used pack models. */
  textured: boolean;
  /** Blocks the pack had no model for; these fall back to coloured boxes. */
  missingModels: string[];
  baking: boolean;

  undoStack: EditOp[];
  redoStack: EditOp[];
}

interface Actions {
  attachViewer: (viewer: Viewer | null) => void;
  /** Routes a dropped file to the schematic loader or the pack loader. */
  openAny: (file: File) => Promise<void>;
  openFile: (file: File) => Promise<void>;
  /**
   * Reads a schematic onto the clipboard instead of replacing the build, so
   * another design can be dropped into this one and moved around. Falls back to
   * opening the file when there is nothing to import into.
   */
  importFile: (file: File) => Promise<void>;
  /**
   * Opens a schematic in its own tab, leaving the current build untouched. The
   * clipboard is shared between tabs, so a piece can be resized and edited over
   * there and then stamped into the build over here.
   */
  openInNewTab: (file: File) => Promise<void>;
  /** An empty canvas in its own tab. */
  newTab: (width: number, height: number, length: number) => void;
  switchDoc: (id: string) => void;
  closeDoc: (id: string) => void;
  /** Puts the whole build on the clipboard — how a tab hands its work over. */
  copyBuild: () => void;
  loadResourcePack: (file: File) => Promise<void>;
  /** Restores the cached pack, or picks up a local install if there is none. */
  autoLoadResourcePack: () => Promise<void>;
  useInstalledVersion: (id: string) => Promise<void>;
  clearResourcePack: () => Promise<void>;
  setTexturesEnabled: (enabled: boolean) => Promise<void>;
  /** Stacks a mod jar over the base pack, adding its blocks to the picker. */
  addModPack: (file: File) => Promise<void>;
  /** As {@link addModPack}, for a jar the dev server found in an instance. */
  addInstanceMod: (instance: string, file: string) => Promise<void>;
  removeModPack: (file: string) => Promise<void>;
  setModBlocksEnabled: (enabled: boolean) => Promise<void>;
  closeBuild: () => void;
  download: (format: SaveFormat) => Promise<void>;

  /** Starts an empty build of the given size. */
  newBuild: (width: number, height: number, length: number) => void;
  /**
   * Re-cuts the grid, growing or shrinking each side by the given amounts.
   * Positive grows; the build's blocks keep their positions relative to the
   * corner that didn't move.
   */
  resizeCanvas: (expand: { min: [number, number, number]; max: [number, number, number] }) => void;
  /** Shrinks the box to the blocks actually in it. */
  cropToContent: () => void;
  undoStructural: () => void;
  setNotice: (notice: string | null) => void;

  /** Offers a build left behind by a previous session, if storage has one. */
  checkSession: () => Promise<void>;
  restoreSession: () => void;
  dismissSession: () => Promise<void>;
  /** Writes the snapshot now rather than waiting out the debounce. */
  flushAutosave: () => void;

  setTool: (tool: Tool) => void;
  setCameraMode: (mode: "orbit" | "fly") => void;
  frameBuild: () => void;
  setLayerLimit: (y: number) => void;
  selectMaterial: (paletteIndex: number | null) => void;
  setPaintMaterial: (paletteIndex: number | null) => void;
  /** Loads a blockstate into the paint slot, adding it to the palette if new. */
  setPaintState: (state: BlockState) => void;
  /** Sets one orientation property on the paint material. */
  setPaintProperty: (key: string, value: string) => void;
  /** A quarter turn clockwise, or the next axis for a log. */
  turnPaint: () => void;
  /** Turns the paint material upside down. */
  flipPaint: () => void;
  setAutoOrient: (on: boolean) => void;
  setHover: (hover: State["hover"]) => void;
  setMeshingRemaining: (remaining: number) => void;

  setBrushSize: (size: number) => void;
  setBrushShape: (shape: BrushShape) => void;
  setPushSize: (size: number) => void;
  setPushShape: (shape: BrushShape) => void;
  setFillMode: (mode: FillMode) => void;
  /** Takes the slot in hand and makes its material the paint material. */
  useHotbarSlot: (slot: number) => void;
  /** Drops a blockstate into a slot; the current paint material when omitted. */
  assignHotbarSlot: (slot: number, state?: BlockState | null) => void;
  /**
   * Lifts a palette entry into the hand: the paint material, and the hotbar slot
   * that goes with it. What the eyedropper does, and what an Alt-click does with
   * any tool in hand. False when the cell held nothing to take.
   */
  pickBlock: (paletteIndex: number) => boolean;

  /** Called on every pointer move over the build; also drives the clone ghost. */
  hoverAt: (hit: BlockHit | null) => void;
  applyTool: (hit: BlockHit, modifiers: PickModifiers) => void;
  beginStroke: () => void;
  endStroke: () => void;
  clearRegion: () => void;
  /** Selects the whole build, for handing it to another tab in one go. */
  selectAll: () => void;
  /**
   * Takes the result of a through-selection drag. `additive` grows the box
   * already selected rather than replacing it, for picking up a branch the
   * first pass missed.
   */
  selectThrough: (found: ThroughSelection | null, additive: boolean) => void;

  setPlaneLock: (locked: boolean) => void;
  copyRegion: () => void;
  cutRegion: () => void;
  clearClip: () => void;
  rotateClip: () => void;
  mirrorClip: (axis: "x" | "z") => void;
  setPasteMode: (mode: "merge" | "replace") => void;
  setPasteOverwrite: (on: boolean) => void;
  pasteAt: (origin: [number, number, number]) => void;
  /** Parks the ghost so the arrow keys drive it; null picks a sensible start. */
  pinPaste: (origin?: [number, number, number] | null) => void;
  /** Steps the pinned ghost, in whole blocks, along the given world offset. */
  nudgePaste: (delta: [number, number, number]) => void;
  /** Grid axes matching screen right and away, for the nudge keys. */
  viewerAxes: () => { right: [number, number, number]; forward: [number, number, number] };
  /** Stamps at the pin and leaves it up for a second stamp. */
  stampPin: () => void;
  unpinPaste: () => void;
  /** Raises or lowers the pointer-driven ghost by whole blocks. */
  liftPaste: (by: number) => void;
  /** Sets that height outright; 0 puts the stamp back on the face. */
  setPasteLift: (lift: number) => void;

  setStairsWidth: (width: number) => void;
  setStairsRun: (run: number) => void;
  setStairsStyle: (style: StairStyle) => void;
  setStairsSupport: (support: StairSupport) => void;
  setStairsMaterial: (state: BlockState) => void;
  setStairsFill: (state: BlockState) => void;
  /** Drops the pending bottom step, so the next click starts a fresh flight. */
  clearStairs: () => void;
  /** Lays down the flight currently previewed. */
  buildStairs: () => void;

  /** Drops a ruler mark; the third one starts a new measurement. */
  markMeasure: (at: [number, number, number]) => void;
  clearMeasure: () => void;
  /** Reads the current measurement, or null while fewer than two marks are down. */
  measurement: () => Measurement | null;
  /** Puts the ruler on the selection box's opposite corners. */
  measureRegion: () => void;
  /** Turns the two ruler marks into a selection box. */
  regionFromMeasure: () => void;
  setCentreGuides: (on: boolean) => void;
  setCentreTarget: (target: CentreTarget) => void;
  /**
   * The box the centre readout describes. Defaults to whichever the centre
   * panel is pointed at; `target` overrides that for a caller that means one in
   * particular, like the selection panel's own centre buttons.
   */
  centreBox: (target?: CentreTarget) => Region | null;
  /** Selects the centre column of that box, full height. */
  selectCentre: (target?: CentreTarget) => void;
  /** Selects the middle block itself — one cell, or the cluster round an even seam. */
  selectCentreCell: (target?: CentreTarget) => void;

  setMirrorAxis: (axis: 0 | 1 | 2, on: boolean) => void;
  /** Slides one plane by half a block per step. */
  nudgeMirrorPivot: (axis: 0 | 1 | 2, by: number) => void;
  /** Puts every plane back on the middle of the build. */
  recentreMirror: () => void;
  clearMirror: () => void;

  eraseMaterial: (paletteIndex: number) => void;
  replaceMaterial: (from: number, to: BlockState) => void;
  eraseRegion: () => void;
  fillRegion: (state: BlockState) => void;
  replaceInRegion: (from: number, to: BlockState) => void;

  /** Quarter turn about Y, in place, re-centred on the selection box. */
  rotateRegion: () => void;
  mirrorRegion: (axis: "x" | "z") => void;
  /** Moves the selection's blocks, leaving air behind and taking the box along. */
  moveRegion: (delta: [number, number, number]) => void;
  /** Slides the selection box without disturbing any blocks. */
  nudgeRegion: (delta: [number, number, number]) => void;

  undo: () => void;
  redo: () => void;
  materials: () => MaterialRow[];
}

/**
 * One open document. The active one's editing state lives in the store proper;
 * this is where the others park theirs, along with every build — far too heavy
 * to want React re-rendering on, which is why the tab strip gets the light
 * {@link DocTab} summaries instead.
 *
 * What is *not* here is deliberate: the clipboard, the hotbar, the tool and the
 * camera are ways of working rather than properties of a file, and they stay
 * put as you move between tabs. The shared clipboard is the whole point — it is
 * how a piece cut down to size in one tab reaches the build in another.
 */
interface DocRecord {
  id: string;
  build: Build;
  fileName: string | null;
  layerLimit: number;
  region: Region | null;
  regionAnchor: [number, number, number] | null;
  selectedMaterial: number | null;
  paintMaterial: number | null;
  undoStack: EditOp[];
  redoStack: EditOp[];
  structuralUndo: { build: Build; label: string; fileName: string | null } | null;
  measureA: [number, number, number] | null;
  measureB: [number, number, number] | null;
}
let docRecords: DocRecord[] = [];
let docCounter = 0;

let viewer: Viewer | null = null;
/** Non-null while the pointer is held down with an edit tool. */
let activeStroke: number | null = null;
let strokeCounter = 0;
/**
 * What the eyedropper interrupted. Picking a material is a means to an end —
 * nobody's goal is to be holding an eyedropper — so a pick made on the way out
 * of a block tool hands that tool back rather than leaving you a keypress short
 * of using what you just took.
 */
let toolBeforePick: Tool | null = null;
/**
 * The tool a pick has earned back, waiting for the button to come up. Swapping
 * tools while the pointer is still down would hand the rest of that press to the
 * new one, so a dropper click that strayed a pixel would start laying blocks.
 */
let pendingToolReturn: Tool | null = null;

/**
 * Blocks written so far in the current drag. A stroke used to be folded into
 * the undo stack one block at a time, which re-copied the whole stroke on every
 * block and turned a long erase quadratic; it collects here instead and becomes
 * a single {@link EditOp} when the pointer comes up.
 */
interface StrokeBuffer {
  label: string;
  strokeId: number;
  indices: number[];
  before: number[];
  after: number[];
  /** Where each cell already sits in the arrays, for re-crossed cells. */
  slot: Map<number, number>;
}
let strokeBuffer: StrokeBuffer | null = null;
let autosaveTimer = 0;
/**
 * The face a place-drag started on. Without it the row you are laying becomes
 * its own surface and the next block climbs on top of the last one.
 */
let strokePlane: { axis: 0 | 1 | 2; value: number } | null = null;
/**
 * The corner a floor was dragged from and the corner it has reached. The floor
 * is only written when the button comes up, so this is where it lives until
 * then — nothing outside the viewport's own preview needs to watch it, which is
 * why it is here rather than in the store proper.
 */
let floorFrom: [number, number, number] | null = null;
let floorTo: [number, number, number] | null = null;
/** Where the push brush was grabbed, and the cell it now sits on. */
let pushFrom: [number, number, number] | null = null;
let pushAt: [number, number, number] | null = null;
/** Last cell reported to React, so a pointer move that changes nothing is free. */
let lastHoverIndex = -1;
/**
 * The client jar or resource pack everything else stands on, and the mod jars
 * stacked over it. `pack` is the two folded together — what the baker resolves
 * against — and is rebuilt by {@link relayerPacks} whenever either changes.
 */
let basePack: ResourcePack | null = null;
let modPacks: { file: string; pack: ResourcePack }[] = [];
let pack: ResourcePack | null = null;
/** Guards the startup probe: StrictMode mounts effects twice in development. */
let autoLoadStarted = false;
/** Palette length the current bake covers; a longer palette needs a rebake. */
let bakedCount = 0;
let bakeToken = 0;

const PACK_EXTENSIONS = /\.(jar|zip)$/i;

/** True when every cell of a stamp at `origin` lands inside the build. */
function clipFits(build: Build, clip: Clip, origin: [number, number, number]): boolean {
  return (
    build.inBounds(origin[0], origin[1], origin[2]) &&
    build.inBounds(
      origin[0] + clip.width - 1,
      origin[1] + clip.height - 1,
      origin[2] + clip.length - 1,
    )
  );
}

/**
 * The nine most-used materials in a build, as a starting hotbar. An empty
 * canvas has none to draw on and falls back to a generic building set.
 */
function seedHotbar(build: Build): (BlockState | null)[] {
  const counts = build.countByPalette();
  const order: number[] = [];
  for (let i = 1; i < build.palette.length; i++) if (counts[i] > 0) order.push(i);
  order.sort((a, b) => counts[b] - counts[a]);
  if (order.length === 0) return STARTER_BLOCKS.map((name) => ({ name }));

  const slots: (BlockState | null)[] = new Array(HOTBAR_SLOTS).fill(null);
  for (let i = 0; i < HOTBAR_SLOTS && i < order.length; i++) slots[i] = build.palette[order[i]];
  return slots;
}

/** The whole build, as a region — the default box for the centre readout. */
function buildBox(build: Build): Region {
  return { min: [0, 0, 0], max: [build.width - 1, build.height - 1, build.length - 1] };
}

/** A write map as the flat pair of arrays an {@link EditOp} is made of. */
function packWrites(writes: Map<number, number>): { indices: Uint32Array; after: Uint16Array } {
  const indices = new Uint32Array(writes.size);
  const after = new Uint16Array(writes.size);
  let i = 0;
  for (const [index, value] of writes) {
    indices[i] = index;
    after[i] = value;
    i++;
  }
  return { indices, after };
}

/** The box two opposite corners span, in either order. */
function spanBox(a: [number, number, number], b: [number, number, number]): Region {
  return {
    min: [0, 1, 2].map((i) => Math.min(a[i], b[i])) as [number, number, number],
    max: [0, 1, 2].map((i) => Math.max(a[i], b[i])) as [number, number, number],
  };
}

/** The smallest box holding both. */
function unionBox(a: Region, b: Region): Region {
  return {
    min: [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i])) as [number, number, number],
    max: [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i])) as [number, number, number],
  };
}

/**
 * Points the centre lines at whichever box they are set to follow. The
 * selection moves constantly, so this is driven off a subscription rather than
 * from every action that touches a region.
 */
function drawCentreGuides(state: State) {
  if (!viewer) return;
  const { build, centreGuides, centreTarget, region } = state;
  if (!build || !centreGuides) {
    viewer.setCentreGuides(null);
    return;
  }
  viewer.setCentreGuides(
    centreTarget === "selection" && region ? region : buildBox(build),
  );
}

export const useStore = create<State & Actions>((set, get) => {
  /** Applies an edit, records it for undo, and tells the viewer what moved. */
  function commit(label: string, indices: Uint32Array, after: Uint16Array) {
    const build = get().build;
    if (!build || indices.length === 0) return;

    // Fences, panes and walls keep their connections in the blockstate, and the
    // game recomputes them on every placement. The joins an edit implies — for
    // the blocks it writes and for the neighbours they reach — are folded into
    // the same change here, so they undo together and never drift apart.
    if (hasConnectors(build)) {
      const writes = new Map<number, number>();
      for (let i = 0; i < indices.length; i++) writes.set(indices[i], after[i]);
      repairConnections(build, writes);
      ({ indices, after } = packWrites(writes));
    }

    const before = new Uint16Array(indices.length);
    for (let i = 0; i < indices.length; i++) before[i] = build.data[indices[i]];
    build.applyChanges(indices, after);

    record(label, indices, before, after);
    invalidate(indices);
    refreshHighlight();
    scheduleAutosave();
  }

  /**
   * Files an applied change into history: straight onto the stack outside a
   * drag, into the stroke buffer inside one.
   */
  function record(label: string, indices: Uint32Array, before: Uint16Array, after: Uint16Array) {
    if (activeStroke === null) {
      const op: EditOp = { label, indices, before, after, strokeId: null };
      set({
        undoStack: [...get().undoStack, op].slice(-HISTORY_LIMIT),
        redoStack: [],
        revision: get().revision + 1,
      });
      return;
    }

    const buffer: StrokeBuffer = (strokeBuffer ??= {
      label, strokeId: activeStroke, indices: [], before: [], after: [], slot: new Map(),
    });
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const at = buffer.slot.get(index);
      if (at === undefined) {
        buffer.slot.set(index, buffer.indices.length);
        buffer.indices.push(index);
        buffer.before.push(before[i]);
        buffer.after.push(after[i]);
      } else {
        // A wide brush re-crosses its own cells constantly. Only the newest
        // value matters, and `before` has to stay the value from before the
        // whole stroke or undo would rewind to a half-drawn state.
        buffer.after[at] = after[i];
      }
    }
    set({ revision: get().revision + 1 });
  }

  /** Seals the current drag into one undo entry. */
  function flushStroke() {
    const buffer = strokeBuffer;
    strokeBuffer = null;
    if (!buffer || buffer.indices.length === 0) return;
    const op: EditOp = {
      label: buffer.label,
      indices: Uint32Array.from(buffer.indices),
      before: Uint16Array.from(buffer.before),
      after: Uint16Array.from(buffer.after),
      strokeId: buffer.strokeId,
    };
    set({
      undoStack: [...get().undoStack, op].slice(-HISTORY_LIMIT),
      redoStack: [],
      revision: get().revision + 1,
    });
  }

  /**
   * Applies a merged set of writes as one entry. The region transforms clear a
   * box and stamp into it in the same breath, and a cell touched by both must
   * end up in history once, with the value it finished on.
   */
  function commitMap(label: string, writes: Map<number, number>) {
    const { indices, after } = packWrites(writes);
    commit(label, indices, after);
  }

  /** Queues a session snapshot once the edits stop coming. */
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      const { build, fileName } = get();
      if (build) void writeSession(build, fileName);
    }, AUTOSAVE_DELAY) as unknown as number;
  }

  /**
   * Folds the mod jars over the base pack and republishes the block lists the
   * picker reads. Mods off leaves the jars loaded but resolves against vanilla
   * alone, so a build that already holds modded blocks still says so — those
   * blocks simply fall back to coloured boxes until they are turned back on.
   */
  function relayerPacks() {
    const useMods = get().modBlocksEnabled;
    pack = stackPacks(basePack, useMods ? modPacks.map((entry) => entry.pack) : []);
    if (import.meta.env.DEV) (window as unknown as { pack: ResourcePack | null }).pack = pack;

    const vanilla = basePack ? blocksInNamespace(basePack, "minecraft") : [];
    const modBlocks: ModBlockGroup[] = [];
    const info: ModPackInfo[] = [];
    for (const { file, pack: mod } of modPacks) {
      const label = modLabel(file);
      const blocks = mod.namespaces.flatMap((namespace) => blocksInNamespace(mod, namespace));
      info.push({ file, label, namespaces: mod.namespaces, blockCount: blocks.length });
      if (useMods && blocks.length > 0) modBlocks.push({ label, blocks });
    }
    // The pack chip counts its own pack, not the stack: it is labelled with the
    // jar's name, and reporting a mod's blockstates under it would just read as
    // the wrong number for that jar.
    set({ packBlocks: vanilla, modBlocks, modPacks: info, packCounts: basePack?.counts ?? null });
  }

  /**
   * Parses pack bytes, installs them as the base pack, and re-bakes. Returns
   * false when the bytes weren't a usable pack, having left the previous one in
   * place.
   */
  async function adoptPack(
    name: string,
    bytes: Uint8Array,
    source: "auto" | "manual" | "cache",
    remember: boolean,
  ): Promise<boolean> {
    set({ packStatus: "loading", packError: null });
    try {
      basePack = await loadPackBytes(name, bytes);
      // Choosing a pack cancels an earlier "unload and stop looking".
      if (source !== "cache") setAutoLoadDisabled(false);
      set({
        packStatus: "ready",
        packName: basePack.name,
        packSource: source,
        texturesEnabled: true,
      });
      relayerPacks();
      // Caching is fire-and-forget; a 30 MB write shouldn't hold up the render.
      if (remember) void writeCachedPack(name, bytes);
      await rebake();
      return true;
    } catch (cause) {
      set({
        packStatus: basePack ? "ready" : "error",
        packError: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  }

  /**
   * Parses a mod jar and stacks it. A jar already loaded is replaced rather
   * than stacked twice, so adding the same one again is a refresh.
   */
  async function adoptMod(file: string, bytes: Uint8Array, remember: boolean): Promise<boolean> {
    set({ modLoading: true, modError: null });
    try {
      const mod = await loadPackBytes(file, bytes, "mod");
      const at = modPacks.findIndex((entry) => entry.file === file);
      if (at === -1) modPacks.push({ file, pack: mod });
      else modPacks[at] = { file, pack: mod };
      set({ modLoading: false, modBlocksEnabled: true });
      relayerPacks();
      if (remember) void writeCachedMod(file, bytes);
      await rebake();
      return true;
    } catch (cause) {
      set({
        modLoading: false,
        modError: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  }

  /** Re-bakes every palette entry and hands the result to the viewer. */
  async function rebake() {
    const build = get().build;
    if (!build || !viewer) return;
    const token = ++bakeToken;
    set({ baking: true });
    try {
      const source = get().texturesEnabled ? pack : null;
      const baked = await bakePalette(build, source);
      // A newer bake started while this one was decoding textures.
      if (token !== bakeToken) return;
      bakedCount = build.palette.length;
      viewer.setBaked(baked);
      set({ textured: baked.textured, missingModels: baked.missing, baking: false });
    } catch (cause) {
      if (token !== bakeToken) return;
      set({ baking: false, packError: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  /**
   * Re-meshes what an edit touched. A palette that grew needs new baked models
   * first, and that rebuild covers every chunk anyway.
   */
  function invalidate(indices: Uint32Array) {
    const build = get().build;
    if (build && build.palette.length > bakedCount) void rebake();
    else viewer?.invalidateBlocks(indices);
  }

  /**
   * Loads the paint material, and puts it in the hotbar slot in hand. The slot
   * is the hand, not a bookmark: whatever you are building with is on its number
   * key, however it was chosen.
   *
   * `keepSlot` is for the one direction that must not write back — reading a
   * material *out* of a slot — and for a follow-on change like a replace-all,
   * where the material moved but nothing was chosen.
   */
  function loadPaint(paletteIndex: number | null, keepSlot = false) {
    set({ paintMaterial: paletteIndex });
    const { build, hotbar, hotbarSlot } = get();
    if (keepSlot || !build || paletteIndex === null || paletteIndex === 0) return;
    const state = build.palette[paletteIndex];
    if (!state) return;
    const held = hotbar[hotbarSlot];
    if (held && stateKey(held) === stateKey(state)) return;
    const next = [...hotbar];
    next[hotbarSlot] = state;
    set({ hotbar: next });
  }

  /** The blockstate the paint tools are loaded with; null when the slot is empty. */
  function paintState(): BlockState | null {
    const { build, paintMaterial } = get();
    if (!build || paintMaterial === null || paintMaterial === 0) return null;
    return build.palette[paintMaterial] ?? null;
  }

  /**
   * The palette entry a place click should write: the paint material turned to
   * suit the face it landed on. The face decides everything a surface can — which
   * way a log lies, which half a stair sits in — and the camera stands in for the
   * player's yaw for the rest, so a stair climbs away from the view the way it
   * would in the game.
   *
   * A block with nothing to turn comes back as the entry that went in, so the
   * palette never grows a second identical copy of it.
   */
  function orientedPaint(build: Build, paint: number, hit: BlockHit): number {
    const state = build.palette[paint];
    if (!state) return paint;
    // The construction plane is a floor rather than a face, so a click on it
    // reads as one: laid on top of something, pointing up.
    const normal: [number, number, number] = hit.onPlane
      ? [0, 1, 0]
      : [Math.round(hit.normal.x), Math.round(hit.normal.y), Math.round(hit.normal.z)];
    const forward = viewer?.screenAxes().forward ?? [0, 0, 1];
    const turned = orientToFace(state, normal, forward);
    return turned === state ? paint : build.paletteIndexFor(turned);
  }

  /** Rebuilding the highlight scans the whole build, so a drag defers it. */
  function refreshHighlight() {
    if (activeStroke !== null) return;
    viewer?.setHighlight(get().selectedMaterial);
  }

  /** Collects the block indices matching a predicate, optionally inside a region. */
  function collect(match: (value: number) => boolean, region: Region | null): Uint32Array {
    const build = get().build!;
    const out: number[] = [];
    const [x0, y0, z0] = region ? region.min : [0, 0, 0];
    const [x1, y1, z1] = region
      ? region.max
      : [build.width - 1, build.height - 1, build.length - 1];
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const row = (y * build.length + z) * build.width;
        for (let x = x0; x <= x1; x++) {
          if (match(build.data[row + x])) out.push(row + x);
        }
      }
    }
    return Uint32Array.from(out);
  }

  function fill(indices: Uint32Array, value: number): Uint16Array {
    const after = new Uint16Array(indices.length);
    after.fill(value);
    return after;
  }

  /** Keeps the viewer's stamp preview in step with the tool and the clipboard. */
  function syncClip() {
    const { tool, clip } = get();
    viewer?.setPlacing(PLACING_TOOLS.includes(tool));
    viewer?.setPlaneLock(get().planeLock);
    viewer?.setClipSize(
      tool === "clone" && clip ? [clip.width, clip.height, clip.length] : null,
    );
    viewer?.setClipThrough(get().pasteOverwrite);
    viewer?.setClipLift(tool === "clone" && clip ? get().pasteLift : 0);
  }

  /** Hands the viewer the cursors and gestures the current tool owns. */
  function syncTool() {
    const { tool, pushSize, pushShape } = get();
    viewer?.setPushBrush(tool === "push" ? { size: pushSize, shape: pushShape } : null);
    viewer?.setMarquee(tool === "through");
    // A floor is often the first thing laid on an empty canvas, where there is
    // no geometry to aim at; it falls back to the layer plane instead.
    viewer?.setPlaneFallback(tool === "floor");
  }

  /** Ends a floor or push drag, whether it was finished or abandoned. */
  function dropDrag() {
    floorFrom = null;
    floorTo = null;
    pushFrom = null;
    pushAt = null;
    viewer?.endDragPick();
    viewer?.setFloorPreview(null);
  }

  /**
   * Lays the floor that was dragged out. Only the empty cells are written —
   * a floor tool that ground its way through whatever it was drawn over would
   * take the walls with it — and the count of cells it stepped around is worth
   * saying, since from above they look no different.
   */
  function commitFloor() {
    const { build, paintMaterial } = get();
    if (!build || !floorFrom || !floorTo || paintMaterial === null || paintMaterial === 0) return;
    const box = spanBox(floorFrom, floorTo);
    const size = boxSize(box);

    const writes = new Map<number, number>();
    let occupied = 0;
    for (const index of regionCells(build, box, "solid")) {
      if (build.data[index] === 0) writes.set(index, paintMaterial);
      else occupied++;
    }

    if (writes.size === 0) {
      set({ notice: `Nothing to lay — all ${size[0]}×${size[2]} cells at Y ${box.min[1]} are already filled.` });
      return;
    }
    commitMap(`Floor ${size[0]}×${size[2]}`, writes);
    set({
      notice:
        `Floor ${size[0]}×${size[2]} at Y ${box.min[1]} — ${writes.size.toLocaleString()} blocks` +
        (occupied > 0 ? `, ${occupied.toLocaleString()} cells were already filled and left alone.` : "."),
    });
  }

  /** Redraws the parked ghost, e.g. after a rotate changes the footprint. */
  function drawPin() {
    const { build, clip, pastePin } = get();
    if (!pastePin) return;
    if (!build || !clip) return;
    viewer?.setGhost(pastePin, clipFits(build, clip, pastePin));
  }

  /** Replaces the clipboard and refreshes the preview that depends on it. */
  function setClip(clip: Clip | null) {
    // A new piece is a different height and belongs on the ground until it is
    // told otherwise, so the old float goes with the old clip.
    set({ clip, pasteLift: 0 });
    if (!clip) set({ pastePin: null, clipName: null });
    syncClip();
    drawPin();
  }

  /**
   * Re-plans the flight from the pending bottom step to `target`, and hands the
   * result to the ghost. A plan that cannot be worked out — two points on the
   * same level, say — keeps its reason around for the panel to explain.
   */
  function planStairsTo(target: [number, number, number] | null) {
    const { build, stairsFrom } = get();
    if (!build || !stairsFrom || !target) {
      set({ stairsPlan: null, stairsProblem: null });
      viewer?.setStairPreview(null, stairsFrom);
      return;
    }
    const result = planStairs(stairsFrom, target, {
      width: get().stairsWidth,
      run: get().stairsRun,
      style: get().stairsStyle,
      support: get().stairsSupport,
      step: get().stairsMaterial,
      fill: get().stairsFill,
    });
    if (!result.ok) {
      set({ stairsPlan: null, stairsProblem: result.reason });
      viewer?.setStairPreview(null, stairsFrom);
      return;
    }
    set({ stairsPlan: result.plan, stairsProblem: null });
    viewer?.setStairPreview(
      result.plan.cells
        .filter((cell) => build.inBounds(cell.x, cell.y, cell.z))
        .map(({ x, y, z, kind }) => ({ x, y, z, kind })),
      stairsFrom,
    );
  }

  /**
   * Re-picks from where the pointer already is. Hover is deduplicated by cell,
   * so a settings change that alters the flight without moving the mouse has to
   * clear that memory first or the ghost would go stale.
   */
  function replanStairs() {
    lastHoverIndex = -1;
    if (viewer) viewer.refreshHover();
    else planStairsTo(null);
  }

  /**
   * Adds the mirror images of a set of writes.
   *
   * `accept` decides which mirrored cells are eligible from what is currently
   * in them, so symmetry keeps each tool's own rule: place still only fills
   * empty space, erase and paint still only touch cells that hold something.
   * The original writes always win a collision — the half you are pointing at
   * is the one you meant.
   */
  function withMirror(
    build: Build,
    writes: Map<number, number>,
    accept: (current: number) => boolean,
  ): Map<number, number> {
    const config = get().mirror;
    if (!mirrorActive(config) || writes.size === 0) return writes;

    const out = new Map(writes);
    for (const [index, value] of writes) {
      const position = build.positionOf(index);
      for (const image of mirrorImages(config, position)) {
        const [x, y, z] = image.position;
        if (!build.inBounds(x, y, z)) continue;
        const target = build.index(x, y, z);
        if (out.has(target)) continue;
        if (!accept(build.data[target])) continue;
        if (value === 0) {
          out.set(target, 0);
          continue;
        }
        // Stairs, doors and signs have to face back the way they came, or the
        // mirrored half is a copy rather than a reflection.
        let state = build.palette[value];
        if (image.flipped[0]) state = mirrorState(state, "x");
        if (image.flipped[1]) state = mirrorState(state, "y");
        if (image.flipped[2]) state = mirrorState(state, "z");
        out.set(target, build.paletteIndexFor(state));
      }
    }
    return out;
  }

  /** Hands the viewer the planes to draw and to reflect the cursor across. */
  function syncMirror() {
    const config = get().mirror;
    viewer?.setMirror(mirrorActive(config) ? config : null);
  }

  /** Forgets the pending flight and takes its ghost down. */
  function dropStairs() {
    set({ stairsFrom: null, stairsPlan: null, stairsProblem: null });
    viewer?.setStairPreview(null, null);
    lastHoverIndex = -1;
  }

  /**
   * Writes a clip's cells into a pending edit with its min corner at `origin`.
   * Anything hanging off the edge is dropped — the build's box doesn't grow to
   * meet a stamp — and under `merge` the clip's air leaves what's there alone.
   */
  function stampInto(
    writes: Map<number, number>,
    build: Build,
    clip: Clip,
    origin: [number, number, number],
    mode: "merge" | "replace",
  ) {
    // States the clip carries may be new to this build, so they join the
    // palette here; the extra entries are dropped again on export.
    const remap = clip.palette.map((state) => build.paletteIndexFor(state));
    for (let y = 0; y < clip.height; y++) {
      const by = origin[1] + y;
      for (let z = 0; z < clip.length; z++) {
        const bz = origin[2] + z;
        for (let x = 0; x < clip.width; x++) {
          const value = clip.data[(y * clip.length + z) * clip.width + x];
          if (value === 0 && mode === "merge") continue;
          const bx = origin[0] + x;
          if (!build.inBounds(bx, by, bz)) continue;
          writes.set(build.index(bx, by, bz), remap[value]);
        }
      }
    }
  }

  /** Clamps a box of the given size so it sits wholly inside the build. */
  function clampOrigin(
    build: Build,
    origin: [number, number, number],
    size: [number, number, number],
  ): [number, number, number] {
    const limit = [build.width - size[0], build.height - size[1], build.length - size[2]];
    return [0, 1, 2].map((a) =>
      Math.max(0, Math.min(origin[a], Math.max(0, limit[a]))),
    ) as [number, number, number];
  }

  /**
   * Turns or flips the selection where it stands: lift it out, transform it,
   * blank the old box, put it back. One entry in history, because half of a
   * rotation is not a state anyone wants to undo to.
   */
  function transformRegion(label: string, transform: (clip: Clip) => Clip) {
    const { build, region } = get();
    if (!build || !region) return;
    const clip = transform(extractClip(build, region.min, region.max));

    // A quarter turn swaps width and length, so the result is re-centred on the
    // box it came from; anchoring it at the min corner would walk a long thin
    // selection sideways every time you turned it.
    const size = boxSize(region);
    const origin = clampOrigin(
      build,
      [
        region.min[0] + Math.floor((size[0] - clip.width) / 2),
        region.min[1] + Math.floor((size[1] - clip.height) / 2),
        region.min[2] + Math.floor((size[2] - clip.length) / 2),
      ],
      [clip.width, clip.height, clip.length],
    );

    const writes = new Map<number, number>();
    for (const index of regionCells(build, region, "solid")) writes.set(index, 0);
    // Merge, not replace: where the turned footprint spills past the old box it
    // should drop blocks in, not carve a hole in whatever it landed on.
    stampInto(writes, build, clip, origin, "merge");
    commitMap(label, writes);

    const next: Region = {
      min: origin,
      max: [origin[0] + clip.width - 1, origin[1] + clip.height - 1, origin[2] + clip.length - 1],
    };
    set({ region: next, regionAnchor: null });
    viewer?.setSelection(next);
  }

  /** Points the viewer at a different build and drops everything keyed to the old one. */
  function installBuild(build: Build | null) {
    strokeBuffer = null;
    activeStroke = null;
    bakedCount = 0;
    lastHoverIndex = -1;
    dropDrag();
    // A pending flight and the ruler marks name cells in the grid being
    // replaced, so they go with it. The mirror keeps its axes — that is a way
    // of working, not a property of the file — but its planes re-centre, since
    // a pivot from the old box means nothing in the new one.
    set({
      stairsFrom: null, stairsPlan: null, stairsProblem: null,
      measureA: null, measureB: null,
      // Matches the viewer, which drops the stamp's float with the old box.
      pasteLift: 0,
      mirror: {
        axes: get().mirror.axes,
        pivot: build
          ? centrePivot([build.width, build.height, build.length])
          : get().mirror.pivot,
      },
    });
    viewer?.setBuild(build);
    viewer?.setSelection(null);
    viewer?.setHighlight(null);
    viewer?.setGhost(null);
    syncMirror();
  }

  function newRecord(build: Build, fileName: string | null): DocRecord {
    return {
      id: `doc-${++docCounter}`,
      build,
      fileName,
      layerLimit: build.height - 1,
      region: null,
      regionAnchor: null,
      selectedMaterial: null,
      paintMaterial: null,
      undoStack: [],
      redoStack: [],
      structuralUndo: null,
      measureA: null,
      measureB: null,
    };
  }

  /** Re-reads the tab strip from the records. Called when the set of them moves. */
  function refreshTabs() {
    set({
      docs: docRecords.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        name: doc.fileName ?? doc.build.meta.name ?? "Untitled",
        size: [doc.build.width, doc.build.height, doc.build.length] as [number, number, number],
      })),
    });
  }

  /**
   * Writes the live editing state back onto the active document's record, so it
   * is still there when the tab is come back to.
   */
  function stashActive() {
    const state = get();
    const record = docRecords.find((doc) => doc.id === state.activeDoc);
    if (!record || !state.build) return;
    // A resize hands back a different Build object, so the build is copied over
    // too rather than assumed to be the one the record already holds.
    record.build = state.build;
    record.fileName = state.fileName;
    record.layerLimit = state.layerLimit;
    record.region = state.region;
    record.regionAnchor = state.regionAnchor;
    record.selectedMaterial = state.selectedMaterial;
    record.paintMaterial = state.paintMaterial;
    record.undoStack = state.undoStack;
    record.redoStack = state.redoStack;
    record.structuralUndo = state.structuralUndo;
    record.measureA = state.measureA;
    record.measureB = state.measureB;
  }

  /** Makes a document the one being edited, putting it back as it was left. */
  function activateDoc(record: DocRecord) {
    flushStroke();
    installBuild(record.build);
    set({
      activeDoc: record.id,
      build: record.build,
      fileName: record.fileName,
      status: "ready",
      error: null,
      notice: null,
      hover: null,
      layerLimit: record.layerLimit,
      region: record.region,
      regionAnchor: record.regionAnchor,
      selectedMaterial: record.selectedMaterial,
      paintMaterial: record.paintMaterial,
      undoStack: record.undoStack,
      redoStack: record.redoStack,
      structuralUndo: record.structuralUndo,
      measureA: record.measureA,
      measureB: record.measureB,
      // A parked ghost names a cell in the grid we just left; the clip itself
      // survives, which is what makes stamping across tabs work.
      pastePin: null,
      revision: get().revision + 1,
    });
    viewer?.setLayerLimit(record.layerLimit);
    viewer?.setSelection(record.region);
    viewer?.setHighlight(record.selectedMaterial);
    viewer?.setMeasure(record.measureA, record.measureB);
    viewer?.setEditing(get().tool !== "move");
    syncClip();
    void rebake();
    scheduleAutosave();
  }

  /** Back to the empty state: the last tab closed, or the build was thrown away. */
  function emptyOut() {
    clearTimeout(autosaveTimer);
    installBuild(null);
    void clearSession();
    set({
      build: null, activeDoc: null, status: "empty", error: null, fileName: null,
      notice: null, undoStack: [], redoStack: [], region: null, regionAnchor: null,
      selectedMaterial: null, paintMaterial: null, hover: null,
      pastePin: null, clipSource: null, structuralUndo: null, session: null,
      hotbar: new Array(HOTBAR_SLOTS).fill(null),
      hotbarSlot: 0,
      revision: get().revision + 1,
    });
    refreshTabs();
  }

  /**
   * Opens a build as a document: a file, a blank canvas, a restored session.
   * `inNewTab` puts it beside what is already open instead of over it.
   */
  function adoptBuild(build: Build, fileName: string | null, inNewTab = false) {
    if (inNewTab) stashActive();
    installBuild(build);
    viewer?.setCameraMode("orbit");
    viewer?.setEditing(false);
    const hotbar = seedHotbar(build);
    set({
      build,
      fileName,
      status: "ready",
      error: null,
      notice: null,
      cameraMode: "orbit",
      revision: get().revision + 1,
      layerLimit: build.height - 1,
      selectedMaterial: null,
      // The first slot is what the hand starts on, so it is also the paint
      // material — the build's own most-used block, or the first of the starter
      // set on an empty canvas, where the palette has nothing to offer.
      paintMaterial: hotbar[0] ? build.paletteIndexFor(hotbar[0]) : null,
      hotbar,
      hotbarSlot: 0,
      region: null,
      regionAnchor: null,
      undoStack: [],
      redoStack: [],
      structuralUndo: null,
      tool: "move",
      pastePin: null,
      clipSource: null,
      session: null,
    });
    // A fresh tab gets its own record; otherwise this document is being
    // replaced in the tab it already occupies.
    if (inNewTab || !get().activeDoc) {
      const record = newRecord(build, fileName);
      docRecords.push(record);
      set({ activeDoc: record.id });
    }
    stashActive();
    refreshTabs();
    syncClip();
    void rebake();
    scheduleAutosave();
  }

  /**
   * Swaps in a re-cut grid — a resize or a crop — keeping the tool, the paint
   * material and the hotbar, since none of those are tied to the box. Block
   * history is indexed by position and cannot survive, so it is traded for one
   * step of structural undo.
   */
  function recutBuild(label: string, next: Build) {
    const current = get().build;
    if (!current) return;
    installBuild(next);
    set({
      build: next,
      structuralUndo: { build: current, label, fileName: get().fileName },
      undoStack: [],
      redoStack: [],
      region: null,
      regionAnchor: null,
      pastePin: null,
      selectedMaterial: null,
      layerLimit: next.height - 1,
      revision: get().revision + 1,
      notice: `${label} — ${next.width}×${next.height}×${next.length}. Block history was cleared.`,
    });
    stashActive();
    refreshTabs();
    viewer?.setLayerLimit(next.height - 1);
    void rebake();
    scheduleAutosave();
  }

  /** The brush footprint for the current settings, optionally pinned to a face. */
  function brushCells(
    build: Build,
    at: { x: number; y: number; z: number },
    plane: { axis: 0 | 1 | 2; value: number } | null,
  ): number[] {
    const { brushSize, brushShape } = get();
    return brushIndices(build, at.x, at.y, at.z, { size: brushSize, shape: brushShape, plane });
  }

  return {
    build: null,
    docs: [],
    activeDoc: null,
    revision: 0,
    status: "empty",
    error: null,
    fileName: null,
    notice: null,

    tool: "move",
    cameraMode: "orbit",
    layerLimit: 0,
    selectedMaterial: null,
    paintMaterial: null,
    autoOrient: true,
    region: null,
    regionAnchor: null,
    hover: null,
    meshingRemaining: 0,

    brushSize: 1,
    brushShape: "cube",
    pushSize: 5,
    pushShape: "sphere",
    fillMode: "solid",
    hotbar: new Array(HOTBAR_SLOTS).fill(null),
    hotbarSlot: 0,

    structuralUndo: null,
    session: null,

    planeLock: false,
    clip: null,
    pasteMode: "merge",
    pasteOverwrite: false,
    pastePin: null,
    pasteLift: 0,
    clipSource: null,
    clipName: null,
    importing: false,

    stairsFrom: null,
    stairsPlan: null,
    stairsProblem: null,
    stairsWidth: 1,
    stairsRun: 0,
    stairsStyle: "stairs",
    stairsSupport: "none",
    stairsMaterial: { name: "minecraft:oak_stairs" },
    stairsFill: { name: "minecraft:oak_planks" },

    measureA: null,
    measureB: null,
    centreGuides: false,
    centreTarget: "build",
    mirror: { axes: [false, false, false], pivot: [0, 0, 0] },

    packStatus: "none",
    packName: null,
    packError: null,
    packCounts: null,
    packSource: null,
    packBlocks: [],
    modPacks: [],
    modBlocks: [],
    modBlocksEnabled: true,
    modLoading: false,
    modError: null,
    installedInstances: [],
    installedVersions: [],
    texturesEnabled: true,
    textured: false,
    missingModels: [],
    baking: false,

    undoStack: [],
    redoStack: [],

    attachViewer: (next) => {
      viewer = next;
      if (!next) return;
      next.setEditing(get().tool !== "move");
      syncClip();
      syncTool();
      const build = get().build;
      if (build) {
        next.setBuild(build);
        next.setLayerLimit(get().layerLimit);
        next.setHighlight(get().selectedMaterial);
        next.setSelection(get().region);
        void rebake();
      }
      // Overlays that outlive a remount: the ruler and the centre lines are
      // readings, not edits, and should still be there after a hot reload.
      next.setMeasure(get().measureA, get().measureB);
      next.setStairPreview(null, get().stairsFrom);
      syncMirror();
      drawCentreGuides(get());
    },

    openAny: async (file) => {
      if (PACK_EXTENSIONS.test(file.name)) return get().loadResourcePack(file);
      return get().openFile(file);
    },

    /**
     * A jar or zip chosen or dropped on the window. A mod jar arriving this way
     * is stacked as a mod rather than made the base pack: it carries blocks
     * under its own namespace and none under `minecraft`, so adopting it as the
     * base would throw the whole game away and leave a shelf of aspen planks.
     */
    loadResourcePack: async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (basePack) {
        try {
          const probe = await loadPackBytes(file.name, bytes, "mod");
          if (!probe.namespaces.includes("minecraft")) {
            return void (await adoptMod(file.name, bytes, true));
          }
        } catch {
          // Not readable as a mod either; let adoptPack report it properly.
        }
      }
      await adoptPack(file.name, bytes, "manual", true);
    },

    addModPack: async (file) => {
      await adoptMod(file.name, new Uint8Array(await file.arrayBuffer()), true);
    },

    addInstanceMod: async (instance, file) => {
      set({ modLoading: true, modError: null });
      try {
        const bytes = await fetchInstanceMod(instance, file);
        await adoptMod(file, bytes, true);
      } catch (cause) {
        set({
          modLoading: false,
          modError: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },

    removeModPack: async (file) => {
      modPacks = modPacks.filter((entry) => entry.file !== file);
      await deleteCachedMod(file);
      relayerPacks();
      await rebake();
    },

    setModBlocksEnabled: async (enabled) => {
      set({ modBlocksEnabled: enabled });
      relayerPacks();
      await rebake();
    },

    useInstalledVersion: async (id) => {
      set({ packStatus: "loading", packError: null });
      try {
        const bytes = await fetchInstalledVersion(id);
        await adoptPack(`${id}.jar`, bytes, "auto", true);
      } catch (cause) {
        set({
          packStatus: "error",
          packError: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },

    /**
     * Runs once at startup. A cached pack is restored without touching the
     * disk; otherwise the newest local install is adopted if the dev server
     * can see one. Failing to find anything is normal, not an error.
     */
    autoLoadResourcePack: async () => {
      if (autoLoadStarted || pack) return;
      autoLoadStarted = true;

      // What the dev server can see is offered whatever else happens, so the
      // menu has something to show even when nothing loads automatically.
      const probeLocal = () => {
        void findInstalledVersions().then((versions) => set({ installedVersions: versions }));
        void findInstances().then((instances) => set({ installedInstances: instances }));
      };

      if (isAutoLoadDisabled()) {
        // Unloaded on purpose last time; still offer whatever is installed.
        probeLocal();
        return;
      }

      // Mod jars are restored before the base pack so the first bake already
      // has them, rather than baking twice and flashing untextured blocks.
      for (const mod of await readCachedMods()) {
        if (!(await adoptMod(mod.name, new Uint8Array(mod.bytes), false))) {
          await deleteCachedMod(mod.name);
        }
      }

      const cached = await readCachedPack();
      if (cached) {
        set({ packStatus: "loading" });
        // A cached pack that no longer parses is worse than none; drop it.
        if (await adoptPack(cached.name, new Uint8Array(cached.bytes), "cache", false)) {
          probeLocal();
          return;
        }
        await clearCachedPack();
      }

      void findInstances().then((instances) => set({ installedInstances: instances }));
      const versions = await findInstalledVersions();
      set({ installedVersions: versions });
      if (versions.length === 0) {
        set({ packStatus: "none" });
        return;
      }

      set({ packStatus: "loading", packError: null });
      try {
        const [newest] = versions;
        const bytes = await fetchInstalledVersion(newest.id);
        await adoptPack(`${newest.id}.jar`, bytes, "auto", true);
      } catch {
        // The install vanished or is unreadable; the picker still works.
        set({ packStatus: "none" });
      }
    },

    clearResourcePack: async () => {
      // The mods go with it. They only ever made sense stacked on a base pack —
      // a mod jar alone has no dirt, no stone and no cube_all to parent to.
      basePack = null;
      modPacks = [];
      pack = null;
      setAutoLoadDisabled(true);
      await clearCachedPack();
      await clearCachedMods();
      set({
        packStatus: "none", packName: null, packCounts: null,
        packError: null, packSource: null, packBlocks: [], missingModels: [],
        modPacks: [], modBlocks: [], modError: null,
      });
      await rebake();
    },

    setTexturesEnabled: async (enabled) => {
      set({ texturesEnabled: enabled });
      await rebake();
    },

    openFile: async (file) => {
      set({ status: "loading", error: null, fileName: file.name });
      try {
        adoptBuild(await loadBuild(file), file.name);
      } catch (cause) {
        set({
          status: "error",
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },

    importFile: async (file) => {
      // A pack is never a thing to stamp, however it arrived here.
      if (PACK_EXTENSIONS.test(file.name)) return get().loadResourcePack(file);
      // Nothing to import into: opening it is what was meant.
      if (!get().build) return get().openFile(file);

      set({ importing: true });
      try {
        const imported = await loadBuild(file);
        const clip = extractClip(
          imported,
          [0, 0, 0],
          [imported.width - 1, imported.height - 1, imported.length - 1],
        );
        if (clip.count === 0) {
          set({ importing: false, notice: `${file.name} has no blocks in it.` });
          return;
        }

        const build = get().build!;
        set({ clipSource: null, clipName: file.name, importing: false });
        setClip(clip);
        // Park the ghost rather than hanging it off the pointer: an imported
        // piece is placed deliberately, and the arrow keys are a steadier way
        // to land something this size than aiming at a face.
        get().pinPaste();

        const size = `${clip.width}×${clip.height}×${clip.length}`;
        const oversized =
          clip.width > build.width || clip.height > build.height || clip.length > build.length;
        set({
          notice: oversized
            ? `Imported ${file.name} — ${size}, larger than this build's ${build.width}×${build.height}×${build.length}. ` +
              `Grow the canvas or the overhang will be dropped when you stamp.`
            : `Imported ${file.name} — ${size}, ${clip.count.toLocaleString()} blocks. ` +
              `Arrows move it, R turns it, Enter stamps.`,
        });
      } catch (cause) {
        set({
          importing: false,
          notice: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },

    openInNewTab: async (file) => {
      // A pack is never a document, however it arrived here.
      if (PACK_EXTENSIONS.test(file.name)) return get().loadResourcePack(file);
      // Nothing open to sit beside: this is just opening a file.
      if (!get().build) return get().openFile(file);

      set({ status: "loading", error: null });
      try {
        const build = await loadBuild(file);
        adoptBuild(build, file.name, true);
        set({
          notice:
            `${file.name} opened in its own tab — ${build.width}×${build.height}×${build.length}. ` +
            `Resize or trim it here, then Copy build and stamp it into the other tab.`,
        });
      } catch (cause) {
        // The build that was open is still open; this is a notice, not a state.
        set({
          status: "ready",
          notice: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },

    newTab: (width, height, length) => {
      if (!get().build) return get().newBuild(width, height, length);
      try {
        adoptBuild(createBuild(width, height, length, { format: "new" }), null, true);
        set({ tool: "place", notice: "Empty canvas in its own tab." });
        viewer?.setEditing(true);
        syncClip();
      } catch (cause) {
        set({ notice: cause instanceof Error ? cause.message : String(cause) });
      }
    },

    switchDoc: (id) => {
      if (id === get().activeDoc) return;
      const record = docRecords.find((doc) => doc.id === id);
      if (!record) return;
      flushStroke();
      stashActive();
      activateDoc(record);
      refreshTabs();
    },

    closeDoc: (id) => {
      const index = docRecords.findIndex((doc) => doc.id === id);
      if (index < 0) return;
      const wasActive = get().activeDoc === id;
      if (wasActive) flushStroke();
      docRecords.splice(index, 1);

      if (!wasActive) {
        refreshTabs();
        return;
      }
      // The tab that slid into this one's place, or the one before it.
      const next = docRecords[index] ?? docRecords[docRecords.length - 1];
      if (!next) return emptyOut();
      activateDoc(next);
      refreshTabs();
    },

    copyBuild: () => {
      const build = get().build;
      if (!build) return;
      const clip = extractClip(
        build,
        [0, 0, 0],
        [build.width - 1, build.height - 1, build.length - 1],
      );
      if (clip.count === 0) {
        set({ notice: "Nothing to copy — this build has no blocks in it." });
        return;
      }
      set({ clipSource: [0, 0, 0], clipName: get().fileName ?? build.meta.name ?? null });
      setClip(clip);
      set({
        notice:
          `Copied the whole build — ${clip.width}×${clip.height}×${clip.length}, ` +
          `${clip.count.toLocaleString()} blocks. It stays on the clipboard across tabs.`,
      });
    },

    newBuild: (width, height, length) => {
      try {
        adoptBuild(createBuild(width, height, length, { format: "new" }), null);
        set({ tool: "place", notice: "Empty canvas. Pick a paint material and start placing." });
        viewer?.setEditing(true);
        syncClip();
      } catch (cause) {
        set({ notice: cause instanceof Error ? cause.message : String(cause) });
      }
    },

    resizeCanvas: ({ min, max }) => {
      const build = get().build;
      if (!build) return;
      if (min.every((v) => v === 0) && max.every((v) => v === 0)) return;
      try {
        recutBuild(
          "Resize canvas",
          resizeBuild(
            build,
            [-min[0], -min[1], -min[2]],
            [build.width - 1 + max[0], build.height - 1 + max[1], build.length - 1 + max[2]],
          ),
        );
      } catch (cause) {
        set({ notice: cause instanceof Error ? cause.message : String(cause) });
      }
    },

    cropToContent: () => {
      const build = get().build;
      if (!build) return;
      const bounds = build.occupiedBounds();
      if (!bounds) {
        set({ notice: "Nothing to crop to — the build has no blocks in it." });
        return;
      }
      const tight =
        bounds.min.every((v) => v === 0) &&
        bounds.max[0] === build.width - 1 &&
        bounds.max[1] === build.height - 1 &&
        bounds.max[2] === build.length - 1;
      if (tight) {
        set({ notice: "Already tight to the blocks — nothing to crop." });
        return;
      }
      recutBuild("Crop to content", resizeBuild(build, bounds.min, bounds.max));
    },

    undoStructural: () => {
      const previous = get().structuralUndo;
      if (!previous) return;
      installBuild(previous.build);
      set({
        build: previous.build,
        fileName: previous.fileName,
        structuralUndo: null,
        undoStack: [],
        redoStack: [],
        region: null,
        regionAnchor: null,
        pastePin: null,
        selectedMaterial: null,
        layerLimit: previous.build.height - 1,
        revision: get().revision + 1,
        notice: `Undid ${previous.label.toLowerCase()}.`,
      });
      stashActive();
      refreshTabs();
      viewer?.setLayerLimit(previous.build.height - 1);
      void rebake();
      scheduleAutosave();
    },

    setNotice: (notice) => set({ notice }),

    checkSession: async () => {
      // Only an offer, never automatic: silently reopening someone's last build
      // over a fresh tab is the kind of helpfulness nobody asked for.
      if (get().build) return;
      const snapshot = await readSession();
      if (snapshot && !get().build) set({ session: snapshot });
    },

    restoreSession: () => {
      const snapshot = get().session;
      if (!snapshot) return;
      adoptBuild(buildFromSession(snapshot), snapshot.fileName);
    },

    dismissSession: async () => {
      set({ session: null });
      await clearSession();
    },

    // Only the tab being worked in is kept: the snapshot is a scratch copy for
    // surviving a reload, not a workspace, and a second tab is usually a piece
    // being cut to size rather than something you'd mourn.
    flushAutosave: () => {
      clearTimeout(autosaveTimer);
      const { build, fileName } = get();
      if (build) void writeSession(build, fileName);
    },

    /** Closes the tab being worked in; the last one leaves the empty state. */
    closeBuild: () => {
      const active = get().activeDoc;
      if (active) return get().closeDoc(active);
      emptyOut();
    },

    download: async (format) => {
      const build = get().build;
      if (!build) return;
      const blob = await saveBuild(build, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestFilename(build, format);
      link.click();
      URL.revokeObjectURL(url);
    },

    setTool: (tool) => {
      // Reaching for the eyedropper is always an interruption of something else;
      // remember what, so the pick can put it back in your hand. Choosing any
      // other tool by hand answers the question itself.
      if (tool === "eyedropper") {
        if (get().tool !== "eyedropper") toolBeforePick = get().tool;
      } else {
        toolBeforePick = null;
        pendingToolReturn = null;
      }
      set({ tool });
      if (tool !== "select") set({ regionAnchor: null });
      if (tool !== "clone") {
        get().unpinPaste();
        set({ pasteLift: 0 });
      }
      // A half-drawn flight belongs to the stairs tool; leaving it takes the
      // pending bottom step with it rather than surprising you on the way back.
      if (tool !== "stairs") dropStairs();
      else viewer?.setStairPreview(null, get().stairsFrom);
      // Same for a floor or a push left mid-drag by a keyboard tool change.
      dropDrag();
      viewer?.setEditing(tool !== "move");
      syncClip();
      syncTool();
      drawPin();
    },

    setCameraMode: (mode) => {
      viewer?.setCameraMode(mode);
      set({ cameraMode: mode });
    },

    frameBuild: () => viewer?.frameBuild(),

    setLayerLimit: (y) => {
      viewer?.setLayerLimit(y);
      set({ layerLimit: y });
      refreshHighlight();
    },

    selectMaterial: (paletteIndex) => {
      set({ selectedMaterial: paletteIndex });
      viewer?.setHighlight(paletteIndex);
    },

    setPaintMaterial: (paletteIndex) => loadPaint(paletteIndex),

    setPaintState: (state) => {
      const build = get().build;
      if (!build) return;
      // A state the build has never held joins the palette here. Nothing points
      // at it yet, and an entry no block uses is dropped again on export.
      loadPaint(build.paletteIndexFor(state));
    },

    setPaintProperty: (key, value) => {
      const state = paintState();
      if (!state) return;
      get().setPaintState(withProperty(state, key, value));
    },

    turnPaint: () => {
      const state = paintState();
      if (!state) return;
      get().setPaintState(turnOrientation(state));
    },

    flipPaint: () => {
      const state = paintState();
      if (!state) return;
      get().setPaintState(flipOrientation(state));
    },

    setAutoOrient: (autoOrient) => set({ autoOrient }),
    setHover: (hover) => set({ hover }),
    setMeshingRemaining: (remaining) => set({ meshingRemaining: remaining }),

    setBrushSize: (size) => set({ brushSize: snapBrushSize(size) }),
    setBrushShape: (brushShape) => set({ brushShape }),

    setPushSize: (size) => {
      set({ pushSize: snapPushSize(size) });
      syncTool();
    },

    setPushShape: (pushShape) => {
      set({ pushShape });
      syncTool();
    },

    setFillMode: (fillMode) => set({ fillMode }),

    useHotbarSlot: (slot) => {
      const { build, hotbar } = get();
      if (!build) return;
      set({ hotbarSlot: slot });
      const state = hotbar[slot];
      // An empty slot has nothing to hand over, so it takes what is already in
      // hand instead — the same thing a click on it does.
      if (!state) return get().assignHotbarSlot(slot);
      loadPaint(build.paletteIndexFor(state), true);
    },

    assignHotbarSlot: (slot, state) => {
      const { build, hotbar, paintMaterial } = get();
      if (!build) return;
      const next = [...hotbar];
      next[slot] =
        state === undefined ? (paintMaterial === null ? null : build.palette[paintMaterial]) : state;
      set({ hotbar: next });
      // Filling the slot you are holding is a change of material as much as it
      // is a change of slot; filling any other one is just parking a block.
      const held = next[slot];
      if (held && slot === get().hotbarSlot) loadPaint(build.paletteIndexFor(held), true);
    },

    pickBlock: (paletteIndex) => {
      const build = get().build;
      if (!build || paletteIndex === 0 || !build.palette[paletteIndex]) return false;
      loadPaint(paletteIndex);
      return true;
    },

    hoverAt: (hit) => {
      const { build, tool, clip } = get();
      if (!build) return;

      // A pinned ghost is the user's own placement; the pointer must not drag
      // it back to whatever surface happens to be under the cursor.
      if (tool === "clone" && clip && !get().pastePin) {
        const origin = hit?.clipOrigin ?? null;
        viewer?.setGhost(origin, origin ? clipFits(build, clip, origin) : true);
      }

      // The placing tools read out the cell they would write, which is one step
      // along the face normal from the block under the pointer.
      const cell =
        (tool === "place" || tool === "stairs" || tool === "floor") && hit ? hit.place : hit;
      const index = cell ? cell.index : -1;
      if (index === lastHoverIndex) return;
      lastHoverIndex = index;
      if (tool === "stairs" && get().stairsFrom) {
        planStairsTo(cell ? [cell.x, cell.y, cell.z] : null);
      }
      if (!cell) {
        set({ hover: null });
        return;
      }
      const state = build.palette[build.data[cell.index]];
      set({ hover: { x: cell.x, y: cell.y, z: cell.z, label: state ? displayName(state) : "" } });
    },

    applyTool: (hit, { shift, alt, drag }) => {
      const { build, tool } = get();
      if (!build) return;
      const index = hit.index;

      // Alt samples rather than edits, whatever is in hand. Held down through a
      // drag it keeps sampling and never writes, so a slip of the mouse while
      // picking a colour off a wall cannot carve into it.
      if (alt) {
        get().pickBlock(build.data[index]);
        return;
      }

      const wide = get().brushSize > 1;

      if (tool === "erase") {
        // The brush is a solid cluster around the hit; only the cells that
        // actually hold something are worth recording.
        const writes = new Map<number, number>();
        for (const i of brushCells(build, hit, null)) {
          if (build.data[i] !== 0) writes.set(i, 0);
        }
        if (writes.size === 0) return;
        commitMap(
          wide ? "Erase blocks" : "Erase block",
          withMirror(build, writes, (current) => current !== 0),
        );
        return;
      }
      if (tool === "paint") {
        const paint = get().paintMaterial;
        if (paint === null) return;
        const writes = new Map<number, number>();
        for (const i of brushCells(build, hit, null)) {
          if (build.data[i] !== 0 && build.data[i] !== paint) writes.set(i, paint);
        }
        if (writes.size === 0) return;
        commitMap(
          wide ? "Paint blocks" : "Paint block",
          withMirror(build, writes, (current) => current !== 0),
        );
        return;
      }
      if (tool === "place") {
        const paint = get().paintMaterial;
        const target = hit.place;
        if (paint === null || paint === 0 || !target) return;
        // Only ever fill empty space: a place drag that overwrote blocks would
        // eat the wall you were building along.
        if (build.data[target.index] !== 0) return;
        const position: [number, number, number] = [target.x, target.y, target.z];
        if (strokePlane && position[strokePlane.axis] !== strokePlane.value) return;
        const axis = hit.onPlane ? 1 : normalAxis(hit.normal);
        if (!strokePlane && activeStroke !== null) {
          strokePlane = { axis, value: position[axis] };
        }
        // A place brush stays flat on the face it is drawn against: a ball of
        // blocks would bury itself in the wall you were facing.
        const plane = strokePlane ?? { axis, value: position[axis] };
        const value = get().autoOrient ? orientedPaint(build, paint, hit) : paint;
        const writes = new Map<number, number>();
        for (const i of brushCells(build, target, plane)) {
          if (build.data[i] === 0) writes.set(i, value);
        }
        if (writes.size === 0) return;
        commitMap(
          wide ? "Place blocks" : "Place block",
          withMirror(build, writes, (current) => current === 0),
        );
        return;
      }
      if (tool === "floor") {
        const paint = get().paintMaterial;
        const target = hit.place;
        if (paint === null || paint === 0 || !target) return;

        if (!drag) {
          // The course is set by the press and never moves again: a floor that
          // changed height halfway through the drag would be a staircase.
          const at: [number, number, number] = [target.x, target.y, target.z];
          floorFrom = at;
          floorTo = at;
          viewer?.beginDragPick("level", at);
          viewer?.setFloorPreview({ min: at, max: at });
          return;
        }
        if (!floorFrom) return;
        const at: [number, number, number] = [target.x, floorFrom[1], target.z];
        if (floorTo && floorTo.every((v, a) => v === at[a])) return;
        floorTo = at;
        viewer?.setFloorPreview(spanBox(floorFrom, at));
        return;
      }
      if (tool === "push") {
        if (!drag) {
          const at: [number, number, number] = [hit.x, hit.y, hit.z];
          pushFrom = at;
          pushAt = at;
          // The brush rides a plane facing the camera, so the drag reads as
          // "the way I moved the mouse" rather than as whatever axis happened
          // to be under it.
          viewer?.beginDragPick("screen", at);
          return;
        }
        if (!pushAt || !pushFrom) return;
        const aimed: [number, number, number] = [hit.x, hit.y, hit.z];
        const target = shift ? axisLock(pushFrom, aimed) : aimed;

        const options = { size: get().pushSize, shape: get().pushShape };
        const writes = new Map<number, number>();
        let centre = pushAt;
        let moved = 0;
        for (const step of pushSteps(centre, target)) {
          moved += pushOnce(build, centre, step, options, writes);
          centre = [centre[0] + step[0], centre[1] + step[1], centre[2] + step[2]];
        }
        // The brush goes where it was aimed whether or not it found anything to
        // carry; only the blocks are optional.
        pushAt = centre;
        if (moved > 0) commitMap("Push blocks", writes);
        return;
      }
      if (tool === "clone") {
        // One stamp per press: dragging a clip around would carpet the build.
        if (drag) return;
        // While pinned the click stamps where the ghost was parked, not where
        // the pointer landed — the pin is the placement.
        const pin = get().pastePin;
        if (pin) {
          get().pasteAt(pin);
          return;
        }
        if (!hit.clipOrigin) return;
        get().pasteAt(hit.clipOrigin);
        return;
      }
      if (tool === "stairs") {
        // Two clicks, not a drag: the bottom step, then the top one.
        if (drag) return;
        const target = hit.place;
        if (!target) return;
        const point: [number, number, number] = [target.x, target.y, target.z];
        if (!get().stairsFrom) {
          set({ stairsFrom: point, stairsPlan: null, stairsProblem: null });
          viewer?.setStairPreview(null, point);
          return;
        }
        // Re-plan against exactly where the click landed rather than trusting
        // the last hover, then lay it down.
        planStairsTo(point);
        get().buildStairs();
        return;
      }
      if (tool === "measure") {
        if (drag) return;
        get().markMeasure([hit.x, hit.y, hit.z]);
        return;
      }
      if (tool === "eyedropper") {
        // One pick per press. Dragging the dropper across a wall would leave the
        // paint material set by whichever block the pointer left on, not the one
        // that was aimed at.
        if (drag) return;
        if (!get().pickBlock(build.data[index])) return;
        // Straight back to what the dropper interrupted, so the block just
        // lifted can go down again without another tool change. Only the tools
        // that write the paint material are worth returning to; from anywhere
        // else the dropper stays up, ready for the next pick.
        if (toolBeforePick && PAINT_TOOLS.includes(toolBeforePick)) {
          pendingToolReturn = toolBeforePick;
        }
        return;
      }
      if (tool === "select") {
        const position = build.positionOf(index);
        const anchor = get().regionAnchor;
        if (!anchor || !shift) {
          set({ regionAnchor: position, region: { min: position, max: position } });
          viewer?.setSelection({ min: position, max: position });
          return;
        }
        const region = spanBox(anchor, position);
        set({ region, regionAnchor: null });
        viewer?.setSelection(region);
      }
    },

    beginStroke: () => {
      activeStroke = ++strokeCounter;
      strokePlane = null;
    },

    endStroke: () => {
      // The floor is written on release, not as it is dragged, so it lands
      // while the stroke is still open and undoes as the single edit it is.
      commitFloor();
      dropDrag();
      activeStroke = null;
      strokePlane = null;
      flushStroke();
      viewer?.setHighlight(get().selectedMaterial);
      // Now that the press is over, the eyedropper can hand the tool back.
      if (pendingToolReturn) {
        const back = pendingToolReturn;
        pendingToolReturn = null;
        get().setTool(back);
      }
    },

    clearRegion: () => {
      set({ region: null, regionAnchor: null });
      viewer?.setSelection(null);
    },

    selectAll: () => {
      const build = get().build;
      if (!build) return;
      const region = buildBox(build);
      set({ region, regionAnchor: null });
      viewer?.setSelection(region);
    },

    selectThrough: (found, additive) => {
      if (!get().build) return;
      if (!found) {
        set({ notice: "Nothing in that rectangle — no blocks fall inside it." });
        return;
      }
      const current = additive ? get().region : null;
      const box: Region = { min: found.min, max: found.max };
      const region = current ? unionBox(current, box) : box;
      const size = boxSize(region);
      set({
        region,
        regionAnchor: null,
        notice:
          `${found.count.toLocaleString()} blocks caught${additive ? ", added to the selection" : ""} — ` +
          `the box round them is ${size.join("×")} at ${region.min.join(", ")}.`,
      });
      viewer?.setSelection(region);
    },

    setPlaneLock: (locked) => {
      set({ planeLock: locked });
      viewer?.setPlaneLock(locked);
    },

    copyRegion: () => {
      const { build, region } = get();
      if (!build || !region) return;
      set({ clipSource: region.min, clipName: null });
      setClip(extractClip(build, region.min, region.max));
    },

    cutRegion: () => {
      const { build, region } = get();
      if (!build || !region) return;
      set({ clipSource: region.min, clipName: null });
      setClip(extractClip(build, region.min, region.max));
      get().eraseRegion();
    },

    clearClip: () => setClip(null),

    rotateClip: () => {
      const clip = get().clip;
      if (clip) setClip(rotateClipY(clip));
    },

    mirrorClip: (axis) => {
      const clip = get().clip;
      if (clip) setClip(mirrorClipAxis(clip, axis));
    },

    setPasteMode: (pasteMode) => set({ pasteMode }),

    setPasteOverwrite: (pasteOverwrite) => {
      set({ pasteOverwrite });
      viewer?.setClipThrough(pasteOverwrite);
      // The ghost jumps a block when this flips, so redraw it without waiting
      // for the pointer to move.
      if (!get().pastePin) viewer?.refreshHover();
    },

    pinPaste: (origin) => {
      const { build, clip, region, clipSource } = get();
      if (!build || !clip) return;
      // No explicit target: start from the selection if there is one, else the
      // place the clip was copied from, else the middle of the build.
      const start: [number, number, number] = origin ?? region?.min ?? clipSource ?? [
        Math.floor((build.width - clip.width) / 2),
        Math.floor((build.height - clip.height) / 2),
        Math.floor((build.length - clip.length) / 2),
      ];
      set({ pastePin: start, tool: "clone" });
      viewer?.setEditing(true);
      syncClip();
      drawPin();
    },

    nudgePaste: (delta) => {
      const { build, clip, pastePin } = get();
      if (!build || !clip || !pastePin) return;
      // Clamped so the stamp always keeps at least one cell inside the build;
      // a ghost nudged off into nothing has no way back.
      const limit = [
        build.width - clip.width, build.height - clip.height, build.length - clip.length,
      ];
      const next = [0, 1, 2].map((a) => {
        const value = pastePin[a] + delta[a];
        return Math.max(Math.min(0, limit[a]), Math.min(value, Math.max(0, limit[a])));
      }) as [number, number, number];
      set({ pastePin: next });
      drawPin();
    },

    viewerAxes: () =>
      viewer?.screenAxes() ?? { right: [1, 0, 0], forward: [0, 0, 1] },

    stampPin: () => {
      const pin = get().pastePin;
      if (pin) get().pasteAt(pin);
    },

    unpinPaste: () => {
      if (!get().pastePin) return;
      set({ pastePin: null });
      viewer?.setGhost(null);
      viewer?.refreshHover();
    },

    liftPaste: (by) => get().setPasteLift(get().pasteLift + by),

    setPasteLift: (lift) => {
      const { build, clip } = get();
      if (!build || !clip) return;
      // Bounded by the build's own height: past that the ghost is nowhere near
      // anything and the keys would only be winding a number up.
      const reach = build.height;
      const next = Math.max(-reach, Math.min(reach, Math.round(lift)));
      if (next === get().pasteLift) return;
      set({ pasteLift: next });
      viewer?.setClipLift(next);
    },

    /** Stamps the clipboard with its min corner at `origin`. */
    pasteAt: (origin) => {
      const { build, clip, pasteMode } = get();
      if (!build || !clip) return;
      const writes = new Map<number, number>();
      stampInto(writes, build, clip, origin, pasteMode);
      commitMap(`Paste ${clip.width}×${clip.height}×${clip.length}`, writes);
    },

    setMirrorAxis: (axis, on) => {
      const { build, mirror } = get();
      const axes: [boolean, boolean, boolean] = [...mirror.axes];
      axes[axis] = on;
      // An axis switched on for the first time starts on the middle of the
      // build, which is what symmetry almost always means.
      const pivot: [number, number, number] = [...mirror.pivot];
      if (on && build) {
        const centre = centrePivot([build.width, build.height, build.length]);
        if (pivot[axis] === 0) pivot[axis] = centre[axis];
      }
      set({ mirror: { axes, pivot } });
      syncMirror();
      viewer?.refreshHover();
    },

    nudgeMirrorPivot: (axis, by) => {
      const { build, mirror } = get();
      if (!build) return;
      const span = [build.width, build.height, build.length][axis];
      const pivot: [number, number, number] = [...mirror.pivot];
      // A pivot beyond twice the span reflects the whole build off the edge,
      // where every stroke's mirror silently falls outside and nothing lands.
      pivot[axis] = Math.max(0, Math.min((span - 1) * 2, pivot[axis] + by));
      set({ mirror: { axes: mirror.axes, pivot } });
      syncMirror();
      viewer?.refreshHover();
    },

    recentreMirror: () => {
      const { build, mirror } = get();
      if (!build) return;
      set({
        mirror: {
          axes: mirror.axes,
          pivot: centrePivot([build.width, build.height, build.length]),
        },
      });
      syncMirror();
      viewer?.refreshHover();
    },

    clearMirror: () => {
      set({ mirror: { axes: [false, false, false], pivot: get().mirror.pivot } });
      syncMirror();
      viewer?.refreshHover();
    },

    setStairsWidth: (width) => {
      set({ stairsWidth: Math.max(1, Math.min(MAX_STAIR_WIDTH, Math.round(width))) });
      replanStairs();
    },

    setStairsRun: (run) => {
      set({ stairsRun: Math.max(0, Math.min(MAX_STAIR_RUN, Math.round(run))) });
      replanStairs();
    },

    setStairsStyle: (stairsStyle) => {
      set({ stairsStyle });
      replanStairs();
    },

    setStairsSupport: (stairsSupport) => {
      set({ stairsSupport });
      replanStairs();
    },

    setStairsMaterial: (stairsMaterial) => {
      set({ stairsMaterial });
      replanStairs();
    },

    setStairsFill: (stairsFill) => {
      set({ stairsFill });
      replanStairs();
    },

    clearStairs: () => dropStairs(),

    buildStairs: () => {
      const { build, stairsPlan } = get();
      if (!build || !stairsPlan) return;

      const writes = new Map<number, number>();
      let dropped = 0;
      for (const cell of stairsPlan.cells) {
        if (!build.inBounds(cell.x, cell.y, cell.z)) {
          dropped++;
          continue;
        }
        writes.set(build.index(cell.x, cell.y, cell.z), build.paletteIndexFor(cell.state));
      }
      if (writes.size === 0) {
        set({
          notice: "The whole flight falls outside the build. Grow the canvas, or start it further in.",
        });
        return;
      }

      commitMap(`Stairs — ${stairsPlan.treads} treads`, writes);
      dropStairs();
      set({
        notice: dropped > 0
          ? `${describeStairs(stairsPlan)} · ${dropped.toLocaleString()} cells fell outside the build and were dropped.`
          : describeStairs(stairsPlan),
      });
    },

    markMeasure: (at) => {
      // Two marks make a measurement; a third starts the next one, so the ruler
      // never needs clearing between readings.
      const { measureA, measureB } = get();
      const next = !measureA || measureB
        ? { measureA: at, measureB: null }
        : { measureA, measureB: at };
      set(next);
      viewer?.setMeasure(next.measureA, next.measureB);
    },

    clearMeasure: () => {
      set({ measureA: null, measureB: null });
      viewer?.setMeasure(null, null);
    },

    measurement: () => {
      const { measureA, measureB } = get();
      return measureA && measureB ? measure(measureA, measureB) : null;
    },

    measureRegion: () => {
      const region = get().region;
      if (!region) return;
      set({ measureA: region.min, measureB: region.max });
      viewer?.setMeasure(region.min, region.max);
      get().setTool("measure");
    },

    regionFromMeasure: () => {
      const { measureA, measureB } = get();
      if (!measureA || !measureB) return;
      const region = spanBox(measureA, measureB);
      set({ region, regionAnchor: null });
      viewer?.setSelection(region);
    },

    setCentreGuides: (centreGuides) => set({ centreGuides }),
    setCentreTarget: (centreTarget) => set({ centreTarget }),

    centreBox: (target) => {
      const { build, region, centreTarget } = get();
      if (!build) return null;
      const which = target ?? centreTarget;
      return which === "selection" && region ? region : buildBox(build);
    },

    selectCentre: (target) => {
      const box = get().centreBox(target);
      if (!box) return;
      const region: Region = centreOf(box).column;
      set({ region, regionAnchor: null });
      viewer?.setSelection(region);
      get().setTool("select");
    },

    selectCentreCell: (target) => {
      const box = get().centreBox(target);
      if (!box) return;
      const region: Region = centreCell(box);
      const size = boxSize(region);
      set({
        region,
        regionAnchor: null,
        notice:
          size.every((v) => v === 1)
            ? `Centre block: ${region.min.join(", ")}.`
            : `Centre is ${size.join("×")} blocks at ${region.min.join(", ")} — ` +
              `an even span has no single middle block, so the pair straddling the line is selected.`,
      });
      viewer?.setSelection(region);
      get().setTool("select");
    },

    eraseMaterial: (paletteIndex) => {
      const build = get().build;
      if (!build) return;
      const indices = collect((v) => v === paletteIndex, null);
      commit(`Remove ${displayName(build.palette[paletteIndex])}`, indices, fill(indices, 0));
    },

    replaceMaterial: (from, to) => {
      const build = get().build;
      if (!build) return;
      const target = build.paletteIndexFor(to);
      if (target === from) return;
      const indices = collect((v) => v === from, null);
      commit(
        `Replace ${displayName(build.palette[from])} with ${displayName(to)}`,
        indices, fill(indices, target),
      );
      // Follow the material the user was working on to its new palette entry.
      if (get().selectedMaterial === from) get().selectMaterial(target);
      if (get().paintMaterial === from) loadPaint(target);
    },

    eraseRegion: () => {
      const { build, region, fillMode } = get();
      if (!build || !region) return;
      // "Into gaps" is a fill idea, not an erase one — erasing air does nothing
      // — so it falls back to clearing the whole box.
      const shape = fillMode === "air" ? "solid" : fillMode;
      const cells = regionCells(build, region, shape);
      const indices = Uint32Array.from([...cells].filter((i) => build.data[i] !== 0));
      commit(
        shape === "solid" ? "Erase selection" : `Erase selection (${shape})`,
        indices, fill(indices, 0),
      );
    },

    fillRegion: (state) => {
      const { build, region, fillMode } = get();
      if (!build || !region) return;
      const target = build.paletteIndexFor(state);
      const indices = regionCells(build, region, fillMode);
      commit(`Fill selection with ${displayName(state)}`, indices, fill(indices, target));
    },

    rotateRegion: () => transformRegion("Rotate selection", rotateClipY),

    mirrorRegion: (axis) =>
      transformRegion(`Mirror selection ${axis.toUpperCase()}`, (clip) =>
        mirrorClipAxis(clip, axis),
      ),

    moveRegion: (delta) => {
      const { build, region } = get();
      if (!build || !region) return;
      const size = boxSize(region);
      const origin = clampOrigin(
        build,
        [region.min[0] + delta[0], region.min[1] + delta[1], region.min[2] + delta[2]],
        size,
      );
      if (origin.every((v, a) => v === region.min[a])) return;

      const clip = extractClip(build, region.min, region.max);
      const writes = new Map<number, number>();
      // Clear first, stamp second: where the old and new boxes overlap the
      // stamp has to win, or the move would eat its own tail.
      for (const index of regionCells(build, region, "solid")) writes.set(index, 0);
      stampInto(writes, build, clip, origin, "merge");
      commitMap("Move selection", writes);

      const next: Region = {
        min: origin,
        max: [origin[0] + size[0] - 1, origin[1] + size[1] - 1, origin[2] + size[2] - 1],
      };
      set({ region: next, regionAnchor: null });
      viewer?.setSelection(next);
    },

    nudgeRegion: (delta) => {
      const { build, region } = get();
      if (!build || !region) return;
      const size = boxSize(region);
      const origin = clampOrigin(
        build,
        [region.min[0] + delta[0], region.min[1] + delta[1], region.min[2] + delta[2]],
        size,
      );
      const next: Region = {
        min: origin,
        max: [origin[0] + size[0] - 1, origin[1] + size[1] - 1, origin[2] + size[2] - 1],
      };
      set({ region: next, regionAnchor: null });
      viewer?.setSelection(next);
    },

    replaceInRegion: (from, to) => {
      const { build, region } = get();
      if (!build || !region) return;
      const target = build.paletteIndexFor(to);
      const indices = collect((v) => v === from, region);
      commit(
        `Replace ${displayName(build.palette[from])} in selection`,
        indices, fill(indices, target),
      );
    },

    undo: () => {
      // A keyboard undo can land mid-drag; seal what's been drawn so far first,
      // or it would be undone without ever having reached the stack.
      flushStroke();
      const { build, undoStack } = get();
      const op = undoStack[undoStack.length - 1];
      if (!build || !op) return;
      // The palette keeps any entry an edit added; `compacted()` drops the
      // unused ones on export, and keeping them here means redo still works.
      build.applyChanges(op.indices, op.before);
      invalidate(op.indices);
      set({
        undoStack: undoStack.slice(0, -1),
        redoStack: [...get().redoStack, op],
        revision: get().revision + 1,
      });
      refreshHighlight();
      scheduleAutosave();
    },

    redo: () => {
      flushStroke();
      const { build, redoStack } = get();
      const op = redoStack[redoStack.length - 1];
      if (!build || !op) return;
      build.applyChanges(op.indices, op.after);
      invalidate(op.indices);
      set({
        redoStack: redoStack.slice(0, -1),
        undoStack: [...get().undoStack, op].slice(-HISTORY_LIMIT),
        revision: get().revision + 1,
      });
      refreshHighlight();
      scheduleAutosave();
    },

    materials: () => {
      const build = get().build;
      if (!build) return [];
      const counts = build.countByPalette();
      const rows: MaterialRow[] = [];
      for (let i = 1; i < build.palette.length; i++) {
        if (counts[i] === 0) continue;
        const state = build.palette[i];
        rows.push({
          paletteIndex: i,
          state,
          count: counts[i],
          color: cssColor(state),
          label: displayName(state),
          detail: propertySummary(state),
        });
      }
      rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return rows;
    },
  };
});

if (import.meta.env.DEV) {
  // Alongside `window.viewer` and `window.pack`: the whole editor is drivable
  // from the console, which is how tools get exercised without clicking.
  (window as unknown as { store: typeof useStore }).store = useStore;
}

// The centre lines follow a box that half a dozen actions can move — every
// region transform, a resize, opening a file. Watching the state is one rule
// instead of a redraw call scattered through all of them.
useStore.subscribe((state, previous) => {
  if (
    state.centreGuides === previous.centreGuides &&
    state.centreTarget === previous.centreTarget &&
    state.region === previous.region &&
    state.build === previous.build
  ) {
    return;
  }
  drawCentreGuides(state);
});

/**
 * Merges palette rows that share a block id but differ in properties, which is
 * what a shopping list actually needs — you buy oak stairs, not 12 rotations.
 */
export function groupedMaterials(rows: MaterialRow[]) {
  const groups = new Map<string, { name: string; label: string; color: string; count: number; variants: MaterialRow[] }>();
  for (const row of rows) {
    const existing = groups.get(row.state.name);
    if (existing) {
      existing.count += row.count;
      existing.variants.push(row);
    } else {
      groups.set(row.state.name, {
        name: row.state.name,
        label: row.label,
        color: row.color,
        count: row.count,
        variants: [row],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export { stateKey };
export type { BlockState };
