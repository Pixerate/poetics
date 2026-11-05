// Finds the declarations Poetics tracks as units, with both hashes a version may
// carry: the provisional git: hash of the text, which history recorded before
// the rehash, and the indexer's b3: content hash. Both are syntactic, so this
// needs no type checker.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { contentTree, detectUnits } from "@poetics/adapter-typescript";
import { contentHash, gitBlobHash } from "@poetics/core";
import type { Hash, UnitKind } from "@poetics/core";
import { filesInScope } from "@poetics/store";
import type { Scope } from "@poetics/store";
import type { FrameworkPlugin } from "@poetics/adapter-typescript";
import { pluginsFor } from "./frameworks.ts";

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

/** The units the TypeScript indexer detects in one source text: exported functions, hooks and types. */
export function declarationsIn(file: string, text: string, plugins: readonly FrameworkPlugin[] = []): Declaration[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return detectUnits(source, file, plugins).map((unit) => ({
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
export async function discoverDeclarations(root: string, scope: Scope & { adapters?: readonly string[] }): Promise<{ declarations: Declaration[]; unsupported: string[] }> {
  const { parseable, unsupported } = await filesInScope(root, scope);
  const declarations: Declaration[] = [];
  const plugins = pluginsFor(scope);
  for (const file of parseable) declarations.push(...declarationsIn(file, await readFile(join(root, file), "utf8"), plugins));
  return { declarations, unsupported };
}
