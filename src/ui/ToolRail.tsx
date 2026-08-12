import { useStore } from "../store";
import { IconFly, IconFrame, IconOrbit } from "./icons";
import { TOOLS } from "./tools";

export function ToolRail() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const cameraMode = useStore((s) => s.cameraMode);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const clip = useStore((s) => s.clip);

  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map(({ id, key, label, blurb, icon: Icon }) => (
        <button
          key={id}
          className="rail-btn"
          data-active={tool === id}
          data-empty={id === "clone" && !clip}
          onClick={() => setTool(id)}
          title={`${label} — ${blurb}  (${key})`}
          aria-pressed={tool === id}
        >
          <Icon size={18} />
          <span className="rail-key">{key}</span>
        </button>
      ))}

      <div className="rail-divider" />

      <button
        className="rail-btn"
        data-active={cameraMode === "orbit"}
        onClick={() => setCameraMode("orbit")}
        title="Orbit around the build  (O)"
        aria-pressed={cameraMode === "orbit"}
      >
        <IconOrbit size={18} />
        <span className="rail-key">O</span>
      </button>
      <button
        className="rail-btn"
        data-active={cameraMode === "fly"}
        onClick={() => setCameraMode("fly")}
        title="Walk through the build — click to look, WASD to move  (G)"
        aria-pressed={cameraMode === "fly"}
      >
        <IconFly size={18} />
        <span className="rail-key">G</span>
      </button>

      <div className="rail-divider" />

      <button
        className="rail-btn"
        onClick={() => useStore.getState().frameBuild()}
        title="Fit the build to the view  (F)"
      >
        <IconFrame size={18} />
        <span className="rail-key">F</span>
      </button>
    </nav>
  );
}
