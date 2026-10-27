// Finds the declarations Poetics tracks as units, the way the seed units were
// made: exported functions and exported types or interfaces in .ts/.tsx files.
// A day-one stand-in for the adapters' detectUnits.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { gitBlobHash } from "@poetics/core";
import type { Hash, UnitKind } from "@poetics/core";
import { createMatcher } from "./glob.ts";

export interface Declaration {
  /** Repo-relative POSIX path. */
  file: string;
  name: string;
  kind: UnitKind;
  /** Provisional hash of the declaration text, from `export` to its end, without leading TSDoc. */
  hash: Hash;
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

/** Exported function, interface and type-alias declarations in one source text. */
export function declarationsIn(file: string, text: string): Declaration[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Declaration[] = [];
  for (const node of source.statements) {
    if (!isExported(node)) continue;
    let name: string | undefined;
    let kind: UnitKind | undefined;
    if (ts.isFunctionDeclaration(node)) {
      name = node.name?.text ?? "default";
      kind = /^use[A-Z0-9]/.test(name) ? "hook" : "function";
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
      kind = "type";
    }
    if (!name || !kind) continue;
    const start = node.getStart(source);
    found.push({
      file,
      name,
      kind,
      hash: gitBlobHash(text.slice(start, node.end)),
      startLine: source.getLineAndCharacterOfPosition(start).line + 1,
      endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
    });
  }
  return found;
}

function isExported(node: ts.Statement): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Every tracked-shape declaration in scope. */
export async function discoverDeclarations(root: string, scope: Scope): Promise<{ declarations: Declaration[]; unsupported: string[] }> {
  const { parseable, unsupported } = await filesInScope(root, scope);
  const declarations: Declaration[] = [];
  for (const file of parseable) declarations.push(...declarationsIn(file, await readFile(join(root, file), "utf8")));
  return { declarations, unsupported };
}
