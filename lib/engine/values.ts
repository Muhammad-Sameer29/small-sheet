export type ErrorCode = "#ERROR!" | "#NAME?" | "#REF!" | "#DIV/0!" | "#VALUE!" | "#CYCLE!" | "#NUM!";

export class CellError {
  constructor(
    public code: ErrorCode,
    public message: string,
    // The cell the problem started in, when this error was passed along from another cell.
    public origin?: string,
  ) {}
}

// null is an empty cell. Formulas never produce null; an empty reference reads as 0.
export type Value = number | string | null | CellError;

export const isError = (v: unknown): v is CellError => v instanceof CellError;

export function formatNumber(n: number): string {
  if (Object.is(n, -0)) n = 0;
  let v = Number(n.toPrecision(12));
  if (!Number.isInteger(v) && Math.abs(v) >= 1e-4) v = Number(v.toFixed(6));
  if (Math.abs(v) >= 1e15) return v.toExponential(4);
  return String(v);
}

const statFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
export const formatStat = (n: number) => statFormat.format(Number(n.toPrecision(12)));
