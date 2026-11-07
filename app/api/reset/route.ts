import { resetAll } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  await resetAll();
  return Response.json({ ok: true });
}
