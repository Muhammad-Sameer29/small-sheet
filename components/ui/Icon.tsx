// A small hand-drawn icon set on a 16px grid, stroked with currentColor so icons take the
// colour of whatever they sit in.
const PATHS = {
  undo: "M5.5 4 2.5 7l3 3M3 7h6.5a3.5 3.5 0 0 1 0 7H8",
  redo: "M10.5 4l3 3-3 3M13 7H6.5a3.5 3.5 0 0 0 0 7H8",
  freeze: "M2.5 2.5h11v11h-11zM6 2.5v11M6 6h7.5M6 10h7.5",
  keyboard: "M1.5 4.5h13v7h-13zM4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6",
  plus: "M8 3v10M3 8h10",
  check: "M3.5 8.5l3 3 6-7",
  alert: "M8 2.5 14 13H2zM8 6.5v3M8 11.25h.01",
  refresh: "M13 3v3.5H9.5M12.6 6.5A5 5 0 1 0 13 9",
  close: "M4 4l8 8M12 4l-8 8",
  cloud: "M4.5 12.5a3 3 0 0 1-.4-6A4 4 0 0 1 12 6.6a2.9 2.9 0 0 1 0 5.9z",
  grid: "M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5",
  sun: "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z",
  fx: "M10 2.5c-1.6 0-2.2.9-2.5 2.5L6 12c-.3 1.4-.9 1.8-2 1.8M4.5 6.5h5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
