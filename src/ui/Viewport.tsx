import { useEffect, useRef } from "react";
import { Viewer } from "../render/Viewer";
import { useStore } from "../store";

/** Owns the three.js canvas and forwards its events into the store. */
export function Viewport() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewer = new Viewer(host.current!);
    const store = useStore.getState();

    viewer.onHover = (hit) => useStore.getState().hoverAt(hit);

    viewer.onPick = (hit, event) => {
      useStore.getState().applyTool(hit, {
        shift: event.shiftKey,
        alt: event.altKey,
        drag: event.type === "pointermove",
      });
    };
    viewer.onStrokeStart = () => useStore.getState().beginStroke();
    viewer.onStrokeEnd = () => useStore.getState().endStroke();

    viewer.onMarquee = (found, additive) => {
      useStore.getState().selectThrough(found, additive);
    };

    let lastRemaining = 0;
    viewer.onProgress = (remaining) => {
      // Only push to React when the readout would actually change.
      if (remaining === lastRemaining) return;
      lastRemaining = remaining;
      useStore.getState().setMeshingRemaining(remaining);
    };

    store.attachViewer(viewer);
    return () => {
      useStore.getState().attachViewer(null);
      viewer.dispose();
    };
  }, []);

  return <div className="viewer" ref={host} />;
}
