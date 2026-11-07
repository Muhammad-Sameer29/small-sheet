import { PatchError, patchSheet, readSheet } from "@/lib/server/store";
import type { SheetPatch } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  // ?fail=1 lets the "couldn't open this sheet" screen be seen on demand.
  if (new URL(req.url).searchParams.get("fail")) {
    return Response.json({ error: "Simulated load failure" }, { status: 503 });
  }
  const sheet = await readSheet(id);
  if (!sheet) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(sheet, { headers: { "Cache-Control": "no-store" } });
}

// The save. Deliberately slow (333–1500 ms) and deliberately unreliable (about one in
// five fails), as the brief asks. It fails before writing anything, and every patch only
// sets cells to values, so sending the same patch again is always safe.
const FAIL_RATE = 0.2;

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as SheetPatch | null;
  await new Promise((r) => setTimeout(r, 333 + Math.random() * 1167));
  if (Math.random() < FAIL_RATE) {
    return Response.json({ error: "The server dropped this save (on purpose, one time in five)" }, { status: 503 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  try {
    const ok = await patchSheet(id, body);
    if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, savedAt: Date.now() });
  } catch (e) {
    if (e instanceof PatchError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
