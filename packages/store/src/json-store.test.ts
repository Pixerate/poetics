import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotImplementedError, REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Version } from "@poetics/core";
import { appendVersion, declareLineage, linkTest, listUnitFiles, parseUnit, readUnitFiles, recordRationale, setDocs } from "./json-store.ts";
import { storePaths } from "./paths.ts";
import { createValidator, loadSchemaSet } from "./schemas.ts";
import { REPO_SCHEMAS, UID_A, UID_B, hash, makeRepo, makeUnit, writeUnit } from "./test-helpers.ts";

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
    expect(() => recordRationale(ctx, UID_A, "why")).toThrow(NotImplementedError);
    expect(() => declareLineage(ctx, UID_A, { kind: "rename" })).toThrow(NotImplementedError);
    expect(() => linkTest(ctx, UID_A, { file: "a.test.ts", via: "explicit" })).toThrow(NotImplementedError);
    expect(() => setDocs(ctx, UID_A, "docs", hash("1"))).toThrow(NotImplementedError);
  });
});
