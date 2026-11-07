import { describe, expect, it } from "vitest";
import { keyOf, parseAddr } from "@/lib/engine/address";
import { SheetEngine } from "@/lib/engine/engine";
import { shiftFormula } from "@/lib/engine/shift";
import { CellError } from "@/lib/engine/values";

function sheet(cells: Record<string, string>, rows = 50, cols = 10) {
  const e = new SheetEngine(rows, cols);
  e.load(Object.entries(cells).map(([a, raw]) => {
    const p = parseAddr(a)!;
    return [keyOf(p.r, p.c), raw] as [number, string];
  }));
  return e;
}

const at = (e: SheetEngine, a: string) => {
  const p = parseAddr(a)!;
  return e.get(p.r, p.c)?.value ?? null;
};
const code = (e: SheetEngine, a: string) => (at(e, a) as CellError).code;
const put = (e: SheetEngine, a: string, raw: string) => {
  const p = parseAddr(a)!;
  return e.set([[keyOf(p.r, p.c), raw]]);
};

describe("formulas", () => {
  it("follows spreadsheet operator precedence", () => {
    const e = sheet({
      A1: "=2+3*4",
      A2: "=(2+3)*4",
      A3: "=-2^2",
      A4: "=2^3^2",
      A5: "=10-4-3",
      A6: '="a"&1+2',
      A7: "=8/2/2",
    });
    expect(at(e, "A1")).toBe(14);
    expect(at(e, "A2")).toBe(20);
    expect(at(e, "A3")).toBe(4);
    expect(at(e, "A4")).toBe(64);
    expect(at(e, "A5")).toBe(3);
    expect(at(e, "A6")).toBe("a3");
    expect(at(e, "A7")).toBe(2);
  });

  it("reads numbers the way people type them", () => {
    const e = sheet({ A1: "1,200", A2: "$45.50", A3: "12%", A4: "'42", B1: "=A1+A2+A3", B2: "=A4+1" });
    expect(at(e, "B1")).toBeCloseTo(1245.62);
    expect(at(e, "A4")).toBe("42");
    expect(at(e, "B2")).toBe(43);
  });

  it("handles ranges and functions, skipping text and blanks", () => {
    const e = sheet({ A1: "10", A2: "note", A3: "20", B1: "=SUM(A1:A5)", B2: "=AVG(A1:A5)", B3: "=COUNT(A1:A5)", B4: "=MAX(A1:A3, 99)", B5: "=sum(a1:a3)" });
    expect(at(e, "B1")).toBe(30);
    expect(at(e, "B2")).toBe(15);
    expect(at(e, "B3")).toBe(2);
    expect(at(e, "B4")).toBe(99);
    expect(at(e, "B5")).toBe(30);
  });

  it("treats an empty reference as zero", () => {
    const e = sheet({ A1: "=B9", A2: "=B9+1" });
    expect(at(e, "A1")).toBe(0);
    expect(at(e, "A2")).toBe(1);
  });

  it("reports broken formulas instead of throwing", () => {
    const e = sheet({
      A1: "=1/0",
      A2: "=A1*2",
      A3: "=Z999",
      A4: "=SUM(1,",
      A5: "=FOO(1)",
      A6: '="apples"+1',
      A7: "=A1:A3",
      A8: "=" + "(".repeat(5000) + "1",
    });
    expect(code(e, "A1")).toBe("#DIV/0!");
    expect(code(e, "A2")).toBe("#DIV/0!");
    expect((at(e, "A2") as CellError).origin).toBe("A1");
    expect(code(e, "A3")).toBe("#REF!");
    expect(code(e, "A4")).toBe("#ERROR!");
    expect(code(e, "A5")).toBe("#NAME?");
    expect(code(e, "A6")).toBe("#VALUE!");
    expect(code(e, "A7")).toBe("#VALUE!");
    expect(code(e, "A8")).toBe("#ERROR!");
  });

  it("finds cycles and marks what depends on them", () => {
    const e = sheet({ A1: "=B1+1", B1: "=A1*2", C1: "=C1", D1: "=A1+5", E1: "=10" });
    expect(code(e, "A1")).toBe("#CYCLE!");
    expect(code(e, "B1")).toBe("#CYCLE!");
    expect(code(e, "C1")).toBe("#CYCLE!");
    expect(code(e, "D1")).toBe("#CYCLE!");
    expect((at(e, "D1") as CellError).origin).toBe("A1");
    expect(at(e, "E1")).toBe(10);
    put(e, "B1", "3");
    expect(at(e, "A1")).toBe(4);
    expect(at(e, "D1")).toBe(9);
  });
});

describe("recalculation", () => {
  it("moves the top of a chain when the bottom changes", () => {
    const e = sheet({ A1: "1", A2: "=A1*2", A3: "=A2+1", A4: "=SUM(A2:A3)", A5: "=A4/2" });
    expect(at(e, "A5")).toBe(2.5);
    put(e, "A1", "10");
    expect(at(e, "A5")).toBe(20.5);
  });

  it("only re-evaluates what depends on the change", () => {
    const cells: Record<string, string> = {};
    for (let r = 1; r <= 1000; r++) {
      cells[`A${r}`] = String(r);
      cells[`B${r}`] = `=A${r}*2`;
    }
    cells["C1"] = "=SUM(B1:B1000)";
    const e = sheet(cells, 1001, 5);
    expect(put(e, "A500", "0")).toBe(2); // B500 and the total, nothing else
    expect(at(e, "C1")).toBe(1000 * 1001 - 1000);
  });

  it("copes with a long chain without recursing", () => {
    const cells: Record<string, string> = { A1: "1" };
    for (let r = 2; r <= 10000; r++) cells[`A${r}`] = `=A${r - 1}+1`;
    const e = sheet(cells, 10000, 2);
    expect(at(e, "A10000")).toBe(10000);
    put(e, "A1", "0");
    expect(at(e, "A10000")).toBe(9999);
  });
});

describe("shifting references", () => {
  it("moves relative parts and keeps anchored ones", () => {
    expect(shiftFormula("=A1+$B$2+C$3+$D4", 1, 1, 100, 26)).toBe("=B2+$B$2+D$3+$D5");
    expect(shiftFormula("=SUM(A1:A3)", 0, 2, 100, 26)).toBe("=SUM(C1:C3)");
    expect(shiftFormula("=A1*2", -1, 0, 100, 26)).toBe("=#REF!*2");
    expect(shiftFormula('="A1"&A1', 1, 0, 100, 26)).toBe('="A1"&A2');
  });
});
