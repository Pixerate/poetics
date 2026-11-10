import { describe, expect, it } from "vitest";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import type { IssueTracker, TrackedIssue, Unit, Version } from "@poetics/core";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import type { CodeView } from "./code.ts";
import { linkedNumber, linkedSignals, parseIssueRef, relatedIssues, unitSignals, unitsForIssue } from "./issues.ts";

const hash = (char: string) => `git:${char.repeat(40)}` as const;
const UID = { price: "01JB8K0000000000000000000A", round: "01JB8K0000000000000000000B", cart: "01JB8K0000000000000000000C", gone: "01JB8K0000000000000000000D" };

function version(char: string, overrides: Partial<Version> = {}): Version {
  return { contentHash: hash(char), parent: null, change: "created", actor: { kind: "human" }, rationale: "Why.", ...overrides };
}

function unit(uid: string, name: string, file: string, versions: Version[], extra: Partial<Unit> = {}): Unit {
  return { uid, kind: "function", framework: "none", name, location: { file }, versions, ...extra };
}

function tracker(issues: Record<number, Partial<TrackedIssue>>, comments: Record<number, Array<{ path: string; startLine: number; endLine: number; body: string }>> = {}): IssueTracker & { asked: number[] } {
  const asked: number[] = [];
  return {
    name: "github",
    asked,
    pullRequestsFor: async () => [],
    reviewComments: async (number) => comments[number] ?? [],
    issue: async (number) => {
      asked.push(number);
      const issue = issues[number];
      return issue ? { number, url: `https://github.com/acme/shop/issues/${number}`, title: `#${number}`, body: "", state: "open", labels: [], pullRequest: false, ...issue } : undefined;
    },
  };
}

describe("parseIssueRef", () => {
  it("reads #12, 12, owner/name#12 and issue or pull request URLs", () => {
    expect(parseIssueRef("#12")).toBe(12);
    expect(parseIssueRef(" 12 ")).toBe(12);
    expect(parseIssueRef("acme/shop#12", "acme/shop")).toBe(12);
    expect(parseIssueRef("https://github.com/Acme/Shop/pull/12", "acme/shop")).toBe(12);
    expect(parseIssueRef("https://github.com/acme/shop/issues/12#issuecomment-1")).toBe(12);
  });

  it("refuses another repository's issue and text that is no reference", () => {
    expect(() => parseIssueRef("other/repo#12", "acme/shop")).toThrow("is in other/repo, not this repository (acme/shop)");
    expect(() => parseIssueRef("the login bug")).toThrow("Not an issue reference");
  });
});

describe("linkedNumber", () => {
  it("reads this repository's issue and pull request links, and nothing else", () => {
    expect(linkedNumber({ kind: "github-issue", ref: "#3" })).toEqual({ kind: "issue", number: 3 });
    expect(linkedNumber({ kind: "github-pr", ref: "#12", url: "https://github.com/acme/shop/pull/12" })).toEqual({ kind: "pull-request", number: 12 });
    expect(linkedNumber({ kind: "github-pull-request", ref: "#45" })).toEqual({ kind: "pull-request", number: 45 });
    expect(linkedNumber({ kind: "github-issue", ref: "other/repo#3" })).toBeUndefined();
    expect(linkedNumber({ kind: "decision", ref: "docs/decisions/0001.md" })).toBeUndefined();
    expect(linkedNumber("https://example.com")).toBeUndefined();
  });
});

describe("linkedSignals", () => {
  it("lists each issue once, newest version first, with prehistory marked", () => {
    const u = unit(UID.price, "formatPrice", "src/price.ts", [
      version("1", { links: [{ kind: "github-issue", ref: "#3" }], commit: "aaa" }),
      version("2", { change: "behaviour", links: [{ kind: "github-pr", ref: "#12" }, { kind: "github-issue", ref: "#3" }, { kind: "github-issue", ref: "#3" }] }),
    ], { prehistory: [version("0", { links: [{ kind: "github-issue", ref: "#1" }] })] });
    expect(linkedSignals(u)).toEqual([
      { ref: "#12", kind: "pull-request", versions: [{ contentHash: hash("2"), change: "behaviour" }] },
      { ref: "#3", kind: "issue", versions: [{ contentHash: hash("2"), change: "behaviour" }, { contentHash: hash("1"), change: "created", commit: "aaa" }] },
      { ref: "#1", kind: "issue", versions: [{ contentHash: hash("0"), change: "created", prehistory: true }] },
    ]);
  });
});

describe("unitSignals", () => {
  const u = unit(UID.price, "formatPrice", "src/price.ts", [version("1", { links: [{ kind: "github-issue", ref: "#3" }, { kind: "github-issue", ref: "#12" }] })]);

  it("adds titles and states, settles a pull request linked as an issue, and keeps review comments on the unit's file", async () => {
    const t = tracker({ 3: { title: "Prices round down", state: "closed", labels: ["bug"] }, 12: { title: "Round half up", pullRequest: true } }, {
      12: [
        { path: "src/price.ts", startLine: 4, endLine: 5, body: "Use Math.round here." },
        { path: "src/other.ts", startLine: 1, endLine: 1, body: "Unrelated." },
      ],
    });
    const report = await unitSignals(u, { tracker: t });
    expect(report.linked.map((s) => [s.ref, s.kind, s.title, s.state])).toEqual([
      ["#3", "issue", "Prices round down", "closed"],
      ["#12", "pull-request", "Round half up", "open"],
    ]);
    expect(report.reviewComments).toEqual([{ pullRequest: "#12", path: "src/price.ts", startLine: 4, endLine: 5, body: "Use Math.round here." }]);
    expect(report.errors).toEqual([]);
    expect(report.missing).toEqual(["production errors: no error-monitoring integration yet"]);
  });

  it("keeps the references and says why when there is no tracker or it fails", async () => {
    const none = await unitSignals(u, { unavailable: "no GitHub token" });
    expect(none.linked.map((s) => s.ref)).toEqual(["#3", "#12"]);
    expect(none.missing[0]).toBe("titles, states and review comments: no GitHub token");
    const failing = { ...tracker({}), issue: async () => Promise.reject(new Error("GitHub rate limit reached")) };
    expect((await unitSignals(u, { tracker: failing })).missing[0]).toBe("some titles and review comments: GitHub rate limit reached");
  });

  it("clips long review comments and caps how many it returns", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ path: "src/price.ts", startLine: i + 1, endLine: i + 1, body: "x".repeat(2000) }));
    const report = await unitSignals(u, { tracker: tracker({ 12: { pullRequest: true } }, { 12: many }) });
    expect(report.reviewComments).toHaveLength(20);
    expect(report.reviewComments[0]!.body).toHaveLength(1000);
    expect(report.missing).toContain("5 more review comments");
  });
});

describe("unitsForIssue", () => {
  const units = [
    unit(UID.price, "formatPrice", "src/price.ts", [version("1", { links: [{ kind: "github-issue", ref: "#7" }] })]),
    unit(UID.round, "round", "src/round.ts", [version("2")]),
    unit(UID.cart, "Cart", "src/cart.tsx", [version("3")]),
    unit(UID.gone, "oldPrice", "src/price.ts", [version("4"), version("5", { contentHash: REMOVED_CONTENT_HASH, change: "removed", links: [{ kind: "github-issue", ref: "#7" }] })]),
  ];

  it("ranks units the issue is linked from above names, paths and search, and skips removed units", () => {
    const issue = { number: 7, title: "Cart totals", body: "The `Cart` shows formatPrice output wrong; see src/round.ts. We round too early." };
    const matches = unitsForIssue(issue, units, { search: () => [UID.cart, UID.gone] });
    expect(matches.map((m) => [m.uid, m.why, m.score])).toEqual([
      [UID.price, ["linked", "name"], 11],
      [UID.cart, ["name", "search"], 4],
      [UID.round, ["path"], 2],
    ]);
  });

  it("places stack frames inside a unit's lines when it has the code", () => {
    const code = { name: "round", span: { file: "src/round.ts", start: 0, end: 10 } } as unknown as IndexedUnit;
    const view = { byUid: new Map([[UID.round, code]]), linesOf: () => ({ startLine: 10, endLine: 20 }) } as unknown as CodeView;
    const at = (line: number) => unitsForIssue({ number: 9, title: "Crash", body: `TypeError\n    at round (webpack:///./src/round.ts:${line}:5)` }, units, { view });
    expect(at(12).map((m) => [m.uid, m.why])).toEqual([[UID.round, ["stack", "path"]]]);
    expect(at(30).map((m) => [m.uid, m.why])).toEqual([[UID.round, ["path"]]]);
  });

  it("matches only links when the issue's text cannot be read", () => {
    expect(unitsForIssue({ number: 7 }, units).map((m) => m.uid)).toEqual([UID.price]);
    expect(unitsForIssue({ number: 8 }, units)).toEqual([]);
  });
});

describe("relatedIssues", () => {
  it("lists other issues linked from the units, newest number first, with the units that link them", () => {
    const a = unit(UID.price, "formatPrice", "src/price.ts", [version("1", { links: [{ kind: "github-issue", ref: "#3" }, { kind: "github-issue", ref: "#7" }, { kind: "github-pr", ref: "#9" }] })]);
    const b = unit(UID.round, "round", "src/round.ts", [version("2", { links: [{ kind: "github-issue", ref: "#3" }, { kind: "github-issue", ref: "#5" }] })]);
    expect(relatedIssues([a, b], 7)).toEqual([
      { ref: "#5", units: ["round"] },
      { ref: "#3", units: ["formatPrice", "round"] },
    ]);
  });
});
