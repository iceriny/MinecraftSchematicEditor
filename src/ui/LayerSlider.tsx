import { useStore } from "../store";

/** Vertical build-guide slider: drag down to peel the build back layer by layer. */
export function LayerSlider() {
  const build = useStore((s) => s.build);
  const layerLimit = useStore((s) => s.layerLimit);
  const setLayerLimit = useStore((s) => s.setLayerLimit);
  if (!build) return null;

  return (
    <div className="layers">
      <span className="layers-value">Y {layerLimit}</span>
      <div className="layers-track">
        <input
          type="range"
          min={0}
          max={build.height - 1}
          step={1}
          value={layerLimit}
          onChange={(e) => setLayerLimit(Number(e.target.value))}
          aria-label="Top layer shown"
        />
      </div>
      <span className="layers-label">Layers</span>
    </div>
  );
}
