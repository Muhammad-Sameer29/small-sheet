import { addr, colName } from "./engine/address";
import type { SheetDoc } from "./types";

// Fixtures are generated, not stored, so the big sheet doesn't bloat the repo. Every
// "random" number comes from a seeded generator: resetting always rebuilds the same
// sheets with the same values in the same cells.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUARTERS = ["B", "C", "D", "E"];

function budget(): SheetDoc {
  const rand = seeded(2027);
  const cells: Record<string, string> = {};
  const set = (a: string, v: string | number) => (cells[a] = String(v));
  const around = (base: number, spread = 0.12, step = 50) =>
    Math.round((base * (1 - spread + rand() * spread * 2)) / step) * step;

  set("A1", "Northwind · FY2027 budget");
  ["Q1", "Q2", "Q3", "Q4", "Year", "% of revenue"].forEach((h, i) => set(`${colName(i + 1)}3`, h));

  // Line items: [row, label, base per quarter] — or a formula builder for derived lines.
  type Line = [number, string, number | ((q: string) => string)];
  const section = (titleRow: number, title: string, lines: Line[], subtotalRow: number, subtotalLabel: string) => {
    set(`A${titleRow}`, title);
    for (const [row, label, base] of lines) {
      set(`A${row}`, label);
      for (const q of QUARTERS) set(`${q}${row}`, typeof base === "number" ? around(base) : base(q));
      set(`F${row}`, `=SUM(B${row}:E${row})`);
    }
    const first = lines[0][0];
    const last = lines[lines.length - 1][0];
    set(`A${subtotalRow}`, subtotalLabel);
    for (const q of QUARTERS) set(`${q}${subtotalRow}`, `=SUM(${q}${first}:${q}${last})`);
    set(`F${subtotalRow}`, `=SUM(B${subtotalRow}:E${subtotalRow})`);
  };

  section(4, "Revenue", [
    [5, "Client retainers", 64000],
    [6, "Project work", 41000],
    [7, "Workshops", 9500],
    [8, "Licensing", 4200],
  ], 9, "Total revenue");

  section(11, "People", [
    [12, "Salaries", 46000],
    [13, "Payroll taxes", (q) => `=${q}12*$B$46`],
    [14, "Contractors", (q) => `=${q}48*$B$47`],
    [15, "Benefits", 6400],
    [16, "Training", 1800],
  ], 17, "People subtotal");

  section(19, "Workspace", [
    [20, "Rent", 9000],
    [21, "Utilities", 1100],
    [22, "Insurance", 750],
  ], 23, "Workspace subtotal");

  section(25, "Software & equipment", [
    [26, "Design tools", 2400],
    [27, "Cloud hosting", 1650],
    [28, "Hardware", 3200],
  ], 29, "Software subtotal");

  section(31, "Marketing", [
    [32, "Events", 2800],
    [33, "Advertising", 3600],
    [34, "Content", 1500],
  ], 35, "Marketing subtotal");

  const totals: Array<[number, string, (q: string) => string]> = [
    [37, "Total expenses", (q) => `=${q}17+${q}23+${q}29+${q}35`],
    [38, "Operating profit", (q) => `=${q}9-${q}37`],
    [39, "Tax", (q) => `=MAX(0,${q}38)*$B$45`],
    [40, "Net profit", (q) => `=${q}38-${q}39`],
  ];
  for (const [row, label, f] of totals) {
    set(`A${row}`, label);
    for (const q of QUARTERS) set(`${q}${row}`, f(q));
    set(`F${row}`, `=SUM(B${row}:E${row})`);
  }
  set("A41", "Net margin %");
  for (const q of [...QUARTERS, "F"]) set(`${q}41`, `=ROUND(${q}40/${q}9*100,1)`);

  // Share of revenue for every line and subtotal under Revenue.
  for (const row of [5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27, 28, 29, 32, 33, 34, 35, 37, 40]) {
    set(`G${row}`, `=ROUND(F${row}/$F$9*100,1)`);
  }

  set("A43", "Assumptions");
  set("A45", "Tax rate");
  set("B45", "25%");
  set("A46", "Payroll tax rate");
  set("B46", "12.5%");
  set("A47", "Contractor rate per hour");
  set("B47", "85");
  set("A48", "Contractor hours");
  for (const q of QUARTERS) set(`${q}48`, around(220, 0.3, 10));

  return {
    id: "budget",
    name: "Budget",
    rows: 100,
    cols: 12,
    frozen: true,
    colWidths: { 0: 220, 6: 116 },
    cells,
  };
}

const REGIONS = ["North", "South", "East", "West", "Central"];
const REPS = ["Amara Osei", "Bilal Qureshi", "Chen Wei", "Dana Ruiz", "Elif Kaya", "Farah Haddad", "Grace Mills", "Hiro Tanaka"];
const PRODUCTS: Array<[string, number]> = [
  ["Desk lamp", 48],
  ["Monitor arm", 129],
  ["Standing desk", 640],
  ["Task chair", 389],
  ["Cable tray", 24],
  ["Footrest", 39],
  ["Whiteboard", 210],
  ["Acoustic panel", 75],
];
const DISCOUNTS = ["0%", "0%", "0%", "5%", "5%", "10%", "15%"];

export const ORDER_ROWS = 10_000;

function orders(): SheetDoc {
  const rand = seeded(10_000);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const cells: Record<string, string> = {};
  ["Order", "Date", "Region", "Rep", "Product", "Units", "Unit price", "Discount", "Gross", "Net", "Tax", "Total"].forEach(
    (h, i) => (cells[`${colName(i)}1`] = h),
  );
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < ORDER_ROWS; i++) {
    const r = i + 2;
    const [product, price] = pick(PRODUCTS);
    const day = new Date(start + Math.floor((i / ORDER_ROWS) * 300) * 86_400_000);
    cells[`A${r}`] = `SO-${String(10_001 + i)}`;
    cells[`B${r}`] = day.toISOString().slice(0, 10);
    cells[`C${r}`] = pick(REGIONS);
    cells[`D${r}`] = pick(REPS);
    cells[`E${r}`] = product;
    cells[`F${r}`] = String(1 + Math.floor(rand() * 24));
    cells[`G${r}`] = String(price);
    cells[`H${r}`] = pick(DISCOUNTS);
    cells[`I${r}`] = `=F${r}*G${r}`;
    cells[`J${r}`] = `=I${r}*(1-H${r})`;
    cells[`K${r}`] = `=J${r}*0.08`;
    cells[`L${r}`] = `=J${r}+K${r}`;
  }
  const last = ORDER_ROWS + 1;
  const total = last + 1;
  cells[`A${total}`] = "Total";
  for (const col of ["F", "I", "J", "K", "L"]) cells[`${col}${total}`] = `=SUM(${col}2:${col}${last})`;
  return {
    id: "orders",
    name: "Orders",
    rows: total,
    cols: 12,
    frozen: true,
    colWidths: { 0: 100, 1: 104, 3: 128, 4: 140, 8: 120, 9: 120, 10: 120, 11: 120 },
    cells,
  };
}

function broken(): SheetDoc {
  const cells: Record<string, string> = {};
  const rows: Array<[string, string, string?, string?]> = [
    ["What's wrong with it", "Result", "Input", "Input"],
    ["Refers to its own cell", "=B2+1"],
    ["Two cells that need each other", "=C3*2", "=B3+1"],
    ["Points at a cell that doesn't exist", "=C4+Z999", "50"],
    ["Divides by zero", "=C5/D5", "1200", "0"],
    ["Depends on a broken cell", "=B5*12"],
    ["Totals a range with a broken cell in it", "=SUM(B5:B6)"],
    ["Text where a number should be", "=C8*3", "twelve"],
    ["A function that doesn't exist", "=TOTAL(C9:D9)", "4", "6"],
    ["Never finished typing", "=SUM(C10,", "8"],
    ["And one that's fine, for contrast", "=C11*D11", "3", "4"],
  ];
  rows.forEach((cols, i) => cols.forEach((v, c) => v !== undefined && (cells[addr(i, c)] = v)));
  return {
    id: "broken",
    name: "Broken",
    rows: 30,
    cols: 8,
    frozen: false,
    colWidths: { 0: 280 },
    cells,
  };
}

export function emptySheet(id: string, name: string): SheetDoc {
  return { id, name, rows: 1000, cols: 26, frozen: false, colWidths: {}, cells: {} };
}

export function fixtures(): SheetDoc[] {
  return [budget(), orders(), broken(), emptySheet("scratch", "Scratch")];
}
