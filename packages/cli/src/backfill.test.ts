import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import { applyBackfill, applyPrehistory, formatBackfillPlan, formatPrehistoryPlan, planBackfill, planPrehistory } from "./backfill.ts";
import { applyIndex, planIndex } from "./indexing.ts";
import { runGit, write } from "./test-helpers.ts";

const CONFIG = { include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] };

const commit = (root: string, message: string) => {
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", message);
};

/** A repository with history but no store: the case backfill exists for. */
async function adopted(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-backfill-"));
  runGit(root, "init", "-q", "-b", "main");
  await write(root, "package.json", JSON.stringify({ name: "@x/pkg", type: "module" }));
  await write(root, ".gitignore", ".poetics/cache/\n");
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], ...CONFIG }));
  await write(root, "src/price.ts", "export function formatPrice(n: number) {\n  return n.toFixed(2);\n}\n");
  await write(root, "docs/guide.md", "Call `formatPrice` for invoices.\n");
  commit(root, "feat(core): add formatPrice\n\nInvoices need two decimals (#12).\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");

  await write(root, "src/util.ts", "export function one() {\n  return 1;\n}\nexport function two() {\n  return 2;\n}\n");
  commit(root, "chore: initial import");

  await write(root, "src/tax.ts", "export function taxOf(n: number) {\n  return n * 0.2;\n}\n");
  await write(root, ".changeset/tax.md", '---\n"@x/pkg": minor\n---\n\nAdd taxOf so totals can show VAT separately.\n');
  commit(root, "feat: tax");

  // Not committed yet: one with TSDoc, one without.
  await write(root, "src/new.ts", "/** Rounds half up. */\nexport function roundHalf(n: number) {\n  return Math.round(n);\n}\nexport function bare() {}\n");
  return root;
}

const byName = (plan: Awaited<ReturnType<typeof planBackfill>>) => new Map(plan.created.map(({ unit }) => [unit.name, unit]));

describe("planBackfill", () => {
  it("infers each new unit's rationale from the most specific evidence, with a computed confidence", async () => {
    const root = await adopted();
    const plan = await planBackfill(root, CONFIG);
    const units = byName(plan);
    const sha = (subject: string) => runGit(root, "log", "--format=%H", `--grep=${subject}`).trim();

    expect(units.get("formatPrice")!.versions[0]).toMatchObject({
      change: "created",
      commit: sha("add formatPrice"),
      rationale: "Invoices need two decimals (#12).",
      actor: { kind: "agent", tool: "Claude Opus 5.5", reviewed: false },
      links: [
        { kind: "github-issue", ref: "#12" },
        { kind: "doc", ref: "docs/guide.md" },
      ],
      inferred: { by: "poetics-backfill", confidence: "high", sources: ["commit", "doc"], drafted: false, reviewed: false },
    });
    // The same commit introduced both, so its text speaks to neither in particular.
    expect(units.get("one")!.versions[0]).toMatchObject({ rationale: "initial import", actor: { kind: "human" }, inferred: { confidence: "medium" } });
    // The changeset names taxOf, so it speaks to this unit, not only to its package.
    expect(units.get("taxOf")!.versions[0]).toMatchObject({
      rationale: "Add taxOf so totals can show VAT separately.",
      links: [{ kind: "changeset", ref: ".changeset/tax.md" }],
      inferred: { confidence: "high", sources: ["changeset", "commit"] },
    });
    expect(units.get("roundHalf")!.versions[0]).toMatchObject({ rationale: "Rounds half up.", inferred: { confidence: "low", sources: ["comment"] } });
    expect(units.get("roundHalf")!.versions[0]!.commit).toBeUndefined();
    expect(units.get("bare")!.versions[0]).toMatchObject({ rationale: expect.stringContaining("nothing in the repository says why"), inferred: { confidence: "low", sources: [] } });
    expect(plan.byConfidence).toEqual({ high: 2, medium: 2, low: 2 });
  });

  it("treats a changeset that does not name the unit as speaking to its package, not to it", async () => {
    const root = await adopted();
    await write(root, "src/fee.ts", "export function feeOf(n: number) {\n  return n * 0.01;\n}\n");
    await write(root, ".changeset/fees.md", '---\n"@x/pkg": patch\n---\n\nCharge a card fee.\n');
    commit(root, "feat: fees");
    expect(byName(await planBackfill(root, CONFIG)).get("feeOf")!.versions[0]).toMatchObject({ rationale: "Charge a card fee.", inferred: { confidence: "medium" } });
  });

  it("never stores author names or emails", async () => {
    const root = await adopted();
    const text = JSON.stringify((await planBackfill(root, CONFIG)).created.map(({ unit }) => unit));
    expect(text).not.toContain("noreply@anthropic.com");
    expect(text).not.toContain("test@example.com");
    expect(text).not.toContain("Test");
  });

  it("writes the units, after which a second plan has nothing to create", async () => {
    const root = await adopted();
    expect(await applyBackfill(root, await planBackfill(root, CONFIG))).toBe(6);
    const files = await readdir(join(root, ".poetics/units"));
    const written = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(root, ".poetics/units", f), "utf8")) as Unit));
    expect(written.find((u) => u.name === "formatPrice")!.versions[0]!.actor).toEqual({ kind: "agent", tool: "Claude Opus 5.5", reviewed: false });
    expect((await planBackfill(root, CONFIG)).created).toEqual([]);
  });

  it("leaves existing units alone and lists their gaps, unrecorded changes and candidate notes", async () => {
    const root = await adopted();
    await applyIndex(root, await planIndex(root, CONFIG, { rationale: "Recorded by hand" }), { kind: "human" });
    const before = await readdir(join(root, ".poetics/units"));
    await write(root, "src/price.ts", "/** Formats a price. */\nexport function formatPrice(n: number) {\n  // HACK: toFixed rounds half to even on some engines\n  return n.toFixed(3);\n}\n");
    await write(root, "src/price.test.ts", "import { formatPrice } from './price.ts';\n");
    const plan = await planBackfill(root, CONFIG);
    expect(plan.created).toEqual([]);
    expect(plan.unrecorded).toBe(1);
    expect(plan.missingDocs.map((g) => g.name)).toEqual(["formatPrice"]);
    expect(plan.missingTests).toMatchObject([{ name: "formatPrice", test: "src/price.test.ts" }]);
    expect(plan.candidateNotes).toEqual([{ file: "src/price.ts", line: 3, text: "HACK: toFixed rounds half to even on some engines" }]);
    expect(await readdir(join(root, ".poetics/units"))).toEqual(before);
  });
});

describe("formatBackfillPlan", () => {
  it("lists new units with their confidence, then what to add by hand, then a summary", async () => {
    const root = await adopted();
    const text = formatBackfillPlan(await planBackfill(root, CONFIG));
    expect(text).toContain("+ src/price.ts#formatPrice [high] Invoices need two decimals (#12).");
    expect(text).toMatch(/Would create 6 new unit\(s\) \(2 high, 2 medium, 2 low confidence\)\. Run with --write to write them\.$/);
  });

  it("backfills React components as components when the config lists react", async () => {
    const root = await adopted();
    await write(root, "src/Badge.tsx", "export function Badge() {\n  return <b />;\n}\n");
    const units = byName(await planBackfill(root, { ...CONFIG, include: ["src/**/*.{ts,tsx}"], adapters: ["typescript", "react"] }));
    expect(units.get("Badge")).toMatchObject({ kind: "component", framework: "react" });
  });
});

describe("planPrehistory", () => {
  const TOTAL = (name: string) => `export function ${name}(items: number[], rate: number): number {\n  let sum = 0;\n  for (const item of items) {\n    if (item <= 0) continue;\n    sum += item;\n  }\n  return sum + Math.round(sum * rate * 100) / 100;\n}\n`;

  /** A repo with history, then adopted: the snapshot's unit files are committed last. */
  async function adoptedLate(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "poetics-prehistory-"));
    runGit(root, "init", "-q", "-b", "main");
    await write(root, ".gitignore", ".poetics/cache/\n");
    await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], ...CONFIG }));
    await write(root, "src/price.ts", TOTAL("formatPrice"));
    commit(root, "Add formatPrice (#1)");
    await write(root, "src/price.ts", TOTAL("formatPrice").replace("sum += item;", "sum += item * 2;"));
    commit(root, "Double each item for bulk orders\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
    await write(root, "src/price.ts", "");
    await write(root, "src/money.ts", TOTAL("formatAmount").replace("sum += item;", "sum += item * 2;"));
    commit(root, "Move to money");
    await applyBackfill(root, await planBackfill(root, CONFIG));
    commit(root, "Adopt Poetics");
    return root;
  }

  it("follows a unit back through edits, renames and moves, stopping at the commit that recorded it", async () => {
    const root = await adoptedLate();
    const plan = await planPrehistory(root, CONFIG);
    const sha = (subject: string) => runGit(root, "log", "--format=%H", `--grep=${subject}`).trim();
    expect(plan.commits).toBe(4);
    expect(plan.units).toHaveLength(1);
    const [entry] = plan.units;
    expect(entry).toMatchObject({ name: "formatAmount", file: "src/money.ts" });
    expect(entry!.stoppedAt).toBeUndefined();
    expect(entry!.prehistory).toMatchObject([
      { change: "created", parent: null, commit: sha("Add formatPrice"), rationale: "Add formatPrice (#1)", links: [{ kind: "github-issue", ref: "#1" }], actor: { kind: "human" }, inferred: { by: "poetics-backfill", confidence: "high", sources: ["commit"] } },
      { change: "behaviour", commit: sha("Double each item"), rationale: "Double each item for bulk orders", actor: { kind: "agent", tool: "Claude Opus 5.5", reviewed: false } },
    ]);
    expect(entry!.prehistory[1]!.parent).toBe(entry!.prehistory[0]!.contentHash);
  });

  it("writes prehistory once, after which re-running changes nothing", async () => {
    const root = await adoptedLate();
    expect(await applyPrehistory(root, await planPrehistory(root, CONFIG))).toBe(1);
    expect(await applyPrehistory(root, await planPrehistory(root, CONFIG))).toBe(0);
    const files = await readdir(join(root, ".poetics/units"));
    const unit = JSON.parse(await readFile(join(root, ".poetics/units", files[0]!), "utf8")) as Unit;
    expect([unit.prehistory!.length, unit.versions.length, unit.versions[0]!.change]).toEqual([2, 1, "created"]);
  });

  it("does not claim history across a move matching would only queue", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-prehistory-queue-"));
    runGit(root, "init", "-q", "-b", "main");
    await write(root, ".gitignore", ".poetics/cache/\n");
    await write(root, "src/cart.ts", TOTAL("total") + TOTAL("totalWithTax"));
    commit(root, "Add totals");
    await write(root, "src/cart.ts", "");
    await write(root, "src/sums.ts", TOTAL("sum") + TOTAL("sumWithTax"));
    commit(root, "Move totals");
    await applyBackfill(root, await planBackfill(root, CONFIG));
    commit(root, "Adopt Poetics");
    const plan = await planPrehistory(root, CONFIG);
    const sum = plan.units.find((u) => u.name === "sum")!;
    expect(sum.prehistory.map((v) => v.change)).toEqual(["created"]);
    expect(sum.stoppedAt).toMatchObject({ reason: "4 units share the same content" });
    expect(sum.prehistory[0]!.commit).toBe(runGit(root, "log", "--format=%H", "--grep=Move totals").trim());
  });

  it("describes the plan for people", async () => {
    const root = await adoptedLate();
    expect(formatPrehistoryPlan(await planPrehistory(root, CONFIG))).toMatch(/^src\/money\.ts#formatAmount: 2 version\(s\) back to [0-9a-f]{7}\nWould record 2 version\(s\) of prehistory for 1 unit\(s\), from 4 commit\(s\)\./);
  });
  describe("over a range", () => {
    const sha = (root: string, subject: string) => runGit(root, "log", "--format=%H", `--grep=${subject}`).trim();

    it("walks only the commits after from, opening code that was already there at its first change", async () => {
      const root = await adoptedLate();
      const from = sha(root, "Add formatPrice");
      const plan = await planPrehistory(root, CONFIG, { from });
      expect(plan.commits).toBe(3);
      expect(plan.range).toEqual({ from, to: runGit(root, "rev-parse", "HEAD").trim() });
      const [entry] = plan.units;
      expect(entry!.prehistory).toMatchObject([{ change: "created", parent: null, commit: sha(root, "Double each item"), rationale: "Double each item for bulk orders" }]);
      expect(entry!.stoppedAt).toEqual({ commit: sha(root, "Double each item"), reason: `the range starts after ${from.slice(0, 7)}; earlier history was not walked` });
    });

    it("lets a walk from further back extend what a shorter range wrote", async () => {
      const root = await adoptedLate();
      expect(await applyPrehistory(root, await planPrehistory(root, CONFIG, { from: sha(root, "Add formatPrice") }))).toBe(1);
      const full = await planPrehistory(root, CONFIG);
      expect(await applyPrehistory(root, full)).toBe(1);
      const files = await readdir(join(root, ".poetics/units"));
      const unit = JSON.parse(await readFile(join(root, ".poetics/units", files[0]!), "utf8")) as Unit;
      expect(unit.prehistory).toEqual(full.units[0]!.prehistory);
      expect(unit.prehistory!.map((v) => v.change)).toEqual(["created", "behaviour"]);
    });

    it("gives code nothing when it did not change in the range", async () => {
      const root = await adoptedLate();
      const plan = await planPrehistory(root, CONFIG, { from: sha(root, "Move to money") });
      expect([plan.commits, plan.units]).toEqual([1, []]);
    });

    it("leaves out units recorded after to, rather than stopping their prehistory short", async () => {
      const root = await adoptedLate();
      const to = sha(root, "Move to money");
      const plan = await planPrehistory(root, CONFIG, { to });
      expect([plan.commits, plan.units, plan.beyond, plan.range]).toEqual([3, [], 1, { to }]);
      expect(formatPrehistoryPlan(plan)).toContain(`1 unit(s) were recorded after ${to.slice(0, 7)}, where the range ends; walk to a later commit to reach them.`);
    });

    it("skips units recorded by from, whose prehistory is before the range", async () => {
      const root = await adoptedLate();
      await write(root, "src/money.ts", TOTAL("formatAmount").replace("sum += item;", "sum += item * 3;"));
      commit(root, "Triple each item");
      const plan = await planPrehistory(root, CONFIG, { from: sha(root, "Adopt Poetics") });
      expect([plan.commits, plan.units, plan.beyond]).toEqual([1, [], 0]);
    });

    it("refuses refs that name no commit, a from off the first-parent line, and a range in an empty repository", async () => {
      const root = await adoptedLate();
      await expect(planPrehistory(root, CONFIG, { from: "no-such-ref" })).rejects.toThrow("no-such-ref does not name a commit");
      await expect(planPrehistory(root, CONFIG, { from: "HEAD", to: sha(root, "Add formatPrice") })).rejects.toThrow(/is not on the first-parent line of/);
      const empty = await mkdtemp(join(tmpdir(), "poetics-prehistory-empty-"));
      runGit(empty, "init", "-q", "-b", "main");
      await expect(planPrehistory(empty, CONFIG, { from: "HEAD" })).rejects.toThrow("The repository has no commits to walk a range of");
    });

    it("says where the range starts in the summary", async () => {
      const root = await adoptedLate();
      const from = sha(root, "Add formatPrice");
      expect(formatPrehistoryPlan(await planPrehistory(root, CONFIG, { from }))).toContain(`from 3 commit(s) after ${from.slice(0, 7)}.`);
    });
  });
});
