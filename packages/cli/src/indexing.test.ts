import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import { applyIndex, formatIndexPlan, planIndex } from "./indexing.ts";
import { runGit, write } from "./test-helpers.ts";

const CONFIG = { include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] };
const human = { kind: "human" } as const;

const TOTAL = `export function total(items: number[], taxRate: number): number {
  let sum = 0;
  for (const item of items) {
    if (item <= 0) continue;
    sum += item;
  }
  return sum + Math.round(sum * taxRate * 100) / 100;
}
`;
const PRICE = `export function formatPrice(cents: number): string {\n  return (cents / 100).toFixed(2);\n}\n`;

/** A committed repo whose store poetics index itself created from `files`. */
async function seeded(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-index-"));
  runGit(root, "init", "-q", "-b", "main");
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], ...CONFIG }));
  await write(root, ".gitignore", ".poetics/cache/\n");
  for (const [file, text] of Object.entries(files)) await write(root, file, text);
  await applyIndex(root, await planIndex(root, CONFIG, { rationale: "Seed" }), human);
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", "Seed");
  return root;
}

async function store(root: string): Promise<Map<string, Unit>> {
  const dir = join(root, ".poetics/units");
  const units = await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as Unit));
  return new Map(units.map((unit) => [unit.name, unit]));
}

describe("planIndex and applyIndex", () => {
  it("creates units for new code, with docs, hashes, deps and sibling tests", async () => {
    const root = await seeded({
      "src/price.ts": `/** Formats cents. */\n${PRICE}`,
      "src/cart.ts": `import { formatPrice } from "./price.ts";\nexport function label(c: number) { return formatPrice(c); }\n`,
      "src/cart.test.ts": `// tests label\n`,
    });
    const units = await store(root);
    const price = units.get("formatPrice")!;
    const label = units.get("label")!;
    expect(price).toMatchObject({ kind: "function", framework: "none", location: { file: "src/price.ts" }, docs: "Formats cents." });
    expect(price.versions).toMatchObject([{ change: "created", parent: null, rationale: "Seed", actor: human, contentHash: expect.stringMatching(/^b3:/) }]);
    expect(label.versions[0]!.deps).toEqual({ [price.uid]: price.versions[0]!.contentHash });
    expect(label.tests).toEqual([{ file: "src/cart.test.ts", via: "static" }]);
    expect(price.tests).toBeUndefined();

    // Nothing changed, so a second run records nothing.
    const again = await planIndex(root, CONFIG);
    expect(again).toMatchObject({ fresh: 2, moves: [], versions: [], created: [], removed: [], queued: [] });
  });

  it("classifies edits in place as behaviour, cosmetic or interface, and ignores a reformat", async () => {
    const root = await seeded({ "src/a.ts": TOTAL, "src/b.ts": PRICE, "src/c.ts": PRICE.replace("formatPrice", "formatOther"), "src/d.ts": PRICE.replace("formatPrice", "formatSame") });
    await write(root, "src/a.ts", TOTAL.replace("sum += item;", "sum += item * 2;"));
    await write(root, "src/b.ts", PRICE.replace("(cents: number)", "(cents: number, digits = 2)").replace("toFixed(2)", "toFixed(digits)"));
    await write(root, "src/c.ts", PRICE.replace("formatPrice", "formatOther").replace("(cents / 100)", "((cents as number) / 100)"));
    await write(root, "src/d.ts", `// Reformatted.\nexport function formatSame(\n  cents: number,\n): string {\n  return (cents / 100).toFixed(2)\n}\n`);
    const plan = await planIndex(root, CONFIG, { rationale: "Fix totals (#7)" });
    expect(plan.versions.map(({ key, version }) => [key, version.change])).toEqual([
      ["src/a.ts#total", "behaviour"],
      ["src/b.ts#formatPrice", "interface"],
      ["src/c.ts#formatOther", "cosmetic"],
    ]);
    expect(plan.fresh).toBe(1);
    expect(plan.versions[0]!.version).toMatchObject({ rationale: "Fix totals (#7)", links: [{ kind: "github-issue", ref: "#7" }] });

    expect(await applyIndex(root, plan, human)).toBe(3);
    const total = (await store(root)).get("total")!;
    expect(total.versions.map((v) => v.change)).toEqual(["created", "behaviour"]);
    expect(total.versions[1]!.parent).toBe(total.versions[0]!.contentHash);
  });

  it("keeps the uid through a move, a rename with an edit, and records a deletion as removed", async () => {
    const root = await seeded({ "src/cart.ts": TOTAL, "src/price.ts": PRICE, "src/gone.ts": `export function gone() {\n  return 1;\n}\n` });
    const before = await store(root);
    await rm(join(root, "src/price.ts"));
    await rm(join(root, "src/gone.ts"));
    await write(root, "src/format/price.ts", PRICE);
    await write(root, "src/cart.ts", TOTAL.replace("function total(", "function cartTotal(").replace("return sum +", "return 0 + sum +"));
    const plan = await planIndex(root, CONFIG, { rationale: "Reorganise" });
    expect(plan.moves.map(({ uid, to, lineage, via }) => ({ uid, to, lineage, via }))).toEqual([
      { uid: before.get("total")!.uid, to: { file: "src/cart.ts", name: "cartTotal" }, lineage: [{ kind: "rename", from: "total" }], via: "similarity" },
      { uid: before.get("formatPrice")!.uid, to: { file: "src/format/price.ts", name: "formatPrice" }, lineage: [{ kind: "move", from: "src/price.ts" }], via: "content" },
    ]);
    expect(plan.versions.map((v) => v.uid)).toEqual([before.get("total")!.uid]);
    expect(plan.removed.map((r) => [r.uid, r.version.change])).toEqual([[before.get("gone")!.uid, "removed"]]);
    expect(plan.created).toEqual([]);

    await applyIndex(root, plan, human);
    const after = await store(root);
    expect(after.get("cartTotal")).toMatchObject({ uid: before.get("total")!.uid, location: { file: "src/cart.ts" }, lineage: [{ kind: "rename", from: "total" }] });
    expect(after.get("formatPrice")!.versions).toEqual(before.get("formatPrice")!.versions);
    expect(after.get("gone")!.versions.at(-1)).toMatchObject({ change: "removed", rationale: "Reorganise" });
    expect(await planIndex(root, CONFIG)).toMatchObject({ moves: [], versions: [], created: [], removed: [], queued: [] });
  });

  it("follows test files git saw renamed, for moved and unmoved units alike", async () => {
    const root = await seeded({
      "src/price.ts": PRICE,
      "src/price.test.ts": `// tests formatPrice\n`,
      "src/cart.ts": TOTAL,
      "src/cart.test.ts": `// tests total\n`,
    });
    const before = await store(root);
    expect(before.get("formatPrice")!.tests).toEqual([{ file: "src/price.test.ts", via: "static" }]);
    // formatPrice and its test move together; total stays put while its test moves away.
    await Promise.all(["src/format", "test"].map((dir) => mkdir(join(root, dir))));
    runGit(root, "mv", "src/price.ts", "src/format/price.ts");
    runGit(root, "mv", "src/price.test.ts", "src/format/price.test.ts");
    runGit(root, "mv", "src/cart.test.ts", "test/cart.test.ts");
    const plan = await planIndex(root, CONFIG, { rationale: "Reorganise" });
    expect(plan.moves.map((m) => m.uid)).toEqual([before.get("formatPrice")!.uid]);
    expect(plan.relinks).toEqual([
      { uid: before.get("total")!.uid, key: "src/cart.ts#total", tests: [{ from: "src/cart.test.ts", to: "test/cart.test.ts" }] },
      { uid: before.get("formatPrice")!.uid, key: "src/format/price.ts#formatPrice", tests: [{ from: "src/price.test.ts", to: "src/format/price.test.ts" }] },
    ]);
    expect(plan.fresh).toBe(1);
    expect(formatIndexPlan(plan)).toContain("= src/cart.ts#total tests: src/cart.test.ts -> test/cart.test.ts");
    expect(formatIndexPlan(plan)).toContain("1 moved, 0 changed, 0 new, 0 removed, 2 relinked");

    expect(await applyIndex(root, plan, human)).toBe(2);
    const after = await store(root);
    expect(after.get("formatPrice")).toMatchObject({ location: { file: "src/format/price.ts" }, tests: [{ file: "src/format/price.test.ts", via: "static" }] });
    expect(after.get("total")!.tests).toEqual([{ file: "test/cart.test.ts", via: "static" }]);
    expect(after.get("total")!.versions).toEqual(before.get("total")!.versions);
    // Recorded, so a second run against the same base relinks nothing.
    expect((await planIndex(root, CONFIG)).relinks).toEqual([]);
  });

  it("leaves units a person already recorded alone", async () => {
    const root = await seeded({ "src/price.ts": PRICE });
    const unit = (await store(root)).get("formatPrice")!;
    await rm(join(root, "src/price.ts"));
    await write(root, "src/money.ts", PRICE);
    // Declared by hand, the way the poetics-refactor skill says.
    await write(root, `.poetics/units/${unit.uid}.json`, JSON.stringify({ ...unit, location: { file: "src/money.ts" }, lineage: [{ kind: "move", from: "src/price.ts" }] }));
    expect(await planIndex(root, CONFIG)).toMatchObject({ fresh: 1, moves: [], versions: [], created: [], removed: [] });
  });

  it("queues look-alikes instead of guessing, and writes nothing for them", async () => {
    const pair = TOTAL + TOTAL.replace("function total(", "function totalWithTax(");
    const root = await seeded({ "src/cart.ts": pair });
    await rm(join(root, "src/cart.ts"));
    await write(root, "src/sums.ts", pair.replace("function total(", "function sum(").replace("totalWithTax", "sumWithTax"));
    const plan = await planIndex(root, CONFIG, { rationale: "Move" });
    expect(plan.queued).toMatchObject([{ reason: "4 units share the same content", keys: ["src/sums.ts#sum", "src/sums.ts#sumWithTax"] }]);
    expect([plan.moves, plan.created, plan.removed]).toEqual([[], [], []]);
  });

  it("defaults the rationale to the commits since the base, and refuses to write without one", async () => {
    const root = await seeded({ "src/price.ts": PRICE });
    await write(root, "src/price.ts", PRICE.replace("100", "1000"));
    const none = await planIndex(root, CONFIG);
    expect(none.rationale).toBeUndefined();
    await expect(applyIndex(root, none, human)).rejects.toThrow("No rationale");

    runGit(root, "commit", "-q", "-am", "Use mills (#9)\n\nCo-Authored-By: Someone <x@example.com>");
    const fromCommits = await planIndex(root, CONFIG, { since: "HEAD~1" });
    expect(fromCommits.rationale).toBe("Use mills (#9)");
    expect(fromCommits.versions[0]!.version.links).toEqual([{ kind: "github-issue", ref: "#9" }]);
  });

  it("records React components with their props interface and renders deps when the config lists react", async () => {
    const config = { ...CONFIG, include: ["src/**/*.{ts,tsx}"], adapters: ["typescript", "react"] };
    const root = await seeded({});
    await write(root, "src/price.ts", "export function formatPrice(n: number) {\n  return n.toFixed(2);\n}\n");
    await write(root, "src/PriceTag.tsx", 'import { memo } from "react";\nimport { formatPrice } from "./price.ts";\nexport const PriceTag = memo(function PriceTag({ n, unit = "GBP" }: { n: number; unit?: string }) {\n  return <span>{formatPrice(n)} {unit}</span>;\n});\n');
    await write(root, "src/Page.tsx", 'import { PriceTag } from "./PriceTag.tsx";\nexport function Page() {\n  return <main><PriceTag n={1} /></main>;\n}\n');
    const plan = await planIndex(root, config, { rationale: "Add pages" });
    const made = new Map(plan.created.map((unit) => [unit.name, unit]));
    expect([...made.values()].map((u) => [u.name, u.kind, u.framework])).toEqual([
      ["Page", "component", "react"],
      ["PriceTag", "component", "react"],
      ["formatPrice", "function", "none"],
    ]);
    expect(Object.keys(made.get("Page")!.versions[0]!.deps ?? {})).toEqual([made.get("PriceTag")!.uid]);
  });

  it("reclassifies units an adapter now claims, without a rationale or a version", async () => {
    const plain = { ...CONFIG, include: ["src/**/*.{ts,tsx}"] };
    const root = await mkdtemp(join(tmpdir(), "poetics-index-reclassify-"));
    runGit(root, "init", "-q", "-b", "main");
    await write(root, "src/Page.tsx", "export function Page() {\n  return <main />;\n}\n");
    await write(root, "src/price.ts", PRICE);
    // Recorded before the React adapter: the component is a plain function.
    await applyIndex(root, await planIndex(root, plain, { rationale: "Seed" }), human);
    runGit(root, "add", "-A");
    runGit(root, "commit", "-q", "-m", "Seed");
    expect((await store(root)).get("Page")).toMatchObject({ kind: "function", framework: "none" });

    const react = { ...plain, adapters: ["typescript", "react"] };
    const plan = await planIndex(root, react);
    expect(plan.reclassified).toEqual([
      { uid: (await store(root)).get("Page")!.uid, key: "src/Page.tsx#Page", from: { kind: "function", framework: "none" }, to: { kind: "component", framework: "react" } },
    ]);
    expect(plan).toMatchObject({ fresh: 2, versions: [], moves: [], created: [], rationale: undefined });
    expect(formatIndexPlan(plan)).toContain("* src/Page.tsx#Page function (none) -> component (react)");
    expect(await applyIndex(root, plan, human)).toBe(1);
    const page = (await store(root)).get("Page")!;
    expect([page.kind, page.framework, page.versions.length]).toEqual(["component", "react", 1]);
    expect((await planIndex(root, react)).reclassified).toEqual([]);
  });
});
