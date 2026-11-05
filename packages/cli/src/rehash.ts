// The one-off rehash (ADR 0014): every live unit still on a provisional git:
// hash gets a `rehash` version with the indexer's b3: hashes, but only when its
// code is exactly what that git: hash recorded, so no code change is hidden.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import { pluginsFor } from "./frameworks.ts";
import { gitBlobHash, isProvisional, isRemoved } from "@poetics/core";
import type { Actor, Hash, Link } from "@poetics/core";
import { appendVersion, filesInScope, parseUnit, readUnitFiles, storePaths } from "@poetics/store";
import type { PoeticsConfig, StoreValidator } from "@poetics/store";

export interface RehashEntry {
  uid: string;
  name: string;
  file: string;
  /** The provisional hash the new version follows. */
  parent: Hash;
  contentHash: Hash;
  interfaceHash: Hash;
}

export interface RehashPlan {
  rehash: RehashEntry[];
  /** Units that cannot be rehashed yet, with what to do first. */
  skipped: Array<{ uid: string; name: string; file: string; reason: string }>;
  /** Live units whose latest version already has a b3: hash. */
  alreadyIndexed: number;
}

const LINKS: Link[] = [{ kind: "decision", ref: "docs/decisions/0014-rehash-versions.md" }];

/** Which units the rehash would touch, and which it must leave until their code is recorded. */
export async function planRehash(root: string, config: PoeticsConfig): Promise<RehashPlan> {
  const { parseable } = await filesInScope(root, config);
  const tsconfig = config.typescript?.tsconfig;
  const indexed = createTypeScriptIndexer({ root, files: parseable, plugins: pluginsFor(config), ...(tsconfig ? { tsconfig } : {}) }).index().units;
  const byPlace = new Map(indexed.map((unit) => [place(unit.span.file, unit.name, unit.kind === "type"), unit]));
  const texts = new Map<string, string>();
  const textOf = async (file: string) => {
    if (!texts.has(file)) texts.set(file, await readFile(join(root, file), "utf8"));
    return texts.get(file)!;
  };

  const plan: RehashPlan = { rehash: [], skipped: [], alreadyIndexed: 0 };
  const units = (await readUnitFiles(storePaths(root))).map(parseUnit).sort((a, b) => (a.uid < b.uid ? -1 : 1));
  for (const unit of units) {
    if (isRemoved(unit)) continue;
    const latest = unit.versions.at(-1)!.contentHash;
    if (!isProvisional(latest)) {
      plan.alreadyIndexed++;
      continue;
    }
    const where = { uid: unit.uid, name: unit.name, file: unit.location.file };
    const code: IndexedUnit | undefined = byPlace.get(place(unit.location.file, unit.location.export ?? unit.name, unit.kind === "type"));
    if (!code) {
      plan.skipped.push({ ...where, reason: `no ${unit.kind} ${unit.name} in ${unit.location.file} that the indexer can read` });
      continue;
    }
    const text = (await textOf(code.span.file)).slice(code.span.start, code.span.end);
    if (gitBlobHash(text) !== latest) {
      plan.skipped.push({ ...where, reason: `the code changed since ${latest}; record that change first` });
      continue;
    }
    plan.rehash.push({ ...where, parent: latest, contentHash: code.contentHash, interfaceHash: code.interfaceHash });
  }
  return plan;
}

/** Appends a `rehash` version for each planned unit, as `actor`. Returns how many were written. */
export async function applyRehash(root: string, plan: RehashPlan, actor: Actor, validator?: StoreValidator): Promise<number> {
  const ctx = { paths: storePaths(root), actor, ...(validator ? { validator } : {}) };
  for (const entry of plan.rehash) {
    await appendVersion(ctx, entry.uid, {
      contentHash: entry.contentHash,
      interfaceHash: entry.interfaceHash,
      parent: entry.parent,
      change: "rehash",
      actor,
      rationale: "Rehashed by the indexer: the code is unchanged since the provisional hash, now recorded as the hash of its normalised syntax tree.",
      links: LINKS,
    });
  }
  return plan.rehash.length;
}

/** The indexer's hashes for the units in one file, for writing a version by hand. */
export async function unitHashes(root: string, config: PoeticsConfig, file: string): Promise<Array<Pick<IndexedUnit, "name" | "kind" | "startLine" | "endLine" | "contentHash" | "interfaceHash">>> {
  const tsconfig = config.typescript?.tsconfig;
  const { units } = createTypeScriptIndexer({ root, files: [file], plugins: pluginsFor(config), ...(tsconfig ? { tsconfig } : {}) }).index();
  return units.map(({ name, kind, startLine, endLine, contentHash, interfaceHash }) => ({ name, kind, startLine, endLine, contentHash, interfaceHash }));
}

function place(file: string, name: string, isType: boolean): string {
  return `${file}#${name}#${isType ? "type" : "value"}`;
}
