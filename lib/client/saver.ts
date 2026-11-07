import type { SheetPatch } from "../types";

export type SaveState = "saved" | "saving" | "failed";

export interface SaveStatus {
  state: SaveState;
  unsaved: number;
  error?: string;
  retryAt?: number;
  savedAt?: number;
  // localStorage refused the journal, so a reload right now *would* lose edits.
  atRisk: boolean;
}

type Meta = Omit<SheetPatch, "cells">;

interface Journal {
  generation: string;
  cells: Record<string, string>;
  meta: Meta;
}

const journalKey = (id: string) => `small-sheet:unsaved:${id}`;

export function readJournal(id: string, generation: string): Journal | null {
  try {
    const raw = localStorage.getItem(journalKey(id));
    if (!raw) return null;
    const j = JSON.parse(raw) as Journal;
    if (j.generation !== generation || typeof j.cells !== "object") {
      localStorage.removeItem(journalKey(id));
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

const DEBOUNCE = 400;
const MAX_BACKOFF = 20_000;

// Saves one sheet. The rules:
//  - Edits wait in `pending` (latest value per cell). At most one request is in flight.
//  - Anything not yet confirmed by the server is also written to localStorage, so a reload
//    or a crash mid-save brings it back and sends it again.
//  - If a save fails, its cells go back into `pending` unless the person has since typed
//    something newer there. Then it retries with backoff, or right away on "Retry now".
// Patches only ever set cells to values, so resending one is harmless.
export class Saver {
  private pending = new Map<string, string>();
  private pendingMeta: Meta = {};
  private inflight: { cells: Map<string, string>; meta: Meta } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private journalTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private listeners = new Set<() => void>();
  status: SaveStatus = { state: "saved", unsaved: 0, atRisk: false };

  constructor(
    private id: string,
    private generation: string,
  ) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  queueCells(entries: Iterable<[string, string]>) {
    for (const [a, raw] of entries) this.pending.set(a, raw);
    this.changed();
  }

  queueMeta(meta: Meta) {
    const widths = this.pendingMeta.colWidths;
    Object.assign(this.pendingMeta, meta);
    if (meta.colWidths) this.pendingMeta.colWidths = { ...widths, ...meta.colWidths };
    this.changed();
  }

  retryNow() {
    this.clearTimer();
    void this.flush();
  }

  // Called when the tab is being hidden: no point waiting out the debounce.
  flushSoon() {
    if (this.status.state === "failed") return;
    this.clearTimer();
    void this.flush();
  }

  private changed() {
    this.writeJournalSoon();
    if (this.status.state !== "failed") this.schedule(DEBOUNCE);
    this.setStatus({ state: this.status.state === "failed" ? "failed" : "saving" });
  }

  private schedule(ms: number) {
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private hasPending() {
    return this.pending.size > 0 || Object.keys(this.pendingMeta).length > 0;
  }

  private async flush() {
    this.timer = null;
    if (this.inflight) return;
    if (!this.hasPending()) {
      this.setStatus({ state: "saved", error: undefined, retryAt: undefined });
      return;
    }
    const batch = { cells: this.pending, meta: this.pendingMeta };
    this.inflight = batch;
    this.pending = new Map();
    this.pendingMeta = {};
    this.setStatus({ state: "saving", retryAt: undefined });

    let error: string | null = null;
    try {
      const res = await fetch(`/api/sheets/${this.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...batch.meta, cells: Object.fromEntries(batch.cells) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        error = body?.error ?? `The server answered ${res.status}`;
      }
    } catch {
      error = "Couldn't reach the server";
    }
    this.inflight = null;

    if (error === null) {
      this.failures = 0;
      this.writeJournal();
      if (this.hasPending()) this.schedule(0);
      this.setStatus({
        state: this.hasPending() ? "saving" : "saved",
        error: undefined,
        retryAt: undefined,
        savedAt: Date.now(),
      });
      return;
    }

    // Put the failed batch back underneath anything newer.
    for (const [a, raw] of batch.cells) if (!this.pending.has(a)) this.pending.set(a, raw);
    this.pendingMeta = { ...batch.meta, ...this.pendingMeta };
    if (batch.meta.colWidths || this.pendingMeta.colWidths) {
      this.pendingMeta.colWidths = { ...batch.meta.colWidths, ...this.pendingMeta.colWidths };
    }
    this.failures++;
    const wait = Math.min(MAX_BACKOFF, 1000 * 2 ** this.failures);
    this.schedule(wait);
    this.writeJournal();
    this.setStatus({ state: "failed", error, retryAt: Date.now() + wait });
  }

  private unsavedCount() {
    let n = this.pending.size;
    if (this.inflight) for (const a of this.inflight.cells.keys()) if (!this.pending.has(a)) n++;
    return n;
  }

  private setStatus(patch: Partial<SaveStatus>) {
    this.status = { ...this.status, ...patch, unsaved: this.unsavedCount() };
    this.listeners.forEach((fn) => fn());
  }

  // A 50,000-cell paste shouldn't serialise the journal once per keystroke-sized step.
  private writeJournalSoon() {
    if (this.journalTimer) return;
    this.journalTimer = setTimeout(() => {
      this.journalTimer = null;
      this.writeJournal();
    }, 0);
  }

  private writeJournal() {
    const cells: Record<string, string> = {};
    if (this.inflight) for (const [a, raw] of this.inflight.cells) cells[a] = raw;
    for (const [a, raw] of this.pending) cells[a] = raw;
    const meta = { ...this.inflight?.meta, ...this.pendingMeta };
    let atRisk = false;
    try {
      if (!Object.keys(cells).length && !Object.keys(meta).length) localStorage.removeItem(journalKey(this.id));
      else localStorage.setItem(journalKey(this.id), JSON.stringify({ generation: this.generation, cells, meta }));
    } catch {
      atRisk = true;
    }
    if (atRisk !== this.status.atRisk) this.setStatus({ atRisk });
  }
}
