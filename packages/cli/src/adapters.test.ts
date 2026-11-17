import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptersFor, indexWith, readTextsWith, readsAny } from "./adapters.ts";
import type { AdaptedUnit, CodeAdapter, TextUnit } from "./adapters.ts";
import { write } from "./test-helpers.ts";

const PRICE = "/** Formats a price. */\nexport function formatPrice(n: number): string {\n  return n.toFixed(2);\n}\n\nexport interface Price {\n  amount: number;\n}\n";
const TAX = 'import { formatPrice } from "./price.ts";\n\nexport function withTax(n: number): string {\n  return formatPrice(n * 1.2);\n}\n';

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-adapters-"));
  await write(root, "src/price.ts", PRICE);
  await write(root, "src/tax.ts", TAX);
  return root;
}

/** An adapter that claims files by extension and records what it was asked for. */
function fake(name: string, extension: string, asked: string[][]): CodeAdapter {
  const unit = (file: string): TextUnit => ({
    key: `${file}#${name}`,
    name,
    kind: "function",
    framework: "none",
    span: { file, start: 0, end: 1 },
    startLine: 1,
    endLine: 1,
    contentHash: `b3:${"1".repeat(64)}`,
    fingerprint: [],
    signatureText: name,
  });
  return {
    name,
    reads: (file) => file.endsWith(extension),
    index(files) {
      asked.push([...files]);
      return files.map((file): AdaptedUnit => ({ ...unit(file), interfaceHash: `b3:${"2".repeat(64)}`, edges: [], unresolved: [] }));
    },
    readTexts(files) {
      asked.push(files.map((file) => file.path));
      return new Map(files.map((file) => [file.path, [unit(file.path)]]));
    },
  };
}

describe("adaptersFor", () => {
  it("gives the TypeScript adapter, reading TypeScript but not declaration files, and .svelte only with svelte", () => {
    const [ts] = adaptersFor("/r", { adapters: ["typescript"] });
    expect(ts!.name).toBe("typescript");
    expect(["a.ts", "a.tsx", "a.mts", "a.d.ts", "a.svelte", "a.swift"].filter((file) => ts!.reads(file))).toEqual(["a.ts", "a.tsx", "a.mts"]);
    expect(adaptersFor("/r", { adapters: ["typescript", "svelte"] })[0]!.reads("a.svelte")).toBe(true);
  });
});

describe("indexWith and readTextsWith", () => {
  it("give each adapter only the files it reads, and leave out files none reads", () => {
    const asked: string[][] = [];
    const adapters = [fake("one", ".a", asked), fake("two", ".b", asked)];
    const files = ["x.a", "y.b", "z.c", "w.a"];
    expect(indexWith(adapters, files).map((unit) => unit.key)).toEqual(["x.a#one", "w.a#one", "y.b#two"]);
    expect(asked).toEqual([["x.a", "w.a"], ["y.b"]]);
    asked.length = 0;
    const read = readTextsWith(adapters, files.map((path) => ({ path, text: "" })));
    expect([...read.keys()].sort()).toEqual(["w.a", "x.a", "y.b"]);
    expect(asked).toEqual([["x.a", "w.a"], ["y.b"]]);
    expect(readsAny(adapters, "z.c")).toBe(false);
  });

  it("skips an adapter that reads none of the files", () => {
    const asked: string[][] = [];
    expect(indexWith([fake("one", ".a", asked)], ["z.c"])).toEqual([]);
    expect(readTextsWith([fake("one", ".a", asked)], [{ path: "z.c", text: "" }]).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it("reads the same units from text as from the program on disk, with no edges or interface hash", async () => {
    const root = await repo();
    const adapters = adaptersFor(root, { adapters: ["typescript"] });
    const indexed = indexWith(adapters, ["src/price.ts", "src/tax.ts"]);
    expect(indexed.find((unit) => unit.name === "withTax")!.edges).toEqual([{ to: "src/price.ts#formatPrice", kind: "calls" }]);
    const files = await Promise.all(["src/price.ts", "src/tax.ts"].map(async (path) => ({ path, text: await readFile(join(root, path), "utf8") })));
    const read = [...readTextsWith(adapters, files).values()].flat();
    const shape = (unit: TextUnit) => ({
      key: unit.key,
      name: unit.name,
      kind: unit.kind,
      framework: unit.framework,
      span: unit.span,
      startLine: unit.startLine,
      endLine: unit.endLine,
      docs: unit.docs,
      contentHash: unit.contentHash,
      runtimeHash: unit.runtimeHash,
      fingerprint: unit.fingerprint,
      signatureText: unit.signatureText,
    });
    expect(read.map(shape)).toEqual(indexed.map(shape));
    expect(read[0]!.docs).toBe("Formats a price.");
    expect(read.every((unit) => !("edges" in unit) && !("interfaceHash" in unit))).toBe(true);
  });
});
