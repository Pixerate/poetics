import { describe, expect, it } from "vitest";
import { createTypeScriptAdapter } from "./index.ts";
import { makeProject } from "./test-helpers.ts";

describe("createTypeScriptAdapter", () => {
  const files = {
    "src/price.ts": `export type Cents = number;\nexport function formatPrice(n: Cents) { return String(n); }`,
    "src/cart.ts": `import { formatPrice } from "./price.ts";\nexport function total() { return formatPrice(1) + missing(); }`,
  };
  const root = makeProject(files);
  const adapter = createTypeScriptAdapter({ root, files: Object.keys(files) });

  it("answers the adapter's four questions from the indexer", () => {
    expect(adapter.framework).toBe("none");
    const [total] = adapter.detectUnits("src/cart.ts");
    expect(total).toMatchObject({ name: "total", kind: "function", framework: "none", span: { file: "src/cart.ts" } });
    expect(adapter.interfaceOf(total!)).toMatchObject({ kind: "function", overloads: [{ parameters: [] }] });

    const [, formatPrice] = adapter.detectUnits("src/price.ts");
    const { edges, unresolved } = adapter.edgesOf(total!);
    expect(edges).toEqual([{ from: total!.span, to: formatPrice!.span, kind: "calls" }]);
    expect(unresolved).toMatchObject([{ kind: "calls", reason: "missing does not resolve to a declaration" }]);
  });

  it("refuses a candidate it did not detect", () => {
    expect(() => adapter.interfaceOf({ name: "nope", kind: "function", framework: "none", span: { file: "src/cart.ts", start: 0, end: 1 } })).toThrow(
      "No indexed unit src/cart.ts#nope",
    );
  });
});
