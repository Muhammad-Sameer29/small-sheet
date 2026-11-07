import { createSheet, listSheets } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listSheets());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const meta = await createSheet(typeof body?.name === "string" ? body.name : undefined);
  return Response.json(meta, { status: 201 });
}
