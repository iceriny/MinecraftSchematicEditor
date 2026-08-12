import { useRef, useState } from "react";
import { useStore } from "../store";
import { ACCEPTED_EXTENSIONS, type SaveFormat } from "../formats";
import {
  IconClose, IconDownload, IconImport, IconOpen, IconRedo, IconUndo, Mark,
} from "./icons";
import { TexturePack } from "./TexturePack";
import { ModPacks } from "./ModPacks";
import { NewBuildDialog } from "./NewBuildDialog";

const SAVE_FORMATS: { id: SaveFormat; label: string }[] = [
  { id: "litematic", label: "Litematica" },
  { id: "schem", label: "WorldEdit" },
  { id: "nbt", label: "Structure" },
];

export function TopBar() {
  const build = useStore((s) => s.build);
  const fileName = useStore((s) => s.fileName);
  const undoStack = useStore((s) => s.undoStack);
  const redoStack = useStore((s) => s.redoStack);
  const importing = useStore((s) => s.importing);
  const input = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [newBuild, setNewBuild] = useState(false);

  const lastEdit = undoStack[undoStack.length - 1];

  return (
    <header className="topbar">
      <div className="mark">
        <Mark />
        <span className="mark-text">Schematic</span>
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) useStore.getState().openFile(file);
          e.target.value = "";
        }}
      />

      <button className="btn" onClick={() => input.current?.click()}>
        <IconOpen /> Open
      </button>

      <button
        className="btn"
        onClick={() => setNewBuild(true)}
        title={build ? "Start an empty build — this one is replaced" : "Start an empty build"}
      >
        New
      </button>

      {build && (
        <>
          <input
            ref={importInput}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) useStore.getState().importFile(file);
              e.target.value = "";
            }}
          />
          <button
            className="btn"
            disabled={importing}
            onClick={() => importInput.current?.click()}
            title="Bring another schematic into this build as a stamp, instead of replacing it"
          >
            <IconImport /> {importing ? "Importing…" : "Import"}
          </button>
        </>
      )}

      {newBuild && <NewBuildDialog onClose={() => setNewBuild(false)} />}

      {build && (
        <>
          <span className="file-name" title={fileName ?? ""}>{fileName}</span>
          <span className="file-format">{build.meta.format}</span>
        </>
      )}

      <span className="topbar-spacer" />

      <TexturePack />
      <ModPacks />

      {build && (
        <>
          <div className="topbar-group">
            <button
              className="btn"
              disabled={undoStack.length === 0}
              onClick={() => useStore.getState().undo()}
              title={lastEdit ? `Undo ${lastEdit.label.toLowerCase()}  (Ctrl+Z)` : "Nothing to undo"}
            >
              <IconUndo />
            </button>
            <button
              className="btn"
              disabled={redoStack.length === 0}
              onClick={() => useStore.getState().redo()}
              title="Redo  (Ctrl+Shift+Z)"
            >
              <IconRedo />
            </button>
          </div>

          <div className="topbar-group" style={{ marginLeft: 6 }}>
            <span className="eyebrow" style={{ marginRight: 6 }}>Save as</span>
            {SAVE_FORMATS.map((format) => (
              <button
                key={format.id}
                className="btn btn-outline"
                onClick={() => useStore.getState().download(format.id)}
                title={`Download a .${format.id} file`}
              >
                <IconDownload /> {format.label}
              </button>
            ))}
          </div>

          <button
            className="btn"
            onClick={() => useStore.getState().closeBuild()}
            title="Close this build"
            aria-label="Close this build"
            style={{ marginLeft: 4 }}
          >
            <IconClose />
          </button>
        </>
      )}
    </header>
  );
}
