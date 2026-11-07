// Removes the saved sheets. The next request rebuilds them from the fixtures,
// which are deterministic, so you get exactly the same sheets every time.
import { rmSync } from "node:fs";

rmSync(new URL("../.data", import.meta.url), { recursive: true, force: true });
console.log("Fixtures reset. Reload the app (or start it with npm run dev).");
