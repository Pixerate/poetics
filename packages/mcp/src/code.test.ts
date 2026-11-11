import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import type { Unit } from "@poetics/core";
import { openIndex, rebuildIndex, storePaths } from "@poetics/store";
import { codeView } from "./code.ts";
import { callReadTool, changedUnits, contextPack } from "./read-tools.ts";
import type { ReadContext } from "./read-tools.ts";

const UID = {
  price: "01JB8K0000000000000000000A",
  round: "01JB8K0000000000000000000B",
  label: "01JB8K0000000000000000000C",
  gone: "01JB8K0000000000000000000D",
  old: "01JB8K0000000000000000000E",
};

const FILES = {
  "src/round.ts": `/** Rounds half up. */\nexport function roundHalf(n: number): number {\n  return Math.round(n);\n}\n`,
  "src/price.ts": `import { roundHalf } from "./round.ts";\n\n/** Formats cents. */\nexport function formatPrice(cents: number, currency = "EUR"): string {\n  return \`\${roundHalf(cents) / 100} \${currency}\`;\n}\n`,
  "src/label.ts": `import { formatPrice } from "./price.ts";\n\nexport function label(cents: number) {\n  return formatPrice(cents) + missing();\n}\n\nexport function fresh() {}\n`,
};

async function write(root: string, file: string, text: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

/** A project whose store has a unit for each export but `fresh`, one for deleted code, and one removed. */
async function project(): Promise<{ root: string; ctx: ReadContext }> {
  const root = await mkdtemp(join(tmpdir(), "poetics-mcp-code-"));
  for (const [file, text] of Object.entries(FILES)) await write(root, file, text);
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"] }));
  const code = createTypeScriptIndexer({ root, files: Object.keys(FILES) }).index().units;
  const hashOf = (name: string) => code.find((u) => u.name === name)!.contentHash;
  const unit = (uid: string, name: string, file: string, contentHash: Unit["versions"][number]["contentHash"], extra: Partial<Unit> = {}): Unit => ({
    uid,
    kind: "function",
    framework: "none",
    name,
    location: { file },
    versions: [{ contentHash, parent: null, change: "created", actor: { kind: "human" }, rationale: `Create ${name}` }],
    ...extra,
  });
  const units = [
    unit(UID.price, "formatPrice", "src/price.ts", hashOf("formatPrice"), { docs: "Formats cents.", tests: [{ file: "src/price.test.ts", via: "static" }] }),
    unit(UID.round, "roundHalf", "src/round.ts", hashOf("roundHalf"), { docs: "Rounds half\n  up." }),
    // Recorded before its last edit, so it is stale.
    unit(UID.label, "label", "src/label.ts", `b3:${"9".repeat(64)}`),
    unit(UID.gone, "gone", "src/gone.ts", `b3:${"8".repeat(64)}`),
    unit(UID.old, "old", "src/old.ts", `b3:${"7".repeat(64)}`),
  ];
  units[4]!.versions.push({ contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: `b3:${"7".repeat(64)}`, change: "removed", actor: { kind: "human" }, rationale: "Gone." });
  for (const u of units) await write(root, `.poetics/units/${u.uid}.json`, JSON.stringify(u));
  const paths = storePaths(root);
  const db = openIndex(":memory:");
  await rebuildIndex(paths, db);
  return { root, ctx: { paths, db, code: () => codeView(root, units) } };
}

describe("codeView", () => {
  it("joins indexed code to the units at their places, with a uid graph", async () => {
    const { ctx } = await project();
    const view = await ctx.code!();
    expect([...view.byUid.keys()].sort()).toEqual([UID.price, UID.round, UID.label].sort());
    expect(view.untracked.map((u) => u.name)).toEqual(["fresh"]);
    expect(view.missing).toEqual([UID.gone]);
    expect(view.graph.dependenciesOf(UID.label)).toEqual([UID.price]);
    expect(view.graph.dependentsOf(UID.round)).toEqual([UID.price]);
    expect(view.graph.unresolved).toMatchObject([{ from: UID.label, kind: "calls", reason: "missing does not resolve to a declaration" }]);
    expect(view.sourceOf(view.byUid.get(UID.round)!)).toBe("export function roundHalf(n: number): number {\n  return Math.round(n);\n}");
    // After its doc comment on line 1.
    expect(view.linesOf(view.byUid.get(UID.round)!)).toEqual({ startLine: 2, endLine: 4 });
    expect(view.linesOf(view.byUid.get(UID.price)!)).toEqual({ startLine: 4, endLine: 6 });
  });
});

describe("context packs with code", () => {
  it("include the unit's code and signature, and its callers' and dependencies' signatures", async () => {
    const { ctx } = await project();
    const pack = await contextPack(ctx, { unit: UID.price });
    expect(pack.unit.signature).toBe('export function formatPrice(cents: number, currency = "EUR"): string');
    expect(pack.code).toContain("return `${roundHalf(cents) / 100} ${currency}`;");
    expect(pack.dependencies).toMatchObject([{ uid: UID.round, signature: "export function roundHalf(n: number): number" }]);
    expect(pack.callers).toMatchObject([{ uid: UID.label, signature: "export function label(cents: number)" }]);
    expect(pack.missing).toEqual([]);
  });

  it("keep the first lines of code that does not fit, and say what they cut", async () => {
    const { ctx } = await project();
    const full = await contextPack(ctx, { unit: UID.price });
    // Room for the unit and a few tokens more, so the code has to be cut.
    const unitOnly = { ...full, code: undefined, notes: [], tests: [], dependencies: [], callers: [], history: [], truncated: { code: 1 }, estimatedTokens: 0 };
    const tight = await contextPack(ctx, { unit: UID.price, tokenBudget: Math.ceil(JSON.stringify(unitOnly).length / 4) + 30 });
    expect(tight.truncated["code"]).toBeGreaterThan(0);
    expect(tight.code ?? "").toMatch(/^export function formatPrice/);
  });

  it("say when the indexer cannot read the unit", async () => {
    const { ctx } = await project();
    expect((await contextPack(ctx, { unit: UID.gone })).missing).toEqual(["code and signatures: no function gone in src/gone.ts that the TypeScript indexer can read"]);
  });
});

describe("poetics_impact", () => {
  it("ranks what a change to the given units would reach, with unresolved uses inside it", async () => {
    const { ctx } = await project();
    const report = (await callReadTool(ctx, "poetics_impact", { units: ["roundHalf"] })) as {
      impact: Array<{ name: string; distance: number; reason: string }>;
      unresolved: Array<{ name: string }>;
    };
    expect(report.impact.map(({ name, distance, reason }) => [name, distance, reason])).toEqual([
      ["roundHalf", 0, "own"],
      ["formatPrice", 1, "closure"],
      ["label", 2, "closure"],
    ]);
    expect(report.unresolved.map((u) => u.name)).toEqual(["label"]);
  });

  it("takes changed units and interface changes from a change set", () => {
    const set = {
      from: "a",
      to: "b",
      unrecorded: [],
      decisions: [],
      notes: [],
      commits: [
        {
          commit: "c",
          subject: "s",
          units: [
            { uid: UID.round, name: "roundHalf", kind: "function" as const, file: "src/round.ts", status: "changed" as const, lineage: [], versions: [{ change: "interface" }] },
            { uid: UID.price, name: "formatPrice", kind: "function" as const, file: "src/price.ts", status: "changed" as const, lineage: [], versions: [{ change: "behaviour" }] },
          ],
        },
      ],
    } as unknown as Parameters<typeof changedUnits>[0];
    expect(changedUnits(set)).toEqual({ changed: [UID.price, UID.round].sort(), interfaceChanged: [UID.round] });
  });
});

describe("poetics_verify", () => {
  it("reports stale, untracked and missing units, stale docs, untested units and unresolved uses", async () => {
    const { root, ctx } = await project();
    expect(((await callReadTool(ctx, "poetics_verify", {})) as { staleDocs: unknown[] }).staleDocs).toEqual([]);
    await write(root, "src/round.ts", FILES["src/round.ts"].replace("Rounds half up.", "Rounds half to even."));
    const report = (await callReadTool(ctx, "poetics_verify", {})) as Record<string, Array<Record<string, unknown>>> & { ok: boolean };
    expect(report.ok).toBe(false);
    expect(report.stale!.map((u) => u["name"])).toEqual(["label"]);
    expect(report.untracked!.map((u) => u["name"])).toEqual(["fresh"]);
    expect(report.missing!.map((u) => u["name"])).toEqual(["gone"]);
    // Stored with a line break the code does not have, which alone is not stale.
    expect(report.staleDocs).toMatchObject([{ name: "roundHalf", stored: "Rounds half\n  up.", code: "Rounds half to even." }]);
    expect(report.untested!.map((u) => u["name"]).sort()).toEqual(["label", "roundHalf"]);
    expect(report.unresolved!.map((u) => u["name"])).toEqual(["label"]);

    const scoped = (await callReadTool(ctx, "poetics_verify", { scope: "src/price.ts" })) as { ok: boolean; stale: unknown[]; untested: unknown[] };
    expect([scoped.ok, scoped.stale, scoped.untested]).toEqual([true, [], []]);
  });
});

describe("codeView with React", () => {
  it("sees components and renders edges when the config lists react", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-mcp-react-"));
    await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript", "react"], include: ["src/**/*.tsx"] }));
    await write(root, "src/Tag.tsx", "export function Tag() {\n  return <b />;\n}\n");
    await write(root, "src/Page.tsx", 'import { Tag } from "./Tag.tsx";\nexport function Page() {\n  return <Tag />;\n}\n');
    const units = ["Tag", "Page"].map((name, i): Unit => ({
      uid: `01JB8K000000000000000000R${i}`,
      kind: "component",
      framework: "react",
      name,
      location: { file: `src/${name}.tsx` },
      versions: [{ contentHash: `b3:${String(i).repeat(64)}`, parent: null, change: "created", actor: { kind: "human" }, rationale: name }],
    }));
    const view = await codeView(root, units);
    expect(view.byUid.get(units[0]!.uid)).toMatchObject({ kind: "component", framework: "react" });
    expect(view.graph.edges).toEqual([{ from: units[1]!.uid, to: units[0]!.uid, kind: "renders" }]);
  });
});

describe("codeView with Svelte", () => {
  it("joins functions in a component's script to the units it owns (#72)", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-mcp-svelte-"));
    await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript", "svelte"], include: ["src/**/*.svelte"] }));
    await write(root, "src/Counter.svelte", `<script lang="ts">\n  let count = $state(0);\n  function bump() {\n    count += 1;\n  }\n</script>\n\n<button onclick={bump}>{count}</button>\n`);
    const component: Unit = {
      uid: "01JB8K000000000000000000S0",
      kind: "component",
      framework: "svelte",
      name: "Counter",
      location: { file: "src/Counter.svelte", export: "default" },
      versions: [{ contentHash: `b3:${"0".repeat(64)}`, parent: null, change: "created", actor: { kind: "human" }, rationale: "Counter" }],
    };
    const bump: Unit = { ...component, uid: "01JB8K000000000000000000S1", kind: "function", framework: "none", name: "bump", owner: component.uid, location: { file: "src/Counter.svelte" } };
    const view = await codeView(root, [component, bump]);
    expect(view.untracked).toEqual([]);
    expect(view.missing).toEqual([]);
    expect(view.linesOf(view.byUid.get(bump.uid)!)).toEqual({ startLine: 3, endLine: 5 });
    expect(view.graph.edges).toEqual([{ from: component.uid, to: bump.uid, kind: "calls" }]);
  });
});
