// Compares the code with the store: which declarations have no unit, which
// units are behind their code, and which units no longer have code.
import { isProvisional, isRemoved } from "@poetics/core";
import type { Unit } from "@poetics/core";
import type { Declaration } from "./declarations.ts";

export type DriftKind = "untracked" | "stale" | "orphaned" | "duplicate" | "unverifiable";

export interface DriftFinding {
  kind: DriftKind;
  file: string;
  name: string;
  uid?: string;
  message: string;
}

export interface Drift {
  findings: DriftFinding[];
  /** Declarations that have a unit (fresh or not). */
  tracked: number;
  /** Tracked units whose latest version matches the code. */
  fresh: number;
  declarations: number;
}

export const DRIFT_SEVERITY: Record<DriftKind, "error" | "warning"> = {
  untracked: "error",
  stale: "error",
  orphaned: "error",
  duplicate: "error",
  unverifiable: "warning",
};

const key = (file: string, name: string) => `${file}#${name}`;

/**
 * Matches declarations to units by file and name (lineage keeps these current
 * across renames and moves). Only units whose file satisfies `covers` can be
 * orphaned: pass the set of files that were scanned, so units for files outside
 * the scan (or that the parser cannot read yet, like .svelte) are left alone.
 * Removed units are history, not code, so they never match: an export that
 * reappears under a removed unit's name gets a new unit.
 */
export function compareCodeWithStore(
  declarations: readonly Declaration[],
  units: readonly Unit[],
  covers: (file: string) => boolean,
): Drift {
  const findings: DriftFinding[] = [];
  const byKey = new Map<string, Unit>();
  for (const unit of units) {
    if (unit.owner !== undefined || isRemoved(unit)) continue;
    const k = key(unit.location.file, unit.location.export ?? unit.name);
    const existing = byKey.get(k);
    if (existing) {
      findings.push({
        kind: "duplicate",
        file: unit.location.file,
        name: unit.name,
        uid: unit.uid,
        message: `${unit.name} has two units (${existing.uid}, ${unit.uid}); merge them with lineage`,
      });
      continue;
    }
    byKey.set(k, unit);
  }

  let tracked = 0;
  let fresh = 0;
  const matched = new Set<string>();
  for (const decl of declarations) {
    const k = key(decl.file, decl.name);
    const unit = byKey.get(k);
    if (!unit) {
      findings.push({
        kind: "untracked",
        file: decl.file,
        name: decl.name,
        message: `${decl.name} has no unit; mint a uid and create one (lines ${decl.startLine}-${decl.endLine}, hash ${decl.hash})`,
      });
      continue;
    }
    matched.add(k);
    tracked++;
    const latest = unit.versions.at(-1)!.contentHash;
    if (!isProvisional(latest)) {
      findings.push({
        kind: "unverifiable",
        file: decl.file,
        name: decl.name,
        uid: unit.uid,
        message: `${decl.name}'s latest hash is not provisional, so it cannot be compared until the indexer lands`,
      });
      continue;
    }
    if (latest === decl.hash) {
      fresh++;
    } else {
      findings.push({
        kind: "stale",
        file: decl.file,
        name: decl.name,
        uid: unit.uid,
        message: `${decl.name} changed but its unit has no version for it; append one with contentHash ${decl.hash} (lines ${decl.startLine}-${decl.endLine})`,
      });
    }
  }

  for (const [k, unit] of byKey) {
    if (matched.has(k) || !covers(unit.location.file)) continue;
    findings.push({
      kind: "orphaned",
      file: unit.location.file,
      name: unit.name,
      uid: unit.uid,
      message: `${unit.name} no longer exists in ${unit.location.file}; record lineage if it moved or was renamed, or append a "removed" version saying why it went`,
    });
  }

  return { findings, tracked, fresh, declarations: declarations.length };
}

