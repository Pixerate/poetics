// poetics init: adopt Poetics in a repository. Detect what it is written in,
// write a config whose scope covers its source, and capture the current state
// with a snapshot backfill (ADR 0011).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { filesInScope, storePaths } from "@poetics/store";
import type { CoverageThresholds, PoeticsConfig } from "@poetics/store";
import { applyBackfill, planBackfill } from "./backfill.ts";
import type { BackfillPlan } from "./backfill.ts";

export type Adapter = "typescript" | "react" | "svelte";

/** The config `poetics init` writes, in the shape of `schemas/config.schema.json`. */
export interface InitConfig extends PoeticsConfig {
  version: 1;
  adapters: Adapter[];
  policy: { requireRationale: boolean; agentRationaleNeedsReview: boolean; allowProvisionalHashes: boolean; coverage?: CoverageThresholds };
}

export interface InitPlan {
  /** Set when the repository already has a config: init then changes nothing. */
  existing?: string;
  config: InitConfig;
  /** What decided the adapters, for people to check. */
  detected: { react: string[]; svelte: string[] };
  /** Whether `.gitignore` needs `.poetics/cache/` added. */
  ignoreCache: boolean;
  /** The snapshot backfill the new config leads to. */
  backfill?: BackfillPlan;
}

const EXCLUDE = ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/*.d.ts", "**/dist/**", "**/build/**", "**/node_modules/**"];
const CACHE_LINE = ".poetics/cache/";

/** What `poetics init` would write. Nothing is written until `applyInit`. */
export async function planInit(root: string): Promise<InitPlan> {
  const paths = storePaths(root);
  const packages = packageDirs(root);
  const detected = { react: [] as string[], svelte: [] as string[] };
  for (const dir of packages) {
    const deps = dependenciesOf(root, dir);
    const where = dir === "." ? "package.json" : `${dir}/package.json`;
    if (deps.has("react") || deps.has("next") || deps.has("react-dom")) detected.react.push(where);
    if (deps.has("svelte") || deps.has("@sveltejs/kit")) detected.svelte.push(where);
  }
  const roots = sourceRoots(root, packages);
  const probe = await filesInScope(root, { include: roots.map((r) => `${r}**/*.{tsx,svelte}`), exclude: EXCLUDE });
  const files = [...probe.parseable, ...probe.unsupported];
  if (detected.react.length === 0 && files.some((f) => f.endsWith(".tsx"))) detected.react.push("*.tsx files");
  if (detected.svelte.length === 0 && files.some((f) => f.endsWith(".svelte"))) detected.svelte.push("*.svelte files");

  const adapters: Adapter[] = ["typescript"];
  const extensions = ["ts"];
  if (detected.react.length > 0) {
    adapters.push("react");
    extensions.push("tsx");
  }
  if (detected.svelte.length > 0) {
    adapters.push("svelte");
    extensions.push("svelte");
  }
  const glob = extensions.length === 1 ? "ts" : `{${extensions.join(",")}}`;
  const config: InitConfig = {
    version: 1,
    adapters,
    include: roots.map((r) => `${r}**/*.${glob}`),
    exclude: EXCLUDE,
    policy: { requireRationale: true, agentRationaleNeedsReview: true, allowProvisionalHashes: false },
  };
  const tsconfig = tsconfigOf(root);
  if (tsconfig) config.typescript = { tsconfig };

  const plan: InitPlan = { config, detected, ignoreCache: !ignoresCache(root) };
  if (existsSync(paths.config)) {
    plan.existing = ".poetics/config.json";
    return plan;
  }
  plan.backfill = await planBackfill(root, config);
  return plan;
}

/** Writes the config, ignores the cache and runs the snapshot backfill. Refuses a repository that has a config. */
export async function applyInit(root: string, plan: InitPlan): Promise<number> {
  if (plan.existing) throw new Error(`${plan.existing} already exists; run poetics index or poetics backfill --snapshot instead`);
  const paths = storePaths(root);
  await mkdir(paths.units, { recursive: true });
  await writeFile(paths.config, `${JSON.stringify({ $schema: "https://raw.githubusercontent.com/Pixerate/poetics/main/schemas/config.schema.json", ...plan.config }, null, 2)}\n`);
  if (plan.ignoreCache) {
    const gitignore = join(root, ".gitignore");
    const before = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
    await appendFile(gitignore, `${before === "" || before.endsWith("\n") ? "" : "\n"}${CACHE_LINE}\n`);
  }
  return plan.backfill ? applyBackfill(root, plan.backfill) : 0;
}

/** The plan for people: what was detected, the config, and the backfill summary. */
export function formatInitPlan(plan: InitPlan, written?: number): string {
  if (plan.existing) return `${plan.existing} already exists, so init changes nothing. Run poetics index to record changes, or poetics backfill --snapshot for exports with no unit.`;
  const lines = [
    `Adapters: ${plan.config.adapters.join(", ")}${plan.detected.react.length ? ` (React from ${plan.detected.react.join(", ")})` : ""}${plan.detected.svelte.length ? ` (Svelte from ${plan.detected.svelte.join(", ")})` : ""}`,
    `Include: ${plan.config.include.join(", ")}`,
    ...(plan.config.typescript?.tsconfig ? [`Compiler options from ${plan.config.typescript.tsconfig}`] : []),
    ...(plan.ignoreCache ? [`Adds ${CACHE_LINE} to .gitignore`] : []),
  ];
  const created = plan.backfill?.created.length ?? 0;
  const { high = 0, medium = 0, low = 0 } = plan.backfill?.byConfidence ?? {};
  const backfill = `${created} unit(s) from a snapshot backfill (${high} high, ${medium} medium, ${low} low confidence)`;
  lines.push(
    written === undefined
      ? `Would write .poetics/config.json and ${backfill}. Run with --write to write them; review them with the poetics-backfill skill.`
      : `Wrote .poetics/config.json and ${backfill}.`,
  );
  return lines.join("\n");
}

/** The repository root, or each workspace package when it has workspaces. */
function packageDirs(root: string): string[] {
  const patterns = workspacePatterns(root);
  if (patterns.length === 0) return ["."];
  const dirs = new Set<string>(["."]);
  for (const pattern of patterns) for (const dir of expand(root, pattern)) dirs.add(dir);
  return [...dirs];
}

/** Where each package keeps its source: its `src/` when it has one, else the package itself. */
function sourceRoots(root: string, packages: readonly string[]): string[] {
  const patterns = workspacePatterns(root);
  if (patterns.length > 0) {
    return patterns.map((pattern) => {
      const dirs = expand(root, pattern);
      return dirs.length > 0 && dirs.every((dir) => existsSync(join(root, dir, "src"))) ? `${pattern}/src/` : `${pattern}/`;
    });
  }
  return packages.includes(".") && existsSync(join(root, "src")) ? ["src/"] : [""];
}

/** Workspace globs from pnpm-workspace.yaml or package.json `workspaces`. Only literal paths and trailing `/*` are expanded. */
function workspacePatterns(root: string): string[] {
  const pnpm = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    const lines = readFileSync(pnpm, "utf8").split("\n");
    const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
    const out: string[] = [];
    for (const line of start === -1 ? [] : lines.slice(start + 1)) {
      const item = /^\s+-\s+["']?([^"'#\s]+)["']?/.exec(line);
      if (!item) {
        if (/^\S/.test(line)) break;
        continue;
      }
      if (!item[1]!.startsWith("!")) out.push(item[1]!.replace(/\/$/, ""));
    }
    return out;
  }
  const pkg = readJson(join(root, "package.json")) as { workspaces?: string[] | { packages?: string[] } } | undefined;
  const workspaces = Array.isArray(pkg?.workspaces) ? pkg.workspaces : (pkg?.workspaces?.packages ?? []);
  return workspaces.filter((w) => !w.startsWith("!")).map((w) => w.replace(/\/$/, ""));
}

function expand(root: string, pattern: string): string[] {
  if (!pattern.includes("*")) return existsSync(join(root, pattern, "package.json")) ? [pattern] : [];
  if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) return [];
  const parent = pattern.slice(0, -2);
  if (!existsSync(join(root, parent))) return [];
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, "package.json")))
    .map((entry) => `${parent}/${entry.name}`)
    .sort();
}

function dependenciesOf(root: string, dir: string): Set<string> {
  const pkg = readJson(join(root, dir, "package.json")) as Record<string, Record<string, string> | undefined> | undefined;
  return new Set(["dependencies", "devDependencies", "peerDependencies"].flatMap((field) => Object.keys(pkg?.[field] ?? {})));
}

/** A tsconfig whose compiler options apply to the source: one that is only project references would give none. */
function tsconfigOf(root: string): string | undefined {
  for (const name of ["tsconfig.json", "tsconfig.base.json"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    // TypeScript's own reader: comments, trailing commas, and `/*` inside strings such as `"@/*"`.
    const config = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8")).config as { compilerOptions?: object } | undefined;
    if (config?.compilerOptions && Object.keys(config.compilerOptions).length > 0) return name;
  }
  return undefined;
}

function ignoresCache(root: string): boolean {
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) return false;
  return readFileSync(gitignore, "utf8")
    .split("\n")
    .some((line) => [".poetics/cache", ".poetics/cache/", "/.poetics/cache/", ".poetics/"].includes(line.trim()));
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
