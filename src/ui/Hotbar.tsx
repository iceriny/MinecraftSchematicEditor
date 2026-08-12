import { useState } from "react";
import { useStore, HOTBAR_SLOTS } from "../store";
import { cssColor } from "../core/blockLook";
import { displayName, propertySummary, type BlockState } from "../core/model";
import { BlockPicker } from "./BlockPicker";

/**
 * Nine materials on the number keys. Changing what you are placing is the most
 * frequent thing anyone does in a build, and routing every change through the
 * picker dialog made it the slowest.
 *
 * One slot is *in hand* rather than merely matching the paint material, and it
 * follows that material wherever it goes — the picker, the eyedropper, a turn of
 * a stair. A hotbar that only ever showed what the build held when it opened was
 * a display; this one is where the block you are holding actually lives.
 */
export function Hotbar() {
  const build = useStore((s) => s.build);
  const hotbar = useStore((s) => s.hotbar);
  const held = useStore((s) => s.hotbarSlot);
  const paint = useStore((s) => s.paintMaterial);
  // Which slot the picker was opened for; null while it is closed.
  const [picking, setPicking] = useState<number | null>(null);
  if (!build) return null;

  const paintState = paint !== null ? build.palette[paint] : null;

  return (
    <div className="hotbar" role="toolbar" aria-label="Material hotbar">
      {Array.from({ length: HOTBAR_SLOTS }, (_, slot) => {
        const state = hotbar[slot];
        const active = slot === held;
        return (
          <button
            key={slot}
            className="hotbar-slot"
            data-active={active}
            data-empty={state === null}
            aria-pressed={active}
            title={
              (state
                ? `${displayName(state)} — click or press ${slot + 1} to hold it.`
                : `Empty slot ${slot + 1} — click to drop the paint material in.`) +
              `\nRight-click to choose a different block for this slot.` +
              `\nShift-click to overwrite it with the paint material.` +
              (active ? `\nThis is the slot in hand: what you pick up lands here.` : "")
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setPicking(slot);
            }}
            onClick={(e) => {
              // An empty slot has nothing to hand over, so a plain click fills
              // it; `useHotbarSlot` does that itself, but Shift means overwrite
              // whatever is already there.
              if (e.shiftKey) useStore.getState().assignHotbarSlot(slot);
              else useStore.getState().useHotbarSlot(slot);
            }}
          >
            <i className="swatch" style={{ background: state ? cssColor(state) : "transparent" }} />
            <span className="hotbar-key">{slot + 1}</span>
          </button>
        );
      })}
      <span className="hotbar-label">
        {paintState ? displayName(paintState) : "No paint material"}
        {/* Orientation is the difference between two otherwise identical
            materials, so it is said here rather than left to the panel. */}
        {paintState && propertySummary(paintState) && (
          <span className="material-detail"> {propertySummary(paintState)}</span>
        )}
      </span>

      {picking !== null && (
        <BlockPicker
          title={`Slot ${picking + 1}`}
          onPick={(state: BlockState) => {
            const store = useStore.getState();
            store.assignHotbarSlot(picking, state);
            // Choosing a block for a slot is choosing the block: take it in hand
            // rather than filing it away and making you press the number too.
            store.useHotbarSlot(picking);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
