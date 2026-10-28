// "What changed, and why" between two refs (ADR 0009): a diff of .poetics/
// between them, grouped by commit. Versions are append-only, so the versions
// present at `to` and absent at `from` are exactly the changes in the range.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { ChangeClass, LineageEntry, Uid, Unit, UnitKind, Version } from "@poetics/core";
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

const WORKTREE = "worktree";
const DECISION_RECORD = /^docs\/decisions\/\d{4}-[^/]+\.md$/;
// Breaking changes first: a removal or interface change is what a reader must not miss.
const RANK: Record<ChangeClass, number> = { removed: 0, interface: 1, behaviour: 2, created: 3, cosmetic: 4 };

interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  from?: string;
}

/**
 * Every recorded change between two refs, with its rationale, grouped by
 * commit, newest first. Merge commits are skipped: their changes arrive with
 * the commits they merge. Commits are walked with git, so no `commit` backfill
 * is needed.
 */
export async function changesBetween(paths: StorePaths, options: ChangesOptions = {}): Promise<ChangeSet> {
  const { root } = paths;
  const unitsDir = `${toPosix(relative(root, paths.units))}/`;
  const notesDir = `${toPosix(relative(root, paths.notes))}/`;
  const head = resolve(root, options.to ?? "HEAD");
  const from = options.from === undefined ? git(root, ["merge-base", defaultBranch(root), head]).trim() : resolve(root, options.from);

  const result: ChangeSet = { from, to: options.to === undefined ? WORKTREE : head, commits: [], unrecorded: [], decisions: [], notes: [] };
  const decisions = new Set<string>();
  const notes = new Set<string>();

  const record = async (
    summary: CommitSummary,
    changes: readonly FileChange[],
    before: (path: string) => string | undefined,
    after: (path: string) => Promise<string | undefined>,
  ) => {
    const units: UnitChange[] = [];
    for (const change of changes) {
      if (change.status !== "D" && DECISION_RECORD.test(change.path)) decisions.add(change.path);
      if (change.status !== "D" && change.path.startsWith(notesDir) && change.path.endsWith(".json")) {
        notes.add(basename(change.path, ".json"));
      }
      if (!isUnitFile(change.path, unitsDir) && !(change.from && isUnitFile(change.from, unitsDir))) continue;
      const was = change.status === "A" ? undefined : parse(before(change.from ?? change.path), change.from ?? change.path);
      const now = change.status === "D" ? undefined : parse(await after(change.path), change.path);
      const unitChange = diffUnit(was, now);
      if (unitChange) units.push(unitChange);
    }
    if (units.length === 0) {
      result.unrecorded.push(summary);
      return;
    }
    units.sort((a, b) => rank(a) - rank(b));
    result.commits.push({ ...summary, units });
  };

  const log = git(root, ["log", "--reverse", "--topo-order", "--no-merges", "--format=%H%x09%s", `${from}..${head}`]);
  for (const line of log.split("\n")) {
    if (!line) continue;
    const [commit, subject = ""] = line.split("\t") as [string, string?];
    const changes = parseNameStatus(git(root, ["diff-tree", "-r", "-M", "--root", "--no-commit-id", "--name-status", commit]));
    await record(
      { commit, subject },
      changes,
      (path) => showAt(root, `${commit}^`, path),
      async (path) => showAt(root, commit, path),
    );
  }

  if (options.to === undefined) {
    const changes = parseNameStatus(git(root, ["diff", "-M", "--name-status", "HEAD"]));
    for (const path of git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n")) {
      if (path) changes.push({ status: "A", path });
    }
    if (changes.length > 0) {
      await record(
        { commit: WORKTREE, subject: "Uncommitted changes" },
        changes,
        (path) => showAt(root, "HEAD", path),
        (path) => readFile(join(root, path), "utf8").catch(() => undefined),
      );
    }
  }

  result.commits.reverse();
  result.unrecorded.reverse();
  result.decisions = [...decisions].sort();
  result.notes = [...notes].sort();
  return result;
}

function diffUnit(before: Unit | undefined, after: Unit | undefined): UnitChange | undefined {
  const unit = after ?? before;
  if (!unit) return undefined;
  const versions = after ? after.versions.slice(before?.versions.length ?? 0) : [];
  const lineage = after ? (after.lineage ?? []).slice(before?.lineage?.length ?? 0) : [];
  // A deleted unit file is a removal too, even though ADR 0010 forbids it now.
  if (after && before && versions.length === 0 && lineage.length === 0) return undefined;
  const status = !before ? "added" : !after || versions.at(-1)?.change === "removed" ? "removed" : "changed";
  return { uid: unit.uid, name: unit.name, kind: unit.kind, file: unit.location.file, status, versions, lineage };
}

function rank(change: UnitChange): number {
  if (change.versions.length === 0) return change.status === "removed" ? RANK.removed : Object.keys(RANK).length;
  return Math.min(...change.versions.map((v) => RANK[v.change]));
}

function isUnitFile(path: string, unitsDir: string): boolean {
  return path.startsWith(unitsDir) && path.endsWith(".json");
}

function parse(raw: string | undefined, path: string): Unit | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as Unit;
  } catch (cause) {
    throw new Error(`${path}: invalid JSON: ${(cause as Error).message}`);
  }
}

function parseNameStatus(output: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [status, first, second] = line.split("\t");
    const code = status![0];
    if (code === "R") changes.push({ status: "R", from: first!, path: second! });
    else if (code === "A" || code === "M" || code === "D") changes.push({ status: code, path: first! });
    else if (code === "T" || code === "C") changes.push({ status: "M", path: second ?? first! });
  }
  return changes;
}

/** `origin/HEAD` when a remote names one, else a local `main` or `master`. */
function defaultBranch(root: string): string {
  try {
    return git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).trim();
  } catch {
    for (const branch of ["main", "master"]) {
      try {
        git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
        return branch;
      } catch {
        // try the next one
      }
    }
  }
  throw new Error("No default branch found (origin/HEAD, main or master); pass `from` explicitly");
}

function resolve(root: string, ref: string): string {
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`Unknown git ref: ${ref}`);
  }
}

function showAt(root: string, ref: string, path: string): string | undefined {
  try {
    return git(root, ["show", `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}
