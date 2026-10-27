import { join } from "node:path";

export type StoreLayout = "flat" | "sharded";

export interface StorePaths {
  root: string;
  dir: string;
  config: string;
  units: string;
  notes: string;
  lock: string;
  cache: string;
  indexDb: string;
}

/** Locations inside `.poetics/` for a repository root. */
export function storePaths(root: string): StorePaths {
  const dir = join(root, ".poetics");
  const cache = join(dir, "cache");
  return {
    root,
    dir,
    config: join(dir, "config.json"),
    units: join(dir, "units"),
    notes: join(dir, "notes"),
    lock: join(dir, "poetics.lock"),
    cache,
    indexDb: join(cache, "index.db"),
  };
}

/**
 * Where a unit file lives. `flat` is `units/<uid>.json`; `sharded` splits by the
 * first two uid characters, the way git stores objects, for very large repos.
 */
export function unitFilePath(paths: StorePaths, uid: string, layout: StoreLayout = "flat"): string {
  return layout === "sharded" ? join(paths.units, uid.slice(0, 2), `${uid}.json`) : join(paths.units, `${uid}.json`);
}
