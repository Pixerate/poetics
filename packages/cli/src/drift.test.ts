import { describe, expect, it } from "vitest";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Hash, Unit } from "@poetics/core";
import type { Declaration } from "./declarations.ts";
import { compareCodeWithStore } from "./drift.ts";

const h = (c: string): Hash => `git:${c.repeat(40)}`;

const b3 = (c: string): Hash => `b3:${c.repeat(64)}`;

const decl = (name: string, hash = h("1"), file = "src/a.ts", contentHash = b3("1")): Declaration => ({
  file,
  name,
  kind: "function",
  hash,
  contentHash,
  startLine: 1,
  endLine: 3,
});

const unit = (uid: string, name: string, hash = h("1"), file = "src/a.ts", extra: Partial<Unit> = {}): Unit => ({
  uid,
  kind: "function",
  framework: "none",
  name,
  location: { file },
  versions: [
    { contentHash: hash, provisional: true, parent: null, change: "created", actor: { kind: "human" }, rationale: "r" },
  ],
  ...extra,
});

const removed = (u: Unit): Unit => ({
  ...u,
  versions: [
    ...u.versions,
    { contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: u.versions.at(-1)!.contentHash, change: "removed", actor: { kind: "human" }, rationale: "gone" },
  ],
});

const U1 = "01JB8K0000000000000000000A";
const U2 = "01JB8K0000000000000000000B";
const all = () => true;

describe("compareCodeWithStore", () => {
  it("counts fresh tracked declarations", () => {
    expect(compareCodeWithStore([decl("a")], [unit(U1, "a")], all)).toEqual({
      findings: [],
      tracked: 1,
      fresh: 1,
      declarations: 1,
    });
  });

  it("reports untracked, stale and orphaned", () => {
    const drift = compareCodeWithStore(
      [decl("a", h("2"), "src/a.ts", b3("2")), decl("b")],
      [unit(U1, "a"), unit(U2, "gone")],
      all,
    );
    expect(drift.findings.map((f) => [f.kind, f.name])).toEqual([
      ["stale", "a"],
      ["untracked", "b"],
      ["orphaned", "gone"],
    ]);
    expect(drift).toMatchObject({ tracked: 1, fresh: 0, declarations: 2 });
    // New versions take the indexer's hash, whatever family the unit's history used.
    expect(drift.findings[0]!.message).toContain(b3("2"));
  });

  it("tells orphans to record lineage or a removed version", () => {
    const [finding] = compareCodeWithStore([], [unit(U1, "gone")], all).findings;
    expect(finding!.message).toContain('append a "removed" version');
  });

  it("never orphans or matches removed units, so a returning name is untracked", () => {
    expect(compareCodeWithStore([], [removed(unit(U1, "gone"))], all).findings).toEqual([]);
    const drift = compareCodeWithStore([decl("gone")], [removed(unit(U1, "gone"))], all);
    expect(drift.findings.map((f) => f.kind)).toEqual(["untracked"]);
    expect(drift.tracked).toBe(0);
  });

  it("only orphans units in files it covers", () => {
    const drift = compareCodeWithStore([], [unit(U1, "PriceTag", h("1"), "src/PriceTag.svelte")], (f) => f.endsWith(".ts"));
    expect(drift.findings).toEqual([]);
  });

  it("matches default exports by location.export and skips owned units", () => {
    const drift = compareCodeWithStore(
      [decl("default")],
      [unit(U1, "Page", h("1"), "src/a.ts", { location: { file: "src/a.ts", export: "default" } }), unit(U2, "inner", h("1"), "src/a.ts", { owner: U1 })],
      all,
    );
    expect(drift.findings).toEqual([]);
    expect(drift.fresh).toBe(1);
  });

  it("reports duplicate units", () => {
    const drift = compareCodeWithStore([decl("a")], [unit(U1, "a"), unit(U2, "a")], all);
    expect(drift.findings.map((f) => f.kind)).toEqual(["duplicate"]);
  });

  it("compares a b3: latest hash with the code's content hash, and a git: one with its text hash", () => {
    const rehashed = (u: Unit, hash: Hash): Unit => ({
      ...u,
      versions: [...u.versions, { contentHash: hash, parent: u.versions[0]!.contentHash, change: "rehash", actor: { kind: "human" }, rationale: "Rehashed." }],
    });
    const fresh = compareCodeWithStore([decl("a"), decl("b")], [rehashed(unit(U1, "a"), b3("1")), unit(U2, "b")], all);
    expect([fresh.findings, fresh.fresh]).toEqual([[], 2]);

    const stale = compareCodeWithStore([decl("a", h("1"), "src/a.ts", b3("2"))], [rehashed(unit(U1, "a"), b3("1"))], all);
    expect(stale.findings).toMatchObject([{ kind: "stale", message: expect.stringContaining(`append one with contentHash ${b3("2")}`) }]);
  });
});
