import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
function visit(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (
      entry.name.startsWith(".dev.vars") ||
      entry.name.startsWith(".env")
    )
      rmSync(file);
  }
}
if (existsSync("dist")) visit("dist");
