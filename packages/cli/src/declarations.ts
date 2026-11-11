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
import type { DetectedUnit, FrameworkPlugin } from "@poetics/adapter-typescript";
import { pluginsFor } from "./frameworks.ts";

export interface Declaration {
  /** Repo-relative POSIX path. */
  file: string;
  name: string;
  /** The name the module exports it as, when that differs from `name`, such as `default`. */
  exportedAs?: string;
  kind: UnitKind;
  /** Provisional hash of the declaration text, from `export` to its end, without leading TSDoc. */
  hash: Hash;
  /** The indexer's hash of the normalised syntax tree, which ignores formatting and comments (ADR 0014). */
  contentHash: Hash;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

/**
 * The units in one file's text, found syntactically. A file a framework
 * transforms, such as a .svelte component, is detected in the TypeScript it
 * becomes; spans and lines still index `text` (ADR 0020).
 */
export function detectIn(file: string, text: string, plugins: readonly FrameworkPlugin[] = []): { units: DetectedUnit[]; source: ts.SourceFile; lineOf(offset: number): number } {
  const plugin = plugins.find((p) => p.transform && p.detect && p.extensions?.some((ext) => file.endsWith(ext)));
  const transformed = plugin?.transform!(file, text);
  const source = ts.createSourceFile(transformed ? `${file}.tsx` : file, transformed?.code ?? text, ts.ScriptTarget.Latest, true);
  const units = plugin && transformed ? plugin.detect!(source, file, text, transformed) : detectUnits(source, file, plugins);
  return { units, source, lineOf: (offset) => text.slice(0, offset).split("\n").length };
}

/** The units the TypeScript indexer detects in one source text: exported functions, hooks, types and framework components. */
export function declarationsIn(file: string, text: string, plugins: readonly FrameworkPlugin[] = []): Declaration[] {
  const { units, lineOf } = detectIn(file, text, plugins);
  return units.map((unit) => ({
    file,
    name: unit.name,
    ...(unit.exportedAs !== undefined ? { exportedAs: unit.exportedAs } : {}),
    kind: unit.kind,
    hash: gitBlobHash(text.slice(unit.span.start, unit.span.end)),
    contentHash: contentHash(contentTree(unit)),
    startLine: lineOf(unit.span.start),
    endLine: lineOf(unit.span.end),
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
