import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitBlobHash } from "@poetics/core";
import { declarationsIn, discoverDeclarations, filesInScope } from "./declarations.ts";

const SOURCE = `import x from "y";

/** Formats a price. */
export function formatPrice(n: number): string {
  return n.toFixed(2);
}

export function useCart() {}

export interface CartLine {
  sku: string;
}

export type Money = number;

function internal() {}
export const notAUnit = 1;
export default function () {}
`;

describe("declarationsIn", () => {
  const found = declarationsIn("src/a.ts", SOURCE);

  it("finds exported functions, hooks and types, and skips the rest", () => {
    expect(found.map((d) => [d.name, d.kind])).toEqual([
      ["formatPrice", "function"],
      ["useCart", "hook"],
      ["CartLine", "type"],
      ["Money", "type"],
      ["default", "function"],
    ]);
  });

  it("hashes the declaration text without its TSDoc and reports 1-based lines", () => {
    const decl = found[0]!;
    expect(decl.hash).toBe(gitBlobHash('export function formatPrice(n: number): string {\n  return n.toFixed(2);\n}'));
    expect([decl.startLine, decl.endLine]).toEqual([4, 6]);
  });

  it("ignores comment-only and formatting-outside-the-declaration changes", () => {
    const moved = declarationsIn("src/a.ts", `// header\n\n${SOURCE}`);
    expect(moved[0]!.hash).toBe(found[0]!.hash);
  });
});

describe("discoverDeclarations", () => {
  it("walks the scope, skipping excluded, ignored and declaration files", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-decl-"));
    await mkdir(join(root, "src", "deep"), { recursive: true });
    await mkdir(join(root, "node_modules", "x"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export function a() {}\n");
    await writeFile(join(root, "src", "deep", "b.tsx"), "export type B = 1;\n");
    await writeFile(join(root, "src", "a.test.ts"), "export function t() {}\n");
    await writeFile(join(root, "src", "types.d.ts"), "export type D = 1;\n");
    await writeFile(join(root, "src", "C.svelte"), "<p></p>\n");
    await writeFile(join(root, "node_modules", "x", "i.ts"), "export function n() {}\n");

    const scope = { include: ["src/**/*.{ts,tsx,svelte}", "node_modules/**"], exclude: ["**/*.test.ts"] };
    expect(await filesInScope(root, scope)).toEqual({
      parseable: ["src/a.ts", "src/deep/b.tsx"],
      unsupported: ["src/C.svelte", "src/types.d.ts"],
    });
    const { declarations, unsupported } = await discoverDeclarations(root, scope);
    expect(declarations.map((d) => `${d.file}#${d.name}`)).toEqual(["src/a.ts#a", "src/deep/b.tsx#B"]);
    expect(unsupported).toEqual(["src/C.svelte", "src/types.d.ts"]);
  });
});
