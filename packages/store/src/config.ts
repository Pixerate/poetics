import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scope } from "./scope.ts";

export interface CoverageThresholds {
  tracked?: number;
  fresh?: number;
  linkedRationale?: number;
  reviewed?: number;
  tested?: number;
  documented?: number;
}

export interface PoeticsConfig extends Scope {
  /** Which adapters read the code: `typescript`, plus `react` and `svelte` for their components. */
  adapters?: readonly string[];
  /** The tsconfig whose compiler options the indexer uses, relative to the root. */
  typescript?: { tsconfig?: string };
  store?: { layout?: "flat" | "sharded" };
  policy?: { coverage?: CoverageThresholds };
}

export async function readConfig(root: string): Promise<PoeticsConfig> {
  return JSON.parse(await readFile(join(root, ".poetics", "config.json"), "utf8")) as PoeticsConfig;
}
