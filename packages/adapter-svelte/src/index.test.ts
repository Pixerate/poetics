import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import { componentDocs, componentNameFromFile, componentSignatureText, detectSvelteMajor, svelteContent, svelteFileKind, sveltePlugin, transformComponent } from "./index.ts";

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
      signature: { kind: "component", props: { written: ["TypeReference", ["Identifier", "Props"]] }, defaults: [] },
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

  it("records what the module script exports as units of their own, placed in the component's file", () => {
    const root = project(APP);
    const label = byKey(index(root).units).get("src/App.svelte#label")!;
    expect(label).toMatchObject({ kind: "function", framework: "none", startLine: 2, endLine: 4 });
    expect(APP["src/App.svelte"].slice(label.span.start, label.span.end)).toMatch(/^export function label[\s\S]*\}$/);
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
});
