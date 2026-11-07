import { Workbook } from "@/components/Workbook";
import { listSheets } from "@/lib/server/store";

export const dynamic = "force-dynamic";

// The workbook lives in the layout, not the page, so it stays mounted while you move
// between sheets: loaded sheets, undo history and saves in flight all survive a tab switch.
// The server renders the chrome and the tab list; cells load in the browser.
export default async function SheetsLayout({ children }: { children: React.ReactNode }) {
  const { sheets } = await listSheets();
  return (
    <>
      <Workbook initialSheets={sheets} />
      {children}
    </>
  );
}
