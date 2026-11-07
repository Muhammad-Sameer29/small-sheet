// What travels between the browser and the route handlers.

export interface SheetMeta {
  id: string;
  name: string;
}

export interface SheetDoc extends SheetMeta {
  rows: number;
  cols: number;
  frozen: boolean;
  // Column index -> width in px. Columns not listed use the default width.
  colWidths: Record<number, number>;
  // "B7" -> what was typed.
  cells: Record<string, string>;
}

export interface LoadedSheet extends SheetDoc {
  // Changes every time the fixtures are reset, so unsaved edits kept in the browser from
  // before a reset aren't replayed on top of fresh data.
  generation: string;
}

export interface SheetPatch {
  // An empty string clears the cell.
  cells?: Record<string, string>;
  name?: string;
  frozen?: boolean;
  colWidths?: Record<number, number>;
}

export const MAX_NAME = 40;
export const MAX_RAW = 10_000;
