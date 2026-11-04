// Which files a repository's config puts in scope, read from the working tree.
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createMatcher } from "./glob.ts";

export interface Scope {
  include: readonly string[];
  exclude?: readonly string[];
}

const PARSEABLE = /\.(ts|tsx|mts|cts)$/;
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".poetics", ".svelte-kit"]);

/** Repo-relative files in scope, sorted. Files the parser cannot read yet (e.g. .svelte) are listed separately. */
export async function filesInScope(root: string, scope: Scope): Promise<{ parseable: string[]; unsupported: string[] }> {
  const match = createMatcher(scope.include, scope.exclude ?? []);
  const parseable: string[] = [];
  const unsupported: string[] = [];
  for (const file of await walk(root, root)) {
    if (!match(file)) continue;
    (PARSEABLE.test(file) && !file.endsWith(".d.ts") ? parseable : unsupported).push(file);
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
