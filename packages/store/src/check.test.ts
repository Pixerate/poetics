import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Hash, Version } from "@poetics/core";
import { checkStore } from "./check.ts";
import { storePaths } from "./paths.ts";
import { createValidator, loadSchemaSet } from "./schemas.ts";
import { NOTE_ID, REPO_SCHEMAS, UID_A, UID_B, UID_C, defaultConfig, hash, makeNote, makeRepo, makeUnit, writeNote, writeUnit } from "./test-helpers.ts";

const validator = createValidator(await loadSchemaSet(REPO_SCHEMAS));
const check = async (root: string) => checkStore(storePaths(root), validator);
const removedVersion = (parent: Hash): Version => ({
  contentHash: REMOVED_CONTENT_HASH,
  provisional: true,
  parent,
  change: "removed",
  actor: { kind: "human" },
  rationale: "Folded into formatRange.",
});
const messages = (result: Awaited<ReturnType<typeof check>>) => result.problems.map((p) => p.message);
const inferredVersion = (hash: Hash, parent: Hash | null, change: Version["change"]): Version => ({
  contentHash: hash,
  parent,
  change,
  commit: "a".repeat(40),
  actor: { kind: "human" },
  rationale: "From git.",
  inferred: { by: "poetics-backfill", confidence: "medium", sources: ["commit"], drafted: false, reviewed: false },
});


describe("checkStore", () => {
  it("passes a consistent store", async () => {
    const root = await makeRepo([makeUnit(UID_A), makeUnit(UID_B, { versions: [{ ...makeUnit(UID_B).versions[0]!, deps: { [UID_A]: hash("1") } }] })]);
    expect(await check(root)).toEqual({ units: 2, notes: 0, problems: [] });
  });

  it("reports a missing config", async () => {
    const root = await makeRepo([]);
    await rm(join(root, ".poetics", "config.json"));
    expect(messages(await check(root))).toContain("missing");
  });

  it("reports invalid JSON and schema errors per file", async () => {
    const root = await makeRepo([]);
    await writeFile(join(root, ".poetics", "units", `${UID_A}.json`), "{ nope");
    await writeUnit(root, { ...makeUnit(UID_B), kind: "widget" } as never);
    const result = await check(root);
    expect(result.problems.map((p) => p.file)).toEqual([`.poetics/units/${UID_A}.json`, `.poetics/units/${UID_B}.json`]);
    expect(messages(result)[0]).toMatch(/invalid JSON/);
  });

  it("requires the filename to match the uid", async () => {
    const root = await makeRepo([]);
    await writeUnit(root, makeUnit(UID_A), join(".poetics", "units", `${UID_B}.json`));
    expect(messages(await check(root))).toContain(`filename does not match uid ${UID_A}`);
  });

  it("checks the version chain", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push(
      { ...unit.versions[0]!, contentHash: hash("2"), parent: hash("9"), change: "behaviour" },
      { ...unit.versions[0]!, contentHash: hash("2"), parent: hash("2"), change: "created" },
    );
    const result = messages(await check(await makeRepo([unit])));
    expect(result).toContain(`versions[1].parent should be ${hash("1")}`);
    expect(result).toContain(`versions[2] repeats contentHash ${hash("2")}`);
    expect(result).toContain('versions[2].change cannot be "created"');
  });

  it("only allows removed as the last version", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push(removedVersion(hash("1")), { ...unit.versions[0]!, contentHash: hash("2"), parent: REMOVED_CONTENT_HASH, change: "behaviour" });
    expect(messages(await check(await makeRepo([unit])))).toContain(
      'versions[1] is "removed" but versions follow it; a removed unit gets no more versions',
    );
  });

  it("does not require a removed unit's file or tests to exist", async () => {
    const unit = makeUnit(UID_A, { location: { file: "src/gone.ts" }, tests: [{ file: "src/gone.test.ts", via: "static" }] });
    unit.versions.push(removedVersion(hash("1")));
    expect(await check(await makeRepo([unit]))).toEqual({ units: 1, notes: 0, problems: [] });
  });

  it("exempts the removed sentinel from the provisional-hash policy", async () => {
    const unit = makeUnit(UID_A);
    const { provisional: _, ...seed } = unit.versions[0]!;
    unit.versions[0] = { ...seed, contentHash: hash("1", "b3") };
    unit.versions.push(removedVersion(hash("1", "b3")));
    const root = await makeRepo([unit], { ...defaultConfig(), policy: { allowProvisionalHashes: false } });
    expect(messages(await check(root))).toEqual([]);
  });

  it("warns when a live unit still depends on a removed one", async () => {
    const gone = makeUnit(UID_A, { name: "formatRange" });
    gone.versions.push(removedVersion(hash("1")));
    const caller = makeUnit(UID_B, { versions: [{ ...makeUnit(UID_B).versions[0]!, deps: { [UID_A]: hash("1") } }] });
    const result = await check(await makeRepo([gone, caller]));
    expect(result.problems).toEqual([
      { severity: "warning", file: `.poetics/units/${UID_B}.json`, message: `depends on formatRange (${UID_A}), which has been removed` },
    ]);
  });

  it("ties the provisional flag to git: hashes", async () => {
    const unit = makeUnit(UID_A);
    unit.versions[0] = { ...unit.versions[0]!, provisional: false };
    const other = makeUnit(UID_B);
    other.versions[0] = { ...other.versions[0]!, contentHash: hash("a", "b3") };
    const result = messages(await check(await makeRepo([unit, other])));
    expect(result).toContain("versions[0] has git: hashes but is not marked provisional");
    expect(result).toContain("versions[0] is marked provisional but has no git: hashes");
  });

  it("enforces the provisional-hash policy", async () => {
    const root = await makeRepo([makeUnit(UID_A)], { ...defaultConfig(), policy: { allowProvisionalHashes: false } });
    expect(messages(await check(root))).toContain("versions[0] is provisional but policy forbids it");
  });

  it("keeps provisional history under the policy once the latest version is rehashed", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push({ contentHash: hash("1", "b3"), parent: hash("1"), change: "rehash", actor: { kind: "human" }, rationale: "Rehashed by the indexer." });
    const root = await makeRepo([unit], { ...defaultConfig(), policy: { allowProvisionalHashes: false } });
    expect(messages(await check(root))).toEqual([]);
  });

  it("keeps a note confirmed through a rehash, but not through a code change", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push({ contentHash: hash("1", "b3"), parent: hash("1"), change: "rehash", actor: { kind: "human" }, rationale: "Rehashed." });
    const note = makeNote({ anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } });
    const root = await makeRepo([unit]);
    await writeNote(root, note);
    expect(messages(await check(root))).toEqual([]);

    unit.versions.push({ contentHash: hash("2", "b3"), parent: hash("1", "b3"), change: "behaviour", actor: { kind: "human" }, rationale: "Changed." });
    await writeUnit(root, unit);
    expect(messages(await check(root))).toEqual(["fnA has changed since this note was confirmed; re-check it and update observedAt"]);
  });

  it("only allows a rehash with b3: hashes, straight after a git: version", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push(
      { contentHash: hash("1", "b3"), parent: hash("1"), change: "rehash", actor: { kind: "human" }, rationale: "Rehashed." },
      { contentHash: hash("2", "b3"), parent: hash("1", "b3"), change: "rehash", actor: { kind: "human" }, rationale: "Rehashed again." },
    );
    const other = makeUnit(UID_B);
    other.versions.push({ contentHash: hash("2"), provisional: true, parent: hash("1"), change: "rehash", actor: { kind: "human" }, rationale: "Not a rehash." });
    const result = messages(await check(await makeRepo([unit, other])));
    expect(result).toContain("versions[2] is a rehash but the version before it already has a b3: hash");
    expect(result).toContain("versions[1] is a rehash but its hashes are not all b3:");
  });

  it("checks references to files and units", async () => {
    const unit = makeUnit(UID_A, {
      owner: UID_B,
      location: { file: "src/missing.ts" },
      tests: [{ file: "src/missing.test.ts", via: "explicit" }],
      lineage: [{ kind: "merge", uids: [UID_B] }],
    });
    unit.versions[0]!.deps = { [UID_B]: hash("1") };
    const result = await check(await makeRepo([unit]));
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        "location.file src/missing.ts does not exist",
        `owner ${UID_B} is not a known unit`,
        `dependency ${UID_B} is not a known unit`,
        `lineage refers to unknown unit ${UID_B}`,
        "linked test src/missing.test.ts does not exist",
      ]),
    );
    expect(result.problems.find((p) => p.message.startsWith("lineage"))?.severity).toBe("warning");
  });

  it("validates poetics.lock and its pins", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await writeFile(
      join(root, ".poetics", "poetics.lock"),
      JSON.stringify({ version: 1, pins: { [UID_B]: { name: "Gone", closureHash: hash("a", "b3") } } }),
    );
    expect(messages(await check(root))).toContain(`pin for unknown unit ${UID_B}`);
  });

  it("reports duplicate uids across shard folders", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await writeUnit(root, makeUnit(UID_A), join(".poetics", "units", "01", `${UID_A}.json`));
    expect(messages(await check(root)).some((m) => m.startsWith("duplicate uid"))).toBe(true);
  });
});

describe("checkStore notes", () => {
  it("counts valid notes", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await writeNote(root, makeNote({ anchors: { units: [{ uid: UID_A, observedAt: hash("1") }], paths: ["src/lib.ts"] } }));
    expect(await check(root)).toEqual({ units: 1, notes: 1, problems: [] });
  });

  it("reports schema errors and filename mismatches", async () => {
    const root = await makeRepo([]);
    await writeNote(root, { ...makeNote(), status: "resolved" } as never);
    await writeNote(root, makeNote({ id: UID_B }), join(".poetics", "notes", `${UID_A}.json`));
    const result = messages(await check(root));
    expect(result.some((m) => m.includes("resolvedBy"))).toBe(true);
    expect(result).toContain(`filename does not match id ${UID_B}`);
  });

  it("checks anchors, check files and supersession", async () => {
    const root = await makeRepo([]);
    await writeNote(
      root,
      makeNote({
        status: "superseded",
        supersededBy: UID_B,
        anchors: { units: [{ uid: UID_A }], paths: ["src/gone.ts"] },
        check: { kind: "test", ref: "src/gone.test.ts" },
      }),
    );
    expect(messages(await check(root))).toEqual([
      `anchored unit ${UID_A} is not a known unit`,
      "anchored path src/gone.ts does not exist",
      "check file src/gone.test.ts does not exist",
      `supersededBy ${UID_B} is not a known note`,
    ]);
  });

  it("warns when an anchored unit has changed since the note was confirmed", async () => {
    const unit = makeUnit(UID_A, { name: "formatPrice" });
    unit.versions.push({ ...unit.versions[0]!, contentHash: hash("2"), parent: hash("1"), change: "behaviour" });
    const root = await makeRepo([unit]);
    await writeNote(root, makeNote({ anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } }));
    const result = await check(root);
    expect(result.problems).toEqual([
      {
        severity: "warning",
        file: `.poetics/notes/${NOTE_ID}.json`,
        message: "formatPrice has changed since this note was confirmed; re-check it and update observedAt",
      },
    ]);
  });

  it("does not ask for re-checks on resolved notes", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push({ ...unit.versions[0]!, contentHash: hash("2"), parent: hash("1"), change: "behaviour" });
    const root = await makeRepo([unit]);
    await writeNote(
      root,
      makeNote({ status: "resolved", resolvedBy: { kind: "commit", ref: "abc1234" }, anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } }),
    );
    expect((await check(root)).problems).toEqual([]);
  });

  it("accepts reconstructed prehistory, and checks it is a created-first chain of inferred, committed changes", async () => {
    const good = makeUnit(UID_A, { prehistory: [inferredVersion(hash("7", "b3"), null, "created"), inferredVersion(hash("8", "b3"), hash("7", "b3"), "behaviour")] });
    expect(messages(await check(await makeRepo([good])))).toEqual([]);

    const { inferred: _, ...recorded } = inferredVersion(hash("8", "b3"), hash("9", "b3"), "created");
    const bad = makeUnit(UID_B, { prehistory: [inferredVersion(hash("7", "b3"), null, "behaviour"), recorded] });
    // A well-formed removal, so the schema passes and the prehistory rule is what refuses it.
    const removal = { ...inferredVersion(REMOVED_CONTENT_HASH, hash("7", "b3"), "removed"), provisional: true };
    const removed = makeUnit(UID_C, { prehistory: [inferredVersion(hash("7", "b3"), null, "created"), removal] });
    expect(messages(await check(await makeRepo([bad, removed])))).toEqual([
      'prehistory[0].change must be "created"',
      `prehistory[1].parent should be ${hash("7", "b3")}`,
      'prehistory[1].change cannot be "created"',
      "prehistory[1] has no inferred record; prehistory is always reconstructed",
      'prehistory[1] cannot be "removed"; prehistory only reconstructs changes to code',
    ]);
  });
});
