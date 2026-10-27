import { describe, expect, it } from "vitest";
import type { Note } from "@poetics/core";
import { filterUnits, inlineCode, isStaleFor, linkHref, linkLabel, matchNotes, notesForUnit, percent, sourceUrl } from "./query.ts";
import type { SiteUnit } from "./types.ts";

const h = (c: string) => `git:${c.repeat(40)}` as const;
const unit = (uid: string, name: string, extra: Partial<SiteUnit> = {}): SiteUnit => ({
  uid,
  kind: "function",
  framework: "none",
  name,
  area: "packages/core",
  location: { file: `packages/core/src/${name}.ts` },
  versions: [{ contentHash: h("1"), provisional: true, parent: null, change: "created", actor: { kind: "human" }, rationale: "Seed stub" }],
  ...extra,
});
const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id,
  kind: "gotcha",
  area: "tooling",
  title: "pnpm ci wipes node_modules",
  symptoms: ["Removing node_modules"],
  cause: "c",
  fix: "f",
  anchors: { commands: ["pnpm ci"] },
  status: "active",
  actor: { kind: "human" },
  ...extra,
});
const repo = { url: "https://github.com/o/r", commit: "abc" };
const U1 = "01JB8K0000000000000000000A";
const U2 = "01JB8K0000000000000000000B";

describe("filterUnits", () => {
  const units = [unit(U1, "mintUid", { docs: "Mints a ULID" }), unit(U2, "Note", { kind: "type", area: "scripts" })];

  it("matches every query word across name, file, docs and rationale", () => {
    expect(filterUnits(units, { query: "ulid mints", area: "", kind: "" }).map((u) => u.name)).toEqual(["mintUid"]);
    expect(filterUnits(units, { query: "seed", area: "", kind: "" })).toHaveLength(2);
  });

  it("filters by area and kind", () => {
    expect(filterUnits(units, { query: "", area: "scripts", kind: "" }).map((u) => u.name)).toEqual(["Note"]);
    expect(filterUnits(units, { query: "", area: "", kind: "function" }).map((u) => u.name)).toEqual(["mintUid"]);
  });
});

describe("matchNotes", () => {
  const notes = [
    note("01JB8N0000000000000000000A"),
    note("01JB8N0000000000000000000B", { title: "TypeScript pinned to 6", symptoms: [], anchors: { dependencies: [{ name: "typescript" }] } }),
    note("01JB8N0000000000000000000C", { status: "resolved", resolvedBy: "x" }),
  ];

  it("ranks verbatim symptoms above dependency mentions and skips retired notes", () => {
    const matches = matchNotes(notes, "$ pnpm ci\nRemoving node_modules\nupgrading typescript");
    expect(matches.map((m) => [m.note.id, m.score])).toEqual([
      ["01JB8N0000000000000000000A", 3],
      ["01JB8N0000000000000000000B", 2],
    ]);
    expect(matches[0]!.reason).toBe("symptom “Removing node_modules”");
  });

  it("matches a partial paste of a symptom, and nothing for empty text", () => {
    expect(matchNotes(notes, "removing node_mod")).toHaveLength(1);
    expect(matchNotes(notes, "   ")).toEqual([]);
  });

  it("drops title-word matches when a symptom or anchor matched", () => {
    const withTitleHit = [...notes, note("01JB8N0000000000000000000D", { title: "Node modules are big", symptoms: [], anchors: {} })];
    expect(matchNotes(withTitleHit, "Removing node_modules").map((m) => m.note.id)).toEqual(["01JB8N0000000000000000000A"]);
  });

  it("falls back to title words", () => {
    expect(matchNotes(notes, "why is it pinned?")[0]).toMatchObject({ score: 1, reason: "title mentions pinned" });
  });
});

describe("notes for a unit", () => {
  const u = unit(U1, "mintUid");
  const byUid = note("01JB8N0000000000000000000A", { anchors: { units: [{ uid: U1, observedAt: h("0") }] } });
  const byPath = note("01JB8N0000000000000000000B", { anchors: { paths: ["packages/core/src/mintUid.ts"] } });

  it("finds notes anchored by uid or path, and flags stale anchors", () => {
    expect(notesForUnit([byUid, byPath, note("01JB8N0000000000000000000C")], u).map((n) => n.id)).toEqual([byUid.id, byPath.id]);
    expect(isStaleFor(byUid, u)).toBe(true);
    expect(isStaleFor(byPath, u)).toBe(false);
  });
});

describe("links", () => {
  it("resolves references to GitHub", () => {
    expect(sourceUrl(repo, "a.ts", 3)).toBe("https://github.com/o/r/blob/abc/a.ts#L3");
    expect(linkHref({ kind: "plan", ref: "docs/plan.md#cli" }, repo)).toBe("https://github.com/o/r/blob/abc/docs/plan.md#cli");
    expect(linkHref({ kind: "github-pr", ref: "#2" }, repo)).toBe("https://github.com/o/r/issues/2");
    expect(linkHref({ kind: "commit", ref: "abc1234" }, repo)).toBe("https://github.com/o/r/commit/abc1234");
    expect(linkHref("https://x.dev", repo)).toBe("https://x.dev");
    expect(linkHref({ kind: "uchiage-task", ref: "T-1" }, repo)).toBeUndefined();
  });

  it("labels links briefly", () => {
    expect(linkLabel({ kind: "decision", ref: "docs/decisions/0002-x.md" })).toBe("ADR 0002");
    expect(linkLabel({ kind: "plan", ref: "docs/plan.md#cli" })).toBe("plan §cli");
    expect(linkLabel("https://x.dev/a")).toBe("x.dev/a");
  });

  it("formats percentages without rounding up", () => {
    expect(percent(0.6666)).toBe("66.6%");
    expect(percent(1)).toBe("100%");
  });
});

describe("inlineCode", () => {
  it("splits backtick pairs into code segments", () => {
    expect(inlineCode("Run `pnpm preflight` not `pnpm ci`.")).toEqual([
      { text: "Run ", code: false },
      { text: "pnpm preflight", code: true },
      { text: " not ", code: false },
      { text: "pnpm ci", code: true },
      { text: ".", code: false },
    ]);
  });

  it("leaves plain text and unpaired backticks alone", () => {
    expect(inlineCode("plain")).toEqual([{ text: "plain", code: false }]);
    expect(inlineCode("a ` b")).toEqual([{ text: "a ` b", code: false }]);
    expect(inlineCode("")).toEqual([]);
  });
});
