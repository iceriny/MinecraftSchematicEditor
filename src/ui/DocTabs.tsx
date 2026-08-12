import { useRef, useState } from "react";
import { useStore } from "../store";
import { ACCEPTED_EXTENSIONS } from "../formats";
import { IconClose, IconOpen } from "./icons";
import { NewBuildDialog } from "./NewBuildDialog";

/**
 * One tab per open schematic.
 *
 * A piece that arrives the wrong height or width has to be cut down before it
 * can go anywhere, and doing that inside the build you are working on means
 * resizing the wrong box. So it opens beside it instead: edit it on its own
 * terms, copy it, and stamp it across. The clipboard is shared between tabs,
 * which is the only reason any of this is useful.
 */
export function DocTabs() {
  const docs = useStore((s) => s.docs);
  const active = useStore((s) => s.activeDoc);
  const importing = useStore((s) => s.importing);
  const input = useRef<HTMLInputElement>(null);
  const [newBuild, setNewBuild] = useState(false);

  if (docs.length === 0) return null;

  return (
    <div className="doctabs" role="tablist" aria-label="Open schematics">
      {docs.map((doc) => (
        <div
          key={doc.id}
          className="doctab"
          data-active={doc.id === active}
          role="tab"
          aria-selected={doc.id === active}
          title={`${doc.name} · ${doc.size.join(" × ")}`}
        >
          <button className="doctab-name" onClick={() => useStore.getState().switchDoc(doc.id)}>
            <span className="doctab-label">{doc.name}</span>
            <span className="num doctab-size">
              <span className="ax-x">{doc.size[0]}</span>
              <span className="doctab-x">×</span>
              <span className="ax-y">{doc.size[1]}</span>
              <span className="doctab-x">×</span>
              <span className="ax-z">{doc.size[2]}</span>
            </span>
          </button>
          <button
            className="doctab-close"
            onClick={() => useStore.getState().closeDoc(doc.id)}
            title="Close this tab"
            aria-label={`Close ${doc.name}`}
          >
            <IconClose />
          </button>
        </div>
      ))}

      <input
        ref={input}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void useStore.getState().openInNewTab(file);
          e.target.value = "";
        }}
      />
      <button
        className="btn doctab-add"
        disabled={importing}
        onClick={() => input.current?.click()}
        title="Open another schematic in its own tab — this build stays as it is"
      >
        <IconOpen /> Open in a tab
      </button>
      <button
        className="btn doctab-add"
        onClick={() => setNewBuild(true)}
        title="Start an empty canvas in its own tab"
      >
        + Empty tab
      </button>
      {newBuild && <NewBuildDialog inNewTab onClose={() => setNewBuild(false)} />}

      <span className="doctabs-spacer" />
      <ClipNote />
    </div>
  );
}

/**
 * What is on the clipboard, since that is the thing that crosses between tabs
 * and there is otherwise no sign of it until you reach the clone tool.
 */
function ClipNote() {
  const clip = useStore((s) => s.clip);
  const docs = useStore((s) => s.docs);
  if (!clip || docs.length < 2) return null;
  return (
    <span className="doctabs-note" title="Switch tab, press C for the clone tool, then Enter to stamp">
      Clipboard{" "}
      <span className="num">
        {clip.width}×{clip.height}×{clip.length}
      </span>{" "}
      · travels between tabs
    </span>
  );
}
