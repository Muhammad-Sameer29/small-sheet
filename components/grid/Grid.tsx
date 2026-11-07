"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { colName, inRect, type Pos, type Rect } from "@/lib/engine/address";
import type { Cell } from "@/lib/engine/engine";
import { formatNumber, isError } from "@/lib/engine/values";
import { selRect, type Editing, type Sel, type SheetModel } from "@/lib/client/sheet-model";
import s from "./Grid.module.css";

export const ROW_H = 28;
const HEAD_H = 28;
const ROWHEAD_W = 56;
const OVERSCAN = 8;
const MIN_W = 36;
const MAX_W = 640;

export type PointerTarget = { kind: "cell"; r: number; c: number } | { kind: "col"; c: number } | { kind: "row"; r: number } | { kind: "all" };

export interface GridHandle {
  scrollToCell(p: Pos): void;
  focus(): void;
  visibleRows(): number;
}

interface Props {
  model: SheetModel;
  version: number;
  sel: Sel;
  editing: Editing | null;
  copied: Rect | null;
  label: string;
  children?: ReactNode;
  onPointerSelect(t: PointerTarget, phase: "start" | "move", shift: boolean): void;
  onEditStart(p: Pos): void;
  onEditText(text: string): void;
  onEditKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  onEditBlur(e: React.FocusEvent<HTMLInputElement>): void;
  onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
  onCopy(e: ClipboardEvent<HTMLDivElement>): void;
  onCut(e: ClipboardEvent<HTMLDivElement>): void;
  onPaste(e: ClipboardEvent<HTMLDivElement>): void;
  onResize(c: number, width: number, done: boolean): void;
}

interface Layout {
  colLeft: number[];
  cs: number;
  ce: number;
  frozen: boolean;
  spacer: number;
  width: number;
}

// The largest column whose left edge is at or before x.
function findCol(colLeft: number[], x: number) {
  let lo = 0;
  let hi = colLeft.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (colLeft[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type Kind = "empty" | "text" | "number" | "computed" | "computedText" | "error";

export function describeCell(cell: Cell | undefined): { text: string; kind: Kind } {
  if (!cell) return { text: "", kind: "empty" };
  if (cell.kind === "number") return { text: cell.raw.trim(), kind: "number" };
  if (cell.kind === "text") return { text: String(cell.value), kind: "text" };
  const v = cell.value;
  if (isError(v)) return { text: v.code, kind: "error" };
  if (typeof v === "number") return { text: formatNumber(v), kind: "computed" };
  return { text: String(v ?? ""), kind: "computedText" };
}

export const Grid = forwardRef<GridHandle, Props>(function Grid(props, ref) {
  const { model, version, sel, editing, copied, label, children } = props;
  const viewport = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, left: 0, w: 1200, h: 800 });
  const frame = useRef(0);
  const rows = model.rows;
  const cols = model.cols;
  const frozen = model.frozen;

  const colLeft = useMemo(() => {
    const a = new Array<number>(cols + 1);
    a[0] = 0;
    for (let c = 0; c < cols; c++) a[c + 1] = a[c] + model.width(c);
    return a;
    // colWidths is replaced (never mutated) when a width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, cols, model.colWidths]);

  const totalW = colLeft[cols];
  const frozenW = frozen ? colLeft[1] : 0;

  const readViewport = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    setVp((prev) => {
      const next = { top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight };
      return prev.top === next.top && prev.left === next.left && prev.w === next.w && prev.h === next.h ? prev : next;
    });
  }, []);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    readViewport();
    const ro = new ResizeObserver(readViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, [readViewport]);

  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      readViewport();
    });
  };

  const first = frozen ? 1 : 0;
  const cs = Math.max(first, findCol(colLeft, vp.left + frozenW) - 1);
  const ce = Math.min(cols - 1, findCol(colLeft, vp.left + vp.w - ROWHEAD_W) + 1);
  const rs = Math.max(0, Math.floor(vp.top / ROW_H) - OVERSCAN);
  const re = Math.min(rows - 1, Math.ceil((vp.top + vp.h) / ROW_H) + OVERSCAN);

  const layout: Layout = useMemo(
    () => ({ colLeft, cs, ce, frozen, spacer: colLeft[cs] - colLeft[first], width: ROWHEAD_W + colLeft[cols] }),
    [colLeft, cs, ce, frozen, first, cols],
  );

  const rect = selRect(sel);

  useImperativeHandle(ref, () => ({
    focus() {
      viewport.current?.focus({ preventScroll: true });
    },
    visibleRows() {
      const el = viewport.current;
      return el ? Math.max(1, Math.floor((el.clientHeight - HEAD_H) / ROW_H) - 1) : 20;
    },
    scrollToCell(p: Pos) {
      const el = viewport.current;
      if (!el) return;
      const bodyH = el.clientHeight - HEAD_H;
      const top = p.r * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + bodyH) el.scrollTop = top + ROW_H - bodyH;
      if (frozen && p.c === 0) return;
      const bodyW = el.clientWidth - ROWHEAD_W;
      const left = colLeft[p.c];
      const right = colLeft[p.c + 1];
      if (left < el.scrollLeft + frozenW) el.scrollLeft = left - frozenW;
      else if (right > el.scrollLeft + bodyW) el.scrollLeft = right - bodyW;
    },
  }));

  // ---- pointer: click, shift-click, drag to extend with edge auto-scroll ----

  const drag = useRef<{ kind: PointerTarget["kind"]; x: number; y: number; raf: number } | null>(null);

  const hitTest = useCallback(
    (x: number, y: number): { r: number; c: number } => {
      const el = viewport.current!;
      const b = el.getBoundingClientRect();
      const relX = Math.max(0, Math.min(x, b.left + el.clientWidth - 1) - b.left - ROWHEAD_W);
      const relY = Math.max(0, Math.min(y, b.top + el.clientHeight - 1) - b.top - HEAD_H);
      const c = frozen && relX < frozenW ? 0 : findCol(colLeft, relX + el.scrollLeft);
      const r = Math.max(0, Math.min(rows - 1, Math.floor((relY + el.scrollTop) / ROW_H)));
      return { r, c: Math.min(cols - 1, c) };
    },
    [colLeft, frozen, frozenW, rows, cols],
  );

  const { onPointerSelect } = props;

  const dragTo = useCallback(
    (x: number, y: number) => {
      const d = drag.current;
      if (!d) return;
      const { r, c } = hitTest(x, y);
      if (d.kind === "cell") onPointerSelect({ kind: "cell", r, c }, "move", false);
      else if (d.kind === "col") onPointerSelect({ kind: "col", c }, "move", false);
      else if (d.kind === "row") onPointerSelect({ kind: "row", r }, "move", false);
    },
    [hitTest, onPointerSelect],
  );

  useEffect(() => {
    const tick = () => {
      const d = drag.current;
      const el = viewport.current;
      if (!d || !el) return;
      const b = el.getBoundingClientRect();
      const edge = 24;
      const speed = (over: number) => Math.min(48, Math.round(over / 2) + 6);
      let dy = 0;
      let dx = 0;
      if (d.kind !== "col") {
        if (d.y > b.bottom - edge) dy = speed(d.y - (b.bottom - edge));
        else if (d.y < b.top + HEAD_H) dy = -speed(b.top + HEAD_H - d.y);
      }
      if (d.kind !== "row") {
        if (d.x > b.right - edge) dx = speed(d.x - (b.right - edge));
        else if (d.x < b.left + ROWHEAD_W + frozenW) dx = -speed(b.left + ROWHEAD_W + frozenW - d.x);
      }
      if (dx || dy) {
        el.scrollTop += dy;
        el.scrollLeft += dx;
        dragTo(d.x, d.y);
      }
      d.raf = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.x = e.clientX;
      d.y = e.clientY;
      dragTo(e.clientX, e.clientY);
      if (!d.raf) d.raf = requestAnimationFrame(tick);
    };
    const up = () => {
      if (drag.current?.raf) cancelAnimationFrame(drag.current.raf);
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragTo, frozenW]);

  const touch = useRef<{ x: number; y: number; target: PointerTarget } | null>(null);

  const targetOf = (el: HTMLElement): PointerTarget | null => {
    if (el.closest("[data-corner]")) return { kind: "all" };
    const head = el.closest<HTMLElement>("[data-col]");
    if (head) return { kind: "col", c: Number(head.dataset.col) };
    const rowHead = el.closest<HTMLElement>("[data-rowhead]");
    if (rowHead) return { kind: "row", r: Number(rowHead.dataset.rowhead) };
    const cell = el.closest<HTMLElement>("[data-c]");
    const row = el.closest<HTMLElement>("[data-r]");
    if (cell && row) return { kind: "cell", r: Number(row.dataset.r), c: Number(cell.dataset.c) };
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (e.button !== 0 || el.closest("input") || el.closest("[data-resize]")) return;
    const target = targetOf(el);
    if (!target) return;
    if (e.pointerType === "touch") {
      // On touch, a drag scrolls. A tap selects.
      touch.current = { x: e.clientX, y: e.clientY, target };
      return;
    }
    e.preventDefault();
    viewport.current?.focus({ preventScroll: true });
    onPointerSelect(target, "start", e.shiftKey);
    if (target.kind !== "all") drag.current = { kind: target.kind, x: e.clientX, y: e.clientY, raf: 0 };
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touch.current;
    touch.current = null;
    if (!t || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) return;
    viewport.current?.focus({ preventScroll: true });
    onPointerSelect(t.target, "start", false);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = targetOf(e.target as HTMLElement);
    if (t?.kind === "cell") props.onEditStart({ r: t.r, c: t.c });
  };

  // ---- column resizing ----

  const startResize = (e: ReactPointerEvent<HTMLDivElement>, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = model.width(c);
    let w = startW;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX)));
      props.onResize(c, w, false);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (w !== startW) props.onResize(c, w, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const autoFit = (c: number) => {
    const el = viewport.current;
    if (!el) return;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = `${getComputedStyle(el).fontSize} ${getComputedStyle(el).fontFamily}`;
    let widest = ctx.measureText(colName(c)).width;
    for (let r = 0; r < rows; r++) {
      const { text } = describeCell(model.engine.get(r, c));
      if (text) widest = Math.max(widest, ctx.measureText(text).width);
    }
    props.onResize(c, Math.round(Math.max(MIN_W, Math.min(MAX_W, widest + 20))), true);
  };

  // ---- keyboard & clipboard: the editor handles its own keys ----

  const fromGrid = (e: { target: EventTarget; currentTarget: EventTarget }) => e.target === e.currentTarget;

  const rowEls = [];
  const rowRange: number[] = [];
  for (let r = rs; r <= re; r++) rowRange.push(r);
  if (editing && (editing.r < rs || editing.r > re)) rowRange.push(editing.r);
  for (const r of rowRange) {
    const rowSel = r >= rect.r1 && r <= rect.r2 ? sel : null;
    const rowCopied = copied && r >= copied.r1 && r <= copied.r2 ? copied : null;
    const rowEdit = editing && editing.r === r ? editing : null;
    rowEls.push(
      <Row
        key={r}
        r={r}
        layout={layout}
        model={model}
        version={version}
        sel={rowSel}
        copied={rowCopied}
        editing={rowEdit}
        onEditText={props.onEditText}
        onEditKeyDown={props.onEditKeyDown}
        onEditBlur={props.onEditBlur}
      />,
    );
  }

  const headCells = [];
  const pushHead = (c: number) => {
    const selected = c >= rect.c1 && c <= rect.c2;
    const whole = selected && rect.r1 === 0 && rect.r2 === rows - 1;
    headCells.push(
      <div
        key={c}
        role="columnheader"
        aria-colindex={c + 2}
        data-col={c}
        className={[s.colHead, selected && s.headSel, whole && s.headWhole, frozen && c === 0 && s.frozenHead].filter(Boolean).join(" ")}
        style={{ width: model.width(c) }}
      >
        {colName(c)}
        <div
          data-resize={c}
          className={s.resize}
          onPointerDown={(e) => startResize(e, c)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            autoFit(c);
          }}
          aria-hidden="true"
        />
      </div>,
    );
  };
  if (frozen) pushHead(0);
  headCells.push(<div key="spacer" style={{ width: layout.spacer, flex: "none" }} />);
  for (let c = cs; c <= ce; c++) pushHead(c);

  const allSelected = rect.r1 === 0 && rect.c1 === 0 && rect.r2 === rows - 1 && rect.c2 === cols - 1;

  return (
    <div className={s.wrap}>
      <div
        ref={viewport}
        className={[s.viewport, vp.left > 0 && s.scrolledX, vp.top > 0 && s.scrolledY].filter(Boolean).join(" ")}
        role="grid"
        aria-label={label}
        aria-rowcount={rows + 1}
        aria-colcount={cols + 1}
        aria-multiselectable="true"
        tabIndex={0}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={(e) => fromGrid(e) && props.onKeyDown(e)}
        onCopy={(e) => fromGrid(e) && props.onCopy(e)}
        onCut={(e) => fromGrid(e) && props.onCut(e)}
        onPaste={(e) => fromGrid(e) && props.onPaste(e)}
      >
        <div className={s.canvas} style={{ width: ROWHEAD_W + totalW, height: HEAD_H + rows * ROW_H }}>
          <div className={s.headRow} role="row" aria-rowindex={1} style={{ width: ROWHEAD_W + totalW }}>
            <div data-corner="" className={[s.corner, allSelected && s.headWhole].filter(Boolean).join(" ")} role="columnheader" aria-label="Select all">
              <span className={s.cornerMark} />
            </div>
            {headCells}
          </div>
          <div className={s.body} style={{ height: rows * ROW_H }}>
            {rowEls}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
});

interface RowProps {
  r: number;
  layout: Layout;
  model: SheetModel;
  version: number;
  sel: Sel | null;
  copied: Rect | null;
  editing: Editing | null;
  onEditText(text: string): void;
  onEditKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  onEditBlur(e: React.FocusEvent<HTMLInputElement>): void;
}

const KIND_CLASS: Record<Kind, string | undefined> = {
  empty: undefined,
  text: undefined,
  number: s.num,
  computed: s.computed + " " + s.num,
  computedText: s.computed,
  error: s.error,
};

// Rows only re-render when something about *them* changes: their selection, the data
// version, the visible columns. Scrolling just mounts the rows coming into view.
const Row = memo(function Row({ r, layout, model, version: _version, sel, copied, editing, onEditText, onEditKeyDown, onEditBlur }: RowProps) {
  const rect = sel ? selRect(sel) : null;
  const cells = [];

  const pushCell = (c: number) => {
    const cell = model.engine.get(r, c);
    const { text, kind } = describeCell(cell);
    const inSel = rect !== null && inRect(rect, r, c);
    const active = sel !== null && sel.active.r === r && sel.active.c === c;
    const isEditing = editing !== null && editing.c === c;
    const multi = rect !== null && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
    const cls = [s.cell, KIND_CLASS[kind], layout.frozen && c === 0 && s.frozen, inSel && multi && s.sel, active && s.active, isEditing && s.editing];
    if (inSel && multi && rect) {
      if (r === rect.r1) cls.push(s.et);
      if (r === rect.r2) cls.push(s.eb);
      if (c === rect.c1) cls.push(s.el);
      if (c === rect.c2) cls.push(s.er);
    }
    const inCopy = copied !== null && inRect(copied, r, c);
    const err = cell && isError(cell.value) ? cell.value : null;
    cells.push(
      <div
        key={c}
        role="gridcell"
        aria-colindex={c + 2}
        aria-selected={inSel || undefined}
        data-c={c}
        className={cls.filter(Boolean).join(" ")}
        style={{ width: model.width(c) }}
        title={err ? `${err.code} ${err.origin ? `(from ${err.origin}) ` : ""}— ${err.message}` : undefined}
      >
        {!isEditing && <span className={s.value}>{text}</span>}
        {inCopy && copied && (
          <span
            className={[s.marquee, r === copied.r1 && s.mt, r === copied.r2 && s.mb, c === copied.c1 && s.ml, c === copied.c2 && s.mr].filter(Boolean).join(" ")}
            aria-hidden="true"
          />
        )}
        {isEditing && editing && <CellEditor editing={editing} onText={onEditText} onKeyDown={onEditKeyDown} onBlur={onEditBlur} />}
      </div>,
    );
  };

  if (layout.frozen) pushCell(0);
  cells.push(<div key="spacer" className={s.spacer} style={{ width: layout.spacer }} />);
  for (let c = layout.cs; c <= layout.ce; c++) pushCell(c);

  const headSel = rect !== null;
  const whole = rect !== null && rect.c1 === 0 && rect.c2 === model.cols - 1;

  return (
    <div className={s.row} role="row" aria-rowindex={r + 2} data-r={r} style={{ top: r * ROW_H, width: layout.width }}>
      <div role="rowheader" data-rowhead={r} className={[s.rowHead, headSel && s.headSel, whole && s.headWhole].filter(Boolean).join(" ")}>
        {r + 1}
      </div>
      {cells}
    </div>
  );
});

interface EditorProps {
  editing: Editing;
  onText(t: string): void;
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  onBlur(e: React.FocusEvent<HTMLInputElement>): void;
}

function CellEditor({ editing, onText, onKeyDown, onBlur }: EditorProps) {
  const input = useRef<HTMLInputElement>(null);
  // Focus on mount, which also covers the editor being re-mounted after scrolling away and back.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || editing.origin !== "cell") return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.origin]);

  return (
    <input
      ref={input}
      className={s.editor}
      value={editing.text}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      spellCheck={false}
      autoComplete="off"
      aria-label={`Editing ${colName(editing.c)}${editing.r + 1}`}
      style={{ minWidth: "100%", width: `calc(${Math.max(editing.text.length + 2, 4)}ch)` }}
    />
  );
}
