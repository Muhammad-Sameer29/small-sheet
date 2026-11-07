// Cells are addressed zero-based internally (r, c) and as "B7" everywhere a person sees them.

export interface Pos {
  r: number;
  c: number;
}

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

// Packs a position into one number so maps stay cheap. 16384 is Excel's column limit,
// far more than any sheet here will have.
export const STRIDE = 16384;

export const keyOf = (r: number, c: number) => r * STRIDE + c;
export const rowOf = (key: number) => Math.floor(key / STRIDE);
export const colOf = (key: number) => key % STRIDE;

export function colName(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const addr = (r: number, c: number) => colName(c) + (r + 1);
export const addrOfKey = (key: number) => addr(rowOf(key), colOf(key));

const ADDR_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

export function parseAddr(text: string): Pos | null {
  const m = ADDR_RE.exec(text.trim());
  if (!m) return null;
  const r = parseInt(m[2], 10) - 1;
  if (r < 0) return null;
  return { r, c: colIndex(m[1]) };
}

export function parseRange(text: string): Rect | null {
  const parts = text.trim().split(":");
  if (parts.length > 2) return null;
  const a = parseAddr(parts[0]);
  const b = parts.length === 2 ? parseAddr(parts[1]) : a;
  if (!a || !b) return null;
  return normRect(a, b);
}

export function normRect(a: Pos, b: Pos): Rect {
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

export function rectAddr(rect: Rect): string {
  const a = addr(rect.r1, rect.c1);
  if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return a;
  return `${a}:${addr(rect.r2, rect.c2)}`;
}

export const rectArea = (rect: Rect) => (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);

export const inRect = (rect: Rect, r: number, c: number) =>
  r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
