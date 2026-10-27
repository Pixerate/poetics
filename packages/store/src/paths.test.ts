import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths, unitFilePath } from "./paths.ts";

describe("storePaths", () => {
  it("puts the index in the gitignored cache folder", () => {
    const paths = storePaths("/repo");
    expect(paths.units).toBe(join("/repo", ".poetics", "units"));
    expect(paths.indexDb).toBe(join("/repo", ".poetics", "cache", "index.db"));
  });
});

describe("unitFilePath", () => {
  const paths = storePaths("/repo");
  const uid = "01JB8K0000000000000000000A";

  it("is flat by default", () => {
    expect(unitFilePath(paths, uid)).toBe(join(paths.units, `${uid}.json`));
  });

  it("shards by the first two uid characters", () => {
    expect(unitFilePath(paths, uid, "sharded")).toBe(join(paths.units, "01", `${uid}.json`));
  });
});
