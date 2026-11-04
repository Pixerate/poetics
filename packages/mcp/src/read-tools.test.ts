import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotImplementedError, REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Note, Unit } from "@poetics/core";
import { openIndex, rebuildIndex, storePaths } from "@poetics/store";
import { callReadTool, contextPack, matchNotes } from "./read-tools.ts";
import type { ReadContext } from "./read-tools.ts";

const UID_A = "01JB8K0000000000000000000A";
const UID_B = "01JB8K0000000000000000000B";
const UID_C = "01JB8K0000000000000000000C";
const UID_D = "01JB8K0000000000000000000D";
const hash = (char: string) => `git:${char.repeat(40)}` as const;

function unit(uid: string, name: string, overrides: Partial<Unit> = {}): Unit {
  return {
    uid,
    kind: "function",
    framework: "none",
    name,
    location: { file: "src/lib.ts" },
    versions: [
      { contentHash: hash("1"), provisional: true, parent: null, change: "created", actor: { kind: "human" }, rationale: `Seed ${name}` },
    ],
    ...overrides,
  };
}

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    kind: "gotcha",
    area: "tooling",
    title: `Note ${id.slice(-1)}`,
    symptoms: ["Error: boom"],
    cause: "Because.",
    fix: "Do the other thing.",
    anchors: {},
    status: "active",
    actor: { kind: "human" },
    ...overrides,
  };
}

/** formatPrice (A) depends on roundHalf (B); two units named render (C, D) live in different files. */
async function repo(notes: Note[] = []): Promise<ReadContext> {
  const root = await mkdtemp(join(tmpdir(), "poetics-mcp-"));
  const price = unit(UID_A, "formatPrice", {
    docs: "Formats a price in the user's currency.",
    tests: [
      { file: "src/lib.test.ts", via: "static", verifiedAgainst: hash("2") },
      { file: "src/other.test.ts", via: "explicit", verifiedAgainst: hash("1") },
    ],
  });
  price.versions.push({
    contentHash: hash("2"),
    provisional: true,
    parent: hash("1"),
    change: "behaviour",
    actor: { kind: "human" },
    rationale: "Rounds half up",
    deps: { [UID_B]: hash("1") },
  });
  const units = [
    price,
    unit(UID_B, "roundHalf", { docs: "Rounds half up." }),
    unit(UID_C, "render", { location: { file: "src/a.ts" } }),
    unit(UID_D, "render", { location: { file: "src/b.ts" } }),
  ];
  for (const [dir, items] of [
    ["units", units.map((u) => [u.uid, u] as const)],
    ["notes", notes.map((n) => [n.id, n] as const)],
  ] as const) {
    await mkdir(join(root, ".poetics", dir), { recursive: true });
    for (const [id, item] of items) await writeFile(join(root, ".poetics", dir, `${id}.json`), JSON.stringify(item));
  }
  const paths = storePaths(root);
  const db = openIndex(":memory:");
  await rebuildIndex(paths, db);
  return { paths, db };
}

describe("matchNotes", () => {
  const N1 = "01JB8N0000000000000000000A";
  const N2 = "01JB8N0000000000000000000B";
  const N3 = "01JB8N0000000000000000000C";
  const notes = [
    note(N1, { symptoms: ["Cannot find module  'X'"], anchors: { paths: ["scripts"], commands: ["pnpm validate"] } }),
    note(N2, { anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } }),
    note(N3, { status: "resolved", anchors: { paths: ["scripts/lib"] } }),
  ];
  const ids = (matches: ReturnType<typeof matchNotes>) => matches.map((match) => match.note.id);

  it("matches error text either way round, ignoring case and spacing", () => {
    expect(ids(matchNotes(notes, { error: "node: cannot find module 'x' at line 3" }, new Map()))).toEqual([N1]);
    expect(ids(matchNotes(notes, { error: "boom" }, new Map()))).toEqual([N2]);
  });

  it("matches paths inside or containing an anchor, and skips retired notes unless asked", () => {
    expect(ids(matchNotes(notes, { path: "scripts/lib/glob.ts" }, new Map()))).toEqual([N1]);
    expect(ids(matchNotes(notes, { path: "scripts/lib/glob.ts", includeRetired: true }, new Map()))).toEqual([N1, N3]);
    expect(ids(matchNotes(notes, { path: "scriptsx" }, new Map()))).toEqual([]);
  });

  it("ranks by criteria matched and flags notes observed at an older version", () => {
    const matches = matchNotes(notes, { unit: UID_A, command: "pnpm validate", path: "scripts" }, new Map([[UID_A, hash("2")]]));
    expect(matches.map((match) => [match.note.id, match.matched])).toEqual([
      [N1, ["path", "command"]],
      [N2, ["unit"]],
    ]);
    expect(matches[1]!.needsRecheck).toEqual([UID_A]);
    expect(matches[0]!.needsRecheck).toEqual([]);
  });
});

describe("callReadTool", () => {
  it("poetics_search returns hits, capped by limit", async () => {
    const ctx = await repo();
    // roundHalf matches by name; formatPrice only by its rationale, so it ranks lower.
    expect(await callReadTool(ctx, "poetics_search", { query: "round" })).toEqual({
      units: [
        { uid: UID_B, name: "roundHalf", kind: "function", framework: "none", file: "src/lib.ts", versionCount: 1 },
        { uid: UID_A, name: "formatPrice", kind: "function", framework: "none", file: "src/lib.ts", versionCount: 2 },
      ],
    });
    const many = (await callReadTool(ctx, "poetics_search", { query: "rounds", limit: 1 })) as { units: unknown[] };
    expect(many.units).toHaveLength(1);
    await expect(callReadTool(ctx, "poetics_search", { query: 3 })).rejects.toThrow("query must be a non-empty string");
    await expect(callReadTool(ctx, "poetics_search", { query: "x", limit: 0 })).rejects.toThrow("limit must be a positive integer");
  });

  it("resolves unit references by uid, name or file#name, refusing ambiguous ones", async () => {
    const ctx = await repo();
    expect(await callReadTool(ctx, "poetics_unit", { unit: "src/b.ts#render" })).toMatchObject({ uid: UID_D });
    await expect(callReadTool(ctx, "poetics_history", { unit: "render" })).rejects.toThrow(/render is ambiguous/);
  });

  it("poetics_unit returns current state, dependencies and callers", async () => {
    const ctx = await repo();
    const result = (await callReadTool(ctx, "poetics_unit", { unit: "formatPrice" })) as Record<string, unknown>;
    expect(result).toMatchObject({ uid: UID_A, removed: false, versionCount: 2, latest: { contentHash: hash("2") } });
    expect(result["dependencies"]).toEqual([{ uid: UID_B, name: "roundHalf", kind: "function", file: "src/lib.ts", docs: "Rounds half up." }]);
    expect(await callReadTool(ctx, "poetics_unit", { unit: UID_B })).toMatchObject({
      callers: [{ uid: UID_A, name: "formatPrice" }],
    });
  });

  it("poetics_history lists versions newest first with their sequence", async () => {
    const ctx = await repo();
    const history = (await callReadTool(ctx, "poetics_history", { unit: UID_A })) as { versions: Array<{ seq: number }> };
    expect(history.versions.map((version) => version.seq)).toEqual([1, 0]);
    const latest = (await callReadTool(ctx, "poetics_history", { unit: UID_A, limit: 1 })) as typeof history;
    expect(latest.versions).toMatchObject([{ seq: 1, rationale: "Rounds half up" }]);
  });

  it("poetics_tests_for says which tests were verified against the current version", async () => {
    const ctx = await repo();
    expect(await callReadTool(ctx, "poetics_tests_for", { unit: UID_A })).toMatchObject({
      contentHash: hash("2"),
      tests: [
        { file: "src/lib.test.ts", verified: true },
        { file: "src/other.test.ts", verified: false },
      ],
    });
  });

  it("poetics_notes resolves a unit reference and needs at least one criterion", async () => {
    const N = "01JB8N0000000000000000000A";
    const ctx = await repo([note(N, { anchors: { units: [{ uid: UID_A, observedAt: hash("1") }] } })]);
    expect(await callReadTool(ctx, "poetics_notes", { unit: "formatPrice" })).toMatchObject({
      notes: [{ note: { id: N }, matched: ["unit"], needsRecheck: [UID_A] }],
    });
    await expect(callReadTool(ctx, "poetics_notes", {})).rejects.toThrow("Pass an error, unit, path or command");
  });

  it("says when a tool needs the code and the context has none, and leaves signals as a stub", async () => {
    const ctx = await repo();
    await expect(callReadTool(ctx, "poetics_impact", { units: [UID_A] })).rejects.toThrow("poetics_impact needs the code");
    await expect(callReadTool(ctx, "poetics_verify", {})).rejects.toThrow("poetics_verify needs the code");
    await expect(callReadTool(ctx, "poetics_impact", {})).rejects.toThrow("Pass since, units, or both");
    await expect(callReadTool(ctx, "poetics_impact", { units: "x" })).rejects.toThrow("units must be an array");
    await expect(callReadTool(ctx, "poetics_signals", {})).rejects.toThrow(NotImplementedError);
  });
});

describe("contextPack", () => {
  it("packs the unit, its notes, tests, dependencies, callers and earlier rationale", async () => {
    const N = "01JB8N0000000000000000000A";
    const ctx = await repo([note(N, { anchors: { units: [{ uid: UID_B }] } })]);
    const pack = await contextPack(ctx, { unit: UID_A });
    expect(pack.unit).toMatchObject({ uid: UID_A, docs: "Formats a price in the user's currency.", latest: { rationale: "Rounds half up" } });
    // The note is anchored to a dependency, not the unit itself.
    expect(pack.notes.map((n) => n.id)).toEqual([N]);
    expect(pack.tests).toHaveLength(2);
    expect(pack.dependencies.map((dep) => dep.name)).toEqual(["roundHalf"]);
    expect(pack.callers).toEqual([]);
    expect(pack.history).toEqual([{ contentHash: hash("1"), change: "created", rationale: "Seed formatPrice" }]);
    expect(pack.truncated).toEqual({});
    expect(pack.missing).toEqual(["code and signatures: this server has no code view"]);
    expect(pack.estimatedTokens).toBeLessThanOrEqual(4000);
  });

  it("picks the best match for a task and lists other candidates", async () => {
    const ctx = await repo();
    const pack = await contextPack(ctx, { task: "Change how we round prices" });
    expect(pack.unit.uid).toBe(UID_B);
    expect(pack.candidates?.map((c) => c.uid)).toEqual([UID_A]);
  });

  it("cuts lower-priority sections first to fit the budget, and counts what it cut", async () => {
    const ctx = await repo();
    const unbounded = await contextPack(ctx, { unit: UID_A });
    const budget = unbounded.estimatedTokens - 20;
    const pack = await contextPack(ctx, { unit: UID_A, tokenBudget: budget });
    expect(pack.estimatedTokens).toBeLessThanOrEqual(budget);
    expect(pack.tests).toHaveLength(2);
    expect(pack.history).toEqual([]);
    expect(pack.truncated).toEqual({ history: 1 });
  });

  it("trims the unit's own docs when the unit alone is over budget", async () => {
    const ctx = await repo();
    const long = unit(UID_A, "formatPrice", { docs: "x".repeat(5000) });
    await writeFile(join(ctx.paths.units, `${UID_A}.json`), JSON.stringify(long));
    await rebuildIndex(ctx.paths, ctx.db);
    const pack = await contextPack(ctx, { unit: UID_A, tokenBudget: 256 });
    expect(pack.estimatedTokens).toBeLessThanOrEqual(256);
    expect(pack.unit.docs?.endsWith("…")).toBe(true);
    expect(pack.truncated["unit.docs"]).toBe(1);
  });

  it("refuses an empty request and leaves issue lookup as a stub", async () => {
    const ctx = await repo();
    await expect(contextPack(ctx, {})).rejects.toThrow("Pass a unit, a task or an issue");
    await expect(contextPack(ctx, { issue: "#22" })).rejects.toThrow(NotImplementedError);
    await expect(callReadTool(ctx, "poetics_context_pack", { unit: UID_A, tokenBudget: 10 })).rejects.toThrow(/at least 256/);
  });

  it("reports a removed unit as removed", async () => {
    const ctx = await repo();
    const gone = unit(UID_B, "roundHalf");
    gone.versions.push({ contentHash: REMOVED_CONTENT_HASH, parent: hash("1"), change: "removed", actor: { kind: "human" }, rationale: "Inlined" });
    await writeFile(join(ctx.paths.units, `${UID_B}.json`), JSON.stringify(gone));
    await rebuildIndex(ctx.paths, ctx.db);
    expect((await contextPack(ctx, { unit: UID_B })).unit.removed).toBe(true);
  });
});
