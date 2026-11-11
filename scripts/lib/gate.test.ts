import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFACTORS, formatResults, prepareWorkspace, refactorsFor, runGate, seededRandom } from "./gate.ts";
import type { CorpusEntry } from "./gate.ts";

// Distinct statement shapes, so no two functions look alike and nothing is queued.
const SHAPES = [
  (v: string) => `const ${v} = [input, input + 1].map((x) => x * 2);`,
  (v: string) => `if (input > 10) { console.log("${v}", input); }`,
  (v: string) => `let ${v} = 0;\n  for (let i = 0; i < input; i++) ${v} += i;`,
  (v: string) => `const ${v} = { total: input, label: String(input) };`,
  (v: string) => `try { JSON.parse("${v}"); } catch { input -= 1; }`,
  (v: string) => `const ${v} = new Map<string, number>([["a", input]]);`,
  (v: string) => `while (input % 3 !== 0) input++;`,
  (v: string) => `const ${v} = input ? Math.max(input, 4) : Math.min(input, -4);`,
  (v: string) => `switch (input) { case 1: input = 2; break; default: input = 3; }`,
  (v: string) => `const ${v} = \`\${input}-\${input * 7}\`.split("-");`,
  (v: string) => `for (const key of Object.keys({ input })) console.info(key, "${v}");`,
  (v: string) => `const ${v} = Array.from({ length: input }, (_, i) => i ** 2).reduce((a, b) => a + b, 0);`,
];
let made = 0;
const fn = (name: string) => {
  const start = made++;
  const lines = Array.from({ length: 6 }, (_, i) => `  ${SHAPES[(start * 5 + i * 7) % SHAPES.length]!(`${name.slice(7, 10).toLowerCase()}${i}`)}`);
  return `export function ${name}(input: number): number {\n${lines.join("\n")}\n  return input;\n}\n`;
};

/** A small corpus with enough block-bodied functions, several per file, for every refactor. */
async function corpus(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-gate-src-"));
  const files: Record<string, string> = {
    "src/alpha.ts": fn("computeAlpha") + fn("computeBravo") + fn("computeCharlie"),
    "src/delta.ts": fn("computeDelta") + fn("computeEcho") + fn("computeFoxtrot"),
    "src/golf.ts": fn("computeGolf") + fn("computeHotel") + fn("computeIndia"),
    "src/juliet.ts": fn("computeJuliet") + fn("computeKilo") + fn("computeLima"),
    "src/view.svelte": "<p>not indexed</p>\n",
    "test/ignored.ts": fn("ignored"),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

// runGate indexes a real git workspace once per round: about 3s alone, past Vitest's 5s default when the full suite runs in parallel.
const GATE_TIMEOUT_MS = 30_000;

const ENTRY: CorpusEntry = { name: "synthetic", kind: "mixed", repo: "example/synthetic", commit: "0".repeat(40), include: ["src/**/*.{ts,svelte}"], exclude: [] };

describe("seededRandom", () => {
  it("repeats for a seed and differs between seeds", () => {
    const a = seededRandom(26);
    const b = seededRandom(26);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seededRandom(27)()).not.toBe(first[0]);
  });
});

describe("prepareWorkspace", () => {
  it("copies only the files in scope into a fresh git repository with a matching config", async () => {
    const { root, config, notIndexed } = await prepareWorkspace(await corpus(), ENTRY);
    expect(config).toEqual({ include: ENTRY.include, exclude: [], adapters: ["typescript"] });
    expect(notIndexed).toBe(1);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(join(root, "src"))).sort()).toEqual(["alpha.ts", "delta.ts", "golf.ts", "juliet.ts", "view.svelte"]);
    expect((await readdir(root)).includes("test")).toBe(false);
  });
});

describe("runGate", () => {
  it("applies every refactor and keeps every uid on code with room to match", async () => {
    const result = await runGate(ENTRY, await corpus(), { rounds: 2, seed: 26 });
    expect(result.units).toBe(12);
    expect(result.files).toEqual({ indexed: 4, notIndexed: 1 });
    expect(Object.keys(result.byKind)).toEqual(REFACTORS.filter((kind) => kind !== "wrap" && kind !== "rename-file"));
    for (const kind of refactorsFor({})) expect(result.byKind[kind]!.refactors + result.byKind[kind]!.skipped).toBe(2);
    const missed = Object.values(result.byKind).reduce((n, k) => n + k.lost + k.misplaced + k.queued, 0);
    expect(result.failures).toEqual([]);
    expect(missed).toBe(0);
    expect(result.byKind.split!.kept).toBe(2 * result.byKind.split!.refactors);
    expect(result.adapters).toEqual(["typescript"]);
    expect(result.unitKinds).toEqual({ function: 12 });
    expect(result.timings.indexMs).toHaveLength(2);
  }, GATE_TIMEOUT_MS);
});

/** A React corpus: components with block bodies, which only the React adapter claims. */
async function reactCorpus(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-gate-react-"));
  const component = (name: string, tag: string) =>
    `export function ${name}(props: { label: string; count: number }) {\n  const text = \`\${props.label}: \${props.count}\`;\n  if (props.count > ${name.length}) console.info("${name}");\n  return <${tag} className="${name.toLowerCase()}">{text}</${tag}>;\n}\n`;
  const files: Record<string, string> = {
    "src/cards.tsx": component("AlphaCard", "section") + component("BravoCard", "article") + component("CharlieCard", "aside"),
    "src/lists.tsx": component("DeltaList", "ul") + component("EchoList", "ol") + component("FoxtrotList", "menu"),
    "src/panels.tsx": component("GolfPanel", "div") + component("HotelPanel", "main") + component("IndiaPanel", "nav"),
    "src/rows.tsx": component("JulietRow", "tr") + component("KiloRow", "td") + component("LimaRow", "th"),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

const REACT_ENTRY: CorpusEntry = { name: "react", kind: "react", repo: "example/react", commit: "0".repeat(40), include: ["src/**/*.tsx"], exclude: [], adapters: ["typescript", "react"] };

describe("refactorsFor", () => {
  it("measures wraps only with the React adapter, and file renames only with the Svelte adapter", () => {
    expect(refactorsFor({ adapters: ["typescript"] })).not.toContain("wrap");
    expect(refactorsFor({})).not.toContain("wrap");
    expect(refactorsFor({ adapters: ["typescript", "react"] })).toEqual(REFACTORS.filter((kind) => kind !== "rename-file"));
    expect(refactorsFor({ adapters: ["typescript", "svelte"] })).toEqual(REFACTORS.filter((kind) => kind !== "wrap"));
    expect(refactorsFor({ adapters: ["typescript", "react", "svelte"] })).toEqual(REFACTORS);
  });
});

describe("runGate with the React adapter", () => {
  it("records components as components and keeps a component's uid when it is wrapped in memo", async () => {
    const result = await runGate(REACT_ENTRY, await reactCorpus(), { rounds: 2, seed: 26 });
    expect(result.adapters).toEqual(["typescript", "react"]);
    expect(result.unitKinds).toEqual({ component: 12 });
    expect(result.byKind.wrap!.refactors).toBeGreaterThan(0);
    expect(result.byKind.wrap!.kept).toBe(result.byKind.wrap!.refactors);
    expect(result.byUnitKind["component"]!.touched).toBeGreaterThan(0);
  }, GATE_TIMEOUT_MS);

  it("runs without React when adapters are overridden", async () => {
    const result = await runGate(REACT_ENTRY, await reactCorpus(), { rounds: 1, seed: 26, adapters: ["typescript"] });
    expect(result.adapters).toEqual(["typescript"]);
    expect(result.unitKinds).toEqual({ function: 12 });
    expect(result.byKind.wrap).toBeUndefined();
  }, GATE_TIMEOUT_MS);
});

/** A Svelte corpus: components with functions in their scripts, beside TypeScript the refactors can edit. */
async function svelteCorpus(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-gate-svelte-"));
  const component = (name: string, tag: string) =>
    `<script lang="ts">\n  let { label }: { label: string } = $props();\n  let count = $state(${name.length});\n  function bump${name}(by: number) {\n    count += by * ${name.length};\n    if (count > 100) console.info("${name}", count);\n  }\n</script>\n\n<${tag} class="${name.toLowerCase()}">\n  <button onclick={() => bump${name}(1)}>{label}: {count}</button>\n</${tag}>\n`;
  const files: Record<string, string> = {
    "src/AlphaCard.svelte": component("AlphaCard", "section"),
    "src/BravoList.svelte": component("BravoList", "article"),
    "src/CharliePanel.svelte": component("CharliePanel", "aside"),
    "src/DeltaRow.svelte": component("DeltaRow", "div"),
    "src/alpha.ts": fn("computeAlpha") + fn("computeBravo") + fn("computeCharlie"),
    "src/delta.ts": fn("computeDelta") + fn("computeEcho") + fn("computeFoxtrot"),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

const SVELTE_ENTRY: CorpusEntry = { name: "svelte", kind: "svelte", repo: "example/svelte", commit: "0".repeat(40), include: ["src/**/*.{ts,svelte}"], exclude: [], adapters: ["typescript", "svelte"] };

describe("runGate with the Svelte adapter (#66)", () => {
  it("indexes .svelte files and keeps components' uids, and their script functions', through renames and moves", async () => {
    const result = await runGate(SVELTE_ENTRY, await svelteCorpus(), { rounds: 3, seed: 26 });
    expect(result.files).toEqual({ indexed: 6, notIndexed: 0 });
    expect(result.unitKinds).toEqual({ component: 4, function: 10 });
    expect(result.byKind["rename-file"]!.refactors).toBeGreaterThan(0);
    expect(result.byKind["rename-file"]!.kept).toBe(result.byKind["rename-file"]!.refactors);
    expect(result.failures).toEqual([]);
    expect(result.spuriousCreated).toBe(0);
    expect(result.byUnitKind["component"]!.kept).toBe(result.byUnitKind["component"]!.touched);
  }, GATE_TIMEOUT_MS);
});

describe("formatResults", () => {
  it("renders a table per corpus with totals and misses", async () => {
    const result = await runGate(ENTRY, await corpus(), { rounds: 1, seed: 1 });
    result.failures.push("round 1 rename: X removed, should be at src/a.ts#y");
    const text = formatResults([result], { date: "2026-11-04", rounds: 1, seed: 1 });
    expect(text).toMatch(/^# Gate results\n/);
    expect(text).toContain("adapters typescript:");
    expect(text).toContain("units (12 function)");
    expect(text).not.toContain("| wrap |");
    expect(text).toContain("## synthetic (mixed)");
    expect(text).toContain("| rename | ");
    expect(text).toMatch(/Uids kept: \*\*\d+ of \d+\*\*/);
    expect(text).toContain("- round 1 rename: X removed");
  }, GATE_TIMEOUT_MS);
});
