import { tokenize, type Token } from "./tokenize";

export type Node =
  | { k: "num"; value: number }
  | { k: "str"; value: string }
  | { k: "ref"; r: number; c: number }
  | { k: "range"; r1: number; c1: number; r2: number; c2: number }
  | { k: "refErr" }
  | { k: "name"; name: string }
  | { k: "neg"; arg: Node }
  | { k: "bin"; op: string; left: Node; right: Node }
  | { k: "call"; name: string; args: Node[] };

export type Parsed = { ok: true; node: Node } | { ok: false; message: string };

class ParseError extends Error {}

// Precedence follows Excel and Google Sheets, so the results match what people expect:
//   &  <  + -  <  * /  <  ^  <  unary minus  <  range (:)
// which means -2^2 is 4 and 2^3^2 is 64. Surprising on paper, familiar in a spreadsheet.
export function parseFormula(src: string): Parsed {
  const tokens = tokenize(src);
  const bad = tokens.find((t) => t.t === "bad");
  if (bad && bad.t === "bad") return { ok: false, message: bad.value };
  if (tokens.length === 0) return { ok: false, message: "The formula is empty" };

  let pos = 0;
  // Keeps a pasted "((((((…" from blowing the stack.
  let depth = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string) => {
    const t = tokens[pos];
    return t !== undefined && t.t === "op" && t.value === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) {
      const t = peek();
      throw new ParseError(t ? `Expected “${v}”` : `Missing “${v}” at the end`);
    }
    pos++;
  };

  function concat(): Node {
    let left = additive();
    while (isOp("&")) {
      pos++;
      left = { k: "bin", op: "&", left, right: additive() };
    }
    return left;
  }

  function additive(): Node {
    let left = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { value: string }).value;
      left = { k: "bin", op, left, right: multiplicative() };
    }
    return left;
  }

  function multiplicative(): Node {
    let left = power();
    while (isOp("*") || isOp("/")) {
      const op = (tokens[pos++] as { value: string }).value;
      left = { k: "bin", op, left, right: power() };
    }
    return left;
  }

  function power(): Node {
    let left = unary();
    while (isOp("^")) {
      pos++;
      left = { k: "bin", op: "^", left, right: unary() };
    }
    return left;
  }

  function unary(): Node {
    if (++depth > 200) throw new ParseError("This formula is nested too deeply");
    try {
      return unaryInner();
    } finally {
      depth--;
    }
  }

  function unaryInner(): Node {
    if (isOp("-")) {
      pos++;
      return { k: "neg", arg: unary() };
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return primary();
  }

  function primary(): Node {
    const t = peek();
    if (!t) throw new ParseError("The formula ends too early");
    pos++;
    switch (t.t) {
      case "num":
        return { k: "num", value: t.value };
      case "str":
        return { k: "str", value: t.value };
      case "refErr":
        if (isOp(":")) {
          pos++;
          primary();
        }
        return { k: "refErr" };
      case "ref": {
        if (isOp(":")) {
          pos++;
          const end = peek();
          if (end?.t === "refErr") {
            pos++;
            return { k: "refErr" };
          }
          if (!end || end.t !== "ref") throw new ParseError("A range needs a cell on both sides of “:”");
          pos++;
          return {
            k: "range",
            r1: Math.min(t.r, end.r),
            c1: Math.min(t.c, end.c),
            r2: Math.max(t.r, end.r),
            c2: Math.max(t.c, end.c),
          };
        }
        return { k: "ref", r: t.r, c: t.c };
      }
      case "name": {
        if (!isOp("(")) return { k: "name", name: t.value };
        pos++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(concat());
          while (isOp(",")) {
            pos++;
            args.push(concat());
          }
        }
        expect(")");
        return { k: "call", name: t.value, args };
      }
      case "op":
        if (t.value === "(") {
          const inner = concat();
          expect(")");
          return inner;
        }
        throw new ParseError(`Unexpected “${t.value}”`);
      default:
        throw new ParseError("Couldn't read this formula");
    }
  }

  try {
    const node = concat();
    if (pos < tokens.length) {
      const t = tokens[pos];
      const text = src.slice(t.start, t.end);
      throw new ParseError(`Unexpected “${text}”`);
    }
    return { ok: true, node };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, message: e.message };
    throw e;
  }
}
