// Which files a repository's config puts in scope, read from the working tree.
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createMatcher } from "./glob.ts";

export interface Scope {
  include: readonly string[];
  exclude?: readonly string[];
  /** The adapters that read the code: with `svelte`, `.svelte` components are parseable too (ADR 0020). */
  adapters?: readonly AdapterEntry[];
}

/** An out-of-process adapter: a command run once per batch of the files its `include` matches (ADR 0025). */
export interface CommandAdapterConfig {
  name: string;
  /** argv, run without a shell from the repository root. */
  command: readonly string[];
  include: readonly string[];
  /** How long one batch may take. Default 120. */
  timeoutSeconds?: number;
}

/** A built-in adapter by name, or a command adapter. */
export type AdapterEntry = string | CommandAdapterConfig;

/** The command adapters among `adapters`, in order. */
export function commandAdapters(adapters?: readonly AdapterEntry[]): CommandAdapterConfig[] {
  return (adapters ?? []).filter((entry): entry is CommandAdapterConfig => typeof entry === "object");
}

const matchers = new WeakMap<CommandAdapterConfig, (path: string) => boolean>();

/** The command adapter whose `include` matches `file`, the first one listed when several do. */
export function commandAdapterFor(file: string, adapters?: readonly AdapterEntry[]): CommandAdapterConfig | undefined {
  return commandAdapters(adapters).find((entry) => {
    if (!matchers.has(entry)) matchers.set(entry, createMatcher(entry.include));
    return matchers.get(entry)!(file);
  });
}

/** Whether the in-process TypeScript adapter reads `file`: TypeScript sources, and `.svelte` with `svelte`, unless a command adapter claims it. */
export function typescriptReads(file: string, adapters?: readonly AdapterEntry[]): boolean {
  if (commandAdapterFor(file, adapters)) return false;
  if (file.endsWith(".svelte")) return adapters?.includes("svelte") ?? false;
  return PARSEABLE.test(file) && !file.endsWith(".d.ts");
}

const PARSEABLE = /\.(ts|tsx|mts|cts)$/;
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".poetics", ".svelte-kit"]);

/**
 * Whether the configured adapters read `file`: TypeScript sources other than
 * declaration files, `.svelte` components when `svelte` is configured (ADR 0020),
 * and files a command adapter's `include` matches (ADR 0025).
 */
export function isParseable(file: string, adapters?: readonly AdapterEntry[]): boolean {
  return commandAdapterFor(file, adapters) !== undefined || typescriptReads(file, adapters);
}

/** Repo-relative files in scope, sorted. Files no configured adapter reads (e.g. .svelte without `svelte`) are listed separately. */
export async function filesInScope(root: string, scope: Scope): Promise<{ parseable: string[]; unsupported: string[] }> {
  const match = createMatcher(scope.include, scope.exclude ?? []);
  const parseable: string[] = [];
  const unsupported: string[] = [];
  for (const file of await walk(root, root)) {
    if (!match(file)) continue;
    (isParseable(file, scope.adapters) ? parseable : unsupported).push(file);
  }
  return { parseable, unsupported };
}

async function walk(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, path)));
    else if (entry.isFile()) out.push(relative(root, path).split(sep).join("/"));
  }
  return out.sort();
}
