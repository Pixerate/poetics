import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scope } from "./declarations.ts";

export interface CoverageThresholds {
  tracked?: number;
  fresh?: number;
  linkedRationale?: number;
  reviewed?: number;
  tested?: number;
  documented?: number;
}

export interface PoeticsConfig extends Scope {
  policy?: { coverage?: CoverageThresholds };
}

export async function readConfig(root: string): Promise<PoeticsConfig> {
  return JSON.parse(await readFile(join(root, ".poetics", "config.json"), "utf8")) as PoeticsConfig;
}
