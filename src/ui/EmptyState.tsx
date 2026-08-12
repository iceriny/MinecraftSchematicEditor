import { useRef, useState } from "react";
import { useStore } from "../store";
import { ACCEPTED_EXTENSIONS } from "../formats";
import { describeAge } from "../core/session";
import { IconOpen } from "./icons";
import { NewBuildDialog } from "./NewBuildDialog";

export function EmptyState() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const packStatus = useStore((s) => s.packStatus);
  const packName = useStore((s) => s.packName);
  const [over, setOver] = useState(false);
  const [newBuild, setNewBuild] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const packLine =
    packStatus === "ready" && packName
      ? `Rendering with the blocks from ${packName}.`
      : packStatus === "loading"
        ? "Looking for your Minecraft install…"
        : "Add a client .jar or resource pack for the real vanilla look.";

  return (
    <div className="empty">
      <div className="empty-card">
        <RestoreOffer />
        <span className="eyebrow">Litematica · WorldEdit · Structure block</span>
        <div className="empty-rule" />
        <h1>
          Measure, re-skin and<br />
          strip back <em>your build</em>
        </h1>
        <p>
          Open a schematic to walk through it at scale, read its exact extents off the
          dimension frame, swap any material for another, and delete what you don't want.
        </p>

        <div
          className="dropzone"
          data-over={over}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) useStore.getState().openAny(file);
          }}
        >
          <div className="dropzone-text">
            <div>{status === "loading" ? "Reading your build…" : "Drop a schematic here"}</div>
            <div className="dropzone-formats">{ACCEPTED_EXTENSIONS.join("   ")}</div>
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) useStore.getState().openAny(file);
              e.target.value = "";
            }}
          />
          <button className="btn btn-primary" onClick={() => input.current?.click()}>
            <IconOpen /> Choose a file
          </button>
        </div>

        <p style={{ color: "var(--dim)", margin: "10px 0 0", fontSize: 12 }}>
          Nothing to open yet?{" "}
          <button className="link" onClick={() => setNewBuild(true)}>
            Start from an empty box
          </button>
          .
        </p>
        {newBuild && <NewBuildDialog onClose={() => setNewBuild(false)} />}

        {error && <div className="empty-error">{error}</div>}

        <div className="empty-legend">
          <span className="legend-item">
            <b>Everything stays local</b>
            <span>Files are parsed in your browser, never uploaded.</span>
          </span>
          <span className="legend-item">
            <b>Round-trips back out</b>
            <span>Save to .litematic, .schem or .nbt when you're done.</span>
          </span>
          <span className="legend-item">
            <b>Your own textures</b>
            <span>{packLine}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * What was open when the tab last closed. Restoring is offered rather than done
 * automatically — silently reopening someone's last build over a fresh tab is
 * the kind of helpfulness nobody asked for.
 */
function RestoreOffer() {
  const session = useStore((s) => s.session);
  if (!session) return null;

  const name = session.fileName ?? session.meta.name ?? "an unsaved build";
  return (
    <div className="restore">
      <div className="restore-text">
        <b>Pick up where you left off</b>
        <span>
          {name} · {session.width}×{session.height}×{session.length} ·{" "}
          {session.blocks.toLocaleString()} blocks · saved {describeAge(session.savedAt)}
        </span>
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={() => useStore.getState().restoreSession()}>
          Restore
        </button>
        <button className="btn" onClick={() => void useStore.getState().dismissSession()}>
          Discard
        </button>
      </div>
    </div>
  );
}
