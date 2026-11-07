import { addrOfKey, keyOf, normRect, parseAddr, type Pos, type Rect } from "../engine/address";
import { SheetEngine } from "../engine/engine";
import type { LoadedSheet } from "../types";
import { readJournal, Saver } from "./saver";

export const DEFAULT_COL_WIDTH = 104;

// anchor..focus is the selected range; active is the cell inside it that typing goes to.
export interface Sel {
  anchor: Pos;
  focus: Pos;
  active: Pos;
}

export const selAt = (p: Pos): Sel => ({ anchor: p, focus: p, active: p });
export const selRect = (s: Sel): Rect => normRect(s.anchor, s.focus);

// One undo step: every cell it touched, before and after, plus where the selection was,
// so undoing a paste puts you back where you were before pasting.
interface Step {
  cells: Array<[key: number, before: string, after: string]>;
  selBefore: Sel;
  selAfter: Sel;
}

export class SheetModel {
  readonly engine: SheetEngine;
  readonly saver: Saver;
  name: string;
  frozen: boolean;
  colWidths: Record<number, number>;
  // Bumped on every change so React knows to re-render.
  version = 0;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  // Edits that hadn't reached the server before the last reload and were brought back.
  restored = 0;

  constructor(doc: LoadedSheet) {
    this.name = doc.name;
    this.frozen = doc.frozen;
    this.colWidths = { ...doc.colWidths };
    this.engine = new SheetEngine(doc.rows, doc.cols);
    this.saver = new Saver(doc.id, doc.generation);

    const cells = { ...doc.cells };
    const journal = readJournal(doc.id, doc.generation);
    if (journal) {
      for (const [a, raw] of Object.entries(journal.cells)) {
        const p = parseAddr(a);
        if (!p || p.r >= doc.rows || p.c >= doc.cols) continue;
        if ((cells[a] ?? "") !== raw) this.restored++;
        if (raw === "") delete cells[a];
        else cells[a] = raw;
      }
      if (journal.meta.name) this.name = journal.meta.name;
      if (journal.meta.frozen !== undefined) this.frozen = journal.meta.frozen;
      if (journal.meta.colWidths) Object.assign(this.colWidths, journal.meta.colWidths);
    }

    const entries: Array<[number, string]> = [];
    for (const [a, raw] of Object.entries(cells)) {
      const p = parseAddr(a);
      if (p && p.r < doc.rows && p.c < doc.cols) entries.push([keyOf(p.r, p.c), raw]);
    }
    this.engine.load(entries);

    // Send what came back from the journal straight away.
    if (journal) {
      this.saver.queueCells(Object.entries(journal.cells));
      if (Object.keys(journal.meta).length) this.saver.queueMeta(journal.meta);
    }
  }

  get rows() {
    return this.engine.rows;
  }
  get cols() {
    return this.engine.cols;
  }

  width(c: number) {
    return this.colWidths[c] ?? DEFAULT_COL_WIDTH;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  // Returns false when nothing actually changed, so no empty undo steps are recorded.
  apply(changes: Array<[number, string]>, selBefore: Sel, selAfter: Sel): boolean {
    const latest = new Map<number, string>();
    for (const [k, raw] of changes) latest.set(k, raw);
    const cells: Step["cells"] = [];
    for (const [k, raw] of latest) {
      const before = this.engine.raw(k);
      if (before !== raw) cells.push([k, before, raw]);
    }
    if (!cells.length) return false;
    this.undoStack.push({ cells, selBefore, selAfter });
    this.redoStack = [];
    this.write(cells.map(([k, , after]) => [k, after]));
    return true;
  }

  undo(): Sel | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push(step);
    this.write(step.cells.map(([k, before]) => [k, before]));
    return step.selBefore;
  }

  redo(): Sel | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push(step);
    this.write(step.cells.map(([k, , after]) => [k, after]));
    return step.selAfter;
  }

  rename(name: string) {
    this.name = name;
    this.saver.queueMeta({ name });
    this.version++;
  }

  setFrozen(frozen: boolean) {
    this.frozen = frozen;
    this.saver.queueMeta({ frozen });
    this.version++;
  }

  setWidth(c: number, w: number, save: boolean) {
    this.colWidths = { ...this.colWidths, [c]: w };
    if (save) this.saver.queueMeta({ colWidths: { [c]: w } });
    this.version++;
  }

  private write(cells: Array<[number, string]>) {
    this.engine.set(cells);
    this.saver.queueCells(cells.map(([k, raw]) => [addrOfKey(k), raw]));
    this.version++;
  }
}

// "enter" is editing that began by typing over a cell: arrow keys commit and move, like
// Excel. "edit" began with F2, Enter or a double-click: arrow keys move the caret.
export interface Editing {
  r: number;
  c: number;
  text: string;
  mode: "enter" | "edit";
  origin: "cell" | "bar";
}
