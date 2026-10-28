import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Hash, Unit, Version } from "@poetics/core";
import { changesBetween } from "./changes.ts";
import { storePaths } from "./paths.ts";
import { NOTE_ID, UID_A, UID_B, UID_C, commitAll, hash, makeNote, makeRepo, makeUnit, runGit, writeNote, writeUnit } from "./test-helpers.ts";

const version = (unit: Unit, change: Version["change"], rationale: string, contentHash: Hash = hash(String(unit.versions.length + 1))): Version => ({
  contentHash,
  provisional: true,
  parent: unit.versions.at(-1)!.contentHash,
  change,
  actor: { kind: "human" },
  rationale,
});

/** A repo on `main` whose first commit holds units A and B. */
async function makeHistory(): Promise<{ root: string; a: Unit; b: Unit; base: string }> {
  const a = makeUnit(UID_A);
  const b = makeUnit(UID_B);
  const root = await makeRepo([a, b]);
  runGit(root, "init", "-q", "-b", "main");
  commitAll(root, "Seed");
  return { root, a, b, base: runGit(root, "rev-parse", "HEAD").trim() };
}

const changes = (root: string, options: Parameters<typeof changesBetween>[1] = {}) => changesBetween(storePaths(root), options);
const head = (root: string) => runGit(root, "rev-parse", "HEAD").trim();

describe("changesBetween", () => {
  it("groups new versions by commit, newest first, with their rationale", async () => {
    const { root, a, b, base } = await makeHistory();
    a.versions.push(version(a, "behaviour", "Round half up"));
    await writeUnit(root, a);
    commitAll(root, "Fix rounding");
    b.versions.push(version(b, "cosmetic", "Tighten the return type"));
    await writeUnit(root, b);
    commitAll(root, "Tidy types");

    const result = await changes(root, { from: base, to: "HEAD" });
    expect(result).toMatchObject({ from: base, to: head(root), unrecorded: [], decisions: [], notes: [] });
    expect(result.commits.map((c) => [c.subject, c.units.map((u) => [u.name, u.status, u.versions.map((v) => v.rationale)])])).toEqual([
      ["Tidy types", [["fnB", "changed", ["Tighten the return type"]]]],
      ["Fix rounding", [["fnA", "changed", ["Round half up"]]]],
    ]);
  });

  it("puts removals and interface changes before other units in a commit", async () => {
    const { root, a, b, base } = await makeHistory();
    const c = makeUnit(UID_C);
    a.versions.push(version(a, "behaviour", "Behaviour"));
    b.versions.push(version(b, "removed", "Folded into fnC", REMOVED_CONTENT_HASH));
    for (const unit of [a, b, c]) await writeUnit(root, unit);
    commitAll(root, "Fold fnB into fnC");

    const [commit] = (await changes(root, { from: base, to: "HEAD" })).commits;
    expect(commit!.units.map((u) => [u.name, u.status])).toEqual([
      ["fnB", "removed"],
      ["fnA", "changed"],
      ["fnC", "added"],
    ]);
  });

  it("lists commits that recorded no unit change separately", async () => {
    const { root, a, base } = await makeHistory();
    await writeFile(join(root, "README.md"), "hello\n");
    commitAll(root, "Add a readme");
    a.docs = "Docs only, no new version.";
    await writeUnit(root, a);
    commitAll(root, "Document fnA");

    const result = await changes(root, { from: base, to: "HEAD" });
    expect(result.commits).toEqual([]);
    expect(result.unrecorded.map((c) => c.subject)).toEqual(["Document fnA", "Add a readme"]);
  });

  it("reports declared lineage without a new version", async () => {
    const { root, a, base } = await makeHistory();
    await writeUnit(root, { ...a, name: "formatPrice", lineage: [{ kind: "rename", from: "fnA" }] });
    commitAll(root, "Rename fnA");

    const [commit] = (await changes(root, { from: base, to: "HEAD" })).commits;
    expect(commit!.units).toEqual([
      { uid: UID_A, name: "formatPrice", kind: "function", file: "src/lib.ts", status: "changed", versions: [], lineage: [{ kind: "rename", from: "fnA" }] },
    ]);
  });

  it("treats a deleted unit file as a removal with no versions", async () => {
    const { root, base } = await makeHistory();
    await rm(join(root, ".poetics", "units", `${UID_B}.json`));
    commitAll(root, "Delete fnB's unit");

    const [commit] = (await changes(root, { from: base, to: "HEAD" })).commits;
    expect(commit!.units.map((u) => [u.name, u.status, u.versions.length])).toEqual([["fnB", "removed", 0]]);
  });

  it("collects decision records and notes changed in the range", async () => {
    const { root, base } = await makeHistory();
    await mkdir(join(root, "docs", "decisions"), { recursive: true });
    await writeFile(join(root, "docs", "decisions", "0001-first.md"), "# 0001\n");
    await writeFile(join(root, "docs", "decisions", "README.md"), "index\n");
    await writeNote(root, makeNote());
    commitAll(root, "Decide and note");

    const result = await changes(root, { from: base, to: "HEAD" });
    expect(result.decisions).toEqual(["docs/decisions/0001-first.md"]);
    expect(result.notes).toEqual([NOTE_ID]);
    expect(result.unrecorded.map((c) => c.subject)).toEqual(["Decide and note"]);
  });

  it("includes uncommitted changes only when `to` is omitted", async () => {
    const { root, a, base } = await makeHistory();
    a.versions.push(version(a, "behaviour", "Work in progress"));
    await writeUnit(root, a);
    const c = makeUnit(UID_C);
    await writeUnit(root, c);

    const withWorktree = await changes(root, { from: base });
    expect(withWorktree.to).toBe("worktree");
    expect(withWorktree.commits.map((commit) => [commit.commit, commit.subject, commit.units.map((u) => [u.name, u.status])])).toEqual([
      ["worktree", "Uncommitted changes", [["fnA", "changed"], ["fnC", "added"]]],
    ]);
    expect((await changes(root, { from: base, to: "HEAD" })).commits).toEqual([]);
  });

  it("starts from the merge base with the default branch by default", async () => {
    const { root, a, b } = await makeHistory();
    b.versions.push(version(b, "behaviour", "On main"));
    await writeUnit(root, b);
    commitAll(root, "Main moves on");
    runGit(root, "checkout", "-q", "-b", "feature", "HEAD~1");
    a.versions.push(version(a, "behaviour", "On the branch"));
    await writeUnit(root, a);
    commitAll(root, "Branch work");

    const result = await changes(root);
    expect(result.from).toBe(runGit(root, "rev-parse", "main~1").trim());
    expect(result.commits.map((c) => c.subject)).toEqual(["Branch work"]);
  });

  it("skips merge commits, whose changes arrive with the commits they merge", async () => {
    const { root, a, base } = await makeHistory();
    runGit(root, "checkout", "-q", "-b", "feature");
    a.versions.push(version(a, "behaviour", "From the branch"));
    await writeUnit(root, a);
    commitAll(root, "Branch work");
    runGit(root, "checkout", "-q", "main");
    await writeFile(join(root, "README.md"), "hello\n");
    commitAll(root, "Main work");
    runGit(root, "-c", "core.editor=true", "merge", "-q", "--no-ff", "feature", "-m", "Merge feature");

    const result = await changes(root, { from: base, to: "HEAD" });
    expect(result.commits.map((c) => c.subject)).toEqual(["Branch work"]);
    expect(result.unrecorded.map((c) => c.subject)).toEqual(["Main work"]);
  });

  it("rejects unknown refs", async () => {
    const { root } = await makeHistory();
    await expect(changes(root, { from: "nope", to: "HEAD" })).rejects.toThrow("Unknown git ref: nope");
  });
});
