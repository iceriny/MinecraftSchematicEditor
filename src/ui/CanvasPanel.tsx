import { useState } from "react";
import { useStore } from "../store";
import { MAX_VOLUME } from "../core/model";
import { Section } from "./Section";

type Sides = { min: [number, number, number]; max: [number, number, number] };

const ZERO: Sides = { min: [0, 0, 0], max: [0, 0, 0] };
const AXES = [
  { index: 0 as const, name: "X", className: "ax-x", low: "West", high: "East" },
  { index: 1 as const, name: "Y", className: "ax-y", low: "Down", high: "Up" },
  { index: 2 as const, name: "Z", className: "ax-z", low: "North", high: "South" },
];

/**
 * The build's box, and how to change it. A schematic arrives at a fixed size
 * and every edit until now had to fit inside it — this is where it grows a
 * storey, loses the empty margin it was exported with, or gets started from
 * nothing.
 */
export function CanvasPanel() {
  const build = useStore((s) => s.build);
  const structuralUndo = useStore((s) => s.structuralUndo);
  const [sides, setSides] = useState<Sides>(ZERO);
  if (!build) return null;

  const next: [number, number, number] = [
    build.width + sides.min[0] + sides.max[0],
    build.height + sides.min[1] + sides.max[1],
    build.length + sides.min[2] + sides.max[2],
  ];
  const changed = [...sides.min, ...sides.max].some((v) => v !== 0);
  const volume = next[0] * next[1] * next[2];
  const invalid = next.some((v) => v < 1)
    ? "Every axis needs at least one block."
    : volume > MAX_VOLUME
      ? `${volume.toLocaleString()} cells is over the limit.`
      : null;

  const bump = (side: "min" | "max", axis: 0 | 1 | 2, by: number) =>
    setSides((current) => {
      const copy: Sides = { min: [...current.min], max: [...current.max] };
      copy[side][axis] += by;
      return copy;
    });

  const apply = () => {
    if (invalid) return;
    useStore.getState().resizeCanvas(sides);
    setSides(ZERO);
  };

  return (
    <Section
      id="canvas"
      title="Canvas"
      closed
      summary={
        <span className="num">
          <span className="ax-x">{build.width}</span>
          <span className="fold-quiet"> × </span>
          <span className="ax-y">{build.height}</span>
          <span className="fold-quiet"> × </span>
          <span className="ax-z">{build.length}</span>
        </span>
      }
      help="The box the build lives in. Growing adds empty space on that side; shrinking cuts whatever was there away. Resizing clears the undo history."
    >
      <div className="field">
        <span className="field-label">Grow by</span>
        <span className="num" style={{ fontSize: 11, color: "var(--dim)" }}>
          blocks per side
        </span>
      </div>

      <div className="grow-grid">
        {AXES.map((axis) => (
          <div className="grow-row" key={axis.name}>
            <span className={`grow-axis ${axis.className}`}>{axis.name}</span>
            <Stepper
              label={axis.low}
              value={sides.min[axis.index]}
              onChange={(by) => bump("min", axis.index, by)}
            />
            <Stepper
              label={axis.high}
              value={sides.max[axis.index]}
              onChange={(by) => bump("max", axis.index, by)}
            />
          </div>
        ))}
      </div>

      {changed && (
        <div className="field" style={{ marginTop: 8 }}>
          <span className="field-label">New size</span>
          <span className="num" style={{ fontSize: 12, color: invalid ? "var(--danger)" : undefined }}>
            <span className="ax-x">{next[0]}</span>
            <span style={{ color: "var(--dim)" }}> × </span>
            <span className="ax-y">{next[1]}</span>
            <span style={{ color: "var(--dim)" }}> × </span>
            <span className="ax-z">{next[2]}</span>
          </span>
        </div>
      )}
      {changed && invalid && <p className="fold-note fold-error">{invalid}</p>}

      <div className="actions">
        <button className="btn" disabled={!changed || invalid !== null} onClick={apply}>
          Resize
        </button>
        <button className="btn btn-outline" disabled={!changed} onClick={() => setSides(ZERO)}>
          Reset
        </button>
        <button
          className="btn btn-outline"
          onClick={() => useStore.getState().cropToContent()}
          title="Shrink the box to the blocks that are actually in it"
        >
          Crop to blocks
        </button>
        <button
          className="btn btn-outline"
          onClick={() => useStore.getState().selectAll()}
          title="Select the whole box  (Ctrl+A)"
        >
          Select all <kbd>Ctrl A</kbd>
        </button>
        <button
          className="btn btn-outline"
          onClick={() => useStore.getState().copyBuild()}
          title="Put the whole build on the clipboard — the way to hand it to another tab"
        >
          Copy build
        </button>
        {structuralUndo && (
          <button
            className="btn btn-outline"
            onClick={() => useStore.getState().undoStructural()}
            title="Put the box back the way it was"
          >
            Undo {structuralUndo.label.toLowerCase()}
          </button>
        )}
      </div>

    </Section>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (by: number) => void;
}) {
  return (
    <span className="stepper" title={`${label} side`}>
      <button className="stepper-btn" onClick={() => onChange(-1)} aria-label={`Shrink ${label}`}>
        −
      </button>
      <span className="stepper-value" data-zero={value === 0}>
        {value > 0 ? `+${value}` : value}
      </span>
      <button className="stepper-btn" onClick={() => onChange(1)} aria-label={`Grow ${label}`}>
        +
      </button>
    </span>
  );
}
