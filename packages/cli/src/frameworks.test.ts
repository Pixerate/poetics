import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import { pluginsFor } from "./frameworks.ts";

describe("pluginsFor", () => {
  it("runs the plugins the config lists, Svelte's before React's", () => {
    expect(pluginsFor({ adapters: ["typescript"] })).toEqual([]);
    expect(pluginsFor({ adapters: ["typescript", "react", "svelte"] }).map((plugin) => plugin.framework)).toEqual(["svelte", "react"]);
  });

  it("records a use* rune helper as Svelte's hook, and a use* function elsewhere as React's (#73)", () => {
    const root = mkdtempSync(join(tmpdir(), "poetics-frameworks-"));
    writeFileSync(join(root, "counter.svelte.ts"), "export function useCounter() {\n  let count = $state(0);\n  return { get count() { return count; } };\n}\n");
    writeFileSync(join(root, "toggle.ts"), "export function useToggle() {\n  return true;\n}\n");
    const plugins = pluginsFor({ adapters: ["typescript", "react", "svelte"] });
    const units = createTypeScriptIndexer({ root, files: ["counter.svelte.ts", "toggle.ts"], plugins }).index().units;
    expect(units.map((unit) => [unit.name, unit.kind, unit.framework])).toEqual([
      ["useCounter", "hook", "svelte"],
      ["useToggle", "hook", "react"],
    ]);
  });

  it("records Svelte's createContext as a Svelte context when both adapters are on (ADR 0021)", () => {
    const root = mkdtempSync(join(tmpdir(), "poetics-frameworks-"));
    writeFileSync(join(root, "user.ts"), 'import { createContext } from "svelte";\nexport const [getUser, setUser] = createContext<string>();\n');
    writeFileSync(join(root, "theme.tsx"), 'import { createContext } from "react";\nexport const Theme = createContext("light");\n');
    const plugins = pluginsFor({ adapters: ["typescript", "react", "svelte"] });
    const units = createTypeScriptIndexer({ root, files: ["user.ts", "theme.tsx"], plugins }).index().units;
    expect(units.map((unit) => [unit.name, unit.kind, unit.framework])).toEqual([
      ["getUser", "context", "svelte"],
      ["Theme", "context", "react"],
    ]);
  });
});
