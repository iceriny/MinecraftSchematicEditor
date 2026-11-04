import { useRef, useState } from "react";
import { useStore } from "../store";
import { IconClose, IconMod } from "./icons";

/**
 * Mod jars stacked over the base pack.
 *
 * A mod jar has the same asset layout as a client jar, under its own namespace,
 * so the same loader reads it and the same renderer draws it. Nothing is
 * bundled — these are the jars already sitting in the user's own instance, and
 * on the dev server they can be picked straight out of it.
 *
 * The chip only appears once there is something to say: no mods and no instance
 * to take one from means no chip.
 */
export function ModPacks() {
  const mods = useStore((s) => s.modPacks);
  const enabled = useStore((s) => s.modBlocksEnabled);
  const loading = useStore((s) => s.modLoading);
  const error = useStore((s) => s.modError);
  const instances = useStore((s) => s.installedInstances);
  const packStatus = useStore((s) => s.packStatus);
  const input = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** null is the top level; otherwise the instance whose jars are listed. */
  const [browsing, setBrowsing] = useState<string | null>(null);

  const close = () => {
    setMenuOpen(false);
    setBrowsing(null);
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".jar,.zip"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        // Sequentially: each jar re-bakes the palette, and three at once would
        // just be three bakes racing to hand the viewer a result.
        void files.reduce(
          (queue, file) => queue.then(() => useStore.getState().addModPack(file)),
          Promise.resolve(),
        );
      }}
    />
  );

  const instance = instances.find((entry) => entry.id === browsing);
  const loadedFiles = new Set(mods.map((mod) => mod.file));

  const menu = menuOpen && (
    <>
      <div className="pack-menu-backdrop" onClick={close} />
      <div className="pack-menu" role="menu">
        {instance ? (
          <>
            <button className="pack-menu-item" role="menuitem" onClick={() => setBrowsing(null)}>
              <span>← {instance.name}</span>
            </button>
            <div className="eyebrow" style={{ padding: "2px 10px 6px" }}>
              {instance.mods.length} jars — only the ones that add blocks will load
            </div>
            {instance.mods.map((mod) => {
              const loaded = loadedFiles.has(mod.file);
              return (
                <button
                  key={mod.file}
                  className="pack-menu-item"
                  data-current={loaded}
                  role="menuitemcheckbox"
                  aria-checked={loaded}
                  disabled={loading}
                  title={loaded ? `Remove ${mod.file}` : `Add ${mod.file}`}
                  onClick={() => {
                    const store = useStore.getState();
                    if (loaded) void store.removeModPack(mod.file);
                    else void store.addInstanceMod(instance.id, mod.file);
                  }}
                >
                  <span>{mod.file.replace(/\.jar$/i, "")}</span>
                  <span className="num">{loaded ? "✓" : `${Math.round(mod.size / 1024 / 1024)} MB`}</span>
                </button>
              );
            })}
          </>
        ) : (
          <>
            {mods.length > 0 && (
              <div className="eyebrow" style={{ padding: "2px 10px 6px" }}>Loaded mods</div>
            )}
            {mods.map((mod) => (
              <div className="pack-menu-row" key={mod.file}>
                <span className="pack-menu-label" title={mod.file}>
                  {mod.label}
                  <span className="num"> {mod.blockCount} blocks</span>
                </span>
                <button
                  className="btn pack-more"
                  title={`Remove ${mod.file}`}
                  aria-label={`Remove ${mod.label}`}
                  disabled={loading}
                  onClick={() => void useStore.getState().removeModPack(mod.file)}
                >
                  <IconClose size={12} />
                </button>
              </div>
            ))}

            {instances.length > 0 && (
              <div className="eyebrow" style={{ padding: "8px 10px 6px" }}>
                From an installed instance
              </div>
            )}
            {instances.map((entry) => (
              <button
                key={entry.id}
                className="pack-menu-item"
                role="menuitem"
                onClick={() => setBrowsing(entry.id)}
              >
                <span>{entry.name}</span>
                <span className="num">{entry.mods.length} ›</span>
              </button>
            ))}

            <button
              className="pack-menu-item"
              role="menuitem"
              onClick={() => {
                close();
                input.current?.click();
              }}
            >
              <span>Add a mod jar…</span>
            </button>
          </>
        )}
      </div>
    </>
  );

  // Nothing loaded and nothing to browse: the file picker on the pack chip
  // already takes a mod jar, so a second empty control would be noise.
  if (mods.length === 0 && instances.length === 0 && !loading) return null;
  // A mod with no vanilla underneath it has nothing to parent its models to.
  if (packStatus !== "ready") return null;

  const summary = mods.length
    ? mods.map((mod) => `${mod.label} — ${mod.blockCount} blocks`).join("\n")
    : "No mod jars loaded yet.";

  return (
    <div className="pack-chip" data-off={!enabled || mods.length === 0}>
      {picker}
      <button
        className="pack-toggle"
        onClick={() => useStore.getState().setModBlocksEnabled(!enabled)}
        disabled={mods.length === 0}
        title={
          (mods.length === 0
            ? "Add a mod jar to build with its blocks"
            : enabled
              ? "Hide modded blocks — vanilla only"
              : "Show modded blocks again") +
          `\n${summary}` +
          (error ? `\n${error}` : "")
        }
        aria-pressed={enabled && mods.length > 0}
      >
        <IconMod />
        <span className="pack-name">
          {loading
            ? "Reading mod…"
            : mods.length === 0
              ? "Mods"
              : mods.length === 1
                ? mods[0].label
                : `${mods.length} mods`}
        </span>
      </button>

      <div className="pack-menu-wrap">
        <button
          className="btn pack-more"
          onClick={() => (menuOpen ? close() : setMenuOpen(true))}
          title="Add or remove mod jars"
          aria-expanded={menuOpen}
        >
          ▾
        </button>
        {menu}
      </div>
    </div>
  );
}
