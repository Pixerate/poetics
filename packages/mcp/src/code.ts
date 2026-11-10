// The code as the read tools see it: the TypeScript indexer's units, each
// joined to the store unit recorded at its place, with the edges between them
// as a composition graph over uids.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reactPlugin } from "@poetics/adapter-react";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import { createGraph, isRemoved } from "@poetics/core";
import type { CompositionGraph, Edge, Uid, Unit, UnresolvedEdge } from "@poetics/core";
import { createMatcher, filesInScope, readConfig, storePaths } from "@poetics/store";

export interface CodeView {
  /** The indexed code of every live unit found at its recorded place. */
  byUid: ReadonlyMap<Uid, IndexedUnit>;
  /** Edges between tracked units, resolved by the indexer. */
  graph: CompositionGraph;
  /** Code no unit is recorded for: unrecorded new exports, or moves not yet indexed. */
  untracked: IndexedUnit[];
  /** Live units with no code at their recorded place, in files the indexer reads. */
  missing: Uid[];
  /** The unit's source text, from its first declaration to the end of its last. */
  sourceOf(unit: IndexedUnit): string;
  /** The 1-based lines that text spans, to place stack frames and review comments. */
  linesOf(unit: IndexedUnit): { startLine: number; endLine: number };
}

/** Indexes the files in scope, reusing the cache, and joins the result to `units`. */
export async function codeView(root: string, units: readonly Unit[]): Promise<CodeView> {
  const config = await readConfig(root);
  const { parseable } = await filesInScope(root, config);
  const tsconfig = config.typescript?.tsconfig;
  const indexed = createTypeScriptIndexer({
    root,
    files: parseable,
    cacheFile: join(storePaths(root).cache, "typescript.json"),
    // The same plugins poetics index runs, so packs and impact see components as it records them.
    plugins: config.adapters?.includes("react") ? [reactPlugin()] : [],
    ...(tsconfig ? { tsconfig } : {}),
  }).index().units;
  // By scope, not existence: a unit whose file was deleted is missing, not out of scope.
  const inScope = createMatcher(config.include, config.exclude ?? []);
  const indexable = (file: string) => inScope(file) && /\.(ts|tsx|mts|cts)$/.test(file) && !file.endsWith(".d.ts");
  return joinCode(indexed, units, indexable, (file) => readFileSync(join(root, file), "utf8"));
}

/** The join itself, apart from the file system, so it can be tested on its own. */
export function joinCode(
  indexed: readonly IndexedUnit[],
  units: readonly Unit[],
  indexable: (file: string) => boolean,
  read: (file: string) => string,
): CodeView {
  const place = (file: string, name: string, kind: string) => `${file}#${name}#${kind === "type" ? "type" : "value"}`;
  const byPlace = new Map(indexed.map((unit) => [place(unit.span.file, unit.name, unit.kind), unit]));
  const byUid = new Map<Uid, IndexedUnit>();
  const uidOfKey = new Map<string, Uid>();
  const missing: Uid[] = [];
  for (const unit of units) {
    if (isRemoved(unit) || unit.owner !== undefined) continue;
    const code = byPlace.get(place(unit.location.file, unit.name, unit.kind));
    if (code) {
      byUid.set(unit.uid, code);
      uidOfKey.set(code.key, unit.uid);
    } else if (indexable(unit.location.file)) {
      missing.push(unit.uid);
    }
  }

  const edges: Edge[] = [];
  const unresolved: UnresolvedEdge[] = [];
  for (const [uid, code] of byUid) {
    for (const edge of code.edges) {
      const to = uidOfKey.get(edge.to);
      if (to) edges.push({ from: uid, to, kind: edge.kind });
    }
    for (const use of code.unresolved) unresolved.push({ from: uid, ...use });
  }

  const texts = new Map<string, string>();
  const text = (file: string) => {
    if (!texts.has(file)) texts.set(file, read(file));
    return texts.get(file)!;
  };
  const lineAt = (source: string, offset: number) => source.slice(0, offset).split("\n").length;
  return {
    byUid,
    graph: createGraph(edges, unresolved),
    untracked: indexed.filter((unit) => !uidOfKey.has(unit.key)),
    missing,
    sourceOf(unit) {
      return text(unit.span.file).slice(unit.span.start, unit.span.end);
    },
    linesOf(unit) {
      const source = text(unit.span.file);
      return { startLine: lineAt(source, unit.span.start), endLine: lineAt(source, unit.span.end) };
    },
  };
}
