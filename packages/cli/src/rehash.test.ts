import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import { applyRehash, planRehash, unitHashes } from "./rehash.ts";
import { SCOPE, makeGitRepo, unitFor, write, writeUnitFile } from "./test-helpers.ts";

const UID = "01JB8K0000000000000000000A";
const UID_B = "01JB8K0000000000000000000B";
const UID_C = "01JB8K0000000000000000000C";
const config = { ...SCOPE };
const readUnit = async (root: string, uid: string) => JSON.parse(await readFile(join(root, ".poetics/units", `${uid}.json`), "utf8")) as Unit;

describe("planRehash and applyRehash", () => {
  it("rehashes unchanged provisional units and leaves changed or missing ones", async () => {
    const root = await makeGitRepo(UID);
    await write(root, "src/b.ts", "export function b() {\n  return 2;\n}\n");
    await writeUnitFile(root, unitFor(UID_B, "b", "export function b() {\n  return 1;\n}", { location: { file: "src/b.ts" } }));
    await writeUnitFile(root, unitFor(UID_C, "gone", "export function gone() {}", { location: { file: "src/c.ts" } }));

    const plan = await planRehash(root, config);
    expect(plan.rehash.map((e) => e.uid)).toEqual([UID]);
    expect(plan.rehash[0]).toMatchObject({ name: "a", file: "src/a.ts", reason: "provisional", contentHash: expect.stringMatching(/^b3:/), interfaceHash: expect.stringMatching(/^b3:/) });
    expect(plan.skipped).toEqual([
      { uid: UID_B, name: "b", file: "src/b.ts", reason: expect.stringMatching(/^the code changed since git:/) },
      { uid: UID_C, name: "gone", file: "src/c.ts", reason: "no function gone in src/c.ts that the indexer can read" },
    ]);

    const actor = { kind: "agent" as const, tool: "claude-code", reviewed: false };
    expect(await applyRehash(root, plan, actor)).toBe(1);
    const unit = await readUnit(root, UID);
    expect(unit.versions.at(-1)).toEqual({
      contentHash: plan.rehash[0]!.contentHash,
      interfaceHash: plan.rehash[0]!.interfaceHash,
      parent: unit.versions[0]!.contentHash,
      change: "rehash",
      actor,
      rationale: expect.stringContaining("unchanged"),
      links: [{ kind: "decision", ref: "docs/decisions/0014-rehash-versions.md" }],
    });

    // A second run finds nothing left to do for the rehashed unit.
    const again = await planRehash(root, config);
    expect([again.rehash, again.alreadyIndexed]).toEqual([[], 1]);
  });

  it("rehashes b3: units whose interface hash the adapters' rules now compute differently (ADR 0024)", async () => {
    const root = await makeGitRepo(UID);
    const [now] = await unitHashes(root, config, "src/a.ts");
    const stale = `b3:${"0".repeat(64)}` as const;
    const recorded = unitFor(UID, "a", "");
    recorded.versions = [{ contentHash: now!.contentHash, interfaceHash: stale, parent: null, change: "created", actor: { kind: "human" }, rationale: "Made." }];
    await writeUnitFile(root, recorded);

    const plan = await planRehash(root, config);
    expect(plan).toMatchObject({ skipped: [], alreadyIndexed: 0 });
    expect(plan.rehash).toEqual([{ uid: UID, name: "a", file: "src/a.ts", parent: now!.contentHash, reason: "rules", contentHash: now!.contentHash, interfaceHash: now!.interfaceHash }]);
    expect(await applyRehash(root, plan, { kind: "human" })).toBe(1);
    expect((await readUnit(root, UID)).versions.at(-1)).toMatchObject({
      contentHash: now!.contentHash,
      interfaceHash: now!.interfaceHash,
      parent: now!.contentHash,
      change: "rehash",
      rationale: expect.stringContaining("rules"),
      links: [{ kind: "decision", ref: "docs/decisions/0014-rehash-versions.md" }, { kind: "decision", ref: "docs/decisions/0024-rehash-after-rule-changes.md" }],
    });
    expect(await planRehash(root, config)).toMatchObject({ rehash: [], alreadyIndexed: 1 });
  });

  it("finds a Svelte component by its name, not its default export", async () => {
    const root = await makeGitRepo(UID);
    const svelte = { include: ["src/**/*.{ts,svelte}"], adapters: ["typescript", "svelte"] };
    await write(root, "src/Tag.svelte", `<script lang="ts">\n  let { label }: { label: string } = $props();\n</script>\n\n<b>{label}</b>\n`);
    const [now] = await unitHashes(root, svelte, "src/Tag.svelte");
    const tag = unitFor(UID_B, "Tag", "", { kind: "component", framework: "svelte", location: { file: "src/Tag.svelte", export: "default" } });
    tag.versions = [{ contentHash: now!.contentHash, interfaceHash: `b3:${"0".repeat(64)}`, parent: null, change: "created", actor: { kind: "human" }, rationale: "Made." }];
    await writeUnitFile(root, tag);
    expect((await planRehash(root, svelte)).rehash.map((e) => [e.name, e.reason])).toEqual([["a", "provisional"], ["Tag", "rules"]]);
  });

  it("gives the hashes that the change check expects", async () => {
    const root = await makeGitRepo(UID);
    const [hashes] = await unitHashes(root, config, "src/a.ts");
    const plan = await planRehash(root, config);
    expect(hashes).toEqual({ name: "a", kind: "function", startLine: 1, endLine: 3, contentHash: plan.rehash[0]!.contentHash, interfaceHash: plan.rehash[0]!.interfaceHash });
  });

  it("hashes a component's props as its interface when the config lists react", async () => {
    const root = await makeGitRepo(UID);
    const tag = (unit: string) => `export function Tag({ unit = "${unit}" }: { unit?: string }) {\n  return <b>{unit}</b>;\n}\n`;
    const react = { include: ["src/**/*.{ts,tsx}"], adapters: ["react"] };
    await write(root, "src/Tag.tsx", tag("GBP"));
    const [gbp] = await unitHashes(root, react, "src/Tag.tsx");
    expect(gbp).toMatchObject({ name: "Tag", kind: "component" });
    await write(root, "src/Tag.tsx", tag("EUR"));
    const [eur] = await unitHashes(root, react, "src/Tag.tsx");
    expect(eur!.interfaceHash).not.toBe(gbp!.interfaceHash);
    expect((await unitHashes(root, { include: ["src/**/*.{ts,tsx}"] }, "src/Tag.tsx"))[0]!.kind).toBe("function");
    expect((await planRehash(root, react)).rehash.map((e) => e.name)).toEqual(["a"]);
  });
});
