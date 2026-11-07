import { addr, addrOfKey, colOf, inRect, keyOf, rectAddr, rectArea, rowOf, type Rect } from "./address";
import { parseFormula, type Node } from "./parse";
import { CellError, formatNumber, isError, type Value } from "./values";

export type CellKind = "text" | "number" | "formula";

export interface Cell {
  raw: string;
  kind: CellKind;
  value: Value;
  node?: Node;
  parseError?: string;
  refs?: number[];
  ranges?: Rect[];
}

const NUMBER_RE = /^[-+]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d*)?(?:[eE][-+]?\d+)?%?$/;

// "1,200", "$45.50", "12%", "-3e2" are numbers; anything else that isn't a formula is text.
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s || !/\d/.test(s) || !NUMBER_RE.test(s)) return null;
  const pct = s.endsWith("%");
  const n = parseFloat(s.replace(/[$,%]/g, ""));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

export function isFormula(raw: string) {
  return raw.length > 1 && raw[0] === "=";
}

export interface Stats {
  count: number;
  numbers: number;
  sum: number;
}

export class SheetEngine {
  readonly cells = new Map<number, Cell>();
  // precedent -> formulas that read it directly
  private dependents = new Map<number, Set<number>>();
  // formula -> the ranges it reads. Kept apart because a range can cover thousands of
  // cells and registering each one as a dependency would make SUM(A1:A10000) expensive.
  private rangeReaders = new Map<number, Rect[]>();

  constructor(
    readonly rows: number,
    readonly cols: number,
  ) {}

  load(entries: Iterable<[number, string]>) {
    for (const [key, raw] of entries) this.write(key, raw);
    const all = new Set<number>();
    for (const [key, cell] of this.cells) if (cell.kind === "formula") all.add(key);
    this.evaluate(all);
  }

  get(r: number, c: number): Cell | undefined {
    return this.cells.get(keyOf(r, c));
  }

  raw(key: number): string {
    return this.cells.get(key)?.raw ?? "";
  }

  // Applies a batch of edits and recalculates only what depends on them.
  // Returns how many formulas were re-evaluated, which the tests use to prove "only that".
  set(changes: Array<[number, string]>): number {
    const seeds: number[] = [];
    for (const [key, raw] of changes) {
      if (this.raw(key) === raw) continue;
      this.write(key, raw);
      seeds.push(key);
    }
    if (!seeds.length) return 0;
    const affected = this.collectAffected(seeds);
    this.evaluate(affected);
    return affected.size;
  }

  stats(rect: Rect): Stats {
    const s: Stats = { count: 0, numbers: 0, sum: 0 };
    const visit = (cell: Cell) => {
      s.count++;
      if (typeof cell.value === "number") {
        s.numbers++;
        s.sum += cell.value;
      }
    };
    if (rectArea(rect) <= this.cells.size) {
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++) {
          const cell = this.cells.get(keyOf(r, c));
          if (cell) visit(cell);
        }
    } else {
      for (const [key, cell] of this.cells) if (inRect(rect, rowOf(key), colOf(key))) visit(cell);
    }
    return s;
  }

  lastUsed(): { r: number; c: number } {
    let r = 0;
    let c = 0;
    for (const key of this.cells.keys()) {
      r = Math.max(r, rowOf(key));
      c = Math.max(c, colOf(key));
    }
    return { r, c };
  }

  private inBounds(r: number, c: number) {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
  }

  private write(key: number, raw: string) {
    const prev = this.cells.get(key);
    if (prev?.kind === "formula") this.unlink(key, prev);
    if (raw === "") {
      this.cells.delete(key);
      return;
    }
    if (isFormula(raw)) {
      const cell: Cell = { raw, kind: "formula", value: 0 };
      const parsed = parseFormula(raw.slice(1));
      if (parsed.ok) {
        cell.node = parsed.node;
        this.collectDeps(cell, parsed.node);
        this.link(key, cell);
      } else {
        cell.parseError = parsed.message;
      }
      this.cells.set(key, cell);
      return;
    }
    const n = parseNumber(raw);
    if (n !== null) this.cells.set(key, { raw, kind: "number", value: n });
    else this.cells.set(key, { raw, kind: "text", value: raw[0] === "'" ? raw.slice(1) : raw });
  }

  private collectDeps(cell: Cell, root: Node) {
    const refs = new Set<number>();
    const ranges: Rect[] = [];
    const walk = (n: Node) => {
      switch (n.k) {
        case "ref":
          if (this.inBounds(n.r, n.c)) refs.add(keyOf(n.r, n.c));
          break;
        case "range":
          if (this.inBounds(n.r1, n.c1) && this.inBounds(n.r2, n.c2)) ranges.push({ r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 });
          break;
        case "neg":
          walk(n.arg);
          break;
        case "bin":
          walk(n.left);
          walk(n.right);
          break;
        case "call":
          n.args.forEach(walk);
          break;
      }
    };
    walk(root);
    if (refs.size) cell.refs = [...refs];
    if (ranges.length) cell.ranges = ranges;
  }

  private link(key: number, cell: Cell) {
    for (const p of cell.refs ?? []) {
      let set = this.dependents.get(p);
      if (!set) this.dependents.set(p, (set = new Set()));
      set.add(key);
    }
    if (cell.ranges) this.rangeReaders.set(key, cell.ranges);
  }

  private unlink(key: number, cell: Cell) {
    for (const p of cell.refs ?? []) {
      const set = this.dependents.get(p);
      if (!set) continue;
      set.delete(key);
      if (!set.size) this.dependents.delete(p);
    }
    this.rangeReaders.delete(key);
  }

  // Every formula downstream of the changed cells, the changed formulas themselves included.
  private collectAffected(seeds: number[]): Set<number> {
    const seen = new Set<number>();
    const formulas = new Set<number>();
    const readers = [...this.rangeReaders];
    const stack = [...seeds];
    while (stack.length) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.cells.get(key)?.kind === "formula") formulas.add(key);
      const direct = this.dependents.get(key);
      if (direct) for (const d of direct) stack.push(d);
      if (readers.length) {
        const r = rowOf(key);
        const c = colOf(key);
        for (const [owner, rects] of readers) {
          for (const rect of rects) {
            if (inRect(rect, r, c)) {
              stack.push(owner);
              break;
            }
          }
        }
      }
    }
    return formulas;
  }

  // Evaluates a set of formulas in dependency order (Kahn's algorithm, so a 10,000-long
  // chain doesn't recurse 10,000 deep). Whatever can't be ordered is part of a cycle or
  // sits downstream of one.
  private evaluate(set: Set<number>) {
    const indeg = new Map<number, number>();
    const forward = new Map<number, number[]>();
    const backward = new Map<number, number[]>();
    const edge = (from: number, to: number) => {
      let f = forward.get(from);
      if (!f) forward.set(from, (f = []));
      f.push(to);
      let b = backward.get(to);
      if (!b) backward.set(to, (b = []));
      b.push(from);
    };

    for (const key of set) {
      const cell = this.cells.get(key)!;
      let d = 0;
      for (const p of cell.refs ?? []) {
        if (set.has(p)) {
          d++;
          edge(p, key);
        }
      }
      for (const rect of cell.ranges ?? []) {
        if (rectArea(rect) <= set.size) {
          for (let r = rect.r1; r <= rect.r2; r++)
            for (let c = rect.c1; c <= rect.c2; c++) {
              const p = keyOf(r, c);
              if (set.has(p)) {
                d++;
                edge(p, key);
              }
            }
        } else {
          for (const p of set) {
            if (inRect(rect, rowOf(p), colOf(p))) {
              d++;
              edge(p, key);
            }
          }
        }
      }
      indeg.set(key, d);
    }

    const ready: number[] = [];
    for (const [key, d] of indeg) if (d === 0) ready.push(key);
    let done = 0;
    while (ready.length) {
      const key = ready.pop()!;
      this.evalCell(key);
      done++;
      for (const next of forward.get(key) ?? []) {
        const d = indeg.get(next)! - 1;
        indeg.set(next, d);
        if (d === 0) ready.push(next);
      }
    }
    if (done === set.size) return;

    // Peel off everything that merely depends on a cycle; what's left is the cycle itself.
    const stuck = new Set<number>();
    for (const [key, d] of indeg) if (d > 0) stuck.add(key);
    const outdeg = new Map<number, number>();
    for (const key of stuck) outdeg.set(key, (forward.get(key) ?? []).filter((n) => stuck.has(n)).length);
    const sinks: number[] = [];
    for (const [key, d] of outdeg) if (d === 0) sinks.push(key);
    const downstream: number[] = [];
    while (sinks.length) {
      const key = sinks.pop()!;
      downstream.push(key);
      for (const p of backward.get(key) ?? []) {
        if (!stuck.has(p)) continue;
        const d = outdeg.get(p)! - 1;
        outdeg.set(p, d);
        if (d === 0) sinks.push(p);
      }
    }
    const downstreamSet = new Set(downstream);
    for (const key of stuck) {
      if (downstreamSet.has(key)) continue;
      const cell = this.cells.get(key)!;
      const preds = backward.get(key) ?? [];
      const via = preds.find((p) => p !== key && stuck.has(p) && !downstreamSet.has(p));
      cell.value = preds.includes(key) || via === undefined
        ? new CellError("#CYCLE!", "This formula includes its own cell")
        : new CellError("#CYCLE!", `Circular reference: this cell needs ${addrOfKey(via)}, which needs this cell back`);
    }
    for (let i = downstream.length - 1; i >= 0; i--) this.evalCell(downstream[i]);
  }

  private evalCell(key: number) {
    const cell = this.cells.get(key)!;
    if (!cell.node) {
      cell.value = new CellError("#ERROR!", cell.parseError ?? "Couldn't read this formula");
      return;
    }
    const v = this.ev(cell.node);
    cell.value = v === null ? 0 : v;
  }

  private read(r: number, c: number): Value {
    if (!this.inBounds(r, c)) {
      return new CellError(
        "#REF!",
        r < 0 || c < 0
          ? "That isn't a cell address"
          : `${addr(r, c)} is outside this sheet, which ends at ${addr(this.rows - 1, this.cols - 1)}`,
      );
    }
    const v = this.cells.get(keyOf(r, c))?.value ?? null;
    if (isError(v)) return new CellError(v.code, v.message, v.origin ?? addr(r, c));
    return v;
  }

  private ev(n: Node): Value {
    switch (n.k) {
      case "num":
        return n.value;
      case "str":
        return n.value;
      case "refErr":
        return new CellError("#REF!", "A cell this formula pointed at no longer exists");
      case "name":
        return new CellError("#NAME?", `“${n.name}” isn't a cell address or a function`);
      case "ref":
        return this.read(n.r, n.c);
      case "range":
        return new CellError("#VALUE!", `A range like ${rectAddr(n)} only works inside a function, such as SUM(${rectAddr(n)})`);
      case "neg": {
        const v = toNumber(this.ev(n.arg));
        return isError(v) ? v : -v;
      }
      case "bin":
        return this.binary(n.op, this.ev(n.left), this.ev(n.right));
      case "call":
        return this.call(n.name, n.args);
    }
  }

  private binary(op: string, l: Value, r: Value): Value {
    if (isError(l)) return l;
    if (isError(r)) return r;
    if (op === "&") return toText(l) + toText(r);
    const a = toNumber(l);
    if (isError(a)) return a;
    const b = toNumber(r);
    if (isError(b)) return b;
    let out: number;
    switch (op) {
      case "+": out = a + b; break;
      case "-": out = a - b; break;
      case "*": out = a * b; break;
      case "/":
        if (b === 0) return new CellError("#DIV/0!", "Division by zero");
        out = a / b;
        break;
      case "^": out = Math.pow(a, b); break;
      default:
        return new CellError("#ERROR!", `Unknown operator ${op}`);
    }
    if (!Number.isFinite(out)) return new CellError("#NUM!", "The result is too large, or not a real number");
    return out;
  }

  // Ranges and references inside a function skip text and blanks, like every spreadsheet;
  // a literal that isn't a number is an error.
  private numbersIn(args: Node[]): number[] | CellError {
    const out: number[] = [];
    for (const arg of args) {
      if (arg.k === "range" || arg.k === "ref") {
        const rect = arg.k === "range" ? arg : { r1: arg.r, c1: arg.c, r2: arg.r, c2: arg.c };
        if (!this.inBounds(rect.r1, rect.c1) || !this.inBounds(rect.r2, rect.c2)) {
          return new CellError(
            "#REF!",
            `${rectAddr(rect)} goes outside this sheet, which ends at ${addr(this.rows - 1, this.cols - 1)}`,
          );
        }
        for (let r = rect.r1; r <= rect.r2; r++)
          for (let c = rect.c1; c <= rect.c2; c++) {
            const v = this.cells.get(keyOf(r, c))?.value;
            if (v === undefined || v === null) continue;
            if (isError(v)) return new CellError(v.code, v.message, v.origin ?? addr(r, c));
            if (typeof v === "number") out.push(v);
          }
        continue;
      }
      const v = toNumber(this.ev(arg));
      if (isError(v)) return v;
      out.push(v);
    }
    return out;
  }

  private call(name: string, args: Node[]): Value {
    if (name === "ROUND") return this.round(args);
    const fn = FUNCTIONS[name];
    if (!fn) return new CellError("#NAME?", `There's no function called ${name}. Try SUM, AVG, MIN, MAX, COUNT or ROUND`);
    const nums = this.numbersIn(args);
    if (isError(nums)) return nums;
    return fn(nums);
  }

  // ROUND(value, digits) works on single values rather than ranges, so it sits apart.
  private round(args: Node[]): Value {
    if (args.length < 1 || args.length > 2) return new CellError("#ERROR!", "ROUND takes a value and, optionally, how many digits to keep");
    const x = toNumber(this.ev(args[0]));
    if (isError(x)) return x;
    const d = args[1] ? toNumber(this.ev(args[1])) : 0;
    if (isError(d)) return d;
    const f = Math.pow(10, Math.trunc(d));
    return Math.round(x * f + Math.sign(x) * 1e-9) / f;
  }
}

const FUNCTIONS: Record<string, (nums: number[]) => Value> = {
  SUM: (n) => n.reduce((a, b) => a + b, 0),
  AVG: (n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : new CellError("#DIV/0!", "There are no numbers to average")),
  MIN: (n) => (n.length ? n.reduce((a, b) => (b < a ? b : a)) : 0),
  MAX: (n) => (n.length ? n.reduce((a, b) => (b > a ? b : a)) : 0),
  COUNT: (n) => n.length,
};
FUNCTIONS.AVERAGE = FUNCTIONS.AVG;

function toNumber(v: Value): number | CellError {
  if (isError(v)) return v;
  if (v === null) return 0;
  if (typeof v === "number") return v;
  const n = parseNumber(v);
  if (n !== null) return n;
  const shown = v.length > 24 ? v.slice(0, 24) + "…" : v;
  return new CellError("#VALUE!", `“${shown}” is text, not a number`);
}

function toText(v: Value): string {
  if (v === null) return "";
  if (typeof v === "number") return formatNumber(v);
  return String(v);
}
