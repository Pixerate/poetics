import ts from "typescript";
import { describe, expect, it } from "vitest";
import { contentHash, interfaceHash } from "@poetics/core";
import { contentTree, detectUnits, edgesOf, signatureOf, signatureText } from "./units.ts";
import type { DetectedUnit } from "./units.ts";
import { createTypeScriptIndexer } from "./indexer.ts";
import { makeProject } from "./test-helpers.ts";

const detect = (code: string, file = "src/a.ts") => detectUnits(ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true), file);

/** Indexes one or more files and returns their units by name. */
function indexed(files: Record<string, string>) {
  const root = makeProject(files);
  const { units } = createTypeScriptIndexer({ root, files: Object.keys(files) }).index();
  return new Map(units.map((unit) => [unit.key.split("#")[1]!, unit]));
}

describe("detectUnits", () => {
  it("finds exported functions, hooks and types in every export form", () => {
    const units = detect(`
      export function formatPrice(n: number) { return n; }
      export const useCart = () => ({});
      export const round = (function (n: number) { return n; }) satisfies (n: number) => number;
      export default function () {}
      function local() {}
      const renamed = () => 1;
      export { local, renamed as alias };
      export interface Price { n: number }
      export type Cents = number;
      type Hidden = string;
      export const NOT_A_FUNCTION = 1;
    `);
    expect(units.map((u) => [u.name, u.kind, u.exportedAs])).toEqual([
      ["formatPrice", "function", undefined],
      ["useCart", "hook", undefined],
      ["round", "function", undefined],
      ["default", "function", undefined],
      ["local", "function", undefined],
      ["renamed", "function", "alias"],
      ["Price", "type", undefined],
      ["Cents", "type", undefined],
    ]);
    expect(units.map((u) => u.key)).toContain("src/a.ts#formatPrice");
  });

  it("tracks an exported class only when a plugin claims it", () => {
    const code = `export class Store { items: string[] = []; }\nclass Hidden {}\nexport { Hidden };\nexport class Widget extends Base { render() { return 1; } }`;
    expect(detect(code)).toEqual([]);
    const claimsWidgets = { framework: "react" as const, claim: (unit: { name: string }) => (unit.name === "Widget" ? ("component" as const) : undefined) };
    const units = detectUnits(ts.createSourceFile("src/a.ts", code, ts.ScriptTarget.Latest, true), "src/a.ts", [claimsWidgets]);
    expect(units.map((u) => [u.name, u.kind, u.framework, ts.isClassDeclaration(u.declarations[0]!)])).toEqual([["Widget", "component", "react", true]]);
  });

  it("tracks an exported variable that holds no function only when a plugin's value hook names its kind", () => {
    const code = `export const Ctx = makeContext(0);\nexport const LIMIT = 10;\nconst Hidden = makeContext(1);`;
    expect(detect(code)).toEqual([]);
    const contexts = { framework: "react" as const, value: (d: ts.VariableDeclaration) => (d.initializer?.getText().startsWith("makeContext") ? ("context" as const) : undefined), claim: () => "component" as const };
    const units = detectUnits(ts.createSourceFile("src/a.ts", code, ts.ScriptTarget.Latest, true), "src/a.ts", [contexts]);
    // claim is not asked again: a value keeps the kind its value hook gave.
    expect(units.map((u) => [u.name, u.kind, u.framework])).toEqual([["Ctx", "context", "react"]]);
  });

  it("names a default export after its declaration", () => {
    expect(detect(`export default function main() {}`).map((u) => [u.name, u.exportedAs])).toEqual([["main", "default"]]);
    expect(detect(`function main() {}\nexport default main;`).map((u) => [u.name, u.exportedAs])).toEqual([["main", "default"]]);
  });

  it("joins overloads and merged interfaces into one unit spanning them all", () => {
    const code = `export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: any) { return a; }\nexport interface I { a: 1 }\nexport interface I { b: 2 }`;
    const [f, i] = detect(code);
    expect(f!.declarations).toHaveLength(3);
    expect(code.slice(f!.span.start, f!.span.end)).toMatch(/^export function f\(a: string\)[\s\S]*return a; }$/);
    expect(i!.declarations).toHaveLength(2);
  });

  it("keeps a type and a function of the same name apart", () => {
    expect(detect(`export type Io = { a: 1 };\nexport function Io() {}`).map((u) => u.key)).toEqual(["src/a.ts#Io:type", "src/a.ts#Io"]);
  });

  it("reads the leading TSDoc and leaves line comments out", () => {
    expect(detect(`/** Formats a price. */\nexport function f() {}`)[0]!.docs).toBe("Formats a price.");
    expect(detect(`/** Rounds. */\nexport const r = () => 1;`)[0]!.docs).toBe("Rounds.");
    expect(detect(`// not docs\nexport function f() {}`)[0]!.docs).toBeUndefined();
  });

  it("starts the span at the declaration, after its docs", () => {
    const code = `/** Docs. */\nexport function f() {}`;
    const [f] = detect(code);
    expect(code.slice(f!.span.start, f!.span.end)).toBe("export function f() {}");
  });
});

describe("contentTree", () => {
  const hash = (code: string, erase = false) => contentHash(contentTree(detect(code)[0]!, erase));

  it("is the same across a rename, a reformat and a change of export style", () => {
    expect(hash(`export function f(a: number) { return a * 2; }`)).toBe(hash(`function g(a: number) {\n  return a * 2\n}\nexport { g };`));
  });

  it("separates types-only changes from runtime ones", () => {
    const base = `export function f(a: number) { return a * 2; }`;
    const typed = `export function f(a: string) { return a * 2; }`;
    const changed = `export function f(a: number) { return a * 3; }`;
    expect(hash(base)).not.toBe(hash(typed));
    expect(hash(base, true)).toBe(hash(typed, true));
    expect(hash(base, true)).not.toBe(hash(changed, true));
  });

  it("tells const from let for arrow functions", () => {
    expect(hash(`export const f = () => 1;`)).not.toBe(hash(`export let f = () => 1;`));
  });
});

describe("signatureOf", () => {
  const sig = (code: string) => {
    const units = indexed({ "src/a.ts": code });
    return [...units.values()][0]!;
  };

  it("changes with parameter and return types, defaults and optionality, not with bodies or names", () => {
    const base = sig(`export function f(a: number, b = 1): string { return String(a + b); }`).interfaceHash;
    expect(sig(`export function f(x: number, y = 1): string { return "" + (x - y); }`).interfaceHash).toBe(base);
    expect(sig(`export function f(a: string, b = 1): string { return a; }`).interfaceHash).not.toBe(base);
    expect(sig(`export function f(a: number, b = 2): string { return ""; }`).interfaceHash).not.toBe(base);
    expect(sig(`export function f(a: number, b = 1): number { return 1; }`).interfaceHash).not.toBe(base);
    expect(sig(`export function f(a?: number, b = 1): string { return ""; }`).interfaceHash).not.toBe(base);
  });

  it("infers types the author left out", () => {
    const unit = sig(`export const f = (a = 1) => ({ total: a });`);
    expect(unit.signature).toMatchObject({
      kind: "function",
      overloads: [{ parameters: [{ optional: true, type: { inferred: "number" } }], returns: { inferred: "{ total: number; }" } }],
    });
  });

  it("uses only the overloads callers can see", () => {
    const unit = sig(`export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: any) { return a; }`);
    expect(unit.signature.kind === "function" && unit.signature.overloads).toHaveLength(2);
  });

  it("is the type's structure for types", () => {
    const a = sig(`export interface P { a: number }`).interfaceHash;
    expect(sig(`export interface P {\n  a: number;\n}`).interfaceHash).toBe(a);
    expect(sig(`export interface P { a: string }`).interfaceHash).not.toBe(a);
  });

  it("matches the core hash of the signature", () => {
    const root = makeProject({ "src/a.ts": `export function f(a: number) { return a; }` });
    const program = ts.createProgram({ rootNames: [`${root}/src/a.ts`], options: { strict: true } });
    const source = program.getSourceFile(`${root}/src/a.ts`)!;
    const [unit] = detectUnits(source, "src/a.ts");
    const unitIndexed = createTypeScriptIndexer({ root, files: ["src/a.ts"] }).index().units[0]!;
    expect(unitIndexed.interfaceHash).toBe(interfaceHash(signatureOf(unit!, program.getTypeChecker())));
  });
});

describe("signatureText", () => {
  const text = (code: string) => {
    const source = ts.createSourceFile("src/a.ts", code, ts.ScriptTarget.Latest, true);
    return detectUnits(source, "src/a.ts").map((unit) => signatureText(unit, source));
  };

  it("is each declaration up to its body, as written, without docs", () => {
    expect(
      text(`/** Docs. */\nexport function f(a: number, b = { x: 1 }): string {\n  return "";\n}\nexport const g = async (n: number): Promise<void> => {};\nexport const h = (n: number) => n * 2;`),
    ).toEqual(["export function f(a: number, b = { x: 1 }): string", "export const g = async (n: number): Promise<void> =>", "export const h = (n: number) =>"]);
  });

  it("is the whole declaration for types, and only the overloads for an overloaded function", () => {
    expect(text(`export interface P {\n  a: number;\n}\nexport type Q = P | null;`)).toEqual(["export interface P {\n  a: number;\n}", "export type Q = P | null;"]);
    expect(text(`export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: any) { return a; }`)).toEqual([
      "export function f(a: string): string;\nexport function f(a: number): number;",
    ]);
  });
});

describe("edgesOf", () => {
  it("resolves calls, hooks and types across files, through aliases, re-exports and shorthand", () => {
    const units = indexed({
      "src/price.ts": `export interface Price { cents: number }\nexport function formatPrice(p: Price) { return String(p.cents); }`,
      "src/index.ts": `export { formatPrice as format } from "./price.ts";\nexport type { Price } from "./price.ts";`,
      "src/cart.ts": [
        `import { format, type Price } from "./index.ts";`,
        `import * as price from "./price.ts";`,
        `export function useCart(items: Price[]) { return items.map(format); }`,
        `export function total(items: Price[]) { const { cart } = { cart: useCart(items) }; return { cart, again: price.formatPrice(items[0]!), formatPrice: format }; }`,
        `export function sized(): typeof total { return total; }`,
        `export function handlers() { return { format }; }`,
      ].join("\n"),
    });
    expect(units.get("useCart")!.edges).toEqual([
      { to: "src/price.ts#Price", kind: "references-type" },
      { to: "src/price.ts#formatPrice", kind: "calls" },
    ]);
    expect(units.get("total")!.edges).toEqual([
      { to: "src/cart.ts#useCart", kind: "uses-hook" },
      { to: "src/price.ts#Price", kind: "references-type" },
      { to: "src/price.ts#formatPrice", kind: "calls" },
    ]);
    expect(units.get("sized")!.edges).toEqual([
      { to: "src/cart.ts#total", kind: "calls" },
      { to: "src/cart.ts#total", kind: "references-type" },
    ]);
    expect(units.get("handlers")!.edges).toEqual([{ to: "src/price.ts#formatPrice", kind: "calls" }]);
    expect(units.get("Price")!.edges).toEqual([]);
  });

  it("counts what a private helper in the same file uses as used by its caller", () => {
    const units = indexed({
      "src/price.ts": `export function formatPrice(n: number) { return String(n); }`,
      "src/cart.ts": [
        `import { formatPrice } from "./price.ts";`,
        `function render(n: number) { return wrap(formatPrice(n)); }`,
        `const wrap = (s: string) => \`[\${s}]\`;`,
        `function loop(): number { return loop(); }`,
        `export function total(n: number) { return render(n) + loop(); }`,
      ].join("\n"),
    });
    expect(units.get("total")!.edges).toEqual([{ to: "src/price.ts#formatPrice", kind: "calls" }]);
  });

  it("does not count recursion or untracked declarations as edges", () => {
    const units = indexed({ "src/a.ts": `const helper = 1;\nexport function f(n: number): number { return n ? f(n - helper) : Math.max(0, n); }` });
    expect(units.get("f")!.edges).toEqual([]);
  });

  it("stops at a unit declared inside the one it walks, and counts only uses of it, not its declaration (#72)", () => {
    const code = [
      `export function helper() {}`,
      `export function other() {}`,
      `export function outer() {`,
      `  function inner() { helper(); }`,
      `  function unused() { other(); }`,
      `  return inner;`,
      `}`,
    ].join("\n");
    const root = makeProject({ "src/a.ts": code });
    const program = ts.createProgram({ rootNames: [`${root}/src/a.ts`], options: { strict: true, noEmit: true } });
    const source = program.getSourceFile(`${root}/src/a.ts`)!;
    const checker = program.getTypeChecker();
    const top = detectUnits(source, "src/a.ts");
    const body = (top.find((u) => u.name === "outer")!.declarations[0] as ts.FunctionDeclaration).body!.statements;
    // As a framework plugin such as Svelte's declares them: units owned by the function they sit in.
    const nested = body.filter(ts.isFunctionDeclaration).map((fn): DetectedUnit => ({ key: `src/a.ts#${fn.name!.text}`, name: fn.name!.text, kind: "function", span: { file: "src/a.ts", start: fn.pos, end: fn.end }, declarations: [fn], framework: "none", owner: "src/a.ts#outer" }));
    const units = [...top, ...nested];
    const unitAt = (declaration: ts.Declaration) => units.find((u) => (u.declarations as ts.Declaration[]).includes(declaration));
    const edges = (name: string) => edgesOf(units.find((u) => u.name === name)!, checker, unitAt).edges;
    expect(edges("outer")).toEqual([{ to: "src/a.ts#inner", kind: "calls" }]);
    expect(edges("inner")).toEqual([{ to: "src/a.ts#helper", kind: "calls" }]);
    expect(edges("unused")).toEqual([{ to: "src/a.ts#other", kind: "calls" }]);
  });

  it("records calls that resolve to nothing as unresolved, with their span", () => {
    const code = `export function f() { return missing(1); }`;
    const units = indexed({ "src/a.ts": code });
    const [use] = units.get("f")!.unresolved;
    expect(use).toMatchObject({ kind: "calls", reason: "missing does not resolve to a declaration" });
    expect(code.slice(use!.span.start, use!.span.end)).toBe("missing(1)");
  });
});
