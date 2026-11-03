// Finds the declarations Poetics tracks as units, with both hashes a version may
// carry: the provisional git: hash of the text, which history recorded before
// the rehash, and the indexer's b3: content hash. Both are syntactic, so this
// needs no type checker.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { contentTree, detectUnits } from "@poetics/adapter-typescript";
import { contentHash, gitBlobHash } from "@poetics/core";
import type { Hash, UnitKind } from "@poetics/core";
import { createMatcher } from "./glob.ts";

export interface Declaration {
  /** Repo-relative POSIX path. */
  file: string;
  name: string;
  kind: UnitKind;
  /** Provisional hash of the declaration text, from `export` to its end, without leading TSDoc. */
  hash: Hash;
  /** The indexer's hash of the normalised syntax tree, which ignores formatting and comments (ADR 0014). */
  contentHash: Hash;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

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

/** The units the TypeScript indexer detects in one source text: exported functions, hooks and types. */
export function declarationsIn(file: string, text: string): Declaration[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return detectUnits(source, file).map((unit) => ({
    file,
    name: unit.name,
    kind: unit.kind,
    hash: gitBlobHash(text.slice(unit.span.start, unit.span.end)),
    contentHash: contentHash(contentTree(unit)),
    startLine: source.getLineAndCharacterOfPosition(unit.span.start).line + 1,
    endLine: source.getLineAndCharacterOfPosition(unit.span.end).line + 1,
  }));
}

/** Every tracked-shape declaration in scope. */
export async function discoverDeclarations(root: string, scope: Scope): Promise<{ declarations: Declaration[]; unsupported: string[] }> {
  const { parseable, unsupported } = await filesInScope(root, scope);
  const declarations: Declaration[] = [];
  for (const file of parseable) declarations.push(...declarationsIn(file, await readFile(join(root, file), "utf8")));
  return { declarations, unsupported };
}
