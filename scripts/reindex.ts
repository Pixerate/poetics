// Rebuilds the local SQLite index at .poetics/cache/index.db from the unit files.
// Pass --fresh to delete the cache first.
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openIndex, rebuildIndex, storePaths } from "@poetics/store";
import type { RebuildStats } from "@poetics/store";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function reindex(root: string, fresh: boolean): Promise<RebuildStats> {
  const paths = storePaths(root);
  if (fresh) await rm(paths.cache, { recursive: true, force: true });
  const db = openIndex(paths.indexDb);
  try {
    return await rebuildIndex(paths, db);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1] ?? ".");
  const stats = await reindex(root, argv.includes("--fresh"));
  console.log(argv.includes("--json") ? JSON.stringify(stats) : `Index updated: ${JSON.stringify(stats)}`);
}
