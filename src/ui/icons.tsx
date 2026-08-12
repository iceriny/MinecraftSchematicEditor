/** 16px line icons, drawn on a 16-unit grid to stay crisp at 1x. */

interface Props {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconCursor = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 2.2 12.4 7.6l-4 1.1-1.7 4z" />
  </svg>
);

export const IconEraser = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8.4 3.1 3.2 8.3a1.4 1.4 0 0 0 0 2l1.9 1.9h3.3l4.6-4.6a1.4 1.4 0 0 0 0-2l-2.6-2.5a1.4 1.4 0 0 0-2 0Z" />
    <path d="M5.9 5.6 10.6 10.3" />
    <path d="M2.6 13.6h10.8" />
  </svg>
);

export const IconBrush = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M11.2 2.4 6.5 7.1l2.4 2.4 4.7-4.7a1.7 1.7 0 0 0-2.4-2.4Z" />
    <path d="M6.2 9.1c-1.3-.3-2.6.5-2.9 1.8-.2.9-.7 1.4-1.3 1.6 1 .9 2.4 1.2 3.6.7 1.2-.5 1.8-1.8 1.5-3Z" />
  </svg>
);

export const IconDropper = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M13.4 2.6a1.9 1.9 0 0 0-2.7 0l-1 1-.8-.8-1.2 1.2.8.8-5 5v2.7h2.7l5-5 .8.8 1.2-1.2-.8-.8 1-1a1.9 1.9 0 0 0 0-2.7Z" />
  </svg>
);

/** Place: a cube going in, with the plus of an addition. */
export const IconPlace = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M6.6 5.4 11 7.9v4.4l-4.4 2.4-4.4-2.5V7.8Z" />
    <path d="M2.2 7.8 6.6 10.3 11 7.9M6.6 10.3v4.4" opacity=".55" />
    <path d="M12.4 2v4.4M10.2 4.2h4.4" />
  </svg>
);

/** Clone: the stacked-sheets mark, for copy and stamp. */
export const IconClone = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="5.8" y="5.8" width="7.8" height="7.8" rx="1" />
    <path d="M10.2 5.8V3.4a1 1 0 0 0-1-1H3.4a1 1 0 0 0-1 1v5.8a1 1 0 0 0 1 1h2.4" opacity=".7" />
  </svg>
);

/** Stairs: the stepped profile a flight cuts, drawn in section. */
export const IconStairs = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.4 13.6V10.8h3V8h3V5.2h3V2.4h2.2" />
    <path d="M2.4 13.6h11.2" opacity=".55" />
  </svg>
);

/** Ruler: the scale rule, ticks and all. */
export const IconRuler = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.6" y="5.4" width="12.8" height="5.2" rx="1" />
    <path d="M4.4 5.4v2.1M7 5.4v3M9.6 5.4v2.1M12.2 5.4v3" opacity=".7" />
  </svg>
);

export const IconMarquee = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.4 5V2.4H5M11 2.4h2.6V5M13.6 11v2.6H11M5 13.6H2.4V11" />
    <path d="M7.2 2.4h1.6M2.4 7.2v1.6M13.6 7.2v1.6M7.2 13.6h1.6" opacity=".55" />
  </svg>
);

/** Floor: a slab seen in plan-oblique, with the thickness of one course. */
export const IconFloor = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 2.8 14.6 6.4 8 10 1.4 6.4Z" />
    <path d="M1.4 6.4v2.4L8 12.4l6.6-3.6V6.4" opacity=".6" />
    <path d="M8 10v2.4" opacity=".45" />
  </svg>
);

/**
 * Select through: the marquee corners, with a block in front and one behind it
 * — the hidden one being the whole point of the tool.
 */
export const IconThrough = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.2 5V2.4h2.6M11.2 2.4h2.6V5M13.8 11v2.6h-2.6M4.8 13.6H2.2V11" />
    <rect x="4.4" y="4.4" width="4" height="4" rx=".6" />
    <rect x="8.2" y="8" width="3.4" height="3.4" rx=".6" opacity=".45" />
  </svg>
);

/** Push: a round brush with the blocks it is shoving ahead of it. */
export const IconPush = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="5.4" cy="8" r="3.6" />
    <path d="M10.2 8h3.8" />
    <path d="M11.9 6 13.9 8l-2 2" />
  </svg>
);

export const IconOrbit = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="2.5" />
    <ellipse cx="8" cy="8" rx="6.1" ry="2.7" transform="rotate(-28 8 8)" />
  </svg>
);

export const IconFly = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 1.9 14 8l-6 6.1L2 8Z" />
    <path d="M8 4.6 11.3 8 8 11.4 4.7 8Z" opacity=".55" />
  </svg>
);

export const IconFrame = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.4 5.6V2.4h3.2M10.4 2.4h3.2v3.2M13.6 10.4v3.2h-3.2M5.6 13.6H2.4v-3.2" />
    <rect x="6.2" y="6.2" width="3.6" height="3.6" />
  </svg>
);

export const IconUndo = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 7.2h6.4a3.4 3.4 0 1 1 0 6.8H6.6" />
    <path d="M5.6 4.4 2.8 7.2l2.8 2.8" />
  </svg>
);

export const IconRedo = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M13 7.2H6.6a3.4 3.4 0 1 0 0 6.8h2.8" />
    <path d="M10.4 4.4l2.8 2.8-2.8 2.8" />
  </svg>
);

export const IconDownload = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 2.6v7.2" />
    <path d="M5.2 7.4 8 10.2l2.8-2.8" />
    <path d="M2.8 11.6v1.8h10.4v-1.8" />
  </svg>
);

export const IconOpen = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.4 12.4V4.2a.9.9 0 0 1 .9-.9h2.8l1.4 1.7h4.2a.9.9 0 0 1 .9.9v6.5a.9.9 0 0 1-.9.9H3.3a.9.9 0 0 1-.9-.9Z" />
  </svg>
);

/** Import: something moving into a box that is already there. */
export const IconImport = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M9.6 2.6h2.8a1 1 0 0 1 1 1v8.8a1 1 0 0 1-1 1H9.6" />
    <path d="M2.4 8h6.4" />
    <path d="M6.4 5.6 8.8 8l-2.4 2.4" />
  </svg>
);

export const IconClose = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const IconLayers = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 2.2 14 5.3 8 8.4 2 5.3Z" />
    <path d="M2 8.7 8 11.8l6-3.1" opacity=".6" />
    <path d="M2 11.6 8 14.7l6-3.1" opacity=".35" />
  </svg>
);

export const IconTexture = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1" />
    <path d="M2.4 6.1h11.2M2.4 9.9h11.2M6.1 2.4v11.2M9.9 2.4v11.2" opacity=".55" />
  </svg>
);

/** Mods: a jigsaw piece, the icon every launcher already uses for them. */
export const IconMod = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 6.2h1.9a1.5 1.5 0 1 1 2.9 0H9.7v2a1.5 1.5 0 1 1 0 2.9v1.5H3Z" />
    <path d="M9.7 6.2H13v6.4" opacity=".55" />
  </svg>
);

/** The app mark: an isometric cube with one face lifted away. */
export const Mark = ({ size = 18 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M10 2.6 17 6.4v7.2L10 17.4 3 13.6V6.4Z" stroke="#4c7ff0" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M10 2.6 17 6.4 10 10.2 3 6.4Z" fill="#4c7ff0" fillOpacity=".28" />
    <path d="M10 10.2v7.2" stroke="#4c7ff0" strokeWidth="1.2" opacity=".55" />
  </svg>
);
