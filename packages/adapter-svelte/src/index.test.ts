import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import ts from "typescript";
import { componentDocs, componentNameFromFile, componentSignatureText, createsRuneState, detectSvelteMajor, svelteContent, svelteFileKind, sveltePlugin, transformComponent } from "./index.ts";

describe("svelteFileKind", () => {
  it("separates components from rune modules", () => {
    expect(svelteFileKind("src/lib/PriceTag.svelte")).toBe("component");
    expect(svelteFileKind("src/lib/cart.svelte.ts")).toBe("rune-module");
    expect(svelteFileKind("src/lib/cart.svelte.js")).toBe("rune-module");
    expect(svelteFileKind("src/lib/cart.ts")).toBeUndefined();
  });
});

describe("componentNameFromFile", () => {
  it("uses the basename on either separator", () => {
    expect(componentNameFromFile("src/lib/PriceTag.svelte")).toBe("PriceTag");
    expect(componentNameFromFile("src\\lib\\Cart.svelte")).toBe("Cart");
  });
});

describe("detectSvelteMajor", () => {
  it("spots Svelte 5 runes and Svelte 4 props", () => {
    expect(detectSvelteMajor("let { price } = $props();")).toBe(5);
    expect(detectSvelteMajor("export let price;")).toBe(4);
    expect(detectSvelteMajor("const dispatch = createEventDispatcher();")).toBe(4);
    expect(detectSvelteMajor("<p>static</p>")).toBeUndefined();
  });
});

const PRICE_TAG = `<!-- @component
Displays a price.
-->
<script lang="ts">
  import { formatPrice } from "./format-price.ts";

  interface Props {
    amountMinor: number;
    currency?: string;
  }

  let { amountMinor, currency = "GBP" }: Props = $props();
</script>

<span class="price">{formatPrice(amountMinor, currency)}</span>

<style>
  /* Prices stand out. */
  .price { font-weight: bold; }
</style>
`;

describe("svelteContent", () => {
  const hashOf = (text: string) => JSON.stringify(svelteContent(text).tree);

  it("ignores formatting and comments in scripts, markup and styles", () => {
    const reformatted = PRICE_TAG.replace("let { amountMinor", "// Props.\n  let {   amountMinor")
      .replace('<span class="price">', '<!-- a note -->\n<span   class="price" >')
      .replace("/* Prices stand out. */", "/* Bold. */");
    expect(hashOf(reformatted)).toBe(hashOf(PRICE_TAG));
    // The component's docs are a comment too: they change no version.
    expect(hashOf(PRICE_TAG.replace("Displays a price.", "Shows a price."))).toBe(hashOf(PRICE_TAG));
  });

  it("changes with the script, the markup or the styles", () => {
    expect(hashOf(PRICE_TAG.replace('"GBP"', '"EUR"'))).not.toBe(hashOf(PRICE_TAG));
    expect(hashOf(PRICE_TAG.replace("<span", "<strong").replace("</span>", "</strong>"))).not.toBe(hashOf(PRICE_TAG));
    expect(hashOf(PRICE_TAG.replace("bold", "normal"))).not.toBe(hashOf(PRICE_TAG));
  });

  it("keeps type-only changes out of the runtime tree", () => {
    const typed = PRICE_TAG.replace("currency?: string;", "currency?: string | undefined;");
    expect(JSON.stringify(svelteContent(typed).tree)).not.toBe(JSON.stringify(svelteContent(PRICE_TAG).tree));
    expect(JSON.stringify(svelteContent(typed).runtime)).toBe(JSON.stringify(svelteContent(PRICE_TAG).runtime));
  });

  it("tells the module script from the instance script", () => {
    const moved = `<script module lang="ts">export const SIZE = 1;</script><script lang="ts">let x = 1;</script>`;
    const swapped = `<script module lang="ts">let x = 1;</script><script lang="ts">export const SIZE = 1;</script>`;
    expect(JSON.stringify(svelteContent(moved).tree)).not.toBe(JSON.stringify(svelteContent(swapped).tree));
  });
});

describe("componentDocs and componentSignatureText", () => {
  it("read the @component comment and how the component takes its props", () => {
    expect(componentDocs(PRICE_TAG)).toBe("Displays a price.");
    expect(componentDocs("<p>no docs</p>")).toBeUndefined();
    expect(componentSignatureText(PRICE_TAG)).toBe('let { amountMinor, currency = "GBP" }: Props = $props();');
    expect(componentSignatureText(`<script>export let price = 0;\nexport let label;\nlet local = 1;</script>`)).toBe("export let price = 0;\nexport let label;");
  });
});

describe("transformComponent", () => {
  it("maps generated code back to the component", () => {
    const { code, toOriginal } = transformComponent("PriceTag.svelte", PRICE_TAG);
    const at = code.indexOf("formatPrice(amountMinor");
    expect(PRICE_TAG.slice(toOriginal(at)!, toOriginal(at)! + 11)).toBe("formatPrice");
    expect(toOriginal(code.indexOf("__sveltets_2_"))).toBeUndefined();
  });

  it("gives a component svelte2tsx cannot read a stand-in default export", () => {
    const { code, toOriginal } = transformComponent("Broken.svelte", "<script>let x = </script>{#if}");
    expect(code).toContain("export default");
    expect(toOriginal(0)).toBeUndefined();
  });
});

// Under the package, so `svelte` resolves for svelte2tsx's `///<reference types="svelte" />`.
const scratch = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".poetics-test");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function project(files: Record<string, string>): string {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "svelte-"));
  for (const [file, text] of Object.entries({ "package.json": `{ "type": "module" }`, ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const APP = {
  "src/lib/format-price.ts": `export function formatPrice(amountMinor: number, currency = "GBP"): string {\n  return \`\${amountMinor / 100} \${currency}\`;\n}\n`,
  "src/lib/PriceTag.svelte": PRICE_TAG,
  "src/App.svelte": `<script module lang="ts">\n  export function label(n: number): string {\n    return String(n);\n  }\n</script>\n\n<script lang="ts">\n  import PriceTag from "./lib/PriceTag.svelte";\n</script>\n\n<p><PriceTag amountMinor={100} /> {missing()}</p>\n`,
  "src/lib/Badge.svelte": `<script lang="ts">\n  let { label }: { label: string } = $props();\n</script>\n\n<b>{label}</b>\n`,
  "src/main.ts": `import App from "./App.svelte";\nexport function start(): typeof App {\n  return App;\n}\n`,
};

describe("sveltePlugin with the TypeScript indexer", () => {
  const index = (root: string, files = Object.keys(APP), cacheFile?: string) =>
    createTypeScriptIndexer({ root, files, plugins: [sveltePlugin()], ...(cacheFile ? { cacheFile } : {}) }).index();
  const byKey = (units: IndexedUnit[]) => new Map(units.map((unit) => [unit.key, unit]));

  it("names its rules and svelte2tsx's version, so an upgrade re-indexes components", () => {
    expect(sveltePlugin().version).toMatch(/^\d+\+svelte2tsx@\d+\.\d+\.\d+/);
  });

  it("records each component as one unit spanning its file, with docs, props and edges", () => {
    const root = project(APP);
    const units = byKey(index(root).units);
    const tag = units.get("src/lib/PriceTag.svelte#PriceTag")!;
    expect(tag).toMatchObject({
      name: "PriceTag",
      exportedAs: "default",
      kind: "component",
      framework: "svelte",
      span: { file: "src/lib/PriceTag.svelte", start: 0, end: PRICE_TAG.length },
      startLine: 1,
      endLine: PRICE_TAG.split("\n").length,
      docs: "Displays a price.",
      // Props is declared in the component, not exported, so its structure is the interface.
      signature: { kind: "component", props: { written: ["InterfaceDeclaration", expect.anything(), expect.anything()] }, defaults: [{ name: "currency", value: ["StringLiteral", "GBP"] }] },
      signatureText: 'let { amountMinor, currency = "GBP" }: Props = $props();',
      edges: [{ to: "src/lib/format-price.ts#formatPrice", kind: "calls" }],
      unresolved: [],
    });
    // Props typed inline: the structure is the interface, not svelte2tsx's name for it.
    expect(units.get("src/lib/Badge.svelte#Badge")!.signature).toEqual({
      kind: "component",
      props: { written: ["TypeLiteral", ["PropertySignature", ["Identifier", "label"], ["StringKeyword"]]] },
      defaults: [],
    });
    const app = units.get("src/App.svelte#App")!;
    expect(app.signature).toEqual({ kind: "component", props: null, defaults: [] });
    expect(app.edges).toEqual([{ to: "src/lib/PriceTag.svelte#PriceTag", kind: "renders" }]);
    // A use the author wrote is reported where it was written.
    expect(app.unresolved).toHaveLength(1);
    expect(APP["src/App.svelte"].slice(app.unresolved[0]!.span.start, app.unresolved[0]!.span.end)).toBe("missing()");
    // A .ts file that imports a component reaches it through the same checker.
    expect(units.get("src/main.ts#start")!.edges).toEqual([
      { to: "src/App.svelte#App", kind: "calls" },
      { to: "src/App.svelte#App", kind: "references-type" },
    ]);
  });

  it("records defaults, bindable props, snippet and callback props, and props svelte2tsx infers", () => {
    const root = project({
      "src/Picker.svelte": `<script lang="ts">\n  import type { Snippet } from "svelte";\n  let { children, onpick, size = "md", value = $bindable(0) }: { children: Snippet; onpick?: (id: string) => void; size?: "sm" | "md"; value?: number } = $props();\n</script>\n\n{@render children()}\n<button onclick={() => onpick?.(size)}>{value}</button>\n`,
      "src/Loose.svelte": `<script lang="ts">\n  let { a, b = 1 } = $props();\n</script>\n\n<p>{a}{b}</p>\n`,
      "src/Plain.svelte": `<script>\n  let { a = 2 } = $props();\n</script>\n\n<p>{a}</p>\n`,
    });
    const units = byKey(index(root, ["src/Picker.svelte", "src/Loose.svelte", "src/Plain.svelte"]).units);
    const picker = units.get("src/Picker.svelte#Picker")!.signature;
    expect(picker).toMatchObject({
      kind: "component",
      props: { written: ["TypeLiteral", ["PropertySignature", ["Identifier", "children"], ["TypeReference", ["Identifier", "Snippet"]]], expect.anything(), expect.anything(), expect.anything()] },
      defaults: [
        { name: "size", value: ["StringLiteral", "md"] },
        { name: "value", value: ["CallExpression", ["Identifier", "$bindable"], ["NumericLiteral", "0"]] },
      ],
    });
    // Unannotated: svelte2tsx infers the props and hoists them into an alias inside its render function.
    expect(units.get("src/Loose.svelte#Loose")!.signature).toMatchObject({
      props: { written: ["TypeLiteral", expect.anything(), expect.anything()] },
      defaults: [{ name: "b", value: ["NumericLiteral", "1"] }],
    });
    // JavaScript: svelte2tsx types the props in a JSDoc typedef, read as written.
    expect(units.get("src/Plain.svelte#Plain")!.signature).toEqual({
      kind: "component",
      props: { written: ["TypeLiteral", ["PropertySignature", ["Identifier", "a"], ["QuestionToken"], ["NumberKeyword"]]] },
      defaults: [{ name: "a", value: ["NumericLiteral", "2"] }],
    });
  });

  it("changes a component's interface hash when a prop's type or default changes, but not when its props type is renamed", () => {
    const root = project(APP);
    const before = byKey(index(root).units);
    writeFileSync(join(root, "src/lib/PriceTag.svelte"), PRICE_TAG.replace("amountMinor: number;", "amountMinor: bigint;"));
    const retyped = byKey(index(root).units);
    expect(retyped.get("src/lib/PriceTag.svelte#PriceTag")!.interfaceHash).not.toBe(before.get("src/lib/PriceTag.svelte#PriceTag")!.interfaceHash);
    expect(retyped.get("src/App.svelte#App")!.edges).toContainEqual({ to: "src/lib/PriceTag.svelte#PriceTag", kind: "renders" });
    writeFileSync(join(root, "src/lib/PriceTag.svelte"), PRICE_TAG.replace('currency = "GBP"', 'currency = "EUR"'));
    expect(byKey(index(root).units).get("src/lib/PriceTag.svelte#PriceTag")!.interfaceHash).not.toBe(before.get("src/lib/PriceTag.svelte#PriceTag")!.interfaceHash);
    writeFileSync(join(root, "src/lib/PriceTag.svelte"), PRICE_TAG.replaceAll("Props", "PriceTagProps"));
    expect(byKey(index(root).units).get("src/lib/PriceTag.svelte#PriceTag")!.interfaceHash).toBe(before.get("src/lib/PriceTag.svelte#PriceTag")!.interfaceHash);
  });

  it("records what the module script exports as units of their own, placed in the component's file", () => {
    const root = project(APP);
    const label = byKey(index(root).units).get("src/App.svelte#label")!;
    expect(label).toMatchObject({ kind: "function", framework: "none", startLine: 2, endLine: 4 });
    expect(APP["src/App.svelte"].slice(label.span.start, label.span.end)).toMatch(/^export function label[\s\S]*\}$/);
  });

  const COUNTER = `<script module lang="ts">
  /** Clamps a count to the counter's range. */
  function clamp(n: number, max = 10): number {
    return Math.min(n, max);
  }
</script>

<script lang="ts">
  import { formatPrice } from "./lib/format-price.ts";
  let { start = 0 }: { start?: number } = $props();
  let count = $state(start);
  const step = (by: number) => {
    count = clamp(count + by);
  };
  function show(): string {
    return formatPrice(count);
  }
  const doubled = $derived(count * 2);
</script>

<button onclick={() => step(1)}>{show()} {doubled}</button>
`;

  it("records functions declared in a component's scripts as child units it owns, placed and hashed as written", () => {
    const root = project({ ...APP, "src/Counter.svelte": COUNTER });
    const units = byKey(index(root, [...Object.keys(APP), "src/Counter.svelte"]).units);
    const children = [...units.values()].filter((unit) => unit.owner === "src/Counter.svelte#Counter");
    expect(children.map((unit) => unit.name).sort()).toEqual(["clamp", "show", "step"]);
    const clamp = units.get("src/Counter.svelte#clamp")!;
    expect(clamp).toMatchObject({ kind: "function", framework: "none", docs: "Clamps a count to the counter's range.", startLine: 3, endLine: 5, signatureText: "function clamp(n: number, max = 10): number" });
    expect(COUNTER.slice(clamp.span.start, clamp.span.end)).toMatch(/^function clamp[\s\S]*\}$/);
    expect(clamp.signature).toMatchObject({ kind: "function", overloads: [{ parameters: [{ optional: false }, { optional: true, default: ["NumericLiteral", "10"] }], returns: { written: ["NumberKeyword"] } }] });
    // Edges come from the checker's view: the instance script's functions call each other and other modules.
    expect(units.get("src/Counter.svelte#step")!.edges).toEqual([{ to: "src/Counter.svelte#clamp", kind: "calls" }]);
    expect(units.get("src/Counter.svelte#show")!.edges).toEqual([{ to: "src/lib/format-price.ts#formatPrice", kind: "calls" }]);
    expect(units.get("src/Counter.svelte#show")!.signature).toMatchObject({ overloads: [{ returns: { written: ["StringKeyword"] } }] });
    // The component uses what its markup calls; what those functions use is theirs.
    expect(units.get("src/Counter.svelte#Counter")!.edges).toEqual([
      { to: "src/Counter.svelte#show", kind: "calls" },
      { to: "src/Counter.svelte#step", kind: "calls" },
    ]);
    // Variables holding values, like a $derived, are not units.
    expect(units.has("src/Counter.svelte#doubled")).toBe(false);
  });

  it("hashes a script function like the same function in a .ts file, and changes only it and its component when it is edited", () => {
    const root = project({ ...APP, "src/Counter.svelte": COUNTER, "src/clamp.ts": "function clamp(n: number, max = 10): number {\n  return Math.min(n, max);\n}\nexport { clamp };\n" });
    const files = [...Object.keys(APP), "src/Counter.svelte", "src/clamp.ts"];
    const before = byKey(index(root, files).units);
    expect(before.get("src/Counter.svelte#clamp")!.contentHash).toBe(before.get("src/clamp.ts#clamp")!.contentHash);
    writeFileSync(join(root, "src/Counter.svelte"), COUNTER.replace("count + by", "count + by * 2"));
    const after = byKey(index(root, files).units);
    const changed = [...after.values()].filter((unit) => before.get(unit.key)?.contentHash !== unit.contentHash).map((unit) => unit.key);
    expect(changed.sort()).toEqual(["src/Counter.svelte#Counter", "src/Counter.svelte#step"]);
    // Reformatting a function changes nothing.
    writeFileSync(join(root, "src/Counter.svelte"), COUNTER.replace("const step = (by: number) => {", "const step = (by: number) =>   {"));
    expect(byKey(index(root, files).units).get("src/Counter.svelte#step")!.contentHash).toBe(before.get("src/Counter.svelte#step")!.contentHash);
  });

  it("records the functions of a Svelte 4 component's script", () => {
    const root = project({ "src/Old.svelte": `<script>\n  export let n = 1;\n  function twice() {\n    return n * 2;\n  }\n</script>\n\n<p>{twice()}</p>\n` });
    const units = byKey(createTypeScriptIndexer({ root, files: ["src/Old.svelte"], plugins: [sveltePlugin({ svelteVersion: "4.2.0" })] }).index().units);
    expect(units.get("src/Old.svelte#twice")).toMatchObject({ owner: "src/Old.svelte#Old", startLine: 3, endLine: 5 });
    expect(units.get("src/Old.svelte#Old")!.edges).toEqual([{ to: "src/Old.svelte#twice", kind: "calls" }]);
  });

  it("keeps a component's content hash through reformatting, and changes it with the markup", () => {
    const root = project(APP);
    const before = byKey(index(root).units).get("src/lib/PriceTag.svelte#PriceTag")!;
    writeFileSync(join(root, "src/lib/PriceTag.svelte"), PRICE_TAG.replace('<span class="price">', '<span   class="price">'));
    const reformatted = byKey(index(root).units).get("src/lib/PriceTag.svelte#PriceTag")!;
    expect(reformatted.contentHash).toBe(before.contentHash);
    writeFileSync(join(root, "src/lib/PriceTag.svelte"), PRICE_TAG.replace("<span", "<em").replace("</span>", "</em>"));
    expect(byKey(index(root).units).get("src/lib/PriceTag.svelte#PriceTag")!.contentHash).not.toBe(before.contentHash);
  });

  it("re-indexes a component's importers when it changes, and nothing else", () => {
    const root = project(APP);
    const cacheFile = join(root, ".poetics/cache/typescript.json");
    index(root, undefined, cacheFile);
    expect(index(root, undefined, cacheFile).stats).toEqual({ cached: 5, indexed: 0 });
    writeFileSync(join(root, "src/lib/PriceTag.svelte"), PRICE_TAG.replace('"GBP"', '"EUR"'));
    // PriceTag, App that renders it, and main.ts that imports App.
    expect(index(root, undefined, cacheFile).stats).toEqual({ cached: 2, indexed: 3 });
  });

  it("runs svelte2tsx only on the components a re-index reads, with units unchanged", () => {
    const root = project(APP);
    const cacheFile = join(root, ".poetics/cache/typescript.json");
    const transformed: string[] = [];
    const counting = () => {
      const plugin = sveltePlugin();
      return { ...plugin, transform: (file: string, text: string) => (transformed.push(file.slice(root.length + 1)), plugin.transform!(file, text)) };
    };
    const run = () => createTypeScriptIndexer({ root, files: Object.keys(APP), cacheFile, plugins: [counting()] }).index();
    const first = run();
    expect(transformed.sort()).toEqual(["src/App.svelte", "src/lib/Badge.svelte", "src/lib/PriceTag.svelte"]);
    transformed.length = 0;
    expect(run().units).toEqual(first.units);
    expect(transformed).toEqual([]);
    // Badge imports nothing and nothing imports it: editing it reads it alone.
    writeFileSync(join(root, "src/lib/Badge.svelte"), APP["src/lib/Badge.svelte"].replace("<b>", "<strong>").replace("</b>", "</strong>"));
    const edited = run();
    expect(transformed).toEqual(["src/lib/Badge.svelte"]);
    expect(edited.units).toEqual(index(root).units);
  });
});

const LEGACY = `<script lang="ts">
  import { createEventDispatcher } from "svelte";
  export let amount: number;
  export let currency = "GBP";
  const dispatch = createEventDispatcher<{ pick: { id: string } }>();
</script>

<button on:click={() => dispatch("pick", { id: "x" })} on:focus>{amount} {currency}</button>
<slot />
<slot name="footer" total={amount} />
`;

describe("sveltePlugin with Svelte 4 components", () => {
  const sig = (text: string, svelteVersion?: string) => {
    const root = project({ "src/Legacy.svelte": text });
    const plugin = sveltePlugin(svelteVersion ? { svelteVersion } : {});
    return createTypeScriptIndexer({ root, files: ["src/Legacy.svelte"], plugins: [plugin] }).index().units.find((u) => u.name === "Legacy")!;
  };

  it("records export let props with their defaults, the events it dispatches or forwards, and its slots", () => {
    for (const version of ["4.2.19", "5.57.3"]) {
      const unit = sig(LEGACY, version);
      expect(unit, version).toMatchObject({ kind: "component", framework: "svelte", exportedAs: "default" });
      expect(unit.signature, version).toMatchObject({
        kind: "component",
        props: { written: ["TypeLiteral", expect.anything(), expect.anything()] },
        defaults: [{ name: "currency", value: ["StringLiteral", "GBP"] }],
        events: [
          { name: "focus", type: { inferred: "FocusEvent" } },
          { name: "pick", type: { inferred: "CustomEvent<{ id: string; }>" } },
        ],
        slots: [
          { name: "default", props: { inferred: "{}" } },
          { name: "footer", props: { inferred: "{ total: number; }" } },
        ],
      });
      expect(unit.signatureText).toBe("export let amount: number;\nexport let currency = \"GBP\";");
    }
  });

  it("records rendering a component with content as one renders edge", () => {
    const root = project({
      "src/Legacy.svelte": LEGACY,
      "src/Page.svelte": `<script lang="ts">\n  import Legacy from "./Legacy.svelte";\n</script>\n\n<Legacy amount={1}>Hello</Legacy>\n`,
    });
    const page = createTypeScriptIndexer({ root, files: ["src/Legacy.svelte", "src/Page.svelte"], plugins: [sveltePlugin()] }).index().units.find((u) => u.name === "Page")!;
    expect(page.edges).toEqual([{ to: "src/Legacy.svelte#Legacy", kind: "renders" }]);
  });

  it("changes the interface hash when an event's type or a slot's props change", () => {
    const before = sig(LEGACY).interfaceHash;
    expect(sig(LEGACY.replace("{ pick: { id: string } }", "{ pick: { id: number } }")).interfaceHash).not.toBe(before);
    expect(sig(LEGACY.replace("total={amount}", "total={currency}")).interfaceHash).not.toBe(before);
    expect(sig(LEGACY.replace('currency = "GBP"', 'currency = "EUR"')).interfaceHash).not.toBe(before);
  });

  it("leaves events and slots out of a Svelte 5 component's interface", () => {
    const root = project({ "src/Badge.svelte": `<script lang="ts">\n  let { label }: { label: string } = $props();\n</script>\n\n<b>{label}</b>\n` });
    const badge = createTypeScriptIndexer({ root, files: ["src/Badge.svelte"], plugins: [sveltePlugin()] }).index().units[0]!;
    expect(badge.signature).not.toHaveProperty("events");
    expect(badge.signature).not.toHaveProperty("slots");
  });
});

describe("createsRuneState", () => {
  const fn = (code: string) => {
    const source = ts.createSourceFile("a.svelte.ts", code, ts.ScriptTarget.Latest, true);
    const statement = source.statements[0]!;
    if (ts.isFunctionDeclaration(statement)) return statement;
    return (statement as ts.VariableStatement).declarationList.declarations[0]!.initializer as ts.ArrowFunction;
  };

  it("sees $state, $derived and $effect and their variants called in the function's own body", () => {
    expect(createsRuneState(fn("function a() { let n = $state(0); }"))).toBe(true);
    expect(createsRuneState(fn("const a = () => { const d = $derived.by(() => 1); };"))).toBe(true);
    expect(createsRuneState(fn("function a() { const s = $state.raw([]); }"))).toBe(true);
    expect(createsRuneState(fn("function a() { $effect(() => {}); }"))).toBe(true);
  });

  it("ignores runes in nested functions, and other calls", () => {
    expect(createsRuneState(fn("function a() { return () => $state(0); }"))).toBe(false);
    expect(createsRuneState(fn("function a() { return state(0) + $props; }"))).toBe(false);
  });
});

describe("sveltePlugin with rune modules (#73)", () => {
  const CART = `export interface Line { priceMinor: number }\n\n/** Cart state. */\nexport function createCart(initial: Line[] = []) {\n  let lines = $state(initial);\n  const total = $derived(lines.reduce((sum, line) => sum + line.priceMinor, 0));\n  return {\n    get total() {\n      return total;\n    },\n  };\n}\n\nexport function sum(lines: Line[]): number {\n  return lines.reduce((n, line) => n + line.priceMinor, 0);\n}\n`;
  const COMPONENT = `<script lang="ts">\n  import { createCart } from "./cart.svelte.ts";\n  const cart = createCart();\n  function local() {\n    let open = $state(false);\n    return { get open() { return open; } };\n  }\n</script>\n\n<p>{cart.total} {local().open}</p>\n`;

  it("indexes a .svelte.ts module as TypeScript with the runes' types resolved, without a tsconfig", () => {
    const root = project({ "src/cart.svelte.ts": CART });
    const units = new Map(createTypeScriptIndexer({ root, files: ["src/cart.svelte.ts"], plugins: [sveltePlugin()] }).index().units.map((unit) => [unit.name, unit]));
    expect(units.get("createCart")!.unresolved).toEqual([]);
    expect(units.get("createCart")!.signature).toMatchObject({ overloads: [{ returns: { inferred: "{ readonly total: number; }" } }] });
  });

  it("records a function that creates rune state as a Svelte hook, and plain functions as functions", () => {
    const root = project({ "src/cart.svelte.ts": CART, "src/Cart.svelte": COMPONENT, "src/plain.ts": "export function createThing() {\n  return $state(0);\n}\n" });
    const units = new Map(createTypeScriptIndexer({ root, files: ["src/cart.svelte.ts", "src/Cart.svelte", "src/plain.ts"], plugins: [sveltePlugin()] }).index().units.map((unit) => [unit.name, unit]));
    expect(units.get("createCart")).toMatchObject({ kind: "hook", framework: "svelte", docs: "Cart state." });
    expect(units.get("sum")).toMatchObject({ kind: "function", framework: "none" });
    // Runes only work in Svelte files, so a $state call in a .ts file is not one.
    expect(units.get("createThing")).toMatchObject({ kind: "function", framework: "none" });
    // A function in a component's script that creates rune state is a helper too.
    expect(units.get("local")).toMatchObject({ kind: "hook", framework: "svelte", owner: "src/Cart.svelte#Cart" });
    expect(units.get("Cart")!.edges).toEqual([
      { to: "src/Cart.svelte#local", kind: "uses-hook" },
      { to: "src/cart.svelte.ts#createCart", kind: "uses-hook" },
    ]);
  });
});

describe("sveltePlugin with Svelte contexts (ADR 0021, #74)", () => {
  const CONTEXT = `import { createContext } from "svelte";\n\nexport interface User {\n  name: string;\n}\n\n/** The signed-in user. */\nexport const [getUser, setUser] = createContext<User>();\n\nexport const [getCount, setCount] = createContext<number>();\n`;
  const KEYS = `import { getContext, setContext } from "svelte";\n\nexport const THEME = Symbol("theme");\nexport const LOCALE = Symbol("locale");\nexport const NOT_A_KEY = Symbol("other");\n\nexport function setTheme(theme: "light" | "dark") {\n  setContext(THEME, theme);\n}\n\nexport function getLocale() {\n  return getContext<string>(LOCALE);\n}\n`;
  const PARENT = `<script lang="ts">\n  import { setContext } from "svelte";\n  import { setUser } from "./context.ts";\n  import { THEME } from "./keys.ts";\n  setUser({ name: "Ada" });\n  setContext(THEME, "dark");\n  setContext("plain", 1);\n</script>\n\n<slot />\n`;
  const CHILD = `<script module lang="ts">\n  import { createContext } from "svelte";\n  export const [getTab, setTab] = createContext<string>();\n</script>\n\n<script lang="ts">\n  import { getUser } from "./context.ts";\n  const user = getUser();\n</script>\n\n<p>{user.name}</p>\n`;
  const FILES = { "src/context.ts": CONTEXT, "src/keys.ts": KEYS, "src/Parent.svelte": PARENT, "src/Child.svelte": CHILD };
  const index = (root: string) => new Map(createTypeScriptIndexer({ root, files: Object.keys(FILES), plugins: [sveltePlugin()] }).index().units.map((unit) => [unit.key, unit]));

  it("records createContext pairs, and keys their own module uses, as context units with their value type", () => {
    const units = index(project(FILES));
    expect(units.get("src/context.ts#getUser")).toMatchObject({
      name: "getUser",
      kind: "context",
      framework: "svelte",
      docs: "The signed-in user.",
      signature: { kind: "context", value: { written: ["TypeReference", ["Identifier", "User"]] }, default: null },
    });
    expect(units.has("src/context.ts#setUser")).toBe(false);
    expect(units.get("src/context.ts#getCount")!.signature).toEqual({ kind: "context", value: { written: ["NumberKeyword"] }, default: null });
    // A key's value type: the type its setContext calls give, or the type its getContext calls name.
    expect(units.get("src/keys.ts#THEME")).toMatchObject({ kind: "context", framework: "svelte", signature: { value: { inferred: '"light" | "dark"' } } });
    expect(units.get("src/keys.ts#LOCALE")!.signature).toMatchObject({ value: { written: ["StringKeyword"] } });
    // A Symbol nothing uses as a key is not a context, and not a unit.
    expect(units.has("src/keys.ts#NOT_A_KEY")).toBe(false);
    // A context a component's module script exports is a unit of its file.
    expect(units.get("src/Child.svelte#getTab")).toMatchObject({ kind: "context", signature: { value: { written: ["StringKeyword"] } } });
  });

  it("records setters and getters, components and functions alike, as uses-context edges; a literal string key is not tracked", () => {
    const units = index(project(FILES));
    expect(units.get("src/Parent.svelte#Parent")!.edges).toEqual([
      { to: "src/context.ts#getUser", kind: "uses-context" },
      { to: "src/keys.ts#THEME", kind: "uses-context" },
    ]);
    expect(units.get("src/Child.svelte#Child")!.edges).toEqual([{ to: "src/context.ts#getUser", kind: "uses-context" }]);
    expect(units.get("src/keys.ts#setTheme")!.edges).toEqual([{ to: "src/keys.ts#THEME", kind: "uses-context" }]);
    expect(units.get("src/keys.ts#getLocale")!.edges).toEqual([{ to: "src/keys.ts#LOCALE", kind: "uses-context" }]);
  });

  it("changes a context's interface hash with its value type, not with its names", () => {
    const root = project(FILES);
    const before = index(root).get("src/context.ts#getUser")!;
    writeFileSync(join(root, "src/context.ts"), CONTEXT.replace("createContext<User>", "createContext<User | null>"));
    expect(index(root).get("src/context.ts#getUser")!.interfaceHash).not.toBe(before.interfaceHash);
    writeFileSync(join(root, "src/context.ts"), CONTEXT.replace("setUser]", "provideUser]"));
    const renamed = index(root).get("src/context.ts#getUser")!;
    expect([renamed.contentHash, renamed.interfaceHash]).toEqual([before.contentHash, before.interfaceHash]);
  });
});
