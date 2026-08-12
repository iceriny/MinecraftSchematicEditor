import { useMemo } from "react";
import { useStore } from "../store";
import { centreOf, formatCentre, type AxisCentre } from "../core/measure";
import { Section } from "./Section";

const AXES = [
  { index: 0 as const, name: "X", className: "ax-x" },
  { index: 1 as const, name: "Y", className: "ax-y" },
  { index: 2 as const, name: "Z", className: "ax-z" },
];

/**
 * Where the middle is, and how far it is from here to there. Both are things
 * you would otherwise get by counting blocks along an edge, which is slow and
 * wrong often enough to matter.
 */
export function MeasurePanel() {
  const build = useStore((s) => s.build);
  const region = useStore((s) => s.region);
  const guides = useStore((s) => s.centreGuides);
  const target = useStore((s) => s.centreTarget);
  const a = useStore((s) => s.measureA);
  const b = useStore((s) => s.measureB);
  const measurement = useStore((s) => s.measurement);
  const tool = useStore((s) => s.tool);
  const store = useStore.getState();

  const box = useMemo(() => {
    if (!build) return null;
    if (target === "selection" && region) return region;
    return { min: [0, 0, 0] as [number, number, number], max: [build.width - 1, build.height - 1, build.length - 1] as [number, number, number] };
  }, [build, region, target]);

  const reading = measurement();
  if (!build || !box) return null;
  const centre = centreOf(box);

  return (
    <Section
      id="measure"
      title="Ruler & centre"
      closed
      current={tool === "measure"}
      summary={
        reading
          ? <span className="fold-on">{reading.straight.toFixed(2)} apart</span>
          : <span className="fold-quiet">
              centre {formatCentre(centre.axes[0].world)}, {formatCentre(centre.axes[1].world)},{" "}
              {formatCentre(centre.axes[2].world)}
            </span>
      }
      tools={["measure"]}
      help="Where the middle is, and how far it is from one block to another — both things you would otherwise get by counting along an edge."
    >
      <div className="field">
        <span className="field-label">Centre of</span>
        <div className="segmented">
          <button
            className="segment"
            data-active={target === "build"}
            onClick={() => store.setCentreTarget("build")}
            title="The whole build's box"
          >
            Build
          </button>
          <button
            className="segment"
            data-active={target === "selection"}
            disabled={!region}
            onClick={() => store.setCentreTarget("selection")}
            title={region ? "The current selection box" : "Make a selection first"}
          >
            Selection
          </button>
        </div>
      </div>

      <div className="centre-grid">
        {AXES.map((axis) => (
          <CentreRow
            key={axis.name}
            name={axis.name}
            className={axis.className}
            axis={centre.axes[axis.index]}
            size={centre.size[axis.index]}
          />
        ))}
      </div>

      <label className="check" style={{ margin: "8px 0" }} title="Draws the centre lines and marks the middle column in the viewport">
        <input
          type="checkbox"
          checked={guides}
          onChange={(e) => store.setCentreGuides(e.target.checked)}
        />
        <span>Show centre lines</span>
      </label>

      <div className="actions" style={{ marginBottom: 10 }}>
        <button
          className="btn btn-outline"
          onClick={() => store.selectCentreCell()}
          title="Select the middle block itself — the pair, where a span is even"
        >
          Centre block
        </button>
        <button
          className="btn btn-outline"
          onClick={() => store.selectCentre()}
          title="Select the middle column, full height, so you can build straight off it"
        >
          Centre column
        </button>
        <button
          className="btn btn-outline"
          disabled={!region}
          onClick={() => store.measureRegion()}
          title="Put the ruler on the selection's opposite corners"
        >
          Measure selection
        </button>
      </div>

      <div className="field">
        <span className="field-label">Ruler</span>
        {reading ? (
          <span className="num" style={{ fontSize: 12 }}>
            <span className="value">{reading.straight.toFixed(2)}</span>
            <span style={{ color: "var(--dim)" }}> straight · {reading.manhattan} walked</span>
          </span>
        ) : (
          <span className="num" style={{ fontSize: 12, color: "var(--dim)" }}>
            {a ? "click the second block" : "click two blocks"}
          </span>
        )}
      </div>

      {reading && (
        <>
          <div className="centre-grid">
            {AXES.map((axis) => (
              <div className="centre-row" key={axis.name}>
                <span className={`grow-axis ${axis.className}`}>{axis.name}</span>
                <span className="num centre-value">{reading.span[axis.index]}</span>
                <span className="num centre-note">
                  blocks · {reading.delta[axis.index] >= 0 ? "+" : ""}
                  {reading.delta[axis.index]} step
                </span>
              </div>
            ))}
          </div>

          <div className="field" style={{ marginTop: 8 }}>
            <span className="field-label">Midpoint</span>
            <span className="num" style={{ fontSize: 12 }}>
              <span className="ax-x">{formatCentre(reading.midpoint[0])}</span>
              <span style={{ color: "var(--dim)" }}> , </span>
              <span className="ax-y">{formatCentre(reading.midpoint[1])}</span>
              <span style={{ color: "var(--dim)" }}> , </span>
              <span className="ax-z">{formatCentre(reading.midpoint[2])}</span>
            </span>
          </div>
        </>
      )}

      <div className="actions">
        <button
          className="btn btn-outline"
          disabled={!a || !b}
          onClick={() => store.regionFromMeasure()}
          title="Turn the two marks into a selection box"
        >
          Marks to selection
        </button>
        <button className="btn" disabled={!a} onClick={() => store.clearMeasure()}>
          Clear ruler
        </button>
      </div>

      {!reading && (
        <p className="fold-note">
          <kbd>K</kbd> picks up the ruler — then click the two blocks you want the distance between.
        </p>
      )}
    </Section>
  );
}

/**
 * One axis of the centre readout. An even span has no middle block, so the two
 * that straddle the line are named — that is the number you actually need when
 * deciding whether to grow the build a block to make it symmetrical.
 */
function CentreRow({
  name, className, axis, size,
}: {
  name: string;
  className: string;
  axis: AxisCentre;
  size: number;
}) {
  return (
    <div className="centre-row">
      <span className={`grow-axis ${className}`}>{name}</span>
      <span className="num centre-value">{formatCentre(axis.world)}</span>
      <span className="num centre-note" title={`${size} blocks across`}>
        {axis.even ? `between ${axis.cells[0]} and ${axis.cells[1]}` : `block ${axis.cells[0]}`}
      </span>
    </div>
  );
}
