import { useStore } from "../store";
import {
  MIRROR_AXES, mirrorActive, mirrorCopies, planePosition,
} from "../core/mirror";
import { formatCentre } from "../core/measure";
import { Section } from "./Section";

/**
 * Symmetry mode. A tower, a gatehouse, a cathedral front — anything with a
 * centre line is half the work if the other half draws itself, and the
 * blockstates are turned as they go so the mirrored stairs and doors face back
 * the way they came.
 */
export function MirrorPanel() {
  const build = useStore((s) => s.build);
  const mirror = useStore((s) => s.mirror);
  const store = useStore.getState();
  if (!build) return null;

  const on = mirrorActive(mirror);
  const copies = mirrorCopies(mirror);

  return (
    <Section
      id="mirror"
      title="Mirror"
      summary={on ? <span className="fold-on">×{copies}</span> : <span className="fold-quiet">off</span>}
      tools={["place", "erase", "paint"]}
      help="Draw one half and the other half follows, with stairs and doors turned back the way they came. A plane on a seam mirrors between two blocks; on a block it mirrors through that column."
    >
      <div className="field">
        <span className="field-label">Planes</span>
        <div className="segmented">
          {MIRROR_AXES.map((axis) => (
            <button
              key={axis.name}
              className="segment"
              data-active={mirror.axes[axis.index]}
              title={axis.hint}
              onClick={() => store.setMirrorAxis(axis.index, !mirror.axes[axis.index])}
            >
              {axis.name}
            </button>
          ))}
        </div>
        {on && (
          <span className="num" style={{ fontSize: 11, color: "var(--chalk)" }}>
            every stroke ×{copies}
          </span>
        )}
      </div>

      {on && (
        <>
          <div className="grow-grid">
            {MIRROR_AXES.filter((axis) => mirror.axes[axis.index]).map((axis) => (
              <div className="mirror-row" key={axis.name}>
                <span className={`grow-axis ${axis.className}`}>{axis.name}</span>
                <span className="num centre-value">
                  {formatCentre(planePosition(mirror.pivot[axis.index]))}
                </span>
                <span className="stepper" title={`Slide the ${axis.name} plane half a block`}>
                  <button
                    className="stepper-btn"
                    onClick={() => store.nudgeMirrorPivot(axis.index, -1)}
                    aria-label={`Move the ${axis.name} plane down`}
                  >
                    −
                  </button>
                  <span className="stepper-value" data-zero={false}>
                    {mirror.pivot[axis.index] % 2 === 0 ? "block" : "seam"}
                  </span>
                  <button
                    className="stepper-btn"
                    onClick={() => store.nudgeMirrorPivot(axis.index, 1)}
                    aria-label={`Move the ${axis.name} plane up`}
                  >
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>

          <div className="actions" style={{ marginTop: 8 }}>
            <button
              className="btn btn-outline"
              onClick={() => store.recentreMirror()}
              title="Put every plane back on the middle of the build"
            >
              Recentre
            </button>
            <button className="btn" onClick={() => store.clearMirror()}>
              Turn off
            </button>
          </div>
        </>
      )}

      {!on && (
        <p className="fold-note">
          Pick an axis above to mirror across the middle of the build.
        </p>
      )}
    </Section>
  );
}
