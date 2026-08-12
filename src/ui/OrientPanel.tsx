import { useStore } from "../store";
import { baseName, stateKey, type BlockState } from "../core/model";
import {
  canFlip, canTurn, orientationOf, propertyValue, withoutOrientation,
  type OrientProp,
} from "../core/orientation";

/**
 * Which way the paint material faces.
 *
 * Orientation is part of the blockstate, so before this it could only be set by
 * typing the whole state — `oak_stairs[facing=east,half=top]` — into the picker.
 * Everything here writes one property at a time onto the loaded material and
 * shows the state it has ended up as, since two orientations of the same stair
 * are otherwise indistinguishable in the panel.
 */
export function OrientPanel() {
  const build = useStore((s) => s.build);
  const paint = useStore((s) => s.paintMaterial);
  const tool = useStore((s) => s.tool);
  const autoOrient = useStore((s) => s.autoOrient);
  const store = useStore.getState();

  const state = build && paint !== null && paint !== 0 ? build.palette[paint] : null;
  const orientation = state ? orientationOf(state) : null;
  // The face rule only runs on a place click, so the toggle only appears where
  // it has something to govern.
  const showAuto = tool === "place" && !!orientation;
  if (!state || (!orientation && !showAuto)) return null;

  return (
    <div className="orient">
      {orientation && (
        <>
          <div className="field" style={{ marginBottom: 6 }}>
            <span className="field-label">Turned</span>
            <span className="orient-state" title={stateKey(state)}>
              {shortState(state)}
            </span>
          </div>

          <div className="actions" style={{ marginBottom: 8 }}>
            <button
              className="btn btn-outline"
              disabled={!canTurn(state)}
              onClick={() => store.turnPaint()}
              title="A quarter turn clockwise — the next axis, for a log  (R)"
            >
              Turn <kbd>R</kbd>
            </button>
            <button
              className="btn btn-outline"
              disabled={!canFlip(state)}
              onClick={() => store.flipPaint()}
              title="Upside down: a top slab, a stair hung from the ceiling  (Shift+R)"
            >
              Flip <kbd>⇧R</kbd>
            </button>
            <button
              className="btn"
              disabled={withoutOrientation(state) === state}
              onClick={() => store.setPaintState(withoutOrientation(state))}
              title="Drop every turn back off, to the plain block"
            >
              Plain
            </button>
          </div>

          {orientation.props.map((prop) => (
            <PropControl key={prop.key} prop={prop} state={state} />
          ))}

          {orientation.note && (
            <p className="fold-note" style={{ margin: "0 0 8px" }}>{orientation.note}</p>
          )}
        </>
      )}

      {showAuto && (
        <label
          className={orientation ? "check orient-auto" : "check"}
          title="Off writes the material exactly as it is set above, whatever face you click"
        >
          <input
            type="checkbox"
            checked={autoOrient}
            onChange={(e) => store.setAutoOrient(e.target.checked)}
          />
          <span>Turn it to the face I click</span>
        </label>
      )}
    </div>
  );
}

/** `minecraft:oak_stairs[facing=east]` -> `oak_stairs[facing=east]`. */
function shortState(state: BlockState): string {
  const key = stateKey(state);
  return baseName(state.name) + key.slice(state.name.length);
}

function PropControl({ prop, state }: { prop: OrientProp; state: BlockState }) {
  const value = propertyValue(state, prop);
  const set = (next: string) => useStore.getState().setPaintProperty(prop.key, next);

  if (prop.kind === "toggle") {
    return (
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={value === "true"} onChange={(e) => set(String(e.target.checked))} />
        <span>{prop.label}</span>
      </label>
    );
  }

  if (prop.kind === "select") {
    return (
      <div className="field">
        <span className="field-label">{prop.label}</span>
        <select
          className="search select"
          value={value}
          aria-label={prop.label}
          onChange={(e) => set(e.target.value)}
        >
          {prop.values.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (prop.kind === "compass") return <Compass prop={prop} value={value} onPick={set} />;

  return (
    <div className="field">
      <span className="field-label">{prop.label}</span>
      <div className="segmented">
        {prop.values.map((option) => (
          <button
            key={option.value}
            className="segment"
            data-active={value === option.value}
            title={option.hint}
            onClick={() => set(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The four compass points where they belong on a map, with up and down in the
 * middle for the blocks that reach them. A row of four buttons reads as a list;
 * laid out as a pad it reads as a direction, which is what is being chosen.
 */
function Compass({
  prop, value, onPick,
}: { prop: OrientProp; value: string; onPick: (value: string) => void }) {
  const has = (name: string) => prop.values.some((option) => option.value === name);
  const button = (name: string, extra?: string) => {
    const option = prop.values.find((entry) => entry.value === name);
    if (!option) return <span />;
    return (
      <button
        className={`compass-btn ${extra ?? ""}`}
        data-active={value === name}
        title={option.hint ?? option.value}
        aria-label={option.value}
        onClick={() => onPick(name)}
      >
        {option.label}
      </button>
    );
  };

  return (
    <div className="field" style={{ alignItems: "flex-start" }}>
      <span className="field-label" style={{ marginTop: 6 }}>{prop.label}</span>
      <div className="compass">
        <span />
        {button("north")}
        <span />
        {button("west")}
        <div className="compass-mid">
          {has("up") && button("up", "compass-vert")}
          {has("down") && button("down", "compass-vert")}
        </div>
        {button("east")}
        <span />
        {button("south")}
        <span />
      </div>
    </div>
  );
}
