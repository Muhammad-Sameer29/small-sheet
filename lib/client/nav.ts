import { keyOf, type Pos } from "../engine/address";
import type { SheetEngine } from "../engine/engine";

export const clampPos = (p: Pos, rows: number, cols: number): Pos => ({
  r: Math.max(0, Math.min(rows - 1, p.r)),
  c: Math.max(0, Math.min(cols - 1, p.c)),
});

// Ctrl/Cmd+Arrow: to the end of the current block of filled cells, or to the start of the
// next one, or to the edge of the sheet when there's nothing in the way.
export function jump(engine: SheetEngine, from: Pos, dr: number, dc: number): Pos {
  const filled = (r: number, c: number) => engine.cells.has(keyOf(r, c));
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < engine.rows && c < engine.cols;
  let { r, c } = from;
  if (!inside(r + dr, c + dc)) return from;

  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
      r += dr;
      c += dc;
    }
    return { r, c };
  }
  r += dr;
  c += dc;
  while (inside(r + dr, c + dc) && !filled(r, c)) {
    r += dr;
    c += dc;
  }
  return { r, c };
}
