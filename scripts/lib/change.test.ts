import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitBlobHash } from "@poetics/core";
import type { Unit } from "@poetics/core";
import { checkChange } from "./change.ts";
import { FN_A, SCOPE, makeGitRepo, runGit, unitFor, write, writeUnitFile } from "./test-repo.ts";

const UID = "01JB8K0000000000000000000A";
const UID_B = "01JB8K0000000000000000000B";
const kinds = (report: Awaited<ReturnType<typeof checkChange>>) => report.findings.map((f) => `${f.severity}:${f.kind}`);
const FN_A2 = "export function a() {\n  return 2;\n}";

function appendVersion(unit: Unit, source: string, extra: Partial<Unit["versions"][number]> = {}): Unit {
  unit.versions.push({
    contentHash: gitBlobHash(source),
    provisional: true,
    parent: unit.versions.at(-1)!.contentHash,
    change: "behaviour",
    actor: { kind: "human" },
    rationale: "Return 2 so the total is right",
    links: [{ kind: "github-issue", ref: "#1" }],
    ...extra,
  });
  return unit;
}

describe("checkChange", () => {
  it("passes when nothing changed", async () => {
    const root = await makeGitRepo(UID);
    expect(await checkChange(root, "HEAD", SCOPE)).toMatchObject({ changedCodeFiles: [], changedUnits: 0, findings: [] });
  });

  it("flags a code change with no unit version", async () => {
    const root = await makeGitRepo(UID);
    await write(root, "src/a.ts", `${FN_A2}\n`);
    const report = await checkChange(root, "HEAD", SCOPE);
    expect(report.changedCodeFiles).toEqual(["src/a.ts"]);
    expect(kinds(report)).toEqual(["error:stale"]);
  });

  it("passes a code change recorded with a version and a test change", async () => {
    const root = await makeGitRepo(UID);
    await write(root, "src/a.ts", `${FN_A2}\n`);
    await write(root, "src/a.test.ts", "// updated\n");
    await writeUnitFile(root, appendVersion(unitFor(UID, "a", FN_A), FN_A2));
    expect((await checkChange(root, "HEAD", SCOPE)).findings).toEqual([]);
  });

  it("warns when a behaviour change has no test change and no links", async () => {
    const root = await makeGitRepo(UID);
    await write(root, "src/a.ts", `${FN_A2}\n`);
    await writeUnitFile(root, appendVersion(unitFor(UID, "a", FN_A), FN_A2, { links: [] }));
    expect(kinds(await checkChange(root, "HEAD", SCOPE))).toEqual(["warning:no-links", "warning:unverified"]);
  });

  it("flags new exports without units, including in new files", async () => {
    const root = await makeGitRepo(UID);
    await write(root, "src/b.ts", "export function b() {}\n");
    const report = await checkChange(root, "HEAD", SCOPE);
    expect(report.findings.map((f) => `${f.kind}:${f.file}`)).toEqual(["untracked:src/b.ts"]);
  });

  it("flags units left behind when their file is deleted", async () => {
    const root = await makeGitRepo(UID);
    await rm(join(root, "src", "a.ts"));
    expect(kinds(await checkChange(root, "HEAD", SCOPE))).toEqual(["error:orphaned"]);
  });

  it("flags edits to earlier versions", async () => {
    const root = await makeGitRepo(UID);
    const unit = unitFor(UID, "a", FN_A);
    unit.versions[0]!.rationale = "Rewritten";
    await writeUnitFile(root, unit);
    expect(kinds(await checkChange(root, "HEAD", SCOPE))).toEqual(["error:rewritten-history"]);
  });

  it("requires lineage when a unit moves, and accepts it when present", async () => {
    const root = await makeGitRepo(UID);
    runGit(root, "mv", "src/a.ts", "src/moved.ts");
    const moved = unitFor(UID, "a", FN_A, { location: { file: "src/moved.ts" } });
    await writeUnitFile(root, moved);
    expect(kinds(await checkChange(root, "HEAD", SCOPE))).toEqual(["error:missing-lineage"]);

    await writeUnitFile(root, { ...moved, lineage: [{ kind: "move", from: "src/a.ts" }] });
    expect((await checkChange(root, "HEAD", SCOPE)).findings).toEqual([]);
  });

  it("warns when an interface change leaves dependents without versions", async () => {
    const root = await makeGitRepo(UID);
    const callerSource = "export function b() {\n  return a();\n}";
    const caller = unitFor(UID_B, "b", callerSource, { location: { file: "src/b.ts" }, tests: [] });
    caller.versions[0]!.deps = { [UID]: gitBlobHash(FN_A) };
    await write(root, "src/b.ts", `${callerSource}\n`);
    await writeUnitFile(root, caller);
    runGit(root, "add", "-A");
    runGit(root, "commit", "-q", "-m", "caller");

    const iface = "export function a(n: number) {\n  return n;\n}";
    await write(root, "src/a.ts", `${iface}\n`);
    await write(root, "src/a.test.ts", "// updated\n");
    await writeUnitFile(root, appendVersion(unitFor(UID, "a", FN_A), iface, { change: "interface" }));
    expect(kinds(await checkChange(root, "HEAD", SCOPE))).toEqual(["warning:callers-not-updated"]);
  });

  it("compares a branch with where it forked from", async () => {
    const root = await makeGitRepo(UID);
    runGit(root, "checkout", "-q", "-b", "feature");
    await write(root, "src/a.ts", `${FN_A2}\n`);
    runGit(root, "commit", "-q", "-am", "change without version");
    const report = await checkChange(root, "main", SCOPE);
    expect(report.base).toBe(runGit(root, "rev-parse", "main").trim());
    expect(kinds(report)).toEqual(["error:stale"]);
  });

  it("warns when several units share one rationale", async () => {
    const root = await makeGitRepo(UID);
    for (const [uid, name] of [["01JB8K0000000000000000000C", "c"], ["01JB8K0000000000000000000D", "d"], ["01JB8K0000000000000000000E", "e"]] as const) {
      const source = `export function ${name}() {}`;
      await write(root, `src/${name}.ts`, `${source}\n`);
      const unit = unitFor(uid, name, source, { location: { file: `src/${name}.ts` } });
      unit.versions[0]!.rationale = "Misc changes";
      await writeUnitFile(root, unit);
    }
    expect(kinds(await checkChange(root, "HEAD", SCOPE))).toEqual(Array(3).fill("warning:repeated-rationale"));
  });
});
