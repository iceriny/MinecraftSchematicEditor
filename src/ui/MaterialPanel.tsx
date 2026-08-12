import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type MaterialRow, type Region, type Tool } from "../store";
import { cssColor } from "../core/blockLook";
import { displayName, propertySummary, stateKey, type BlockState } from "../core/model";
import { MAX_BRUSH, MAX_PUSH } from "../core/brush";
import { FILL_MODES } from "../core/region";
import { centreOf, formatCentre } from "../core/measure";
import { BlockPicker } from "./BlockPicker";
import { CanvasPanel } from "./CanvasPanel";
import { OrientPanel } from "./OrientPanel";
import { StairsPanel } from "./StairsPanel";
import { MeasurePanel } from "./MeasurePanel";
import { MirrorPanel } from "./MirrorPanel";
import { Section, setSectionsOpen, useAnySectionOpen } from "./Section";
import { toolSpec } from "./tools";

/** Tools whose click covers a brush footprint rather than a single cell. */
const BRUSH_TOOLS: Tool[] = ["place", "erase", "paint"];
/** Tools that write the paint material, and so care what it is set to. */
const PAINT_TOOLS: Tool[] = ["place", "paint", "floor"];
/** Tools that can lay their work flat on the layer plane instead of on a face. */
const PLANE_TOOLS: Tool[] = ["place", "clone", "stairs", "floor"];

/** Every section that can appear, with its default fold state, for the fold-all button. */
const SECTIONS = [
  { id: "paint" }, { id: "placement" }, { id: "mirror" }, { id: "selected" },
  { id: "stairs" }, { id: "selection" }, { id: "clipboard" },
  { id: "measure", closed: true }, { id: "canvas", closed: true },
];

type PickerTarget =
  | { kind: "paint" }
  | { kind: "replace-all"; from: number }
  | { kind: "replace-region"; from: number }
  | { kind: "fill-region" };

export function MaterialPanel() {
  const build = useStore((s) => s.build);
  const revision = useStore((s) => s.revision);
  const materials = useStore((s) => s.materials);
  const selected = useStore((s) => s.selectedMaterial);
  const paint = useStore((s) => s.paintMaterial);
  const region = useStore((s) => s.region);
  const clip = useStore((s) => s.clip);
  const tool = useStore((s) => s.tool);
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const tools = useRef<HTMLDivElement>(null);

  // Picking up a tool brings its settings into view. They are ordered by what
  // they act on rather than by tool, so the one that just appeared can easily
  // be below the fold, and a control you cannot see is a control you don't know
  // you have.
  useEffect(() => {
    const current = tools.current?.querySelector('[data-current="true"]');
    current?.scrollIntoView({ block: "nearest" });
  }, [tool]);

  const rows = useMemo(() => {
    void revision;
    return materials();
  }, [materials, revision]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.count, 0), [rows]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) => row.label.toLowerCase().includes(needle) || row.state.name.includes(needle),
    );
  }, [rows, query]);

  if (!build) return null;

  const selectedRow = rows.find((row) => row.paletteIndex === selected) ?? null;
  const paintState = paint !== null ? build.palette[paint] : null;

  const handlePick = (state: BlockState) => {
    const store = useStore.getState();
    if (!picker) return;
    switch (picker.kind) {
      case "paint":
        store.setPaintMaterial(build.paletteIndexFor(state));
        break;
      case "replace-all":
        store.replaceMaterial(picker.from, state);
        break;
      case "replace-region":
        store.replaceInRegion(picker.from, state);
        break;
      case "fill-region":
        store.fillRegion(state);
        break;
    }
    setPicker(null);
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="eyebrow">Materials</span>
        <span className="num" style={{ color: "var(--mute)", fontSize: 11 }}>
          {rows.length} types · {total.toLocaleString()} blocks
        </span>
      </div>

      <div style={{ padding: "0 14px 10px" }}>
        <input
          className="search"
          value={query}
          placeholder="Filter materials"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="panel-scroll">
        {visible.map((row) => (
          <MaterialItem key={row.paletteIndex} row={row} total={total} selected={selected === row.paletteIndex} />
        ))}
        {visible.length === 0 && (
          <p style={{ color: "var(--dim)", padding: "8px 14px" }}>No material matches that filter.</p>
        )}
      </div>

      <div className="panel-tools" ref={tools}>
        <ToolContext />

        <Section
          id="paint"
          title="Paint"
          current={PAINT_TOOLS.includes(tool)}
          summary={
            paintState
              ? <span className="fold-swatch"><i className="swatch" style={{ background: cssColor(paintState) }} />{displayName(paintState)}</span>
              : <span className="fold-warn">not set</span>
          }
          tools={PAINT_TOOLS}
          help="The block the tools write, and which way round it faces. Alt-click any block in the view to lift it in here without putting your tool down."
        >
          <button
            className="chip chip-wide"
            data-empty={!paintState}
            onClick={() => setPicker({ kind: "paint" })}
            title={paintState ? stateKey(paintState) : "Choose the block the tools write"}
          >
            <i className="swatch" style={{ background: paintState ? cssColor(paintState) : "var(--line)" }} />
            <span>{paintState ? displayName(paintState) : "Choose a block"}</span>
            {/* Two turns of the same stair are the same name; the properties are
                the only thing telling them apart. */}
            {paintState && propertySummary(paintState) && (
              <span className="material-detail">{propertySummary(paintState)}</span>
            )}
          </button>

          <OrientPanel />
        </Section>

        <PlacementSection />

        {BRUSH_TOOLS.includes(tool) && <MirrorPanel />}
        {tool === "stairs" && <StairsPanel />}

        <Section
          id="selected"
          title="Selected material"
          summary={
            selectedRow
              ? <span className="fold-swatch"><i className="swatch" style={{ background: selectedRow.color }} />{selectedRow.label}</span>
              : <span className="fold-quiet">none</span>
          }
          help="Acts on every copy of one material at once, wherever it is in the build — the way to swap all the cobblestone for deepslate, or strip the torches out."
        >
          {selectedRow ? (
            <>
              <div className="field">
                <span className="field-label">Count</span>
                <span className="num" style={{ fontSize: 12 }} title={selectedRow.state.name}>
                  {selectedRow.count.toLocaleString()} blocks
                </span>
              </div>
              <div className="actions">
                <button className="btn btn-outline" onClick={() => setPicker({ kind: "replace-all", from: selectedRow.paletteIndex })}>
                  Replace all
                </button>
                <button className="btn btn-outline btn-danger" onClick={() => useStore.getState().eraseMaterial(selectedRow.paletteIndex)}>
                  Remove all
                </button>
                {region && (
                  <button className="btn btn-outline" onClick={() => setPicker({ kind: "replace-region", from: selectedRow.paletteIndex })}>
                    Replace in selection
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="fold-empty">
              Click a material in the list above to highlight it in the build and act on every copy at once.
            </p>
          )}
        </Section>

        {region && <RegionSection onFill={() => setPicker({ kind: "fill-region" })} />}
        {clip && <ClipSection />}
        <MeasurePanel />
        <CanvasPanel />
      </div>

      {picker && (
        <BlockPicker
          title={
            picker.kind === "paint" ? "Paint material"
            : picker.kind === "fill-region" ? "Fill selection with"
            : "Replace with"
          }
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}
    </aside>
  );
}

function MaterialItem({ row, total, selected }: { row: MaterialRow; total: number; selected: boolean }) {
  const select = useStore((s) => s.selectMaterial);
  const share = total > 0 ? (row.count / total) * 100 : 0;
  return (
    <button
      className="material"
      data-selected={selected}
      onClick={() => select(selected ? null : row.paletteIndex)}
      title={row.state.name}
    >
      <i className="swatch" style={{ background: row.color }} />
      <span className="material-name">
        {row.label}
        {row.detail && <span className="material-detail"> {row.detail}</span>}
      </span>
      <span className="material-count">{row.count.toLocaleString()}</span>
      <span className="material-bar">
        <span style={{ width: `${Math.max(share, 0.6)}%` }} />
      </span>
    </button>
  );
}

/**
 * Which tool is in hand, said in the panel as well as on the rail. The sections
 * below it come and go with the tool, and without this the panel looks like it
 * rearranged itself for no reason.
 */
function ToolContext() {
  const tool = useStore((s) => s.tool);
  const spec = toolSpec(tool);
  const anyOpen = useAnySectionOpen(SECTIONS);
  const Icon = spec.icon;

  return (
    <div className="tool-context">
      <div className="tool-context-head">
        <Icon size={14} />
        <span className="tool-context-name">{spec.label}</span>
        <kbd>{spec.key}</kbd>
        <button
          className="btn tool-context-fold"
          onClick={() => setSectionsOpen(!anyOpen, SECTIONS.map((s) => s.id))}
          title={anyOpen ? "Fold every section away" : "Open every section"}
        >
          {anyOpen ? "Fold all" : "Open all"}
        </button>
      </div>
      <p className="tool-context-blurb">{spec.blurb}</p>
    </div>
  );
}

/**
 * How a click lands: how wide it writes, and whether it goes against the face
 * you point at or flat on the layer plane. Which of these apply depends on the
 * tool, so the section carries whichever are live and disappears when none are.
 */
function PlacementSection() {
  const tool = useStore((s) => s.tool);
  const brushSize = useStore((s) => s.brushSize);
  const brushShape = useStore((s) => s.brushShape);
  const pushSize = useStore((s) => s.pushSize);
  const pushShape = useStore((s) => s.pushShape);
  const planeLock = useStore((s) => s.planeLock);
  const layerLimit = useStore((s) => s.layerLimit);

  const brush = BRUSH_TOOLS.includes(tool);
  const push = tool === "push";
  const plane = PLANE_TOOLS.includes(tool);
  if (!brush && !push && !plane) return null;

  const size = push ? pushSize : brushSize;
  const shape = push ? pushShape : brushShape;
  const summary = brush || push
    ? size === 1 ? "single block" : `${size} wide ${shape === "cube" ? "cube" : "ball"}`
    : planeLock ? <span className="ax-y">Y {layerLimit}</span>
    : "on faces";

  return (
    <Section
      id="placement"
      title={brush || push ? "Brush" : "Placement"}
      current
      summary={summary}
      keys={[...(brush || push ? ["−", "="] : []), ...(plane ? ["L"] : [])]}
      help={
        brush ? "How wide a click writes. A place brush stays flat on the face it is drawn against, so it lays a patch of wall rather than burying itself in the one behind."
        : push ? "How much of the build the drag takes hold of. Everything inside the shape travels with it."
        : "Where a click lands when nothing is under the pointer to land on."
      }
    >
      {brush && <BrushControl />}
      {push && <PushControl />}
      {plane && <PlaneLock />}
    </Section>
  );
}

/**
 * How wide a click writes. A wall is not built one block at a time, and the
 * place brush stays flat on the face it is drawn against rather than balling up
 * into the wall behind it.
 */
function BrushControl() {
  const size = useStore((s) => s.brushSize);
  const shape = useStore((s) => s.brushShape);
  const store = useStore.getState();
  return (
    <div className="brush">
      <div className="brush-row">
        <input
          type="range"
          min={1}
          max={MAX_BRUSH}
          step={2}
          value={size}
          aria-label="Brush size"
          onChange={(e) => store.setBrushSize(Number(e.target.value))}
        />
        <div className="segmented">
          {(["cube", "sphere"] as const).map((option) => (
            <button
              key={option}
              className="segment"
              data-active={shape === option}
              disabled={size === 1}
              onClick={() => store.setBrushShape(option)}
              title={option === "cube" ? "Square footprint" : "Rounded footprint"}
            >
              {option === "cube" ? "Cube" : "Ball"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * How much of the build the push brush takes hold of. Everything inside the
 * shape moves with the drag, so the size is the tool: a ball of five reshapes a
 * branch, one of fifteen swings a whole canopy round.
 */
function PushControl() {
  const size = useStore((s) => s.pushSize);
  const shape = useStore((s) => s.pushShape);
  const store = useStore.getState();
  return (
    <div className="brush">
      <div className="brush-row">
        <input
          type="range"
          min={1}
          max={MAX_PUSH}
          step={2}
          value={size}
          aria-label="Push brush size"
          onChange={(e) => store.setPushSize(Number(e.target.value))}
        />
        <div className="segmented">
          {(["sphere", "cube"] as const).map((option) => (
            <button
              key={option}
              className="segment"
              data-active={shape === option}
              disabled={size === 1}
              onClick={() => store.setPushShape(option)}
              title={option === "cube" ? "Square footprint" : "Rounded footprint"}
            >
              {option === "cube" ? "Cube" : "Ball"}
            </button>
          ))}
        </div>
      </div>
      <p className="fold-note">
        Hold Shift to keep the shove on one axis. Blocks are moved, not copied —
        they leave holes behind and write over whatever they land on.
      </p>
    </div>
  );
}

function RegionSection({ onFill }: { onFill: () => void }) {
  const region = useStore((s) => s.region)!;
  const fillMode = useStore((s) => s.fillMode);
  const tool = useStore((s) => s.tool);
  const size = [0, 1, 2].map((a) => region.max[a] - region.min[a] + 1);
  const store = useStore.getState();
  const copy = () => {
    store.copyRegion();
    store.setTool("clone");
  };
  const cut = () => {
    store.cutRegion();
    store.setTool("clone");
  };
  const mode = FILL_MODES.find((m) => m.id === fillMode)!;

  return (
    <Section
      id="selection"
      title="Selection"
      current={tool === "select" || tool === "through"}
      summary={<Dims size={size} />}
      tools={["select", "through"]}
      help="The box you have marked out. Fill, erase and replace act on everything inside it; copy hands it to the clone tool."
    >
      <div className="field" style={{ marginBottom: 8 }}>
        <span className="field-label">Shape</span>
        <select
          className="search select"
          value={fillMode}
          title={mode.hint}
          onChange={(e) => store.setFillMode(e.target.value as typeof fillMode)}
          aria-label="Which cells Fill and Erase touch"
        >
          {FILL_MODES.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="actions" style={{ marginBottom: 8 }}>
        <button className="btn btn-outline" onClick={copy} title="Copy the selection to the clone tool  (Ctrl+C)">
          Copy <kbd>Ctrl C</kbd>
        </button>
        <button className="btn btn-outline" onClick={cut} title="Copy the selection, then erase it  (Ctrl+X)">
          Cut
        </button>
        <button className="btn btn-outline" onClick={onFill} title={mode.hint}>Fill</button>
        <button
          className="btn btn-outline btn-danger"
          onClick={() => store.eraseRegion()}
          title={fillMode === "air" ? "Erase every block in the box" : mode.hint}
        >
          Erase
        </button>
        <button className="btn" onClick={() => store.clearRegion()}>Clear</button>
      </div>

      <SelectionCentre region={region} />

      <div className="field">
        <span className="field-label">Move it where it stands</span>
      </div>
      <div className="actions">
        <button className="btn btn-outline" onClick={() => store.rotateRegion()} title="Quarter turn clockwise, re-centred on the box">
          Rotate
        </button>
        <button className="btn btn-outline" onClick={() => store.mirrorRegion("x")} title="Swap east and west">
          Mirror X
        </button>
        <button className="btn btn-outline" onClick={() => store.mirrorRegion("z")} title="Swap north and south">
          Mirror Z
        </button>
      </div>

      <p className="fold-note">
        <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> slide the box across the screen and{" "}
        <kbd>Page&nbsp;Up</kbd>/<kbd>Page&nbsp;Down</kbd> lift it; hold <kbd>Shift</kbd> to take
        the blocks along with it.
      </p>
    </Section>
  );
}

const CENTRE_AXES = [
  { index: 0 as const, name: "X", className: "ax-x" },
  { index: 1 as const, name: "Y", className: "ax-y" },
  { index: 2 as const, name: "Z", className: "ax-z" },
];

/**
 * The middle of the selection, named in blocks rather than left to be counted.
 * An even span has no single middle block — the two that straddle the line are
 * both given, which is the number you need before deciding whether to grow the
 * box a block to make it symmetrical.
 */
function SelectionCentre({ region }: { region: Region }) {
  const guides = useStore((s) => s.centreGuides);
  const target = useStore((s) => s.centreTarget);
  const store = useStore.getState();
  const centre = centreOf(region);
  const showing = guides && target === "selection";

  return (
    <>
      <div className="field" style={{ marginTop: 10 }}>
        <span className="field-label">Centre</span>
        <span className="num" style={{ fontSize: 12 }}>
          <span className="ax-x">{formatCentre(centre.axes[0].world)}</span>
          <span style={{ color: "var(--dim)" }}> , </span>
          <span className="ax-y">{formatCentre(centre.axes[1].world)}</span>
          <span style={{ color: "var(--dim)" }}> , </span>
          <span className="ax-z">{formatCentre(centre.axes[2].world)}</span>
        </span>
      </div>

      <div className="centre-grid">
        {CENTRE_AXES.map((axis) => {
          const at = centre.axes[axis.index];
          return (
            <div className="centre-row" key={axis.name}>
              <span className={`grow-axis ${axis.className}`}>{axis.name}</span>
              <span className="num centre-value">{at.cells.join(" / ")}</span>
              <span
                className="num centre-note"
                title={at.even ? "An even span has no single middle block" : "The middle block on this axis"}
              >
                {at.even
                  ? `${centre.size[axis.index]} across · no single middle`
                  : `${centre.size[axis.index]} across`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="actions" style={{ marginTop: 8 }}>
        <button
          className="btn btn-outline"
          onClick={() => store.selectCentreCell("selection")}
          title="Select the middle block of this box — the pair, where a span is even"
        >
          Centre block
        </button>
        <button
          className="btn btn-outline"
          onClick={() => store.selectCentre("selection")}
          title="Select the middle column, full height of this box"
        >
          Centre column
        </button>
        <button
          className="btn btn-outline"
          data-active={showing}
          onClick={() => {
            store.setCentreTarget("selection");
            store.setCentreGuides(!showing);
          }}
          title="Draw the centre lines through this box in the viewport"
        >
          {showing ? "Hide lines" : "Centre lines"}
        </button>
      </div>
    </>
  );
}

/**
 * Placing against a face is how you build outward; locking to the layer plane
 * is how you lay a course of blocks flat, at exactly the height you chose.
 */
function PlaneLock() {
  const locked = useStore((s) => s.planeLock);
  const layerLimit = useStore((s) => s.layerLimit);
  return (
    <label className="check" style={{ marginBottom: 8 }} title="Blocks land on the plane at the layer slider's height, whatever is under the pointer">
      <input
        type="checkbox"
        checked={locked}
        onChange={(e) => useStore.getState().setPlaneLock(e.target.checked)}
      />
      <span>
        Build on the layer plane
        <span className="num" style={{ color: "var(--dim)" }}> · <span className="ax-y">Y {layerLimit}</span></span>
      </span>
    </label>
  );
}

/** The copied box, and the turns you can give it before stamping. */
function ClipSection() {
  const clip = useStore((s) => s.clip)!;
  const clipName = useStore((s) => s.clipName);
  const tool = useStore((s) => s.tool);
  const pasteMode = useStore((s) => s.pasteMode);
  const pasteOverwrite = useStore((s) => s.pasteOverwrite);
  const pastePin = useStore((s) => s.pastePin);
  const pasteLift = useStore((s) => s.pasteLift);
  const region = useStore((s) => s.region);
  const clipSource = useStore((s) => s.clipSource);
  const store = useStore.getState();

  return (
    <Section
      id="clipboard"
      title={clipName ? "Imported build" : "Clipboard"}
      current={tool === "clone"}
      summary={<Dims size={[clip.width, clip.height, clip.length]} />}
      tools={["clone"]}
      help={`The copy waiting to be stamped — ${clip.count.toLocaleString()} blocks. Turn it here, then click a face in the view to put it down.`}
    >
      {clipName && (
        <div className="field">
          <span className="field-label">From</span>
          <span className="file-name" style={{ fontSize: 11 }} title={clipName}>{clipName}</span>
        </div>
      )}

      <div className="actions" style={{ marginBottom: 8 }}>
        <button className="btn btn-outline" onClick={() => store.rotateClip()} title="Quarter turn clockwise  (R)">
          Rotate <kbd>R</kbd>
        </button>
        <button className="btn btn-outline" onClick={() => store.mirrorClip("x")} title="Swap east and west">
          Mirror X
        </button>
        <button className="btn btn-outline" onClick={() => store.mirrorClip("z")} title="Swap north and south">
          Mirror Z
        </button>
        <button className="btn" onClick={() => store.clearClip()}>Clear</button>
      </div>

      <label className="check" title="Off, the copy's empty space leaves what is already there alone">
        <input
          type="checkbox"
          checked={pasteMode === "replace"}
          onChange={(e) => store.setPasteMode(e.target.checked ? "replace" : "merge")}
        />
        <span>Stamp the empty space too</span>
      </label>

      <label className="check" title="On, the stamp lands on the block you point at and paints over it, instead of being pushed off its face">
        <input
          type="checkbox"
          checked={pasteOverwrite}
          onChange={(e) => store.setPasteOverwrite(e.target.checked)}
        />
        <span>Stamp through blocks in the way</span>
        <kbd>T</kbd>
      </label>

      {!pastePin && (
        <div className="field" style={{ marginTop: 10 }}>
          <span
            className="field-label"
            title="The pointer can only anchor the stamp against a surface. This floats it off that surface, so the mouse still aims and only the height comes from the keys"
          >
            Float
          </span>
          <span className="num" style={{ color: pasteLift === 0 ? "var(--dim)" : undefined }}>
            {pasteLift === 0 ? "on the face" : `${pasteLift > 0 ? "+" : ""}${pasteLift} blocks`}
          </span>
          <span className="stepper" title="Page Up / Page Down, or Shift with the up and down arrows">
            <button
              className="stepper-btn"
              onClick={() => store.liftPaste(-1)}
              aria-label="Lower the stamp a block"
            >
              −
            </button>
            <span className="stepper-value" data-zero={pasteLift === 0}>
              {pasteLift > 0 ? `+${pasteLift}` : pasteLift}
            </span>
            <button
              className="stepper-btn"
              onClick={() => store.liftPaste(1)}
              aria-label="Raise the stamp a block"
            >
              +
            </button>
          </span>
        </div>
      )}

      <div className="field" style={{ marginTop: 10 }}>
        <span className="field-label">Place by hand</span>
        {pastePin && <Coords at={pastePin} />}
      </div>

      <div className="actions" style={{ marginBottom: 8 }}>
        {pastePin ? (
          <>
            <button className="btn" onClick={() => store.stampPin()} title="Stamp it where the ghost sits  (Enter)">
              Stamp here
            </button>
            <button className="btn btn-outline" onClick={() => store.unpinPaste()} title="Back to aiming with the pointer  (Esc)">
              Release
            </button>
          </>
        ) : (
          <button
            className="btn btn-outline"
            onClick={() => store.pinPaste()}
            title="Park the ghost and drive it with the arrow keys, for spots the pointer cannot reach"
          >
            Park the ghost
          </button>
        )}
        <button
          className="btn btn-outline"
          disabled={!region}
          onClick={() => region && store.pinPaste(region.min)}
          title="Drop the ghost on the current selection box"
        >
          To selection
        </button>
        <button
          className="btn btn-outline"
          disabled={!clipSource}
          onClick={() => clipSource && store.pinPaste(clipSource)}
          title="Drop the ghost back where this copy came from"
        >
          To source
        </button>
      </div>

      <p className="fold-note">
        <kbd>Page&nbsp;Up</kbd>/<kbd>Page&nbsp;Down</kbd> — or <kbd>Shift</kbd> with the up and
        down arrows — float the stamp above the face while the pointer keeps aiming it. The side
        arrows park the ghost instead and drive it across the screen; <kbd>Enter</kbd> stamps,{" "}
        <kbd>Esc</kbd> puts it back down.
      </p>

      {tool !== "clone" && (
        <p className="fold-note fold-call">
          <kbd>C</kbd> picks up the clone tool — then click a face to stamp it.
        </p>
      )}
    </Section>
  );
}

function Coords({ at }: { at: [number, number, number] }) {
  return (
    <span className="num" style={{ fontSize: 12 }}>
      <span className="ax-x">{at[0]}</span>
      <span style={{ color: "var(--dim)" }}> , </span>
      <span className="ax-y">{at[1]}</span>
      <span style={{ color: "var(--dim)" }}> , </span>
      <span className="ax-z">{at[2]}</span>
    </span>
  );
}

function Dims({ size }: { size: number[] }) {
  return (
    <span className="num" style={{ fontSize: 12 }}>
      <span className="ax-x">{size[0]}</span>
      <span style={{ color: "var(--dim)" }}> × </span>
      <span className="ax-y">{size[1]}</span>
      <span style={{ color: "var(--dim)" }}> × </span>
      <span className="ax-z">{size[2]}</span>
    </span>
  );
}
