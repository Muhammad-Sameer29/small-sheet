import { promises as fs } from "node:fs";
import path from "node:path";
import { emptySheet, fixtures } from "../fixtures";
import { parseAddr } from "../engine/address";
import { MAX_NAME, MAX_RAW, type LoadedSheet, type SheetDoc, type SheetMeta, type SheetPatch } from "../types";

// Sheets live as JSON files in .data/. Deleting the folder resets everything: the next
// request rebuilds it from the fixtures.
const ROOT = path.join(process.cwd(), ".data");
const SHEETS = path.join(ROOT, "sheets");
const INDEX = path.join(ROOT, "index.json");

interface Index {
  generation: string;
  sheets: SheetMeta[];
}

const ID_RE = /^[a-z0-9-]{1,48}$/;

let seeding: Promise<void> | null = null;

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

async function seed() {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(SHEETS, { recursive: true });
  const docs = fixtures();
  for (const doc of docs) await writeJson(path.join(SHEETS, `${doc.id}.json`), doc);
  const index: Index = {
    generation: Date.now().toString(36),
    sheets: docs.map(({ id, name }) => ({ id, name })),
  };
  await writeJson(INDEX, index);
}

async function ready() {
  if (await exists(INDEX)) return;
  seeding ??= seed().finally(() => (seeding = null));
  await seeding;
}

async function readIndex(): Promise<Index> {
  await ready();
  return JSON.parse(await fs.readFile(INDEX, "utf8"));
}

// One write at a time per file, so two saves landing together can't interleave.
const locks = new Map<string, Promise<unknown>>();
function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(name, next.catch(() => {}));
  return next;
}

export async function listSheets() {
  return readIndex();
}

export async function readSheet(id: string): Promise<LoadedSheet | null> {
  if (!ID_RE.test(id)) return null;
  const index = await readIndex();
  if (!index.sheets.some((s) => s.id === id)) return null;
  const doc: SheetDoc = JSON.parse(await fs.readFile(path.join(SHEETS, `${id}.json`), "utf8"));
  return { ...doc, generation: index.generation };
}

export class PatchError extends Error {}

function validate(doc: SheetDoc, patch: SheetPatch) {
  if (patch.cells !== undefined) {
    if (typeof patch.cells !== "object" || patch.cells === null) throw new PatchError("cells must be an object");
    for (const [a, raw] of Object.entries(patch.cells)) {
      const p = parseAddr(a);
      if (!p || p.r >= doc.rows || p.c >= doc.cols) throw new PatchError(`${a} is not a cell on this sheet`);
      if (typeof raw !== "string" || raw.length > MAX_RAW) throw new PatchError(`${a} has an invalid value`);
    }
  }
  if (patch.name !== undefined && (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > MAX_NAME)) {
    throw new PatchError("Invalid name");
  }
  if (patch.frozen !== undefined && typeof patch.frozen !== "boolean") throw new PatchError("Invalid frozen flag");
  if (patch.colWidths !== undefined) {
    for (const [c, w] of Object.entries(patch.colWidths)) {
      if (!/^\d+$/.test(c) || Number(c) >= doc.cols || typeof w !== "number" || w < 24 || w > 1000) {
        throw new PatchError("Invalid column width");
      }
    }
  }
}

export async function patchSheet(id: string, patch: SheetPatch): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  return exclusive(id, async () => {
    const doc = await readSheet(id);
    if (!doc) return false;
    validate(doc, patch);
    const { generation: _generation, ...stored } = doc;
    for (const [a, raw] of Object.entries(patch.cells ?? {})) {
      const key = a.toUpperCase();
      if (raw === "") delete stored.cells[key];
      else stored.cells[key] = raw;
    }
    if (patch.frozen !== undefined) stored.frozen = patch.frozen;
    if (patch.colWidths) stored.colWidths = { ...stored.colWidths, ...patch.colWidths };
    if (patch.name !== undefined) stored.name = patch.name.trim();
    await writeJson(path.join(SHEETS, `${id}.json`), stored);
    if (patch.name !== undefined) {
      await exclusive("index", async () => {
        const index = await readIndex();
        index.sheets = index.sheets.map((s) => (s.id === id ? { ...s, name: stored.name } : s));
        await writeJson(INDEX, index);
      });
    }
    return true;
  });
}

export async function createSheet(name?: string): Promise<SheetMeta> {
  return exclusive("index", async () => {
    const index = await readIndex();
    let n = index.sheets.length + 1;
    while (index.sheets.some((s) => s.id === `sheet-${n}` || s.name === `Sheet ${n}`)) n++;
    const clean = name?.trim().slice(0, MAX_NAME);
    const meta = { id: `sheet-${n}`, name: clean || `Sheet ${n}` };
    await writeJson(path.join(SHEETS, `${meta.id}.json`), emptySheet(meta.id, meta.name));
    index.sheets.push(meta);
    await writeJson(INDEX, index);
    return meta;
  });
}

export async function resetAll() {
  await exclusive("index", seed);
}
