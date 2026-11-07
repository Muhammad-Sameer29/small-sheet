import { colIndex } from "./address";

export type Token =
  | { t: "num"; value: number; start: number; end: number }
  | { t: "str"; value: string; start: number; end: number }
  | { t: "ref"; r: number; c: number; absR: boolean; absC: boolean; start: number; end: number }
  | { t: "name"; value: string; start: number; end: number }
  | { t: "op"; value: string; start: number; end: number }
  | { t: "refErr"; start: number; end: number }
  | { t: "bad"; value: string; start: number; end: number };

const NUM_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.])/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPS = "+-*/^&(),:";

// Tokenizes the part of a formula after "=". Never throws: anything it can't read
// becomes a "bad" token and the parser turns that into a #ERROR! with a message.
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const rest = src.slice(i);

    if (ch === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += src[j++];
      }
      if (!closed) {
        out.push({ t: "bad", value: "Text is missing its closing quote", start: i, end: src.length });
        return out;
      }
      out.push({ t: "str", value, start: i, end: j });
      i = j;
      continue;
    }

    if (rest.toUpperCase().startsWith("#REF!")) {
      out.push({ t: "refErr", start: i, end: i + 5 });
      i += 5;
      continue;
    }

    let m = NUM_RE.exec(rest);
    if (m && (ch >= "0" && ch <= "9" || ch === ".")) {
      out.push({ t: "num", value: parseFloat(m[0]), start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }

    m = REF_RE.exec(rest);
    if (m) {
      out.push({
        t: "ref",
        absC: m[1] === "$",
        c: colIndex(m[2]),
        absR: m[3] === "$",
        r: parseInt(m[4], 10) - 1,
        start: i,
        end: i + m[0].length,
      });
      i += m[0].length;
      continue;
    }

    m = NAME_RE.exec(rest);
    if (m) {
      out.push({ t: "name", value: m[0].toUpperCase(), start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }

    if (OPS.includes(ch)) {
      out.push({ t: "op", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    out.push({ t: "bad", value: `Unexpected character “${ch}”`, start: i, end: i + 1 });
    return out;
  }
  return out;
}
