import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTypeScriptIndexer } from "./indexer.ts";
import { makeProject, writeFiles } from "./test-helpers.ts";

const FILES = {
  "src/price.ts": `export function formatPrice(n: number) { return n.toFixed(2); }`,
  "src/cart.ts": `import { formatPrice } from "./price.ts";\nexport function total(ns: number[]) { return formatPrice(ns.length); }`,
  "src/other.ts": `export function other() { return 1; }`,
};

function setup() {
  const root = makeProject(FILES);
  const cacheFile = join(root, ".poetics/cache/typescript.json");
  const options = { root, files: Object.keys(FILES), cacheFile };
  return { root, cacheFile, options };
}

const byName = <T extends { name: string }>(units: T[]) => new Map(units.map((u) => [u.name, u]));

describe("createTypeScriptIndexer", () => {
  it("indexes every file in scope, in order, with hashes, lines and edges", () => {
    const { options } = setup();
    const result = createTypeScriptIndexer(options).index();
    expect(result.stats).toEqual({ cached: 0, indexed: 3 });
    expect(result.units.map((u) => u.key)).toEqual(["src/price.ts#formatPrice", "src/cart.ts#total", "src/other.ts#other"]);
    const total = result.units[1]!;
    expect(total).toMatchObject({ kind: "function", framework: "none", startLine: 2, endLine: 2, edges: [{ to: "src/price.ts#formatPrice", kind: "calls" }] });
    expect(total.contentHash).toMatch(/^b3:/);
    expect(total.runtimeHash).toMatch(/^b3:/);
    expect(total.interfaceHash).toMatch(/^b3:/);
  });

  it("answers unchanged files from the cache, across indexers, with identical units", () => {
    const { options } = setup();
    const first = createTypeScriptIndexer(options).index();
    const second = createTypeScriptIndexer(options).index();
    expect(second.stats).toEqual({ cached: 3, indexed: 0 });
    expect(second.units).toEqual(first.units);
  });

  it("re-indexes a changed file and every file that imports it, and nothing else", () => {
    const { root, options } = setup();
    const indexer = createTypeScriptIndexer(options);
    const before = byName(indexer.index().units);
    writeFiles(root, { "src/price.ts": `export function formatPrice(n: number) { return String(n); }` });
    const result = indexer.index();
    expect(result.stats).toEqual({ cached: 1, indexed: 2 });
    const after = byName(result.units);
    expect(after.get("formatPrice")!.contentHash).not.toBe(before.get("formatPrice")!.contentHash);
    // total's code did not change, so neither did its own hash.
    expect(after.get("total")!.contentHash).toBe(before.get("total")!.contentHash);
  });

  it("keeps the hashes when a file is only reformatted", () => {
    const { root, options } = setup();
    const indexer = createTypeScriptIndexer(options);
    const before = indexer.index().units[0]!;
    writeFiles(root, { "src/price.ts": `// Formats.\nexport function formatPrice(\n  n: number,\n) {\n  return n.toFixed(2)\n}\n` });
    const after = indexer.index().units[0]!;
    expect([after.contentHash, after.interfaceHash]).toEqual([before.contentHash, before.interfaceHash]);
    expect([after.startLine, after.endLine]).toEqual([2, 6]);
  });

  it("re-indexes a dependent when an inferred type it relies on changes", () => {
    const { root, options } = setup();
    const indexer = createTypeScriptIndexer(options);
    const before = byName(indexer.index().units).get("total")!;
    writeFiles(root, { "src/price.ts": `export function formatPrice(n: number) { return n; }` });
    const after = byName(indexer.index().units).get("total")!;
    expect(after.signature).toMatchObject({ overloads: [{ returns: { inferred: "number" } }] });
    expect(after.interfaceHash).not.toBe(before.interfaceHash);
  });

  it("indexes a narrower scope when given files, and drops the rest from the cache", () => {
    const { cacheFile, options } = setup();
    const result = createTypeScriptIndexer(options).index(["src/other.ts"]);
    expect(result.units.map((u) => u.name)).toEqual(["other"]);
    expect(Object.keys((JSON.parse(readFileSync(cacheFile, "utf8")) as { files: object }).files)).toEqual(["src/other.ts"]);
  });

  it("starts over when the cache is unreadable or the environment changed", () => {
    const { root, cacheFile, options } = setup();
    createTypeScriptIndexer(options).index();
    writeFileSync(cacheFile, "{ torn");
    expect(createTypeScriptIndexer(options).index().stats.indexed).toBe(3);
    writeFiles(root, { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    expect(createTypeScriptIndexer(options).index().stats.indexed).toBe(3);
    expect(createTypeScriptIndexer({ ...options, compilerOptions: { strict: false } }).index().stats.indexed).toBe(3);
  });

  it("starts over when a plugin's rules change version, and reuses the cache while they do not", () => {
    const { options } = setup();
    const plugin = (version?: number) => ({ framework: "react" as const, ...(version === undefined ? {} : { version }) });
    createTypeScriptIndexer({ ...options, plugins: [plugin()] }).index();
    expect(createTypeScriptIndexer({ ...options, plugins: [plugin()] }).index().stats.cached).toBe(3);
    expect(createTypeScriptIndexer({ ...options, plugins: [plugin(2)] }).index().stats.indexed).toBe(3);
    expect(createTypeScriptIndexer({ ...options, plugins: [plugin(2)] }).index().stats.cached).toBe(3);
  });

  it("reads compiler options from a tsconfig and reports one it cannot read", () => {
    const root = makeProject({ ...FILES, "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "nodenext", "allowImportingTsExtensions": true, "noEmit": true } }` });
    expect(createTypeScriptIndexer({ root, files: Object.keys(FILES), tsconfig: "tsconfig.json" }).index().units).toHaveLength(3);
    expect(() => createTypeScriptIndexer({ root, files: [], tsconfig: "missing.json" })).toThrow(/Cannot read missing\.json/);
  });

  it("gives no units for a file in scope that does not exist", () => {
    const { options } = setup();
    expect(createTypeScriptIndexer(options).index(["src/gone.ts"]).units).toEqual([]);
  });
});
