import type { ReactNode } from "react";
import { create } from "zustand";
import type { Tool } from "../store";
import { toolNames } from "./tools";

/**
 * The panel below the material list holds every tool's settings, and there are
 * enough of them now that a flat stack of unlabelled blocks is unreadable: you
 * cannot tell where the clipboard's controls end and the canvas's begin, and a
 * long one pushes the rest off the bottom.
 *
 * So each block is a named section that folds away. The heading carries the one
 * figure worth seeing while it is shut — the paint block, the size of the
 * selection, whether mirroring is on — so folding costs no information, and the
 * prose that explains the section hides behind the `?` rather than taking up
 * room forever.
 */

const STORAGE_KEY = "schematic-editor:sections";

interface Stored {
  /** Only sections the reader has actually clicked; the rest follow their default. */
  open: Record<string, boolean>;
  help: Record<string, boolean>;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: {}, help: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return { open: parsed.open ?? {}, help: parsed.help ?? {} };
  } catch {
    return { open: {}, help: {} };
  }
}

function write(state: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage denied; the layout just won't outlive this session.
  }
}

interface SectionStore extends Stored {
  toggle: (id: string, fallback: boolean) => void;
  toggleHelp: (id: string) => void;
  setAll: (open: boolean, ids: string[]) => void;
}

const useSections = create<SectionStore>((set, get) => ({
  ...read(),

  toggle: (id, fallback) => {
    const open = { ...get().open, [id]: !(get().open[id] ?? fallback) };
    set({ open });
    write({ open, help: get().help });
  },

  toggleHelp: (id) => {
    const help = { ...get().help, [id]: !get().help[id] };
    set({ help });
    write({ open: get().open, help });
  },

  setAll: (value, ids) => {
    const open = { ...get().open };
    for (const id of ids) open[id] = value;
    set({ open });
    write({ open, help: get().help });
  },
}));

/** Whether a section is open, honouring its default until someone says otherwise. */
export function useSectionOpen(id: string, fallback: boolean): boolean {
  return useSections((s) => s.open[id] ?? fallback);
}

/** Is anything still unfolded? Decides whether the one button folds or opens. */
export function useAnySectionOpen(sections: { id: string; closed?: boolean }[]): boolean {
  return useSections((s) => sections.some((entry) => s.open[entry.id] ?? !entry.closed));
}

export function setSectionsOpen(open: boolean, ids: string[]) {
  useSections.getState().setAll(open, ids);
}

/** Fold anything that keeps its state here, section or not — the HUD uses it too. */
export function toggleSection(id: string, fallback: boolean) {
  useSections.getState().toggle(id, fallback);
}

interface Props {
  /** Stable across renames — it is the storage key for the fold state. */
  id: string;
  title: string;
  /** The figure worth reading with the section shut: a size, a count, a name. */
  summary?: ReactNode;
  /** Which tools these settings govern, named in the help line. */
  tools?: Tool[];
  /** Keys that do the same job, listed beside the title. */
  keys?: string[];
  /** The explanation, behind the `?`. */
  help?: ReactNode;
  /** Shut by default — reference readouts rather than things you reach for. */
  closed?: boolean;
  /** Marked as the section belonging to the tool in hand. */
  current?: boolean;
  children: ReactNode;
}

export function Section({
  id, title, summary, tools, keys, help, closed, current, children,
}: Props) {
  const open = useSectionOpen(id, !closed);
  const showHelp = useSections((s) => s.help[id] ?? false);
  const store = useSections.getState();
  const body = `section-${id}`;

  return (
    <section className="fold" data-open={open} data-current={!!current}>
      <div className="fold-head">
        <button
          className="fold-toggle"
          onClick={() => store.toggle(id, !closed)}
          aria-expanded={open}
          aria-controls={body}
          title={open ? "Fold this away" : "Open this section"}
        >
          <Chevron open={open} />
          <span className="fold-title">{title}</span>
          {keys?.map((key) => <kbd key={key}>{key}</kbd>)}
          {summary !== undefined && <span className="fold-summary">{summary}</span>}
        </button>
        {(help || tools) && (
          <button
            className="fold-help-btn"
            data-active={showHelp}
            onClick={() => store.toggleHelp(id)}
            aria-expanded={showHelp}
            aria-label={`What ${title} does`}
            title={`What ${title} does`}
          >
            ?
          </button>
        )}
      </div>

      <div className="fold-body" id={body} hidden={!open}>
        {showHelp && (help || tools) && (
          <p className="fold-help">
            {help}
            {tools && (
              <span className="fold-scope">
                {help ? " " : ""}Applies to the {toolNames(tools)} tool{tools.length > 1 ? "s" : ""}.
              </span>
            )}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="fold-chevron"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-open={open}
    >
      <path d="M3 1.6 6.6 5 3 8.4" />
    </svg>
  );
}
