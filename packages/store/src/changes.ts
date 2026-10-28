// "What changed, and why" between two refs (ADR 0009): a diff of .poetics/
// between them, grouped by commit. Versions are append-only, so the versions
// present at `to` and absent at `from` are exactly the changes in the range.
import { notImplemented } from "@poetics/core";
import type { LineageEntry, Uid, UnitKind, Version } from "@poetics/core";
import type { StorePaths } from "./paths.ts";

/** One unit's part in a commit: the versions it gained and any lineage declared. */
export interface UnitChange {
  uid: Uid;
  name: string;
  kind: UnitKind;
  file: string;
  /** `added` for a new unit file, `removed` when its last new version is `removed`. */
  status: "added" | "changed" | "removed";
  versions: Version[];
  lineage: LineageEntry[];
}

export interface CommitSummary {
  commit: string;
  subject: string;
}

/** A commit and the unit changes it recorded, interface changes and removals first. */
export interface CommitChanges extends CommitSummary {
  units: UnitChange[];
}

export interface ChangeSet {
  /** Resolved commit the range starts after. */
  from: string;
  /** Resolved commit the range ends at, or `"worktree"` for uncommitted changes. */
  to: string;
  commits: CommitChanges[];
  /** Commits that touched no unit: config, CI, unexported code. Listed so nothing looks recorded that is not. */
  unrecorded: CommitSummary[];
  /** Decision records added or changed in the range, as repo-relative paths. */
  decisions: string[];
  /** Note ids added or changed in the range. */
  notes: string[];
}

export interface ChangesOptions {
  /** Defaults to the merge base with the default branch. */
  from?: string;
  /** Defaults to the working tree. */
  to?: string;
}

/** Every recorded change between two refs, with its rationale, grouped by commit. */
export function changesBetween(_paths: StorePaths, _options?: ChangesOptions): Promise<ChangeSet> {
  return notImplemented("changesBetween");
}
