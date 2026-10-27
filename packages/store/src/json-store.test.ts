import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@poetics/core";
import { appendVersion, declareLineage, linkTest, listUnitFiles, parseUnit, readUnitFiles, recordRationale, setDocs } from "./json-store.ts";
import { storePaths } from "./paths.ts";
import { UID_A, UID_B, hash, makeRepo, makeUnit, writeUnit } from "./test-helpers.ts";

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

describe("validated writes", () => {
  it("are stubs until phase 2", () => {
    const ctx = { paths: storePaths("/repo"), actor: { kind: "human" } as const };
    const version = makeUnit(UID_A).versions[0]!;
    expect(() => appendVersion(ctx, UID_A, version)).toThrow(NotImplementedError);
    expect(() => recordRationale(ctx, UID_A, "why")).toThrow(NotImplementedError);
    expect(() => declareLineage(ctx, UID_A, { kind: "rename" })).toThrow(NotImplementedError);
    expect(() => linkTest(ctx, UID_A, { file: "a.test.ts", via: "explicit" })).toThrow(NotImplementedError);
    expect(() => setDocs(ctx, UID_A, "docs", hash("1"))).toThrow(NotImplementedError);
  });
});
