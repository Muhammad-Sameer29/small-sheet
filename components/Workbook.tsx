"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { addr, keyOf, rectAddr, rectArea, type Pos, type Rect } from "@/lib/engine/address";
import { isError } from "@/lib/engine/values";
import { shiftFormula } from "@/lib/engine/shift";
import {
  INTERNAL_TYPE,
  MAX_HTML,
  MAX_TEXT,
  parseHtmlTable,
  parseText,
  readInternal,
  toHtml,
  toText,
  type InternalClip,
} from "@/lib/clipboard";
import { clampPos, jump } from "@/lib/client/nav";
import { selAt, selRect, SheetModel, type Editing, type Sel } from "@/lib/client/sheet-model";
import type { SaveStatus as SaveStatusT } from "@/lib/client/saver";
import type { LoadedSheet, SheetMeta } from "@/lib/types";
import { describeCell, Grid, type GridHandle, type PointerTarget } from "./grid/Grid";
import { FormulaBar } from "./chrome/FormulaBar";
import { SheetTabs } from "./chrome/SheetTabs";
import { StatusBar } from "./chrome/StatusBar";
import { SaveStatus } from "./chrome/SaveStatus";
import { Toasts, type Toast } from "./chrome/Toasts";
import { Shortcuts } from "./chrome/Shortcuts";
import { EmptyHint, GridSkeleton, Screen } from "./screens/Screens";
import { Button, IconButton } from "./ui/Button";
import { Icon } from "./ui/Icon";
import s from "./Workbook.module.css";

type Load = { id: string; state: "loading" | "ready" | "missing" | "error"; message?: string };

// Copying more than this is refused: it would mean building a multi-megabyte string.
const MAX_COPY = 250_000;

// Gives handlers a stable identity (so memoised rows don't re-render) while always
// calling the latest version (so they never see stale state).
function useStable<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function selFromUrl(rows: number, cols: number): Sel | null {
  const cell = new URLSearchParams(window.location.search).get("cell");
  if (!cell) return null;
  const parts = cell.split(":");
  const a = parseCell(parts[0]);
  const b = parts[1] ? parseCell(parts[1]) : a;
  if (!a || !b) return null;
  const pa = clampPos(a, rows, cols);
  return { anchor: pa, focus: clampPos(b, rows, cols), active: pa };
}

function parseCell(text: string): Pos | null {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(text);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
}

const isPrintable = (e: KeyboardEvent) =>
  e.key.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey);

export function Workbook({ initialSheets }: { initialSheets: SheetMeta[] }) {
  const params = useParams<{ sheetId?: string }>();
  const sheetId = params.sheetId ?? initialSheets[0]?.id ?? "";
  const router = useRouter();

  const [sheets, setSheets] = useState(initialSheets);
  const models = useRef(new Map<string, SheetModel>());
  const [load, setLoad] = useState<Load>({ id: sheetId, state: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [version, setVersion] = useState(0);
  const [saveTick, setSaveTick] = useState(0);
  const [sel, setSelState] = useState<Sel>(selAt({ r: 0, c: 0 }));
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [copied, setCopied] = useState<{ sheet: string; rect: Rect; cut: boolean } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState(false);

  const selRef = useRef(sel);
  const editingRef = useRef(editing);
  const lastSel = useRef(new Map<string, Sel>());
  const tabStartCol = useRef<number | null>(null);
  const lastCopy = useRef<{ text: string; clip: InternalClip } | null>(null);
  const clipboardFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<GridHandle>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toastId = useRef(0);

  const viewOnly = useMediaQuery("(max-width: 599px)");
  const model = load.state === "ready" ? models.current.get(load.id) ?? null : null;

  const setSel = (next: Sel) => {
    selRef.current = next;
    setSelState(next);
  };
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };
  const bump = () => setVersion((v) => v + 1);

  const toast = useStable((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "warn" ? 8000 : 5000);
  });

  // ---- loading a sheet ----

  useEffect(() => {
    const cached = models.current.get(sheetId);
    if (cached) {
      setLoad({ id: sheetId, state: "ready" });
      setSel(selFromUrl(cached.rows, cached.cols) ?? lastSel.current.get(sheetId) ?? selAt({ r: 0, c: 0 }));
      return;
    }
    let cancelled = false;
    setLoad({ id: sheetId, state: "loading" });
    const fail = new URLSearchParams(window.location.search).get("fail") ? "?fail=1" : "";
    fetch(`/api/sheets/${encodeURIComponent(sheetId)}${fail}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setLoad({ id: sheetId, state: "missing" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          return setLoad({ id: sheetId, state: "error", message: body?.error ?? `The server answered ${res.status}` });
        }
        const doc = (await res.json()) as LoadedSheet;
        if (cancelled) return;
        const m = new SheetModel(doc);
        models.current.set(sheetId, m);
        m.saver.subscribe(() => setSaveTick((t) => t + 1));
        if (m.restored) toast(`Restored ${m.restored} unsaved change${m.restored === 1 ? "" : "s"} from your last visit — saving them now.`);
        setSel(selFromUrl(m.rows, m.cols) ?? selAt({ r: 0, c: 0 }));
        setLoad({ id: sheetId, state: "ready" });
      })
      .catch(() => !cancelled && setLoad({ id: sheetId, state: "error", message: "Couldn't reach the server" }));
    return () => {
      cancelled = true;
    };
  }, [sheetId, retryKey, toast]);

  // The URL always says which sheet and which cell. Moving replaces the history entry;
  // switching sheets pushes one, so Back goes to the previous sheet, at the cell you left.
  useEffect(() => {
    if (!model) return;
    lastSel.current.set(load.id, sel);
    document.title = `${model.name} · Small Sheet`;
    const t = setTimeout(() => {
      const rect = selRect(sel);
      const cell = rectArea(rect) > 1 ? `${addr(sel.active.r, sel.active.c)}:${addr(sel.focus.r, sel.focus.c)}` : addr(sel.active.r, sel.active.c);
      const url = `/s/${load.id}?cell=${cell}`;
      if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
    }, 150);
    return () => clearTimeout(t);
  }, [sel, model, load.id, version]);

  // ---- saving: one status for the whole workbook ----

  const saveStatus: SaveStatusT = useMemo(() => {
    let worst: SaveStatusT = { state: "saved", unsaved: 0, atRisk: false };
    let savedAt = 0;
    for (const m of models.current.values()) {
      const st = m.saver.status;
      savedAt = Math.max(savedAt, st.savedAt ?? 0);
      const rank = { saved: 0, saving: 1, failed: 2 };
      if (rank[st.state] > rank[worst.state]) worst = st;
      else if (st.state === worst.state && st.state !== "saved") worst = { ...worst, unsaved: worst.unsaved + st.unsaved };
    }
    return { ...worst, savedAt: savedAt || undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTick]);

  const retryAll = () => {
    for (const m of models.current.values()) if (m.saver.status.state === "failed") m.saver.retryNow();
  };

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") for (const m of models.current.values()) m.saver.flushSoon();
    };
    // Edits are journalled locally, so leaving is safe — unless the browser refused the journal.
    const leaving = (e: BeforeUnloadEvent) => {
      for (const m of models.current.values()) {
        if (m.saver.status.atRisk && m.saver.status.unsaved) e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", leaving);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", leaving);
    };
  }, []);

  // ---- screen reader: announce where you are ----

  useEffect(() => {
    if (!model) return;
    const t = setTimeout(() => {
      const rect = selRect(sel);
      const where = addr(sel.active.r, sel.active.c);
      const cell = model.engine.get(sel.active.r, sel.active.c);
      const { text, kind } = describeCell(cell);
      let what = text ? text : "empty";
      if (kind === "error" && cell && isError(cell.value)) what = `error ${cell.value.code}, ${cell.value.message}`;
      if (cell?.kind === "formula") what += `, formula ${cell.raw}`;
      setAnnouncement(rectArea(rect) > 1 ? `${rectAddr(rect)} selected, ${rectArea(rect)} cells. Active ${where}, ${what}` : `${where}, ${what}`);
    }, 120);
    return () => clearTimeout(t);
  }, [sel, model, version]);

  // ---- selection & movement ----

  const select = (next: Sel, scroll = true) => {
    setSel(next);
    if (scroll) gridRef.current?.scrollToCell(next.focus);
  };

  const move = (dr: number, dc: number, extend: boolean, toEdge: boolean) => {
    if (!model) return;
    const cur = selRef.current;
    const from = extend ? cur.focus : cur.active;
    const to = toEdge ? jump(model.engine, from, dr, dc) : clampPos({ r: from.r + dr, c: from.c + dc }, model.rows, model.cols);
    if (extend) select({ ...cur, focus: to });
    else select(selAt(to));
  };

  const onPointerSelect = useStable((t: PointerTarget, phase: "start" | "move", shift: boolean) => {
    if (!model) return;
    if (phase === "start") {
      commitEdit(null);
      tabStartCol.current = null;
    }
    const cur = selRef.current;
    const last = { r: model.rows - 1, c: model.cols - 1 };
    if (t.kind === "all") return select({ anchor: { r: 0, c: 0 }, focus: last, active: cur.active }, false);
    if (t.kind === "cell") {
      const p = { r: t.r, c: t.c };
      if (phase === "move" || shift) select({ ...cur, focus: p }, phase === "start");
      else select(selAt(p), false);
      return;
    }
    if (t.kind === "col") {
      if (phase === "move" || shift) return select({ ...cur, focus: { r: last.r, c: t.c } }, false);
      return select({ anchor: { r: 0, c: t.c }, focus: { r: last.r, c: t.c }, active: { r: 0, c: t.c } }, false);
    }
    if (phase === "move" || shift) return select({ ...cur, focus: { r: t.r, c: last.c } }, false);
    select({ anchor: { r: t.r, c: 0 }, focus: { r: t.r, c: last.c }, active: { r: t.r, c: 0 } }, false);
  });

  // ---- editing ----

  const startEdit = (p: Pos, mode: Editing["mode"], text?: string, origin: Editing["origin"] = "cell") => {
    if (!model || viewOnly) return;
    gridRef.current?.scrollToCell(p);
    setEditing({ r: p.r, c: p.c, text: text ?? model.engine.raw(keyOf(p.r, p.c)), mode, origin });
  };

  // Commits the edit in progress, then optionally moves. One edit is one undo step.
  const commitEdit = (moveBy: { dr: number; dc: number } | null) => {
    const ed = editingRef.current;
    if (!ed || !model) return;
    const at = { r: ed.r, c: ed.c };
    let to = at;
    if (moveBy) {
      if (moveBy.dc !== 0) tabStartCol.current ??= ed.c;
      const c = moveBy.dr !== 0 && tabStartCol.current !== null ? tabStartCol.current : ed.c + moveBy.dc;
      if (moveBy.dr !== 0) tabStartCol.current = null;
      to = clampPos({ r: ed.r + moveBy.dr, c }, model.rows, model.cols);
    }
    const after = moveBy ? selAt(to) : selRef.current;
    setEditing(null);
    if (model.apply([[keyOf(at.r, at.c), ed.text]], selAt(at), after)) bump();
    select(after);
    gridRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(null);
    gridRef.current?.focus();
  };

  const onEditText = useStable((text: string) => {
    const ed = editingRef.current;
    if (ed) setEditing({ ...ed, text });
  });

  const onEditKeyDown = useStable((e: KeyboardEvent<HTMLInputElement>) => {
    const ed = editingRef.current;
    if (!ed) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "F2") {
      e.preventDefault();
      setEditing({ ...ed, mode: ed.mode === "enter" ? "edit" : "enter" });
    } else if (arrows[e.key] && ed.mode === "enter" && ed.origin === "cell" && !e.shiftKey) {
      e.preventDefault();
      commitEdit({ dr: arrows[e.key][0], dc: arrows[e.key][1] });
    }
  });

  // Clicking a button, a tab or the name box commits; moving into the formula bar doesn't.
  const onEditBlur = useStable((e: React.FocusEvent<HTMLInputElement>) => {
    const to = e.relatedTarget as HTMLElement | null;
    if (!to || to.closest("[data-formula-input]") || to.getAttribute("role") === "grid") return;
    if (editingRef.current) commitEdit(null);
  });

  const onEditStart = useStable((p: Pos) => startEdit(p, "edit"));

  // ---- changing cells ----

  const applyChanges = (changes: Array<[number, string]>, after: Sel) => {
    if (!model) return false;
    const ok = model.apply(changes, selRef.current, after);
    if (ok) bump();
    select(after, false);
    return ok;
  };

  const clearSelection = () => {
    if (!model || viewOnly) return;
    const rect = selRect(selRef.current);
    const changes: Array<[number, string]> = [];
    if (rectArea(rect) <= model.engine.cells.size) {
      for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) changes.push([keyOf(r, c), ""]);
    } else {
      for (const key of model.engine.cells.keys()) {
        const r = Math.floor(key / 16384);
        const c = key % 16384;
        if (r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2) changes.push([key, ""]);
      }
    }
    applyChanges(changes, selRef.current);
  };

  const undo = () => {
    if (!model || viewOnly) return;
    const to = model.undo();
    if (!to) return setAnnouncement("Nothing to undo");
    bump();
    select(to);
    setAnnouncement("Undone");
  };

  const redo = () => {
    if (!model || viewOnly) return;
    const to = model.redo();
    if (!to) return setAnnouncement("Nothing to redo");
    bump();
    select(to);
    setAnnouncement("Redone");
  };

  // ---- clipboard ----

  const buildCopy = (cut: boolean) => {
    if (!model) return null;
    const rect = selRect(selRef.current);
    if (rectArea(rect) > MAX_COPY) {
      toast(`That's ${rectArea(rect).toLocaleString()} cells — too many to copy at once. Try a smaller range.`, "warn");
      return null;
    }
    const shown: string[][] = [];
    const raws: string[][] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const sRow: string[] = [];
      const rRow: string[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = model.engine.get(r, c);
        sRow.push(describeCell(cell).text);
        rRow.push(cell?.raw ?? "");
      }
      shown.push(sRow);
      raws.push(rRow);
    }
    const clip: InternalClip = { v: 1, sheet: load.id, r: rect.r1, c: rect.c1, cut, raws, fullRows: raws.length, fullCols: raws[0].length };
    const text = toText(shown);
    lastCopy.current = { text, clip };
    setCopied({ sheet: load.id, rect, cut });
    setAnnouncement(`${cut ? "Cut" : "Copied"} ${rectAddr(rect)}`);
    return { text, html: toHtml(shown), internal: JSON.stringify(clip) };
  };

  const onCopy = useStable((e: ClipboardEvent<HTMLDivElement>, cut?: boolean) => {
    if (clipboardFallback.current) clearTimeout(clipboardFallback.current);
    e.preventDefault();
    const out = buildCopy(cut === true);
    if (!out) return;
    e.clipboardData.setData("text/plain", out.text);
    e.clipboardData.setData("text/html", out.html);
    try {
      e.clipboardData.setData(INTERNAL_TYPE, out.internal);
    } catch {
      // Some browsers only allow standard types; the text fingerprint covers that case.
    }
  });

  const onCut = useStable((e: ClipboardEvent<HTMLDivElement>) => {
    if (viewOnly) return e.preventDefault();
    onCopy(e, true);
  });

  const paste = (internalJson: string, html: string, text: string) => {
    if (!model || viewOnly) return;
    if (text.length > MAX_TEXT || html.length > MAX_TEXT) {
      toast(`That's ${(Math.max(text.length, html.length) / 1e6).toFixed(1)} MB of data — more than can be pasted at once (8 MB).`, "warn");
      return;
    }
    const cur = selRef.current;
    const rect = selRect(cur);
    const maxRows = model.rows - rect.r1;
    const maxCols = model.cols - rect.c1;

    let clip = internalJson ? readInternal(internalJson, maxRows, maxCols) : null;
    if (!clip && lastCopy.current && text && text === lastCopy.current.text) {
      const c = lastCopy.current.clip;
      clip = { ...c, raws: c.raws.slice(0, maxRows).map((row) => row.slice(0, maxCols)) };
    }

    let values: string[][];
    let fullRows: number;
    let fullCols: number;
    if (clip) {
      const dr = rect.r1 - clip.r;
      const dc = rect.c1 - clip.c;
      values = clip.cut ? clip.raws : clip.raws.map((row) => row.map((raw) => shiftFormula(raw, dr, dc, model.rows, model.cols)));
      fullRows = clip.fullRows;
      fullCols = clip.fullCols;
    } else {
      // Prefer the HTML table (it keeps cells intact), unless it's too big to parse cheaply.
      const block = (html && html.length <= MAX_HTML && parseHtmlTable(html, maxRows, maxCols)) || parseText(text, maxRows, maxCols);
      values = block.cells;
      fullRows = block.fullRows;
      fullCols = block.fullCols;
    }
    if (!values.length || !values.some((row) => row.length)) return;

    const changes: Array<[number, string]> = [];
    // A cut moves cells: clear where they came from first.
    if (clip?.cut && clip.sheet === load.id) {
      for (let i = 0; i < clip.raws.length; i++)
        for (let j = 0; j < clip.raws[i].length; j++) changes.push([keyOf(clip.r + i, clip.c + j), ""]);
    }

    let target: Rect;
    const single = values.length === 1 && values[0].length === 1;
    if (single && rectArea(rect) > 1 && rectArea(rect) <= MAX_COPY) {
      // One value pasted over a range fills the range, the way spreadsheets do.
      const raw = values[0][0];
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++)
          changes.push([keyOf(r, c), clip && !clip.cut ? shiftFormula(clip.raws[0][0], r - clip.r, c - clip.c, model.rows, model.cols) : raw]);
      target = rect;
    } else {
      let width = 0;
      values.forEach((row, i) => {
        width = Math.max(width, row.length);
        row.forEach((raw, j) => changes.push([keyOf(rect.r1 + i, rect.c1 + j), raw]));
      });
      target = { r1: rect.r1, c1: rect.c1, r2: rect.r1 + values.length - 1, c2: rect.c1 + width - 1 };
    }

    const after: Sel = { anchor: { r: target.r1, c: target.c1 }, focus: { r: target.r2, c: target.c2 }, active: { r: target.r1, c: target.c1 } };
    applyChanges(changes, after);
    if (clip?.cut) {
      setCopied(null);
      lastCopy.current = null;
    }
    const pasted = rectArea(target);
    const full = fullRows * fullCols;
    if (!single && full > pasted) {
      toast(`Pasted ${pasted.toLocaleString()} of ${full.toLocaleString()} cells — the rest didn't fit on this sheet.`, "warn");
    }
    setAnnouncement(`Pasted into ${rectAddr(target)}`);
  };

  const onPaste = useStable((e: ClipboardEvent<HTMLDivElement>) => {
    if (clipboardFallback.current) clearTimeout(clipboardFallback.current);
    e.preventDefault();
    const dt = e.clipboardData;
    paste(dt.getData(INTERNAL_TYPE), dt.getData("text/html"), dt.getData("text/plain"));
  });

  // Safari only fires clipboard events at editable elements. If the event hasn't arrived
  // shortly after the shortcut, fall back to the async clipboard API.
  const armClipboardFallback = (kind: "copy" | "cut" | "paste") => {
    if (clipboardFallback.current) clearTimeout(clipboardFallback.current);
    clipboardFallback.current = setTimeout(async () => {
      clipboardFallback.current = null;
      try {
        if (kind === "paste") paste("", "", await navigator.clipboard.readText());
        else {
          const out = buildCopy(kind === "cut");
          if (out) await navigator.clipboard.writeText(out.text);
        }
      } catch {
        toast("Your browser blocked the clipboard. Use the Edit menu to copy or paste.", "warn");
      }
    }, 80);
  };

  // ---- the keyboard, when the grid itself has focus ----

  const onGridKeyDown = useStable((e: KeyboardEvent<HTMLDivElement>) => {
    if (!model) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const cur = selRef.current;

    if (arrows[k]) {
      e.preventDefault();
      tabStartCol.current = null;
      return move(arrows[k][0], arrows[k][1], e.shiftKey, mod);
    }
    if (e.altKey && (k === "PageDown" || k === "PageUp")) {
      e.preventDefault();
      const i = sheets.findIndex((x) => x.id === load.id);
      const next = sheets[(i + (k === "PageDown" ? 1 : -1) + sheets.length) % sheets.length];
      if (next && next.id !== load.id) switchSheet(next.id);
      return;
    }
    switch (k) {
      case "Tab": {
        e.preventDefault();
        tabStartCol.current ??= cur.active.c;
        return move(0, e.shiftKey ? -1 : 1, false, false);
      }
      case "Enter":
        e.preventDefault();
        return startEdit(cur.active, "edit");
      case "F2":
        e.preventDefault();
        return startEdit(cur.active, "edit");
      case "Escape":
        e.preventDefault();
        setCopied(null);
        return select(selAt(cur.active), false);
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return clearSelection();
      case "PageDown":
      case "PageUp": {
        e.preventDefault();
        const n = gridRef.current?.visibleRows() ?? 20;
        return move(k === "PageDown" ? n : -n, 0, e.shiftKey, false);
      }
      case "Home": {
        e.preventDefault();
        const to = mod ? { r: 0, c: 0 } : { r: cur.active.r, c: 0 };
        return e.shiftKey ? select({ ...cur, focus: to }) : select(selAt(to));
      }
      case "End": {
        e.preventDefault();
        const last = model.engine.lastUsed();
        const to = mod ? last : { r: cur.active.r, c: last.c };
        return e.shiftKey ? select({ ...cur, focus: to }) : select(selAt(to));
      }
    }
    if (k === " " && e.shiftKey && !mod) {
      e.preventDefault();
      return select({ anchor: { r: cur.active.r, c: 0 }, focus: { r: cur.active.r, c: model.cols - 1 }, active: cur.active }, false);
    }
    if (k === " " && e.ctrlKey) {
      e.preventDefault();
      return select({ anchor: { r: 0, c: cur.active.c }, focus: { r: model.rows - 1, c: cur.active.c }, active: cur.active }, false);
    }
    if (mod && !e.altKey) {
      const lower = k.toLowerCase();
      if (lower === "a") {
        e.preventDefault();
        return select({ anchor: { r: 0, c: 0 }, focus: { r: model.rows - 1, c: model.cols - 1 }, active: cur.active }, false);
      }
      if (lower === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (lower === "y") {
        e.preventDefault();
        return redo();
      }
      if (lower === "c" || lower === "x" || lower === "v") {
        // Let the browser fire the real clipboard event; arm the fallback in case it doesn't.
        return armClipboardFallback(lower === "c" ? "copy" : lower === "x" ? "cut" : "paste");
      }
      return;
    }
    if (isPrintable(e)) {
      if (viewOnly) return;
      e.preventDefault();
      setCopied(null);
      return startEdit(cur.active, "enter", e.key);
    }
  });

  // ---- sheets ----

  const switchSheet = (id: string) => {
    commitEdit(null);
    setEditing(null);
    const remembered = lastSel.current.get(id);
    const cell = remembered ? addr(remembered.active.r, remembered.active.c) : "A1";
    router.push(`/s/${id}?cell=${cell}`);
  };

  const addSheet = async () => {
    setAdding(true);
    try {
      const res = await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error();
      const meta = (await res.json()) as SheetMeta;
      setSheets((xs) => [...xs, meta]);
      switchSheet(meta.id);
    } catch {
      toast("Couldn't add a sheet. Check your connection and try again.", "warn");
    } finally {
      setAdding(false);
    }
  };

  const renameSheet = (id: string, name: string) => {
    setSheets((xs) => xs.map((x) => (x.id === id ? { ...x, name } : x)));
    const m = models.current.get(id);
    if (m) {
      m.rename(name);
      bump();
    } else {
      // Not loaded yet: send it straight away.
      void fetch(`/api/sheets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    }
  };

  const onResize = useStable((c: number, w: number, done: boolean) => {
    model?.setWidth(c, w, done);
    bump();
  });

  // Keep the tab names in step with names restored from a local journal.
  useEffect(() => {
    if (model && sheets.some((x) => x.id === load.id && x.name !== model.name)) {
      setSheets((xs) => xs.map((x) => (x.id === load.id ? { ...x, name: model.name } : x)));
    }
  }, [model, load.id, sheets]);

  // ---- derived view state ----

  const rect = selRect(sel);
  const stats = useMemo(() => (model ? model.engine.stats(rect) : { count: 0, numbers: 0, sum: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, version, rect.r1, rect.c1, rect.r2, rect.c2]);
  const activeCell = model?.engine.get(sel.active.r, sel.active.c);
  const activeError = activeCell && isError(activeCell.value) ? activeCell.value : null;
  const barValue = editing ? editing.text : activeCell?.raw ?? "";
  const mode = editing ? (editing.mode === "enter" ? "Enter" : "Edit") : viewOnly ? "View only" : "Ready";
  const sheetName = model?.name ?? sheets.find((x) => x.id === sheetId)?.name ?? "Sheet";
  const isEmpty = model !== null && model.engine.cells.size === 0 && !editing;

  let main;
  if (load.state === "loading" || (load.state === "ready" && !model)) {
    main = <GridSkeleton />;
  } else if (load.state === "missing") {
    main = (
      <Screen
        icon="search"
        title="There's no sheet here"
        actions={
          <>
            {sheets.slice(0, 3).map((x) => (
              <Button key={x.id} onClick={() => switchSheet(x.id)}>
                Open {x.name}
              </Button>
            ))}
            <Button variant="primary" icon="plus" onClick={addSheet} disabled={adding}>
              New sheet
            </Button>
          </>
        }
      >
        <p>
          Nothing is saved under <code className={s.code}>{sheetId}</code>. It may have been a typo, or a link to a sheet from before a reset.
        </p>
      </Screen>
    );
  } else if (load.state === "error") {
    main = (
      <Screen
        icon="cloud"
        tone="error"
        title="Couldn't open this sheet"
        actions={
          <Button
            variant="primary"
            icon="refresh"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete("fail");
              window.history.replaceState(null, "", url);
              setRetryKey((k) => k + 1);
            }}
          >
            Try again
          </Button>
        }
      >
        <p>{load.message}. Nothing you've typed is lost — unsaved edits are kept on this device until they reach the server.</p>
      </Screen>
    );
  } else if (model) {
    main = (
      <Grid
        ref={gridRef}
        model={model}
        version={version + model.version}
        sel={sel}
        editing={editing}
        copied={copied && copied.sheet === load.id ? copied.rect : null}
        label={`${model.name} sheet`}
        onPointerSelect={onPointerSelect}
        onEditStart={onEditStart}
        onEditText={onEditText}
        onEditKeyDown={onEditKeyDown}
        onEditBlur={onEditBlur}
        onKeyDown={onGridKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onResize={onResize}
      >
        {isEmpty && <EmptyHint />}
      </Grid>
    );
  }

  // Focus the grid once a sheet is on screen, so the keyboard works straight away.
  useEffect(() => {
    if (load.state === "ready") gridRef.current?.focus();
  }, [load.state, load.id]);

  return (
    <div className={s.app}>
      <header className={s.top}>
        <div className={s.brand}>
          <span className={s.logo} aria-hidden="true">
            <Icon name="grid" size={16} />
          </span>
          <span className={s.product}>Small Sheet</span>
          <span className={s.slash} aria-hidden="true">
            /
          </span>
          <h1 className={s.sheetName}>{sheetName}</h1>
        </div>
        <div className={s.tools} role="toolbar" aria-label="Sheet tools">
          <IconButton icon="undo" label="Undo (⌘/Ctrl+Z)" onClick={undo} disabled={!model?.canUndo || viewOnly} />
          <IconButton icon="redo" label="Redo (⌘/Ctrl+Shift+Z)" onClick={redo} disabled={!model?.canRedo || viewOnly} />
          <span className={s.divider} aria-hidden="true" />
          <IconButton
            icon="freeze"
            label="Freeze first column"
            aria-pressed={model?.frozen ?? false}
            disabled={!model}
            onClick={() => {
              if (!model) return;
              model.setFrozen(!model.frozen);
              bump();
            }}
          />
          <IconButton icon="keyboard" label="Keyboard shortcuts" onClick={() => dialogRef.current?.showModal()} />
        </div>
        <div className={s.save}>
          <SaveStatus status={saveStatus} onRetry={retryAll} />
        </div>
      </header>

      {viewOnly && (
        <div className={s.viewOnly} role="note">
          View only on small screens. Open this sheet on a tablet or computer to edit it.
        </div>
      )}

      <FormulaBar
        address={rectArea(rect) > 1 ? rectAddr(rect) : addr(sel.active.r, sel.active.c)}
        value={barValue}
        editingHere={editing?.origin === "bar"}
        error={editing ? null : activeError}
        readOnly={viewOnly || !model}
        onFocusInput={() => {
          if (!model || viewOnly) return;
          const ed = editingRef.current;
          if (ed) setEditing({ ...ed, origin: "bar", mode: "edit" });
          else setEditing({ r: sel.active.r, c: sel.active.c, text: activeCell?.raw ?? "", mode: "edit", origin: "bar" });
        }}
        onText={onEditText}
        onKeyDown={onEditKeyDown}
        onBlur={(e) => {
          const to = e.relatedTarget as HTMLElement | null;
          if (editingRef.current?.origin === "bar" && to && to.getAttribute("role") !== "grid") commitEdit(null);
        }}
        onJump={(r) => {
          if (!model || r.r2 >= model.rows || r.c2 >= model.cols) return false;
          select({ anchor: { r: r.r1, c: r.c1 }, focus: { r: r.r2, c: r.c2 }, active: { r: r.r1, c: r.c1 } });
          return true;
        }}
        onLeave={() => gridRef.current?.focus()}
      />

      <main className={s.main}>{main}</main>

      <footer className={s.foot}>
        <SheetTabs sheets={sheets} activeId={sheetId} adding={adding} onSelect={switchSheet} onAdd={addSheet} onRename={renameSheet} />
        <StatusBar stats={stats} mode={mode} />
      </footer>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      <Shortcuts ref={dialogRef} onClose={() => gridRef.current?.focus()} />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
