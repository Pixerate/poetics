import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@poetics/core";
import {
  INDEX_SCHEMA_VERSION,
  dependentsOf,
  dumpIndex,
  findUnitsByName,
  getUnit,
  openIndex,
  rebuildIndex,
  searchUnits,
} from "./index-db.ts";
import { storePaths } from "./paths.ts";
import { UID_A, UID_B, UID_C, hash, makeRepo, makeUnit, writeUnit } from "./test-helpers.ts";

const withDep = (uid: string, dep: string) => {
  const unit = makeUnit(uid);
  unit.versions[0]!.deps = { [dep]: hash("1") };
  return unit;
};

describe("rebuildIndex", () => {
  it("indexes units, versions, deps, tests and lineage", async () => {
    const unit = makeUnit(UID_A, {
      name: "formatPrice",
      tests: [{ file: "src/lib.ts", via: "explicit" }],
      lineage: [{ kind: "rename", from: "fmtPrice" }],
    });
    const paths = storePaths(await makeRepo([unit, withDep(UID_B, UID_A)]));
    const db = openIndex(paths.indexDb);

    expect(await rebuildIndex(paths, db)).toEqual({ added: 2, updated: 0, removed: 0, unchanged: 0 });
    expect(getUnit(db, UID_A)).toMatchObject({ name: "formatPrice", version_count: 1, latest_content_hash: hash("1") });
    expect(findUnitsByName(db, "formatPrice").map((row) => row.uid)).toEqual([UID_A]);
    expect(dependentsOf(db, UID_A)).toEqual([UID_B]);
    const dump = dumpIndex(db);
    expect(dump["test_links"]).toEqual([{ uid: UID_A, file: "src/lib.ts", name: "", via: "explicit" }]);
    expect(dump["lineage"]).toEqual([{ uid: UID_A, seq: 0, kind: "rename", from_path: "fmtPrice" }]);
  });

  it("skips unit files whose bytes have not changed", async () => {
    const paths = storePaths(await makeRepo([makeUnit(UID_A), makeUnit(UID_B)]));
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    expect(await rebuildIndex(paths, db)).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 2 });
  });

  it("matches a from-scratch rebuild after edits, additions, deletions and moves", async () => {
    const root = await makeRepo([makeUnit(UID_A), makeUnit(UID_B)]);
    const paths = storePaths(root);
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);

    const edited = makeUnit(UID_A, { name: "renamed" });
    edited.versions.push({ ...edited.versions[0]!, contentHash: hash("2"), parent: hash("1"), change: "behaviour" });
    await writeUnit(root, edited);
    await rm(join(root, ".poetics", "units", `${UID_B}.json`));
    await writeUnit(root, withDep(UID_C, UID_A), join(".poetics", "units", "01", `${UID_C}.json`));
    expect(await rebuildIndex(paths, db)).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 0 });

    // Move C between layouts without changing its contents.
    await rm(join(root, ".poetics", "units", "01", `${UID_C}.json`));
    await writeUnit(root, withDep(UID_C, UID_A));
    expect(await rebuildIndex(paths, db)).toEqual({ added: 1, updated: 0, removed: 1, unchanged: 1 });
    const incremental = dumpIndex(db);
    db.close();

    await rm(paths.cache, { recursive: true });
    const fresh = openIndex(paths.indexDb);
    await rebuildIndex(paths, fresh);
    expect(dumpIndex(fresh)).toEqual(incremental);
    expect(getUnit(fresh, UID_A)).toMatchObject({ name: "renamed", version_count: 2 });
    expect(dependentsOf(fresh, UID_A)).toEqual([UID_C]);
  });

  it("rolls back and leaves the index untouched when a unit file is unreadable", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const paths = storePaths(root);
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    const before = dumpIndex(db);

    await writeUnit(root, makeUnit(UID_B));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, ".poetics", "units", `${UID_C}.json`), "{ broken");
    await expect(rebuildIndex(paths, db)).rejects.toThrow(SyntaxError);
    expect(dumpIndex(db)).toEqual(before);
  });
});

describe("openIndex", () => {
  it("drops and recreates tables written by another index schema version", async () => {
    const paths = storePaths(await makeRepo([makeUnit(UID_A)]));
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'schema_version'").run();
    db.close();

    const reopened = openIndex(paths.indexDb);
    expect(getUnit(reopened, UID_A)).toBeUndefined();
    expect(reopened.prepare("SELECT value FROM meta").get()).toEqual({ value: String(INDEX_SCHEMA_VERSION) });
  });
});

describe("searchUnits", () => {
  it("is a stub until FTS lands", () => {
    expect(() => searchUnits(openIndex(":memory:"), "price")).toThrow(NotImplementedError);
  });
});
