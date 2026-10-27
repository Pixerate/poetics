import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@poetics/core";
import { componentNameFromFile, createSvelteAdapter, detectSvelteMajor, svelteFileKind } from "./index.ts";

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

describe("createSvelteAdapter", () => {
  it("declares its extensions, with detection still stubbed", () => {
    const adapter = createSvelteAdapter({ tsconfig: "tsconfig.json" });
    expect(adapter.extensions).toContain(".svelte");
    expect(() => adapter.detectUnits("src/App.svelte")).toThrow(NotImplementedError);
    expect(() => adapter.interfaceOf({} as never)).toThrow(NotImplementedError);
    expect(() => adapter.edgesOf({} as never)).toThrow(NotImplementedError);
  });
});
