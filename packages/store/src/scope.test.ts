import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filesInScope, isParseable } from "./scope.ts";

describe("filesInScope", () => {
  it("lists matching files, sorted, with those the TypeScript indexer cannot read apart", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-scope-"));
    for (const dir of ["src/deep", "node_modules/x", ".hidden", "dist"]) await mkdir(join(root, dir), { recursive: true });
    for (const file of ["src/b.ts", "src/deep/a.tsx", "src/a.test.ts", "src/types.d.ts", "src/C.svelte", "node_modules/x/i.ts", ".hidden/h.ts", "dist/d.ts"]) {
      await writeFile(join(root, file), "");
    }
    expect(await filesInScope(root, { include: ["**/*.{ts,tsx,svelte}"], exclude: ["**/*.test.ts"] })).toEqual({
      parseable: ["src/b.ts", "src/deep/a.tsx"],
      unsupported: ["src/C.svelte", "src/types.d.ts"],
    });
    // With the Svelte adapter, components are read too (ADR 0020).
    expect(await filesInScope(root, { include: ["**/*.{ts,tsx,svelte}"], exclude: ["**/*.test.ts"], adapters: ["typescript", "svelte"] })).toEqual({
      parseable: ["src/C.svelte", "src/b.ts", "src/deep/a.tsx"],
      unsupported: ["src/types.d.ts"],
    });
  });
});

describe("isParseable", () => {
  it("reads TypeScript sources but not declaration files, and .svelte only with the svelte adapter", () => {
    expect(isParseable("src/a.ts")).toBe(true);
    expect(isParseable("src/a.mts")).toBe(true);
    expect(isParseable("src/a.d.ts")).toBe(false);
    expect(isParseable("src/cart.svelte.ts")).toBe(true);
    expect(isParseable("src/A.svelte")).toBe(false);
    expect(isParseable("src/A.svelte", ["typescript", "svelte"])).toBe(true);
    expect(isParseable("src/a.js", ["typescript", "svelte"])).toBe(false);
  });
});
