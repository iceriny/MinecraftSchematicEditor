import { useMemo } from "react";
import { useStore } from "../store";

/** The drafting readout: extents, totals, and whatever the pointer is over. */
export function StatusBar() {
  const build = useStore((s) => s.build);
  const revision = useStore((s) => s.revision);
  const hover = useStore((s) => s.hover);
  const layerLimit = useStore((s) => s.layerLimit);
  const meshing = useStore((s) => s.meshingRemaining);

  const stats = useMemo(() => {
    void revision;
    if (!build) return null;
    const counts = build.countByPalette();
    let types = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > 0) types++;
    return { blocks: build.totalBlocks(), volume: build.volume, types };
  }, [build, revision]);

  if (!build || !stats) {
    return (
      <footer className="statusbar">
        <span className="status-cell">No build open</span>
      </footer>
    );
  }

  const fill = stats.volume > 0 ? (stats.blocks / stats.volume) * 100 : 0;

  return (
    <footer className="statusbar">
      <span className="status-cell">
        <span className="status-key">Size</span>
        <span className="ax-x">{build.width}</span>
        <span style={{ color: "var(--dim)" }}>×</span>
        <span className="ax-y">{build.height}</span>
        <span style={{ color: "var(--dim)" }}>×</span>
        <span className="ax-z">{build.length}</span>
      </span>

      <span className="status-cell">
        <span className="status-key">Blocks</span>
        <span className="value">{stats.blocks.toLocaleString()}</span>
        <span style={{ color: "var(--dim)" }}>/ {stats.volume.toLocaleString()} ({fill.toFixed(0)}% full)</span>
      </span>

      <span className="status-cell">
        <span className="status-key">Types</span>
        <span className="value">{stats.types}</span>
      </span>

      <span className="status-cell">
        <span className="status-key">Layers</span>
        <span className="value">{layerLimit + 1}</span>
        <span style={{ color: "var(--dim)" }}>of {build.height}</span>
      </span>

      <span className="status-spacer" />

      {meshing > 0 && (
        <span className="status-cell">
          <span className="status-key">Building</span>
          <span className="value">{meshing} chunks left</span>
        </span>
      )}

      <span className="status-cell">
        {hover ? (
          <>
            <span className="status-key">At</span>
            <span className="ax-x">{hover.x}</span>
            <span className="ax-y">{hover.y}</span>
            <span className="ax-z">{hover.z}</span>
            <span className="value" style={{ marginLeft: 4 }}>{hover.label}</span>
          </>
        ) : (
          <span style={{ color: "var(--dim)" }}>Point at a block to read its coordinates</span>
        )}
      </span>
    </footer>
  );
}
