import { describe, expect, it } from "vitest";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Note, Unit } from "@poetics/core";
import type { Declaration } from "./declarations.ts";
import { areaOf, computeCoverage, formatCoverage } from "./coverage.ts";

const h = (c: string) => `git:${c.repeat(40)}` as const;
const decl = (file: string, name: string, hash = h("1")): Declaration => ({ file, name, kind: "function", hash, startLine: 1, endLine: 1 });
const unit = (uid: string, file: string, name: string, extra: Partial<Unit> = {}, reviewed = false): Unit => ({
  uid,
  kind: "function",
  framework: "none",
  name,
  location: { file },
  versions: [
    {
      contentHash: h("1"),
      provisional: true,
      parent: null,
      change: "created",
      actor: { kind: "agent", tool: "claude-code", reviewed },
      rationale: "r",
      links: [{ kind: "plan", ref: "docs/plan.md" }],
    },
  ],
  ...extra,
});
const note = (status: Note["status"], check?: Note["check"]): Note => ({
  id: "01JB8N0000000000000000000N",
  kind: "gotcha",
  area: "tooling",
  title: "t",
  symptoms: [],
  cause: "c",
  fix: "f",
  anchors: {},
  status,
  actor: { kind: "human" },
  ...(check ? { check } : {}),
  ...(status === "resolved" ? { resolvedBy: { kind: "commit", ref: "abc1234" } } : {}),
});

const A = "packages/core/src/a.ts";
const S = "scripts/s.ts";

describe("areaOf", () => {
  it("groups packages by name and everything else by top folder", () => {
    expect(areaOf("packages/core/src/a.ts")).toBe("packages/core");
    expect(areaOf("scripts/lib/x.ts")).toBe("scripts");
  });
});

describe("computeCoverage", () => {
  const declarations = [decl(A, "a"), decl(A, "b", h("2")), decl(S, "s")];
  const units = [
    unit("01JB8K0000000000000000000A", A, "a", { docs: "Does a.", tests: [{ file: "a.test.ts", via: "static" }] }, true),
    unit("01JB8K0000000000000000000B", A, "b"),
    unit("01JB8K0000000000000000000C", "src/Thing.svelte", "Thing"),
  ];
  const report = computeCoverage(declarations, units, [note("active", { kind: "test", ref: "x" }), note("active"), note("resolved")], new Set([A, S]), ["src/Thing.svelte"], {
    tracked: 0.9,
    fresh: 0.5,
  });

  it("computes overall ratios over scanned files only", () => {
    expect(report.overall.tracked).toEqual({ covered: 2, total: 3, ratio: 2 / 3 });
    expect(report.overall.fresh).toEqual({ covered: 1, total: 2, ratio: 0.5 });
    expect(report.overall.tested).toEqual({ covered: 1, total: 2, ratio: 0.5 });
    expect(report.overall.documented.covered).toBe(1);
    expect(report.overall.reviewed).toEqual({ covered: 1, total: 2, ratio: 0.5 });
    expect(report.overall.linkedRationale.ratio).toBe(1);
  });

  it("breaks coverage down by area, with empty areas counting as fully covered", () => {
    expect(Object.keys(report.byArea)).toEqual(["packages/core", "scripts"]);
    expect(report.byArea["scripts"]!.tracked).toEqual({ covered: 0, total: 1, ratio: 0 });
    expect(report.byArea["scripts"]!.tested).toEqual({ covered: 0, total: 0, ratio: 1 });
  });

  it("leaves removed units out of every metric", () => {
    const gone = unit("01JB8K0000000000000000000D", A, "gone");
    gone.versions.push({ ...gone.versions[0]!, contentHash: REMOVED_CONTENT_HASH, parent: h("1"), change: "removed" });
    const withRemoved = computeCoverage(declarations, [...units, gone], [], new Set([A, S]), [], {});
    const without = computeCoverage(declarations, units, [], new Set([A, S]), [], {});
    expect(withRemoved.overall).toEqual(without.overall);
  });

  it("summarises notes and fails only the thresholds that are missed", () => {
    expect(report.notes).toEqual({ active: 2, withCheck: 1, retired: 1 });
    expect(report.failures).toEqual([{ metric: "tracked", ratio: 2 / 3, threshold: 0.9 }]);
  });

  it("formats a table with a dash for empty metrics", () => {
    const text = formatCoverage(report);
    expect(text).toContain("Exports with a unit");
    expect(text).toContain("66.6%");
    expect(text).toContain("—");
    expect(text).toContain("Below threshold: tracked 66.7% < 90.0%");
    expect(text).toContain("Not yet indexable: 1 file(s)");
  });
});
