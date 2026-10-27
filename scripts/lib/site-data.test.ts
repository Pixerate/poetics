import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import type { SiteCoverage } from "../../site/src/lib/types.ts";
import { buildSiteData, parseDecision } from "./site-data.ts";

const unit = (uid: string, name: string, file: string): Unit => ({
  uid,
  kind: "function",
  framework: "none",
  name,
  location: { file },
  versions: [
    { contentHash: `git:${"1".repeat(40)}`, provisional: true, parent: null, change: "created", actor: { kind: "human" }, rationale: "r" },
  ],
});

describe("buildSiteData", () => {
  const data = buildSiteData({
    repoUrl: "https://github.com/o/r",
    commit: "abc",
    generatedAt: "2026-10-27T00:00:00.000Z",
    thresholds: { tracked: 1 },
    coverage: {} as SiteCoverage,
    units: [unit("01JB8K0000000000000000000B", "b", "scripts/s.ts"), unit("01JB8K0000000000000000000A", "a", "packages/core/src/a.ts")],
    notes: [],
    declarations: [{ file: "packages/core/src/a.ts", name: "a", kind: "function", hash: `git:${"1".repeat(40)}`, startLine: 2, endLine: 3 }],
    sources: new Map([["packages/core/src/a.ts", "// x\nexport function a() {\n}\n"]]),
    decisions: [
      { id: "0002", title: "B", status: "Accepted", path: "b.md" },
      { id: "0001", title: "A", status: "Accepted", path: "a.md" },
    ],
  });

  it("sorts units by file and attaches area and current source", () => {
    expect(data.units.map((u) => [u.name, u.area])).toEqual([
      ["a", "packages/core"],
      ["b", "scripts"],
    ]);
    expect(data.units[0]).toMatchObject({ source: "export function a() {\n}", startLine: 2 });
    expect(data.units[1]!.source).toBeUndefined();
  });

  it("carries repo, thresholds and sorted decisions", () => {
    expect(data.repo).toEqual({ url: "https://github.com/o/r", commit: "abc" });
    expect(data.thresholds).toEqual({ tracked: 1 });
    expect(data.decisions.map((d) => d.id)).toEqual(["0001", "0002"]);
  });
});

describe("parseDecision", () => {
  it("reads the number, title and status", () => {
    expect(parseDecision("docs/decisions/0002-x.md", "# 0002. JSON in git\n\n- Status: Accepted\n")).toEqual({
      id: "0002",
      title: "JSON in git",
      status: "Accepted",
      path: "docs/decisions/0002-x.md",
    });
  });

  it("skips files that are not decision records", () => {
    expect(parseDecision("docs/decisions/template.md", "# NNNN. Title\n")).toBeUndefined();
  });
});
