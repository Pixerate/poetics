// Every reader of code goes through a CodeAdapter (ADR 0025), so indexing,
// rehash, backfill, the MCP server and the evals work the same for any
// language. The TypeScript indexer, with the React and Svelte plugins, is one
// adapter running in process; each command adapter in the config is another,
// run out of process (command-adapter.ts).
import { join } from "node:path";
import { contentTree, createTypeScriptIndexer, fingerprint, signatureText } from "@poetics/adapter-typescript";
import type { IndexedEdge, IndexedUnit } from "@poetics/adapter-typescript";
import { contentHash } from "@poetics/core";
import type { Hash } from "@poetics/core";
import { commandAdapters, storePaths, typescriptReads } from "@poetics/store";
import type { PoeticsConfig } from "@poetics/store";
import { commandAdapter } from "./command-adapter.ts";
import { detectIn } from "./declarations.ts";
import { pluginsFor } from "./frameworks.ts";

/** A unit of the code on disk, read with the rest of its program: hashes, signature and edges. */
export type AdaptedUnit = Omit<IndexedUnit, "signature" | "runtimeHash" | "edges"> & {
  /** Only for languages with erasable types: equal runtime hashes with different content hashes mean a types-only change. */
  runtimeHash?: Hash;
  /** `resolution` is `exact` when absent: the in-process adapters resolve every edge through the checker. */
  edges: Array<IndexedEdge & { resolution?: "exact" | "name" }>;
};

/** A unit of a file read on its own from text, such as the file at an earlier commit: no edges and no interface hash. */
export type TextUnit = Pick<AdaptedUnit, "key" | "name" | "exportedAs" | "kind" | "framework" | "span" | "startLine" | "endLine" | "docs" | "contentHash" | "runtimeHash" | "fingerprint" | "signatureText">;

/** Reads the units of the files it claims, from disk as one program or from text one file at a time. */
export interface CodeAdapter {
  readonly name: string;
  /** Whether this adapter reads `file`. */
  reads(file: string): boolean;
  /** The units of `files` as they are on disk, with edges between them, and the files it could not read. */
  index(files: readonly string[]): IndexReport;
  /** The units of each file in `files`, read from the text given, by path. */
  readTexts(files: ReadonlyArray<{ path: string; text: string }>): Map<string, TextUnit[]>;
}

export interface IndexReport {
  units: AdaptedUnit[];
  /** Files the adapter could not read: their units keep their last version and are never removed for it (ADR 0025). */
  notRead: string[];
}

export interface AdapterOptions {
  /** Reuse and update the indexer's cache in `.poetics/cache/`. */
  cache?: boolean;
}

/** The adapters a repository's config names: its command adapters, then the TypeScript indexer with its framework plugins. */
export function adaptersFor(root: string, config: Pick<PoeticsConfig, "adapters" | "typescript">, options: AdapterOptions = {}): CodeAdapter[] {
  return [...commandAdapters(config.adapters).map((entry) => commandAdapter(root, entry, config.adapters ?? [])), typescriptAdapter(root, config, options)];
}

/** Indexes `files` with the adapters that read them, and lists the files an adapter could not read. Files no adapter reads are left out. */
export function indexReport(adapters: readonly CodeAdapter[], files: readonly string[]): IndexReport {
  const report: IndexReport = { units: [], notRead: [] };
  for (const adapter of adapters) {
    const mine = files.filter((file) => adapter.reads(file));
    if (mine.length === 0) continue;
    const { units, notRead } = adapter.index(mine);
    report.units.push(...units);
    report.notRead.push(...notRead);
  }
  return report;
}

/** The units of `files`, indexed with the adapters that read them. */
export function indexWith(adapters: readonly CodeAdapter[], files: readonly string[]): AdaptedUnit[] {
  return indexReport(adapters, files).units;
}

/** Reads each file from its text with the adapter that reads it. A file no adapter reads has no entry. */
export function readTextsWith(adapters: readonly CodeAdapter[], files: ReadonlyArray<{ path: string; text: string }>): Map<string, TextUnit[]> {
  const out = new Map<string, TextUnit[]>();
  for (const adapter of adapters) {
    const mine = files.filter((file) => adapter.reads(file.path));
    if (mine.length > 0) for (const [path, units] of adapter.readTexts(mine)) out.set(path, units);
  }
  return out;
}

/** Whether any of `adapters` reads `file`. */
export function readsAny(adapters: readonly CodeAdapter[], file: string): boolean {
  return adapters.some((adapter) => adapter.reads(file));
}

const CACHE = "typescript.json";

function typescriptAdapter(root: string, config: Pick<PoeticsConfig, "adapters" | "typescript">, options: AdapterOptions): CodeAdapter {
  const plugins = pluginsFor(config);
  const tsconfig = config.typescript?.tsconfig;
  return {
    name: "typescript",
    reads: (file) => typescriptReads(file, config.adapters),
    index(files) {
      const { units } = createTypeScriptIndexer({
        root,
        files,
        plugins,
        ...(options.cache ? { cacheFile: join(storePaths(root).cache, CACHE) } : {}),
        ...(tsconfig ? { tsconfig } : {}),
      }).index();
      return { units, notRead: [] };
    },
    readTexts(files) {
      const out = new Map<string, TextUnit[]>();
      for (const { path, text } of files) {
        const { units, source, lineOf } = detectIn(path, text, plugins);
        out.set(
          path,
          units.map((unit) => {
            const tree = contentTree(unit);
            const read: TextUnit = {
              key: unit.key,
              name: unit.name,
              kind: unit.kind,
              framework: unit.framework,
              span: unit.span,
              startLine: lineOf(unit.span.start),
              endLine: lineOf(unit.span.end),
              contentHash: contentHash(tree),
              runtimeHash: contentHash(contentTree(unit, true)),
              fingerprint: fingerprint(tree),
              signatureText: signatureText(unit, source, plugins),
            };
            if (unit.exportedAs !== undefined) read.exportedAs = unit.exportedAs;
            if (unit.docs !== undefined) read.docs = unit.docs;
            return read;
          }),
        );
      }
      return out;
    },
  };
}
