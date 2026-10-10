import type { ReactNode } from "react";

// Icon set of the "Папір" prototype (docs/concepts/v2/ed.js), 24px grid, 1.7 stroke.
const PATHS = {
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  down: <><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  checks: <><path d="m3 7 2 2 3-4" /><path d="m3 16 2 2 3-4" /><path d="M12 7h9" /><path d="M12 16h9" /></>,
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />,
  structure: <><path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h13" /></>,
  clarity: <path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5-1.9-5.5-5.6-2 5.6-2Z" />,
  interest: <><path d="M9.5 18h5" /><path d="M10.5 21h3" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" /></>,
  visual: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-8 8" /></>,
  accent: <><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z" /><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z" /></>,
  spell: <><path d="m4 16 4-10 4 10" /><path d="M5.5 12.5h5" /><path d="m14 17 2.5 2.5L21 14" /></>,
  italic: <><path d="M10 5h7" /><path d="M7 19h7" /><path d="m14 5-4 14" /></>,
  list: <><path d="M9 7h11" /><path d="M9 12h11" /><path d="M9 17h11" /><path d="M4.5 7h.01" /><path d="M4.5 12h.01" /><path d="M4.5 17h.01" /></>,
  orderedList: <><path d="M10 7h10" /><path d="M10 12h10" /><path d="M10 17h10" /><path d="M4 5.5 5.5 5v4" /><path d="M4 14.6c0-1.1 2.5-1.1 2.5.1 0 .9-2.5 1.5-2.5 2.8h2.7" /></>,
  box: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8" /><path d="M8 14h5" /></>,
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  fact: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  x: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  more: <><circle cx="5" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="19" cy="12" r="1.1" fill="currentColor" /></>
} satisfies Record<string, ReactNode>;

export type V2IconName = keyof typeof PATHS;

export function V2Icon({ name, size = 16 }: { name: V2IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
