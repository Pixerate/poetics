import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@poetics/core";
import { createReactAdapter, isComponentName, isHookName } from "./index.ts";

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

describe("createReactAdapter", () => {
  it("declares its framework and extensions, with detection still stubbed", () => {
    const adapter = createReactAdapter({ tsconfig: "tsconfig.json" });
    expect(adapter.framework).toBe("react");
    expect(adapter.extensions).toEqual([".ts", ".tsx"]);
    expect(() => adapter.detectUnits("src/App.tsx")).toThrow(NotImplementedError);
    expect(() => adapter.interfaceOf({} as never)).toThrow(NotImplementedError);
    expect(() => adapter.edgesOf({} as never)).toThrow(NotImplementedError);
  });
});
