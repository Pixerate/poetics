import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotImplementedError, REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Hash, Version } from "@poetics/core";
import {
  appendVersion,
  confirmNote,
  createNote,
  createUnit,
  extendsPrehistory,
  linkTest,
  listUnitFiles,
  parseUnit,
  readUnit,
  readUnitFiles,
  reclassifyUnit,
  recordRationale,
  relinkTests,
  relocateUnit,
  setPrehistory,
  setDocs,
} from "./json-store.ts";
import { storePaths } from "./paths.ts";
import { createValidator, loadSchemaSet } from "./schemas.ts";
import { NOTE_ID, REPO_SCHEMAS, UID_A, UID_B, hash, makeNote, makeRepo, makeUnit, writeUnit } from "./test-helpers.ts";

describe("reading unit files", () => {
  it("returns nothing when there is no store", async () => {
    expect(await listUnitFiles(storePaths("/definitely/not/here"))).toEqual([]);
  });

  it("finds flat and sharded files with repo-relative POSIX paths", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await writeUnit(root, makeUnit(UID_B), join(".poetics", "units", "01", `${UID_B}.json`));
    const files = await readUnitFiles(storePaths(root));
    expect(files.map((f) => f.relativePath)).toEqual([`.poetics/units/01/${UID_B}.json`, `.poetics/units/${UID_A}.json`]);
    expect(parseUnit(files[1]!).uid).toBe(UID_A);
  });

  it("reads one unit by uid in either layout, and names a missing one", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await writeUnit(root, makeUnit(UID_B), join(".poetics", "units", "01", `${UID_B}.json`));
    expect((await readUnit(storePaths(root), UID_A)).uid).toBe(UID_A);
    expect((await readUnit(storePaths(root), UID_B)).uid).toBe(UID_B);
    await expect(readUnit(storePaths(root), "01JB8K0000000000000000000Z")).rejects.toThrow(/No unit file for/);
  });

  it("names the file when JSON is invalid", () => {
    expect(() => parseUnit({ path: "/x", relativePath: ".poetics/units/x.json", raw: "{" })).toThrow(/\.poetics\/units\/x\.json/);
  });
});

describe("appendVersion", () => {
  const human = { kind: "human" } as const;
  const next = (overrides: Partial<Version> = {}): Version => ({
    contentHash: hash("2"),
    provisional: true,
    parent: hash("1"),
    change: "behaviour",
    actor: { kind: "agent", tool: "claude-code", reviewed: false },
    rationale: "Rounds half up",
    ...overrides,
  });
  const readBack = async (root: string, path = join(".poetics", "units", `${UID_A}.json`)) =>
    JSON.parse(await readFile(join(root, path), "utf8")) as ReturnType<typeof makeUnit>;

  it("appends the version, stamped with the writer's actor, and keeps earlier ones", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await appendVersion({ paths: storePaths(root), actor: human }, UID_A, next());
    const unit = await readBack(root);
    expect(unit.versions).toHaveLength(2);
    expect(unit.versions[0]).toEqual(makeUnit(UID_A).versions[0]);
    expect(unit.versions[1]).toMatchObject({ contentHash: hash("2"), actor: human, rationale: "Rounds half up" });
  });

  it("writes the file the way hand edits do, and leaves no temp file", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await appendVersion({ paths: storePaths(root), actor: human }, UID_A, next());
    const raw = await readFile(join(root, ".poetics", "units", `${UID_A}.json`), "utf8");
    expect(raw).toBe(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
    expect(await readdir(join(root, ".poetics", "units"))).toEqual([`${UID_A}.json`]);
  });

  it("finds a unit in the sharded layout", async () => {
    const root = await makeRepo([]);
    const path = join(".poetics", "units", "01", `${UID_A}.json`);
    await writeUnit(root, makeUnit(UID_A), path);
    await appendVersion({ paths: storePaths(root), actor: human }, UID_A, next());
    expect((await readBack(root, path)).versions).toHaveLength(2);
  });

  it("rejects a parent that is not the latest version", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await expect(appendVersion({ paths: storePaths(root), actor: human }, UID_A, next({ parent: hash("9") }))).rejects.toThrow(
      /parent is git:9+, latest is git:1+/,
    );
    expect((await readBack(root)).versions).toHaveLength(1);
  });

  it("rejects a second created version and anything after removed", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const ctx = { paths: storePaths(root), actor: human };
    await expect(appendVersion(ctx, UID_A, next({ change: "created" }))).rejects.toThrow(/first version is created/);

    await appendVersion(ctx, UID_A, next({ contentHash: REMOVED_CONTENT_HASH, change: "removed" }));
    await expect(appendVersion(ctx, UID_A, next({ parent: REMOVED_CONTENT_HASH, contentHash: hash("3") }))).rejects.toThrow(
      /latest version is removed/,
    );
  });

  it("rejects an unknown uid", async () => {
    const root = await makeRepo([]);
    await expect(appendVersion({ paths: storePaths(root), actor: human }, UID_A, next())).rejects.toThrow(/No unit file for/);
  });

  it("rejects a version the unit schema refuses, and writes nothing", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const validator = createValidator(await loadSchemaSet(REPO_SCHEMAS));
    const bad = next({ rationale: "", contentHash: "nope" as Version["contentHash"] });
    await expect(appendVersion({ paths: storePaths(root), actor: human, validator }, UID_A, bad)).rejects.toThrow(/versions\/1/);
    expect((await readBack(root)).versions).toHaveLength(1);
  });
});

describe("validated writes", () => {
  it("are stubs until phase 2", () => {
    const ctx = { paths: storePaths("/repo"), actor: { kind: "human" } as const };
    expect(() => linkTest(ctx, UID_A, { file: "a.test.ts", via: "explicit" })).toThrow(NotImplementedError);
    expect(() => setDocs(ctx, UID_A, "docs", hash("1"))).toThrow(NotImplementedError);
  });
});

describe("createUnit", () => {
  const agent = { kind: "agent", tool: "claude-code", reviewed: false } as const;

  it("writes a new unit as the writer, in the flat or sharded layout", async () => {
    const root = await makeRepo([]);
    await createUnit({ paths: storePaths(root), actor: agent }, makeUnit(UID_A));
    await createUnit({ paths: storePaths(root), actor: agent }, makeUnit(UID_B), "sharded");
    expect((await readUnit(storePaths(root), UID_A)).versions[0]!.actor).toEqual(agent);
    expect(await readdir(join(root, ".poetics", "units", UID_B.slice(0, 2)))).toEqual([`${UID_B}.json`]);
  });

  it("refuses an existing uid and anything but a single created version", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const ctx = { paths: storePaths(root), actor: agent };
    await expect(createUnit(ctx, makeUnit(UID_A))).rejects.toThrow(`Cannot create unit ${UID_A}: .poetics/units/${UID_A}.json already exists`);
    const twice = makeUnit(UID_B);
    twice.versions.push({ ...twice.versions[0]!, change: "behaviour", parent: twice.versions[0]!.contentHash, contentHash: hash("2") });
    await expect(createUnit(ctx, twice)).rejects.toThrow("exactly one version");
  });
});

describe("relocateUnit", () => {
  const human = { kind: "human" } as const;

  it("moves the unit and appends its lineage, leaving versions alone", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await relocateUnit({ paths: storePaths(root), actor: human }, UID_A, { file: "src/b.ts", name: "fnB", export: "default" }, [
      { kind: "move", from: "src/a.ts" },
      { kind: "rename", from: "fnA" },
    ]);
    const unit = await readUnit(storePaths(root), UID_A);
    expect([unit.name, unit.location, unit.lineage]).toEqual([
      "fnB",
      { file: "src/b.ts", export: "default" },
      [
        { kind: "move", from: "src/a.ts" },
        { kind: "rename", from: "fnA" },
      ],
    ]);
    expect(unit.versions).toEqual(makeUnit(UID_A).versions);
  });

  it("sets the owner the unit moved under, and clears it when the unit moves out", async () => {
    const root = await makeRepo([makeUnit(UID_A), { ...makeUnit(UID_B), owner: UID_A }]);
    const ctx = { paths: storePaths(root), actor: human };
    await relocateUnit(ctx, UID_B, { file: "src/b.ts", name: "fnB" }, [{ kind: "move", from: "src/a.ts" }]);
    expect((await readUnit(storePaths(root), UID_B)).owner).toBeUndefined();
    await relocateUnit(ctx, UID_B, { file: "src/a.ts", name: "fnB", owner: UID_A }, [{ kind: "move", from: "src/b.ts" }]);
    expect((await readUnit(storePaths(root), UID_B)).owner).toBe(UID_A);
  });

  it("refuses a move without lineage, or of a removed unit", async () => {
    const removed = makeUnit(UID_B);
    removed.versions.push({ contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: removed.versions[0]!.contentHash, change: "removed", actor: human, rationale: "Gone." });
    const root = await makeRepo([makeUnit(UID_A), removed]);
    const ctx = { paths: storePaths(root), actor: human };
    await expect(relocateUnit(ctx, UID_A, { file: "src/b.ts", name: "fnA" }, [])).rejects.toThrow("no lineage entry says how it moved");
    await expect(relocateUnit(ctx, UID_B, { file: "src/b.ts", name: "x" }, [{ kind: "move", from: "src/a.ts" }])).rejects.toThrow("its latest version is removed");
  });
});

describe("relinkTests", () => {
  const human = { kind: "human" } as const;

  it("rewrites only the files of the links that moved", async () => {
    const tests = [
      { file: "src/a.test.ts", name: "a", via: "static" as const, verifiedAgainst: hash("1") },
      { file: "src/other.test.ts", via: "explicit" as const },
    ];
    const root = await makeRepo([makeUnit(UID_A, { tests })]);
    await relinkTests({ paths: storePaths(root), actor: human }, UID_A, new Map([["src/a.test.ts", "lib/a.test.ts"]]));
    const unit = await readUnit(storePaths(root), UID_A);
    expect(unit.tests).toEqual([{ ...tests[0], file: "lib/a.test.ts" }, tests[1]]);
    expect(unit.versions).toEqual(makeUnit(UID_A).versions);
  });

  it("refuses a rename of a file the unit does not link, or of a removed unit", async () => {
    const removed = makeUnit(UID_B, { tests: [{ file: "src/b.test.ts", via: "static" }] });
    removed.versions.push({ contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: removed.versions[0]!.contentHash, change: "removed", actor: human, rationale: "Gone." });
    const root = await makeRepo([makeUnit(UID_A), removed]);
    const ctx = { paths: storePaths(root), actor: human };
    await expect(relinkTests(ctx, UID_A, new Map([["src/a.test.ts", "lib/a.test.ts"]]))).rejects.toThrow("it links no test in src/a.test.ts");
    await expect(relinkTests(ctx, UID_B, new Map([["src/b.test.ts", "lib/b.test.ts"]]))).rejects.toThrow("its latest version is removed");
  });
});

describe("reclassifyUnit", () => {
  const human = { kind: "human" } as const;

  it("changes only the kind and framework", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    await reclassifyUnit({ paths: storePaths(root), actor: human }, UID_A, { kind: "component", framework: "react" });
    const unit = await readUnit(storePaths(root), UID_A);
    expect([unit.kind, unit.framework]).toEqual(["component", "react"]);
    expect({ ...unit, kind: "function", framework: "none" }).toEqual(makeUnit(UID_A));
  });

  it("refuses to cross between types and values, or to touch a removed unit", async () => {
    const removed = makeUnit(UID_B);
    removed.versions.push({ contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: removed.versions[0]!.contentHash, change: "removed", actor: human, rationale: "Gone." });
    const root = await makeRepo([makeUnit(UID_A), removed]);
    const ctx = { paths: storePaths(root), actor: human };
    await expect(reclassifyUnit(ctx, UID_A, { kind: "type", framework: "none" })).rejects.toThrow("a function cannot become a type");
    await expect(reclassifyUnit(ctx, UID_B, { kind: "component", framework: "react" })).rejects.toThrow("its latest version is removed");
  });
});

describe("recordRationale", () => {
  const agent = { kind: "agent", tool: "claude-code", reviewed: false } as const;
  const gitIn = (root: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "ignore" });

  it("rewrites an uncommitted newest version's rationale, merges links, and drops inferred", async () => {
    const unit = makeUnit(UID_A);
    unit.versions[0] = { ...unit.versions[0]!, links: ["#1"], inferred: { by: "poetics-backfill", confidence: "low", sources: [], drafted: false, reviewed: false } };
    const root = await makeRepo([unit]);
    await recordRationale({ paths: storePaths(root), actor: agent }, UID_A, "  Rounds half up for invoices.  ", ["#1", { kind: "github-issue", ref: "#2" }]);
    const version = (await readUnit(storePaths(root), UID_A)).versions[0]!;
    expect(version.rationale).toBe("Rounds half up for invoices.");
    expect(version.links).toEqual(["#1", { kind: "github-issue", ref: "#2" }]);
    expect(version.inferred).toBeUndefined();
  });

  it("refuses a committed version, so history stays append-only, and an empty rationale", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    gitIn(root, "init", "-q", "-b", "main");
    gitIn(root, "add", "-A");
    gitIn(root, "commit", "-q", "-m", "Seed");
    const ctx = { paths: storePaths(root), actor: agent };
    await expect(recordRationale(ctx, UID_A, "Later reason.")).rejects.toThrow("its newest version (versions[0]) is committed");
    await expect(recordRationale(ctx, UID_A, "   ")).rejects.toThrow("the rationale is empty");

    // A version appended since the commit is still open.
    await appendVersion(ctx, UID_A, { contentHash: hash("2"), provisional: true, parent: hash("1"), change: "behaviour", actor: agent, rationale: "Run-wide." });
    await recordRationale(ctx, UID_A, "Only this unit's reason.");
    expect((await readUnit(storePaths(root), UID_A)).versions[1]!.rationale).toBe("Only this unit's reason.");
  });
});

describe("createNote and confirmNote", () => {
  const agent = { kind: "agent", tool: "claude-code", reviewed: false } as const;

  it("writes a new note as the writer, valid against the schema, refusing a second with the same id", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const ctx = { paths: storePaths(root), actor: agent, validator: createValidator(await loadSchemaSet(REPO_SCHEMAS)) };
    await createNote(ctx, makeNote({ anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } }));
    const written = JSON.parse(await readFile(join(root, ".poetics", "notes", `${NOTE_ID}.json`), "utf8")) as { actor: unknown };
    expect(written.actor).toEqual(agent);
    await expect(createNote(ctx, makeNote())).rejects.toThrow("a note with that id exists");
  });

  it("confirms a note against each anchored unit's latest hash, and refuses retired notes and removed units", async () => {
    const unit = makeUnit(UID_A);
    unit.versions.push({ contentHash: hash("2"), provisional: true, parent: hash("1"), change: "behaviour", actor: agent, rationale: "Changed." });
    const root = await makeRepo([unit, makeUnit(UID_B)]);
    const ctx = { paths: storePaths(root), actor: agent };
    await createNote(ctx, makeNote({ anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } }));
    expect((await confirmNote(ctx, NOTE_ID)).anchors.units).toEqual([{ uid: UID_A, observedAt: hash("2") }]);
    await expect(confirmNote(ctx, "01JB8N0000000000000000000Z")).rejects.toThrow("there is no such note");
  });
});

describe("setPrehistory", () => {
  const human = { kind: "human" } as const;
  const v = (hashChar: string, parent: Hash | null, change: Version["change"]): Version => ({
    contentHash: hash(hashChar, "b3"),
    parent,
    change,
    commit: "a".repeat(40),
    actor: human,
    rationale: "From git.",
    inferred: { by: "poetics-backfill", confidence: "medium", sources: ["commit"], drafted: false, reviewed: false },
  });

  it("writes prehistory once, and only accepts one that reaches further back", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const ctx = { paths: storePaths(root), actor: human };
    const recent = [v("7", null, "created")];
    await setPrehistory(ctx, UID_A, recent);
    expect((await readUnit(storePaths(root), UID_A)).prehistory).toEqual(recent);

    const rewritten = [{ ...v("7", null, "created"), rationale: "Rewritten." }];
    await expect(setPrehistory(ctx, UID_A, rewritten)).rejects.toThrow("may only be extended further back");
    // Reaching back gives the old first entry a predecessor: only its change and parent may differ.
    const extended = [v("5", null, "created"), v("7", hash("5", "b3"), "behaviour")];
    await setPrehistory(ctx, UID_A, extended);
    expect((await readUnit(storePaths(root), UID_A)).prehistory).toHaveLength(2);
    await expect(setPrehistory(ctx, UID_A, [])).rejects.toThrow("it is empty");
  });
});

describe("extendsPrehistory", () => {
  const v = (hashChar: string, parent: Hash | null, change: Version["change"], rationale = "From git."): Version => ({
    contentHash: hash(hashChar, "b3"),
    parent,
    change,
    actor: { kind: "human" },
    rationale,
  });

  it("accepts nothing recorded, the same, or the same reached further back", () => {
    const was = [v("7", null, "created"), v("8", hash("7", "b3"), "behaviour")];
    expect(extendsPrehistory([], was)).toBe(true);
    expect(extendsPrehistory(was, was)).toBe(true);
    expect(extendsPrehistory(was, [v("6", null, "created"), v("7", hash("6", "b3"), "cosmetic"), was[1]!])).toBe(true);
  });

  it("refuses a shorter one, an edit, or a first entry changed in more than its change and parent", () => {
    const was = [v("7", null, "created"), v("8", hash("7", "b3"), "behaviour")];
    expect(extendsPrehistory(was, was.slice(1))).toBe(false);
    expect(extendsPrehistory(was, [was[0]!, v("8", hash("7", "b3"), "behaviour", "Rewritten.")])).toBe(false);
    expect(extendsPrehistory(was, [v("6", null, "created"), v("7", hash("6", "b3"), "cosmetic", "Rewritten."), was[1]!])).toBe(false);
    expect(extendsPrehistory(was, [{ ...was[0]!, change: "behaviour" }, was[1]!])).toBe(false);
  });
});
