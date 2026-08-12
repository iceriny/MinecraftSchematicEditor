import { useEffect, useState } from "react";
import { useStore, type Tool } from "./store";
import { MIRROR_AXES, mirrorActive, mirrorCopies } from "./core/mirror";
import { Viewport } from "./ui/Viewport";
import { TopBar } from "./ui/TopBar";
import { DocTabs } from "./ui/DocTabs";
import { ToolRail } from "./ui/ToolRail";
import { MaterialPanel } from "./ui/MaterialPanel";
import { StatusBar } from "./ui/StatusBar";
import { LayerSlider } from "./ui/LayerSlider";
import { EmptyState } from "./ui/EmptyState";
import { Hotbar } from "./ui/Hotbar";
import { toggleSection, useSectionOpen } from "./ui/Section";

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: "move",
  KeyP: "place",
  KeyE: "erase",
  KeyB: "paint",
  KeyI: "eyedropper",
  KeyH: "floor",
  KeyU: "push",
  KeyS: "stairs",
  KeyK: "measure",
  KeyM: "select",
  KeyX: "through",
  KeyC: "clone",
};

/** Arrow and page keys, as a step in screen terms: right, up, away. */
const STEP_KEYS: Record<string, [number, number, number]> = {
  ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0],
  ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1],
  PageUp: [0, 1, 0], PageDown: [0, -1, 0],
};

/**
 * Turns a screen-relative step into a grid offset. Vertical steps are already
 * in world terms; the flat ones follow whichever way the camera is facing, so
 * "right" means right on screen however the build is turned.
 */
function gridStep(
  step: [number, number, number],
  axes: { right: [number, number, number]; forward: [number, number, number] },
): [number, number, number] {
  if (step[1] !== 0) return step;
  return [
    axes.right[0] * step[0] + axes.forward[0] * step[2],
    0,
    axes.right[2] * step[0] + axes.forward[2] * step[2],
  ];
}

export default function App() {
  const build = useStore((s) => s.build);
  const [dragging, setDragging] = useState(false);
  // Dropping a file replaces the build, which is the wrong answer when you
  // meant to bring a design *into* it, or to work on it beside this one. Shift
  // and Alt say which.
  const [dropImports, setDropImports] = useState(false);
  const [dropTab, setDropTab] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const store = useStore.getState();

      if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") {
        event.preventDefault();
        store.redo();
        return;
      }
      // Select-all, so a whole build can be handed to another tab in two keys.
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyA" && store.build) {
        event.preventDefault();
        store.selectAll();
        store.setTool("select");
        return;
      }
      // Copy and cut hand the selection to the clone tool and switch to it, so
      // the next click stamps rather than needing a second decision.
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyC" && store.region) {
        event.preventDefault();
        store.copyRegion();
        store.setTool("clone");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyX" && store.region) {
        event.preventDefault();
        store.cutRegion();
        store.setTool("clone");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyV" && store.clip) {
        event.preventDefault();
        store.setTool("clone");
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.code === "Escape") {
        if (store.pastePin) return store.unpinPaste();
        if (store.pasteLift !== 0) return store.setPasteLift(0);
        if (store.stairsFrom) return store.clearStairs();
        store.clearRegion();
        store.setCameraMode("orbit");
        return;
      }
      if (!store.build) return;

      // Enter commits the previewed flight, for when the second click is easier
      // to aim with the pointer than to land on.
      if (
        store.tool === "stairs" && store.stairsPlan &&
        (event.code === "Enter" || event.code === "NumpadEnter")
      ) {
        event.preventDefault();
        return store.buildStairs();
      }

      // Driving a parked stamp: the arrows walk it across the screen's own
      // axes, Page keys lift and drop it, Enter puts it down.
      if (store.tool === "clone" && store.clip) {
        // Shift turns the up and down arrows into the Page keys, so a laptop
        // with no Page keys can still work the one axis the pointer cannot.
        const code = event.shiftKey && (event.code === "ArrowUp" || event.code === "ArrowDown")
          ? (event.code === "ArrowUp" ? "PageUp" : "PageDown")
          : event.code;
        const step = STEP_KEYS[code];
        if (step) {
          event.preventDefault();
          // Height is the one thing a pointer aimed at a surface can never say,
          // so going up floats the ghost above the face instead of parking it —
          // the mouse keeps placing it, the keys only choose the storey.
          if (step[1] !== 0 && !store.pastePin) return store.liftPaste(step[1]);
          if (!store.pastePin) store.pinPaste();
          return useStore.getState().nudgePaste(gridStep(step, useStore.getState().viewerAxes()));
        }
        if (event.code === "Enter" || event.code === "NumpadEnter") {
          event.preventDefault();
          if (!store.pastePin) return store.pinPaste();
          return store.stampPin();
        }
      }

      // The same keys drive the selection box: on its own it just slides, with
      // Shift it takes the blocks inside it along.
      if (store.region) {
        const step = STEP_KEYS[event.code];
        if (step) {
          event.preventDefault();
          const delta = gridStep(step, store.viewerAxes());
          return event.shiftKey ? store.moveRegion(delta) : store.nudgeRegion(delta);
        }
      }

      // Number keys pick a hotbar material; with Shift they fill the slot from
      // whatever is currently loaded.
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit) {
        event.preventDefault();
        const slot = Number(digit[1]) - 1;
        return event.shiftKey ? store.assignHotbarSlot(slot) : store.useHotbarSlot(slot);
      }

      // Step by two: brush widths are odd, so ±1 would snap straight back. The
      // push brush has its own size, and the same keys reach whichever is in use.
      if (event.code === "Minus" || event.code === "Equal") {
        const by = event.code === "Equal" ? 2 : -2;
        return store.tool === "push"
          ? store.setPushSize(store.pushSize + by)
          : store.setBrushSize(store.brushSize + by);
      }

      if (event.code === "KeyL") return store.setPlaneLock(!store.planeLock);
      // R turns the clip a quarter turn — except in fly mode, where it sprints.
      if (event.code === "KeyR" && store.tool === "clone" && store.cameraMode !== "fly") {
        return store.rotateClip();
      }
      // With a block tool in hand the same key turns the paint material itself,
      // so a stair or a log is aimed without a trip through the picker; Shift
      // turns it over.
      if (
        event.code === "KeyR" && store.cameraMode !== "fly" &&
        (store.tool === "place" || store.tool === "paint" || store.tool === "floor")
      ) {
        return event.shiftKey ? store.flipPaint() : store.turnPaint();
      }
      // T flips the stamp between hanging off a face and landing on it.
      if (event.code === "KeyT" && store.tool === "clone") {
        return store.setPasteOverwrite(!store.pasteOverwrite);
      }
      const tool = TOOL_KEYS[event.code];
      // S is also fly mode's "back up" key, so it only picks a tool on the ground.
      if (tool && !(event.code === "KeyS" && store.cameraMode === "fly")) {
        return store.setTool(tool);
      }
      if (event.code === "KeyO") return store.setCameraMode("orbit");
      if (event.code === "KeyG") return store.setCameraMode("fly");
      if (event.code === "KeyF") return store.frameBuild();
      if (event.code === "Delete" || event.code === "Backspace") {
        if (store.region) store.eraseRegion();
      }
      // Layer scrubbing without leaving the keyboard.
      if (event.code === "BracketLeft") return store.setLayerLimit(store.layerLimit - 1);
      if (event.code === "BracketRight") return store.setLayerLimit(store.layerLimit + 1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void useStore.getState().checkSession();
    // The autosave debounce is generous, so a tab that closes mid-edit would
    // otherwise lose the last few seconds. `pagehide` is the one teardown event
    // that fires reliably on mobile and on bfcache navigations alike.
    const flush = () => useStore.getState().flushAutosave();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return (
    <div
      className="app"
      data-empty={build ? "false" : "true"}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
        setDropImports(e.shiftKey && !!build);
        setDropTab(e.altKey && !!build);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        const store = useStore.getState();
        if (e.shiftKey && build) store.importFile(file);
        else if (e.altKey && build) void store.openInNewTab(file);
        else store.openAny(file);
      }}
    >
      <TopBar />
      <DocTabs />
      {build && <ToolRail />}

      <main className="stage">
        <Viewport />
        {build ? (
          <>
            <LayerSlider />
            <StageHud />
            <Hotbar />
            <BusyIndicator />
          </>
        ) : (
          <EmptyState />
        )}
        <Notice />
        {dragging && (
          <div className="drop-overlay" data-import={dropImports || dropTab}>
            {dropImports
              ? "Drop to import into this build"
              : dropTab
                ? "Drop to open in its own tab"
                : build
                  ? "Drop to open · Shift imports into this build · Alt opens a tab"
                  : "Drop to open"}
          </div>
        )}
      </main>

      {build && <MaterialPanel />}
      <StatusBar />
    </div>
  );
}

function BusyIndicator() {
  const remaining = useStore((s) => s.meshingRemaining);
  if (remaining === 0) return null;
  return <div className="busy">Building geometry — {remaining} chunks left</div>;
}

function BrushHint() {
  const tool = useStore((s) => s.tool);
  const brushSize = useStore((s) => s.brushSize);
  const brushShape = useStore((s) => s.brushShape);
  const pushSize = useStore((s) => s.pushSize);
  const pushShape = useStore((s) => s.pushShape);
  const push = tool === "push";
  if (!push && tool !== "place" && tool !== "erase" && tool !== "paint") return null;

  const size = push ? pushSize : brushSize;
  const shape = push ? pushShape : brushShape;
  return (
    <div className="hint">
      {size === 1
        ? push ? "One block at a time" : "One block per click"
        : `${size}-wide ${shape === "cube" ? "cube" : "ball"} brush`}
      {" · "}<kbd>−</kbd> and <kbd>=</kbd> resize it
    </div>
  );
}

/**
 * Alt samples from the build without leaving the tool. Worth saying where it is
 * useful — a material you can see is faster to point at than to find in a list —
 * and it is not a modifier anyone would guess at.
 */
function PickHint() {
  const tool = useStore((s) => s.tool);
  // Alt works with any tool, but it is only worth a line of the HUD where
  // changing material is part of the job.
  if (!["place", "paint", "floor", "erase", "stairs"].includes(tool)) return null;
  return (
    <div className="hint">
      <kbd>Alt</kbd>+click any block to pick it up as the paint material without putting this tool down
    </div>
  );
}

/** Symmetry changes what a click does, so it says so rather than surprising you. */
function MirrorHint() {
  const tool = useStore((s) => s.tool);
  const mirror = useStore((s) => s.mirror);
  if (tool !== "place" && tool !== "erase" && tool !== "paint") return null;
  if (!mirrorActive(mirror)) return null;
  const axes = MIRROR_AXES.filter((a) => mirror.axes[a.index]).map((a) => a.name);
  return (
    <div className="hint">
      Mirroring {axes.join(" and ")} · every stroke lands ×{mirrorCopies(mirror)}
    </div>
  );
}

/** One-line report from an action with no other place to say what it did. */
function Notice() {
  const notice = useStore((s) => s.notice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useStore.getState().setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="notice" role="status">
      <span>{notice}</span>
      <button className="btn" onClick={() => useStore.getState().setNotice(null)}>Dismiss</button>
    </div>
  );
}

function StageHud() {
  const tool = useStore((s) => s.tool);
  const cameraMode = useStore((s) => s.cameraMode);
  const region = useStore((s) => s.region);
  const anchor = useStore((s) => s.regionAnchor);
  const clip = useStore((s) => s.clip);
  const pastePin = useStore((s) => s.pastePin);
  const pasteLift = useStore((s) => s.pasteLift);
  const paint = useStore((s) => s.paintMaterial);
  const planeLock = useStore((s) => s.planeLock);
  const layerLimit = useStore((s) => s.layerLimit);
  const stairsFrom = useStore((s) => s.stairsFrom);
  const measureA = useStore((s) => s.measureA);
  const measureB = useStore((s) => s.measureB);
  const keys = useSectionOpen("hud-keys", true);

  const toolHint =
    tool === "erase" ? "Click or drag to remove blocks"
    : tool === "paint" ? "Click or drag to swap in the paint material"
    : tool === "place" ? (paint === null
      ? "Choose a paint material in the panel first — that is what gets placed"
      : planeLock ? `Click or drag to lay blocks flat across Y ${layerLimit}`
      : "Click or drag on a face to add blocks against it")
    : tool === "floor" ? (paint === null
      ? "Choose a paint material in the panel first — that is what the floor is laid in"
      : planeLock ? `Drag out a rectangle to lay a floor across Y ${layerLimit}`
      : "Press where the floor starts and drag out its far corner — it keeps the height it started at, and Y 0 over open ground")
    : tool === "push" ? "Drag the brush and every block it covers is shoved along with it · Shift keeps the shove on one axis"
    : tool === "through" ? "Drag a box over the build — every block inside it is selected, however deep or hidden · Shift adds to the selection"
    : tool === "eyedropper" ? "Click a block to pick it up — it lands in the hotbar slot you are holding, and hands back the block tool you came from"
    : tool === "stairs" ? (stairsFrom
      ? "Now click where the flight lands — the grade and every step's facing follow"
      : "Click the block the flight starts from")
    : tool === "measure" ? (measureA && !measureB
      ? "Click the second block to close the measurement"
      : "Click two blocks to measure between them")
    : tool === "select" ? (anchor ? "Shift-click the opposite corner" : "Click one corner of the box")
    : tool === "clone" ? (clip ? "Click to stamp the copy" : "Select a box first, then Ctrl+C to copy it")
    : null;

  // What the tool is for, and what a click does right now, are worth the view's
  // corner. The keys behind them are worth knowing once and then folding away —
  // left up they cover the bottom of the build, which is where the ground is.
  return (
    <div className="stage-hud">
      {cameraMode === "fly" ? (
        <div className="hint">
          Click the view to look around · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move ·{" "}
          <kbd>Space</kbd>/<kbd>Shift</kbd> up and down · <kbd>R</kbd> sprint · <kbd>Esc</kbd> back to orbit
        </div>
      ) : tool === "move" ? (
        <div className="hint">Drag to orbit · right-drag to pan · scroll to zoom</div>
      ) : (
        <div className="hint">Right-drag to orbit · middle-drag to pan · scroll to zoom</div>
      )}
      {toolHint && <div className="hint">{toolHint}</div>}

      {keys && (
        <>
          <PickHint />
          <BrushHint />
          <MirrorHint />
          {tool === "clone" && clip && (
            <div className="hint"><kbd>R</kbd> turns the copy a quarter turn</div>
          )}
          {tool === "clone" && clip && !pastePin && (
            <div className="hint">
              {pasteLift === 0 ? (
                <>
                  <kbd>Page&nbsp;Up</kbd>/<kbd>Page&nbsp;Down</kbd> — or{" "}
                  <kbd>Shift</kbd>+<kbd>↑</kbd><kbd>↓</kbd> — float the copy above the face you point at
                </>
              ) : (
                <>
                  Floating <strong>{pasteLift > 0 ? `${pasteLift} up` : `${-pasteLift} down`}</strong>{" "}
                  from the face · the pointer still aims it · <kbd>Esc</kbd> sets it back down
                </>
              )}
            </div>
          )}
          {tool === "stairs" && stairsFrom && (
            <div className="hint">
              <kbd>Enter</kbd> builds it · <kbd>Esc</kbd> starts over
            </div>
          )}
          {tool === "measure" && (
            <div className="hint">The read-out is under Ruler &amp; centre in the panel on the right</div>
          )}
          {(tool === "place" || tool === "clone" || tool === "stairs" || tool === "floor") && (
            <div className="hint">
              <kbd>L</kbd>{" "}
              {planeLock
                ? "unlocks the layer plane · [ and ] move it up and down"
                : "locks placement to the layer plane, for laying a flat course"}
            </div>
          )}
          {region && (
            <div className="hint">
              <kbd>Ctrl</kbd>+<kbd>C</kbd> copies the selection · <kbd>Delete</kbd> erases it · <kbd>Esc</kbd> clears it
            </div>
          )}
        </>
      )}

      <button
        className="hint hint-toggle"
        onClick={() => toggleSection("hud-keys", true)}
        title={keys ? "Hide the key hints" : "Show the key hints for this tool"}
      >
        {keys ? "Hide keys" : "Keys…"}
      </button>
    </div>
  );
}
