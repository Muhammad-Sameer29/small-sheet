import { colName } from "./address";
import { isFormula } from "./engine";
import { tokenize, type Token } from "./tokenize";

type RefToken = Extract<Token, { t: "ref" }>;

// Rewrites relative references when a formula is pasted somewhere else, so =A1*2 copied
// one row down becomes =A2*2. $-anchored parts stay put. A reference pushed off the top
// or left edge becomes #REF!, the same as Excel.
export function shiftFormula(raw: string, dr: number, dc: number, rows: number, cols: number): string {
  if (!isFormula(raw) || (dr === 0 && dc === 0)) return raw;
  const src = raw.slice(1);
  const tokens = tokenize(src);
  let out = "";
  let last = 0;

  const move = (t: RefToken) => {
    const r = t.absR ? t.r : t.r + dr;
    const c = t.absC ? t.c : t.c + dc;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    return `${t.absC ? "$" : ""}${colName(c)}${t.absR ? "$" : ""}${r + 1}`;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== "ref") continue;
    const colon = tokens[i + 1];
    const end = tokens[i + 2];
    if (colon?.t === "op" && colon.value === ":" && end?.t === "ref") {
      const a = move(t);
      const b = move(end);
      out += src.slice(last, t.start) + (a && b ? `${a}:${b}` : "#REF!");
      last = end.end;
      i += 2;
      continue;
    }
    const a = move(t);
    out += src.slice(last, t.start) + (a ?? "#REF!");
    last = t.end;
  }
  return "=" + out + src.slice(last);
}
