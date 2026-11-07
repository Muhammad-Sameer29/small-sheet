// Everything that comes out of the clipboard is untrusted: another spreadsheet, a web page,
// a 40 MB log file, or something built to break us. This module turns it into a plain
// grid of strings and nothing else. It never inserts HTML into the page, and it only ever
// keeps as many cells as fit where they're being pasted, so the cost of a paste is bounded
// by the target area rather than by whatever was copied.

export const INTERNAL_TYPE = "application/x-small-sheet";

// Beyond this the paste is refused outright. A 50,000-cell block from Excel is ~1 MB.
export const MAX_TEXT = 8_000_000;
// Parsing HTML builds a full DOM, which is much heavier than scanning text. Over this size
// we use the plain-text flavour instead, which every app puts on the clipboard alongside.
export const MAX_HTML = 1_500_000;
export const MAX_CELL = 5_000;

export interface Block {
  cells: string[][];
  // How big the copied block was before it was clipped to fit.
  fullRows: number;
  fullCols: number;
}

// Control characters have no business in a cell. Tabs and newlines become
// spaces because cells here are single-line.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanCell(v: string): string {
  let s = v.replace(/\r\n?|\n|\t/g, " ").replace(CONTROL, "");
  if (s.length > MAX_CELL) s = s.slice(0, MAX_CELL);
  return s;
}

export function parseText(text: string, maxRows: number, maxCols: number): Block {
  const cells: string[][] = [];
  let row: string[] = [];
  let field = "";
  let rowCount = 0;
  let fullCols = 0;
  let col = 0;
  let i = 0;
  const n = text.length;
  // Once a search for a closing quote fails, none exists further on either. Remembering
  // that keeps a block of unbalanced quotes from turning the scan quadratic.
  let noQuoteFrom = Infinity;

  const endField = () => {
    if (rowCount < maxRows && col < maxCols) row.push(cleanCell(field));
    field = "";
    col++;
  };
  const endRow = () => {
    endField();
    fullCols = Math.max(fullCols, col);
    if (rowCount < maxRows) cells.push(row);
    row = [];
    col = 0;
    rowCount++;
  };

  while (i < n) {
    const ch = text[i];
    // Spreadsheets quote a cell when it contains a tab, newline or quote.
    if (ch === '"' && field === "" && i < noQuoteFrom) {
      const close = findClosingQuote(text, i + 1);
      if (close === -1) noQuoteFrom = i;
      if (close !== -1) {
        const next = text[close + 1];
        if (next === undefined || next === "\t" || next === "\n" || next === "\r") {
          field = text.slice(i + 1, close).replace(/""/g, '"');
          i = close + 1;
          continue;
        }
      }
    }
    if (ch === "\t") {
      endField();
      i++;
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      // Only accumulate characters we're going to keep.
      if (rowCount < maxRows && col < maxCols && field.length <= MAX_CELL) field += ch;
      i++;
    }
  }
  if (field !== "" || col > 0) endRow();

  while (cells.length && cells[cells.length - 1].every((v) => v === "")) {
    cells.pop();
    rowCount--;
  }
  return { cells, fullRows: Math.max(rowCount, cells.length), fullCols };
}

function findClosingQuote(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const q = text.indexOf('"', i);
    if (q === -1) return -1;
    if (text[q + 1] === '"') {
      i = q + 2;
      continue;
    }
    return q;
  }
  return -1;
}

// Reads the first <table> in some HTML. DOMParser gives an inert document: scripts don't
// run and images don't load, and we only ever read textContent back out of it.
export function parseHtmlTable(html: string, maxRows: number, maxCols: number): Block | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  doc.querySelectorAll("br").forEach((br) => br.replaceWith(" "));

  const cells: string[][] = [];
  const spanning: number[] = []; // rows still covered by a rowspan above, per column
  let fullCols = 0;
  const rows = Array.from(table.rows);
  rows.forEach((tr, ri) => {
    const out: string[] = [];
    let c = 0;
    const skipSpanned = () => {
      while (spanning[c] > 0) {
        spanning[c]--;
        if (ri < maxRows && c < maxCols) out.push("");
        c++;
      }
    };
    for (const td of Array.from(tr.cells)) {
      skipSpanned();
      const text = (td.textContent ?? "").replace(/\s+/g, " ").trim();
      const colspan = clampSpan(td.colSpan);
      const rowspan = clampSpan(td.rowSpan);
      for (let k = 0; k < colspan; k++) {
        if (ri < maxRows && c < maxCols) out.push(k === 0 ? cleanCell(text) : "");
        if (rowspan > 1) spanning[c] = rowspan - 1;
        c++;
      }
    }
    skipSpanned();
    fullCols = Math.max(fullCols, c);
    if (ri < maxRows) cells.push(out);
  });
  if (!cells.length) return null;
  return { cells, fullRows: rows.length, fullCols };
}

const clampSpan = (n: number) => (Number.isFinite(n) && n > 1 ? Math.min(n, 1000) : 1);

export interface InternalClip {
  v: 1;
  sheet: string;
  r: number;
  c: number;
  cut: boolean;
  raws: string[][];
}

// Our own format can also be forged by any page, so it gets checked like everything else.
export function readInternal(json: string, maxRows: number, maxCols: number): InternalClip | null {
  if (json.length > MAX_TEXT) return null;
  try {
    const d = JSON.parse(json);
    if (d?.v !== 1 || !Array.isArray(d.raws) || !Number.isInteger(d.r) || !Number.isInteger(d.c)) return null;
    const raws: string[][] = [];
    for (const row of d.raws.slice(0, maxRows)) {
      if (!Array.isArray(row)) return null;
      raws.push(row.slice(0, maxCols).map((v: unknown) => (typeof v === "string" ? cleanCell(v) : "")));
    }
    return { v: 1, sheet: String(d.sheet ?? ""), r: d.r, c: d.c, cut: d.cut === true, raws };
  } catch {
    return null;
  }
}

export function toText(values: string[][]): string {
  return values
    .map((row) => row.map((v) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join("\t"))
    .join("\n");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(values: string[][]): string {
  const body = values
    .map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${body}</table>`;
}
