import { redirect } from "next/navigation";
import { listSheets } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { sheets } = await listSheets();
  redirect(`/s/${sheets[0]?.id ?? "scratch"}`);
}
