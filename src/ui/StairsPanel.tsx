import { useState } from "react";
import { useStore } from "../store";
import { cssColor } from "../core/blockLook";
import { displayName, type BlockState } from "../core/model";
import { MAX_STAIR_WIDTH, STAIR_STYLES, STAIR_SUPPORTS } from "../core/stairs";
import { BlockPicker } from "./BlockPicker";
import { Section } from "./Section";

/** Grades offered by name, since "1:2" says more than a bare number does. */
const RUNS = [
  { value: 0, label: "Fit", hint: "Work the grade out from the two points you clicked" },
  { value: 1, label: "1:1", hint: "One block along for every block up — the steepest flight" },
  { value: 2, label: "1:2", hint: "Two blocks along per rise, with a landing between steps" },
  { value: 3, label: "1:3", hint: "Three blocks along per rise" },
];

/**
 * The stairs tool's settings, and the read-out of the flight it is about to
 * lay. Everything here changes the ghost as soon as it is touched, so the
 * decisions are made against the preview rather than against the result.
 */
export function StairsPanel() {
  const from = useStore((s) => s.stairsFrom);
  const plan = useStore((s) => s.stairsPlan);
  const problem = useStore((s) => s.stairsProblem);
  const width = useStore((s) => s.stairsWidth);
  const run = useStore((s) => s.stairsRun);
  const style = useStore((s) => s.stairsStyle);
  const support = useStore((s) => s.stairsSupport);
  const step = useStore((s) => s.stairsMaterial);
  const fill = useStore((s) => s.stairsFill);
  const [picker, setPicker] = useState<"step" | "fill" | null>(null);
  const store = useStore.getState();

  const pick = (state: BlockState) => {
    if (picker === "step") store.setStairsMaterial(state);
    if (picker === "fill") store.setStairsFill(state);
    setPicker(null);
  };

  const notStairs = style === "stairs" && !step.name.endsWith("_stairs");

  return (
    <Section
      id="stairs"
      title="Stairs"
      current
      summary={
        plan
          ? <span className="fold-on">{plan.treads} treads · 1:{plan.run}</span>
          : <span className="fold-quiet">{from ? "aim the top" : "no flight"}</span>
      }
      tools={["stairs"]}
      help="Click the block the flight starts on, then the block it lands on. The grade, the direction and every step's facing come out of those two points."
    >
      <div className="field">
        <span className="field-label">Step block</span>
        <button className="chip" onClick={() => setPicker("step")} title={step.name}>
          <i className="swatch" style={{ background: cssColor(step) }} />
          <span>{displayName(step)}</span>
        </button>
      </div>

      <div className="field">
        <span className="field-label">Fill block</span>
        <button
          className="chip"
          onClick={() => setPicker("fill")}
          title={`${fill.name} — used for landings on a gentle grade and for anything under the flight`}
        >
          <i className="swatch" style={{ background: cssColor(fill) }} />
          <span>{displayName(fill)}</span>
        </button>
      </div>

      {notStairs && (
        <p className="fold-note fold-warn-note">
          {displayName(step)} is not a stair block, so it is placed as-is — nothing to turn.
        </p>
      )}

      <div className="field">
        <span className="field-label">Shape</span>
        <div className="segmented">
          {STAIR_STYLES.map((option) => (
            <button
              key={option.id}
              className="segment"
              data-active={style === option.id}
              title={option.hint}
              onClick={() => store.setStairsStyle(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Grade</span>
        <div className="segmented">
          {RUNS.map((option) => (
            <button
              key={option.value}
              className="segment"
              data-active={run === option.value}
              title={option.hint}
              onClick={() => store.setStairsRun(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Under it</span>
        <div className="segmented">
          {STAIR_SUPPORTS.map((option) => (
            <button
              key={option.id}
              className="segment"
              data-active={support === option.id}
              title={option.hint}
              onClick={() => store.setStairsSupport(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="brush">
        <div className="field" style={{ marginBottom: 4 }}>
          <span className="field-label">Width</span>
          <span className="num" style={{ fontSize: 12 }}>
            {width === 1 ? "one block" : `${width} blocks`}
          </span>
        </div>
        <div className="brush-row">
          <input
            type="range"
            min={1}
            max={MAX_STAIR_WIDTH}
            step={1}
            value={width}
            aria-label="Stair width"
            onChange={(e) => store.setStairsWidth(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Flight</span>
        {plan ? (
          <span className="num" style={{ fontSize: 12 }}>
            <span className="value">{plan.treads}</span>
            <span style={{ color: "var(--dim)" }}> treads · rise </span>
            <span className="ax-y">{plan.rise}</span>
            <span style={{ color: "var(--dim)" }}> · 1:{plan.run}{plan.fitted ? " fitted" : ""} · {plan.facing}</span>
          </span>
        ) : (
          <span className="num" style={{ fontSize: 12, color: "var(--dim)" }}>
            {from ? "aim the top step" : "no flight started"}
          </span>
        )}
      </div>

      {problem && <p className="fold-note fold-warn-note">{problem}</p>}

      <div className="actions">
        <button
          className="btn btn-outline"
          disabled={!plan}
          onClick={() => store.buildStairs()}
          title="Lay the previewed flight down  (Enter)"
        >
          Build it <kbd>Enter</kbd>
        </button>
        <button
          className="btn"
          disabled={!from}
          onClick={() => store.clearStairs()}
          title="Forget the bottom step and start again  (Esc)"
        >
          Start over <kbd>Esc</kbd>
        </button>
      </div>

      {picker && (
        <BlockPicker
          title={picker === "step" ? "Step block" : "Fill block"}
          onPick={pick}
          onClose={() => setPicker(null)}
        />
      )}
    </Section>
  );
}
