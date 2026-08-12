import { useState } from "react";
import { useStore } from "../store";
import { MAX_VOLUME } from "../core/model";
import { IconClose } from "./icons";

const PRESETS: { label: string; size: [number, number, number] }[] = [
  { label: "Chunk", size: [16, 32, 16] },
  { label: "Small plot", size: [32, 24, 32] },
  { label: "Large plot", size: [64, 48, 64] },
  { label: "Tall tower", size: [24, 128, 24] },
];

/**
 * Starts an empty box to build into, for work that doesn't begin with a file.
 * `inNewTab` opens it beside the current build rather than over it.
 */
export function NewBuildDialog({
  inNewTab = false,
  onClose,
}: {
  inNewTab?: boolean;
  onClose: () => void;
}) {
  const [size, setSize] = useState<[number, number, number]>([32, 24, 32]);

  const volume = size[0] * size[1] * size[2];
  const invalid = size.some((v) => !Number.isFinite(v) || v < 1)
    ? "Every axis needs at least one block."
    : volume > MAX_VOLUME
      ? `${volume.toLocaleString()} cells is over the ${MAX_VOLUME.toLocaleString()} limit.`
      : null;

  const create = () => {
    if (invalid) return;
    const store = useStore.getState();
    if (inNewTab) store.newTab(size[0], size[1], size[2]);
    else store.newBuild(size[0], size[1], size[2]);
    onClose();
  };

  return (
    <div className="picker-backdrop" role="dialog" aria-modal="true" aria-label="New build" onClick={onClose}>
      <div className="picker picker-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="eyebrow">{inNewTab ? "New build — in its own tab" : "New build"}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} title="Close" aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="picker-body">
          <div className="size-fields">
            {(["X — width", "Y — height", "Z — length"] as const).map((label, axis) => (
              <label className="size-field" key={label}>
                <span className={`field-label ${["ax-x", "ax-y", "ax-z"][axis]}`}>{label}</span>
                <input
                  className="search"
                  type="number"
                  min={1}
                  value={size[axis]}
                  autoFocus={axis === 0}
                  onChange={(e) => {
                    const next: [number, number, number] = [...size];
                    next[axis] = Math.max(1, Math.floor(Number(e.target.value) || 0));
                    setSize(next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") create();
                    if (e.key === "Escape") onClose();
                  }}
                />
              </label>
            ))}
          </div>

          <div className="eyebrow" style={{ marginTop: 16 }}>Start from</div>
          <div className="actions" style={{ marginTop: 6 }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="btn btn-outline"
                onClick={() => setSize(preset.size)}
              >
                {preset.label}
                <span className="num" style={{ color: "var(--dim)", marginLeft: 6 }}>
                  {preset.size.join("×")}
                </span>
              </button>
            ))}
          </div>

          <p style={{ color: invalid ? "var(--danger)" : "var(--dim)", fontSize: 11, marginTop: 16 }}>
            {invalid ?? `${volume.toLocaleString()} cells. The box can be resized later.`}
          </p>

          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" disabled={invalid !== null} onClick={create}>
              Create
            </button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
