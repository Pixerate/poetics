import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import { createReactAdapter, isComponentName, isHookName, reactPlugin } from "./index.ts";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../evals/fixtures/react-app");
const FIXTURE_FILES = ["src/format-price.ts", "src/use-cart.ts", "src/PriceTag.tsx", "src/CheckoutPage.tsx"];

const byName = (units: IndexedUnit[]) => new Map(units.map((unit) => [unit.name, unit]));
const indexFixture = () => byName(createTypeScriptIndexer({ root: FIXTURE, files: FIXTURE_FILES, tsconfig: "tsconfig.json", plugins: [reactPlugin()] }).index().units);

/** A project with React's types from the fixture, and `files` written under its root. */
function project(files: Record<string, string>): Map<string, IndexedUnit> {
  const root = mkdtempSync(join(tmpdir(), "poetics-react-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  symlinkSync(join(FIXTURE, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true, module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, noEmit: true } }));
  return byName(createTypeScriptIndexer({ root, files: Object.keys(files), tsconfig: "tsconfig.json", plugins: [reactPlugin()] }).index().units);
}

describe("naming rules", () => {
  it("recognises hooks", () => {
    expect(isHookName("useCart")).toBe(true);
    expect(isHookName("use3D")).toBe(true);
    expect(isHookName("user")).toBe(false);
    expect(isHookName("use")).toBe(false);
  });

  it("recognises component-shaped names", () => {
    expect(isComponentName("PriceTag")).toBe(true);
    expect(isComponentName("priceTag")).toBe(false);
    expect(isComponentName("Price_Tag")).toBe(false);
  });
});

describe("reactPlugin on the React fixture", () => {
  it("claims components and hooks, and leaves utilities and types as plain TypeScript", () => {
    const units = indexFixture();
    expect([...units.values()].map((u) => [u.name, u.kind, u.framework])).toEqual([
      ["formatPrice", "function", "none"],
      ["CartLine", "type", "none"],
      ["useCart", "hook", "react"],
      ["PriceTagProps", "type", "none"],
      ["PriceTag", "component", "react"],
      ["CheckoutPage", "component", "react"],
    ]);
  });

  it("gives a memo component its props and default prop values as its interface", () => {
    const tag = indexFixture().get("PriceTag")!;
    expect(tag.signature).toEqual({
      kind: "component",
      props: { written: ["TypeReference", ["Identifier", "PriceTagProps"]] },
      defaults: [{ name: "currency", value: ["StringLiteral", "GBP"] }],
    });
    expect(tag.signatureText).toBe("export const PriceTag = memo(function PriceTag({ amountMinor, saleAmountMinor, currency = \"GBP\" }: PriceTagProps)");
  });

  it("records JSX tags as renders and hook calls as uses-hook", () => {
    const units = indexFixture();
    expect(units.get("CheckoutPage")!.edges).toEqual([
      { to: "src/PriceTag.tsx#PriceTag", kind: "renders" },
      { to: "src/use-cart.ts#useCart", kind: "uses-hook" },
    ]);
    expect(units.get("PriceTag")!.edges).toEqual([
      { to: "src/PriceTag.tsx#PriceTagProps", kind: "references-type" },
      { to: "src/format-price.ts#formatPrice", kind: "calls" },
    ]);
  });
});

describe("reactPlugin version", () => {
  it("is 3 since class components, so caches indexed with older rules are not reused", () => {
    expect(reactPlugin().version).toBe(3);
  });
});

describe("reactPlugin on other shapes", () => {
  it("sees through React.memo, forwardRef and lazy, and keeps a forwarded ref in the interface", () => {
    const units = project({
      "src/a.tsx": [
        `import * as React from "react";`,
        `import { forwardRef, lazy } from "react";`,
        `export const Card = React.memo(() => <div />);`,
        `export const Input = forwardRef<HTMLInputElement, { label: string }>(function Input({ label }, ref) { return <input ref={ref} aria-label={label} />; });`,
        `export const Lazy = lazy(() => import("./b.tsx"));`,
        `export function Helper() { return 42; }`,
        `export const Plain = (n: number) => n;`,
      ].join("\n"),
      "src/b.tsx": `export default function B() { return <p />; }`,
    });
    expect([...units.values()].map((u) => [u.name, u.kind, u.framework])).toEqual([
      ["Card", "component", "react"],
      ["Input", "component", "react"],
      ["Lazy", "component", "react"],
      // PascalCase but no JSX and no wrapper: a plain function.
      ["Helper", "function", "none"],
      ["Plain", "function", "none"],
      ["B", "component", "react"],
    ]);
    expect(units.get("Input")!.signature).toMatchObject({ kind: "component", props: { inferred: "{ label: string; }" }, ref: { inferred: "React.ForwardedRef<HTMLInputElement>" } });
    expect(units.get("Card")!.signature).toEqual({ kind: "component", props: null, defaults: [] });
  });

  it("claims PascalCase functions that render without JSX, from their types or what they return", () => {
    const units = project({
      "src/a.tsx": [
        `import * as React from "react";`,
        `import { cloneElement, createElement, type FC, type ReactElement, type ReactNode } from "react";`,
        `import { createPortal } from "react-dom";`,
        // A provider returning its children, as TanStack Query's HydrationBoundary does.
        `export const Boundary = ({ children }: { children: ReactNode }) => {`,
        `  const ready = React.useMemo(() => true, []);`,
        `  return ready ? (children as React.ReactElement) : null;`,
        `};`,
        `export function Slot({ children }: { children: ReactNode }): ReactNode { return children; }`,
        `export function Maybe(): JSX.Element | null { return null; }`,
        `export async function Page(): Promise<React.JSX.Element> { return null as never; }`,
        `export const Typed: FC<{ label: string }> = ({ label }) => label as never;`,
        `export const Memoed: React.FC = React.memo(() => null) as never;`,
        `export function Made() { return createElement("p"); }`,
        `export function Cloned({ child }: { child: ReactElement }) { return cloneElement(child); }`,
        `export function Portal({ children }: { children: ReactNode }) { return createPortal(children, document.body); }`,
        `export const Satisfied = () => (null satisfies ReactNode);`,
      ].join("\n"),
    });
    for (const name of ["Boundary", "Slot", "Maybe", "Page", "Typed", "Memoed", "Made", "Cloned", "Portal", "Satisfied"]) {
      expect([name, units.get(name)?.kind, units.get(name)?.framework]).toEqual([name, "component", "react"]);
    }
  });

  it("leaves PascalCase functions that only render in nested functions, or return other types, as plain functions", () => {
    const units = project({
      "src/a.ts": [
        `import { createElement, type ReactElement } from "react";`,
        `export function Factory() { return () => createElement("p"); }`,
        `export function Lookup(): Map<string, number> { return new Map(); }`,
        `export const Cast = (value: unknown) => value as string;`,
        `export function Builder() { const make = (): ReactElement => createElement("p"); return { make }; }`,
      ].join("\n"),
    });
    expect([...units.values()].map((u) => [u.name, u.kind])).toEqual([
      ["Factory", "function"],
      ["Lookup", "function"],
      ["Cast", "function"],
      ["Builder", "function"],
    ]);
  });

  it("claims classes that extend Component or PureComponent, and leaves other classes out", () => {
    const units = project({
      "src/a.tsx": [
        `import * as React from "react";`,
        `import { Component, PureComponent } from "react";`,
        `import { PriceTag } from "./b.tsx";`,
        `type CounterProps = { start: number; label?: string };`,
        `/** Counts clicks. */`,
        `export class Counter extends Component<CounterProps, { n: number }> {`,
        `  static defaultProps = { label: "Clicks" };`,
        `  state = { n: this.props.start };`,
        `  render() { return <button onClick={() => this.setState({ n: this.state.n + 1 })}><PriceTag amount={this.state.n} /></button>; }`,
        `}`,
        `export class Banner extends React.PureComponent { render() { return null; } }`,
        `export default class extends React.Component<{ id: string }> { render() { return <p>{this.props.id}</p>; } }`,
        `export class Store { items: string[] = []; }`,
        `export class Fancy extends Error {}`,
      ].join("\n"),
      "src/b.tsx": `export function PriceTag({ amount }: { amount: number }) { return <b>{amount}</b>; }`,
    });
    expect([...units.values()].map((u) => [u.name, u.kind, u.framework, u.exportedAs])).toEqual([
      ["Counter", "component", "react", undefined],
      ["Banner", "component", "react", undefined],
      ["default", "component", "react", undefined],
      ["PriceTag", "component", "react", undefined],
    ]);
    const counter = units.get("Counter")!;
    expect(counter.docs).toBe("Counts clicks.");
    expect(counter.signature).toEqual({
      kind: "component",
      props: { written: ["TypeReference", ["Identifier", "CounterProps"]] },
      defaults: [{ name: "label", value: ["StringLiteral", "Clicks"] }],
    });
    expect(counter.signatureText).toBe("export class Counter extends Component<CounterProps, { n: number }>");
    expect(counter.edges).toEqual([{ to: "src/b.tsx#PriceTag", kind: "renders" }]);
    expect(units.get("Banner")!.signature).toEqual({ kind: "component", props: null, defaults: [] });
  });

  it("changes a class component's interface hash with its props or defaults, not with its state or render", () => {
    const hash = (props: string, fallback: string, render: string) =>
      project({ "src/a.tsx": `import { Component } from "react";\nexport class Badge extends Component<${props}, { open: boolean }> {\n  static defaultProps = { tone: "${fallback}" };\n  render() { return <b>${render}</b>; }\n}` }).get("Badge")!.interfaceHash;
    const base = hash("{ tone?: string }", "info", "a");
    expect(hash("{ tone?: string }", "info", "b")).toBe(base);
    expect(hash("{ tone?: string }", "warn", "a")).not.toBe(base);
    expect(hash("{ tone?: string; size?: number }", "info", "a")).not.toBe(base);
  });

  it("changes the interface hash with a default prop value, not with the body", () => {
    const hash = (fallback: string, text: string) =>
      project({ "src/a.tsx": `export function Badge({ tone = "${fallback}" }: { tone?: string }) { return <b>${text}</b>; }` }).get("Badge")!.interfaceHash;
    const base = hash("info", "a");
    expect(hash("info", "b")).toBe(base);
    expect(hash("warn", "a")).not.toBe(base);
  });
});

describe("createReactAdapter", () => {
  it("answers the adapter's questions for React code", () => {
    const adapter = createReactAdapter({ root: FIXTURE, files: FIXTURE_FILES, tsconfig: "tsconfig.json" });
    expect([adapter.framework, adapter.extensions]).toEqual(["react", [".ts", ".tsx"]]);
    const [page] = adapter.detectUnits("src/CheckoutPage.tsx");
    expect(page).toMatchObject({ name: "CheckoutPage", kind: "component", framework: "react" });
    expect(adapter.edgesOf(page!).edges.map((edge) => edge.kind)).toEqual(["renders", "uses-hook"]);
  });
});
