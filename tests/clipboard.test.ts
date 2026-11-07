import { describe, expect, it } from "vitest";
import { parseText, readInternal, toText } from "@/lib/clipboard";

describe("pasted text", () => {
  it("reads tab-separated rows, with spreadsheet quoting", () => {
    const b = parseText('a\tb\n"line one\nline two"\t"say ""hi"""\n', 100, 100);
    expect(b.cells).toEqual([["a", "b"], ["line one line two", 'say "hi"']]);
  });

  it("only keeps what fits, but knows how big the paste was", () => {
    const text = Array.from({ length: 5000 }, (_, r) => Array.from({ length: 10 }, (_, c) => `${r}.${c}`).join("\t")).join("\n");
    const b = parseText(text, 3, 2);
    expect(b.cells).toEqual([["0.0", "0.1"], ["1.0", "1.1"], ["2.0", "2.1"]]);
    expect(b.fullRows).toBe(5000);
    expect(b.fullCols).toBe(10);
  });

  it("survives hostile input", () => {
    const quotes = '"\t'.repeat(200_000);
    const t0 = performance.now();
    parseText(quotes, 1000, 1000);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(parseText("a\u0000b\u0007c", 5, 5).cells).toEqual([["abc"]]);
  });

  it("round-trips through our own text format", () => {
    const values = [["x\ty", 'q"'], ["1", ""]];
    expect(parseText(toText(values), 10, 10).cells).toEqual([["x y", 'q"'], ["1", ""]]);
  });

  it("rejects a forged internal clipboard", () => {
    expect(readInternal('{"v":1,"r":0,"c":0,"raws":"nope"}', 10, 10)).toBeNull();
    expect(readInternal("not json", 10, 10)).toBeNull();
    expect(readInternal('{"v":1,"r":0,"c":0,"raws":[[1,"=A1"]]}', 10, 10)?.raws).toEqual([["", "=A1"]]);
  });
});
