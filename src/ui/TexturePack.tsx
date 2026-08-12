import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { IconClose, IconTexture } from "./icons";

/**
 * Block models and textures come from the user's own Minecraft install —
 * nothing ships with the app. On the dev server the newest installed version
 * is picked up automatically; otherwise a jar or resource pack is chosen here.
 */
export function TexturePack() {
  const status = useStore((s) => s.packStatus);
  const name = useStore((s) => s.packName);
  const counts = useStore((s) => s.packCounts);
  const source = useStore((s) => s.packSource);
  const enabled = useStore((s) => s.texturesEnabled);
  const baking = useStore((s) => s.baking);
  const missing = useStore((s) => s.missingModels);
  const versions = useStore((s) => s.installedVersions);
  const input = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void useStore.getState().autoLoadResourcePack();
  }, []);

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".jar,.zip"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) useStore.getState().loadResourcePack(file);
        e.target.value = "";
      }}
    />
  );

  /** Shared by the loaded chip and the not-yet-loaded button. */
  const menu = menuOpen && (
    <>
      <div className="pack-menu-backdrop" onClick={() => setMenuOpen(false)} />
      <div className="pack-menu" role="menu">
        {versions.length > 0 && (
          <div className="eyebrow" style={{ padding: "2px 10px 6px" }}>Installed versions</div>
        )}
        {versions.map((version) => (
          <button
            key={version.id}
            className="pack-menu-item"
            data-current={name === `${version.id}.jar`}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              useStore.getState().useInstalledVersion(version.id);
            }}
          >
            <span>{version.id}</span>
            <span className="num">{Math.round(version.size / 1024 / 1024)} MB</span>
          </button>
        ))}
        <button
          className="pack-menu-item"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            input.current?.click();
          }}
        >
          <span>Choose a file…</span>
        </button>
      </div>
    </>
  );

  if (status === "ready" && name) {
    const summary = counts
      ? `${counts.blockstates} blockstates · ${counts.models} models · ${counts.textures} textures`
      : "";
    const origin =
      source === "auto" ? "Found in your Minecraft folder"
      : source === "cache" ? "Restored from your last session"
      : "Loaded from a file you picked";
    const unresolved = missing.length
      ? `\n${missing.length} block${missing.length === 1 ? "" : "s"} without a model: ` +
        missing.slice(0, 6).map((id) => id.replace("minecraft:", "")).join(", ") +
        (missing.length > 6 ? "…" : "")
      : "";

    return (
      <div className="pack-chip" data-off={!enabled}>
        {picker}
        <button
          className="pack-toggle"
          onClick={() => useStore.getState().setTexturesEnabled(!enabled)}
          title={`${enabled ? "Switch back to flat colours" : "Switch to pack textures"}\n${origin}\n${summary}${unresolved}`}
          aria-pressed={enabled}
        >
          <IconTexture />
          <span className="pack-name">{baking ? "Baking models…" : name}</span>
        </button>

        <div className="pack-menu-wrap">
          <button
            className="btn pack-more"
            onClick={() => setMenuOpen((open) => !open)}
            title="Use a different version or file"
            aria-expanded={menuOpen}
          >
            ▾
          </button>
          {menu}
        </div>

        <button
          className="btn pack-more"
          onClick={() => useStore.getState().clearResourcePack()}
          title="Unload — go back to flat colours and stop looking for an install"
          aria-label="Unload this pack"
        >
          <IconClose size={13} />
        </button>
      </div>
    );
  }

  // Nothing loaded. If the dev server found installs, offer them directly
  // rather than making the file picker the only way back.
  if (versions.length > 0 && status !== "loading") {
    const [newest] = versions;
    return (
      <div className="pack-chip">
        {picker}
        <button
          className="pack-toggle"
          onClick={() => useStore.getState().useInstalledVersion(newest.id)}
          title={`Render with the blocks from your installed ${newest.id}`}
        >
          <IconTexture />
          <span className="pack-name">Use {newest.id}</span>
        </button>
        <div className="pack-menu-wrap">
          <button
            className="btn pack-more"
            onClick={() => setMenuOpen((open) => !open)}
            title="Use a different version or file"
            aria-expanded={menuOpen}
          >
            ▾
          </button>
          {menu}
        </div>
      </div>
    );
  }

  return (
    <>
      {picker}
      <button
        className="btn"
        onClick={() => input.current?.click()}
        disabled={status === "loading"}
        title={
          "Load block models and textures from your own copy of Minecraft.\n" +
          "Works with a client .jar or a resource pack .zip."
        }
      >
        <IconTexture />
        {status === "loading" ? "Reading textures…" : "Add textures"}
      </button>
    </>
  );
}
