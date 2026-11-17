// The rehash (ADR 0014): every live unit still on a provisional git: hash gets a
// `rehash` version with the indexer's b3: hashes, but only when its code is
// exactly what that git: hash recorded, so no code change is hidden. A unit whose
// b3: content hash still matches but whose interface hash the adapters' rules now
// compute differently gets one too (ADR 0024).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { adaptersFor, indexWith } from "./adapters.ts";
import type { AdaptedUnit } from "./adapters.ts";
import { gitBlobHash, isProvisional, isRemoved } from "@poetics/core";
import type { Actor, Hash, Link, Version } from "@poetics/core";
import { appendVersion, filesInScope, parseUnit, readUnitFiles, storePaths } from "@poetics/store";
import type { PoeticsConfig, StoreValidator } from "@poetics/store";

export interface RehashEntry {
  uid: string;
  name: string;
  file: string;
  /** The hash the new version follows: provisional, or the same b3: hash under older adapter rules. */
  parent: Hash;
  /** Why: a provisional hash to replace, or an interface hash the adapters' rules now compute differently. */
  reason: "provisional" | "rules";
  contentHash: Hash;
  interfaceHash: Hash;
}

export interface RehashPlan {
  rehash: RehashEntry[];
  /** Units that cannot be rehashed yet, with what to do first. */
  skipped: Array<{ uid: string; name: string; file: string; reason: string }>;
  /** Live units whose latest version already has the indexer's current b3: hashes. */
  alreadyIndexed: number;
}

const LINKS: Link[] = [{ kind: "decision", ref: "docs/decisions/0014-rehash-versions.md" }];
const RULES_LINKS: Link[] = [...LINKS, { kind: "decision", ref: "docs/decisions/0024-rehash-after-rule-changes.md" }];
const RATIONALE = {
  provisional: "Rehashed by the indexer: the code is unchanged since the provisional hash, now recorded as the hash of its normalised syntax tree.",
  rules: "Rehashed by the indexer: the code is unchanged, but the adapters' rules now compute a different interface hash for it.",
};

/**
 * The `rehash` version for a unit whose code still has its latest version's b3:
 * content hash but whose interface hash the adapters now compute differently,
 * or undefined when there is none to write (ADR 0024).
 */
export function rulesRehash(latest: Version, code: Pick<AdaptedUnit, "contentHash" | "interfaceHash">): Omit<Version, "actor"> | undefined {
  if (latest.change === "removed" || isProvisional(latest.contentHash) || latest.contentHash !== code.contentHash) return undefined;
  if (latest.interfaceHash === undefined || latest.interfaceHash === code.interfaceHash) return undefined;
  return { contentHash: code.contentHash, interfaceHash: code.interfaceHash, parent: latest.contentHash, change: "rehash", rationale: RATIONALE.rules, links: RULES_LINKS };
}

/** Which units the rehash would touch, and which it must leave until their code is recorded. */
export async function planRehash(root: string, config: PoeticsConfig): Promise<RehashPlan> {
  const { parseable } = await filesInScope(root, config);
  const indexed = indexWith(adaptersFor(root, config), parseable);
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
    const latestVersion = unit.versions.at(-1)!;
    const latest = latestVersion.contentHash;
    const where = { uid: unit.uid, name: unit.name, file: unit.location.file };
    // By the unit's own name, as poetics index matches: a component's `export` is `default`, not what the indexer calls it.
    const code: AdaptedUnit | undefined = byPlace.get(place(unit.location.file, unit.name, unit.kind === "type"));
    if (!isProvisional(latest)) {
      const rules = code && rulesRehash(latestVersion, code);
      if (rules) plan.rehash.push({ ...where, parent: latest, reason: "rules", contentHash: rules.contentHash, interfaceHash: rules.interfaceHash! });
      else plan.alreadyIndexed++;
      continue;
    }
    if (!code) {
      plan.skipped.push({ ...where, reason: `no ${unit.kind} ${unit.name} in ${unit.location.file} that the indexer can read` });
      continue;
    }
    const text = (await textOf(code.span.file)).slice(code.span.start, code.span.end);
    if (gitBlobHash(text) !== latest) {
      plan.skipped.push({ ...where, reason: `the code changed since ${latest}; record that change first` });
      continue;
    }
    plan.rehash.push({ ...where, parent: latest, reason: "provisional", contentHash: code.contentHash, interfaceHash: code.interfaceHash });
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
      rationale: RATIONALE[entry.reason],
      links: entry.reason === "rules" ? RULES_LINKS : LINKS,
    });
  }
  return plan.rehash.length;
}

/** The indexer's hashes for the units in one file, for writing a version by hand. */
export async function unitHashes(root: string, config: PoeticsConfig, file: string): Promise<Array<Pick<AdaptedUnit, "name" | "kind" | "startLine" | "endLine" | "contentHash" | "interfaceHash">>> {
  return indexWith(adaptersFor(root, config), [file]).map(({ name, kind, startLine, endLine, contentHash, interfaceHash }) => ({ name, kind, startLine, endLine, contentHash, interfaceHash }));
}

function place(file: string, name: string, isType: boolean): string {
  return `${file}#${name}#${isType ? "type" : "value"}`;
}
