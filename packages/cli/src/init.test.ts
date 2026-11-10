import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyInit, formatInitPlan, planInit } from "./init.ts";
import { runGit, write } from "./test-helpers.ts";

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-init-"));
  runGit(root, "init", "-q", "-b", "main");
  for (const [file, text] of Object.entries(files)) await write(root, file, text);
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", "Start");
  return root;
}

const FN = "export function a(n: number) {\n  return n + 1;\n}\n";

describe("planInit", () => {
  it("detects React from dependencies and scopes the config to src/", async () => {
    const root = await repo({
      "package.json": JSON.stringify({ name: "app", dependencies: { react: "^19.0.0" } }),
      // A comment, a trailing comma, and `/*` inside strings, as real tsconfig files have.
      "tsconfig.json": '{\n  // Comments are allowed here.\n  "compilerOptions": { "strict": true, "paths": { "@/*": ["./*"] }, },\n}\n',
      "src/a.ts": FN,
      "src/App.tsx": "export function App() {\n  return null;\n}\n",
      "src/App.test.tsx": "export function t() {}\n",
    });
    const plan = await planInit(root);
    expect(plan.config).toEqual({
      version: 1,
      adapters: ["typescript", "react"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: expect.arrayContaining(["**/*.test.*", "**/node_modules/**", "**/*.d.ts"]),
      typescript: { tsconfig: "tsconfig.json" },
      policy: { requireRationale: true, agentRationaleNeedsReview: true, allowProvisionalHashes: false },
    });
    expect(plan.detected).toEqual({ react: ["package.json"], svelte: [] });
    expect(plan.ignoreCache).toBe(true);
    expect(plan.backfill!.created.map(({ unit }) => unit.name).sort()).toEqual(["App", "a"]);
  });

  it("covers every workspace package of a monorepo, and Svelte by its dependency", async () => {
    const root = await repo({
      "package.json": JSON.stringify({ name: "mono", private: true }),
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n  - '!packages/ignored'\nonlyBuiltDependencies: []\n",
      "packages/core/package.json": JSON.stringify({ name: "core" }),
      "packages/core/src/a.ts": FN,
      "packages/ui/package.json": JSON.stringify({ name: "ui", devDependencies: { svelte: "^5.0.0" } }),
      "packages/ui/src/b.ts": FN.replace("function a", "function b"),
      "packages/ui/src/View.svelte": "<p></p>\n",
    });
    const plan = await planInit(root);
    expect(plan.config.adapters).toEqual(["typescript", "svelte"]);
    expect(plan.config.include).toEqual(["packages/*/src/**/*.{ts,svelte}"]);
    expect(plan.detected.svelte).toEqual(["packages/ui/package.json"]);
    expect(plan.config.typescript).toBeUndefined();
    // With Svelte detected, its components are units too (ADR 0020).
    expect(plan.backfill!.created.map(({ unit }) => unit.location.file).sort()).toEqual(["packages/core/src/a.ts", "packages/ui/src/View.svelte", "packages/ui/src/b.ts"]);
    expect(plan.backfill!.created.find(({ unit }) => unit.name === "View")!.unit).toMatchObject({ kind: "component", framework: "svelte" });
  });

  it("falls back to the whole repository, and to file extensions when no dependency says", async () => {
    const root = await repo({ "lib/App.tsx": "export function App() {\n  return null;\n}\n", ".gitignore": "node_modules\n.poetics/cache/\n" });
    const plan = await planInit(root);
    expect(plan.config.include).toEqual(["**/*.{ts,tsx}"]);
    expect(plan.detected.react).toEqual(["*.tsx files"]);
    expect(plan.ignoreCache).toBe(false);
  });

  it("changes nothing in a repository that already has a config", async () => {
    const root = await repo({ ".poetics/config.json": "{}", "src/a.ts": FN });
    const plan = await planInit(root);
    expect(plan.existing).toBe(".poetics/config.json");
    expect(plan.backfill).toBeUndefined();
    await expect(applyInit(root, plan)).rejects.toThrow("already exists");
    expect(formatInitPlan(plan)).toMatch(/already exists, so init changes nothing/);
  });
});

describe("applyInit", () => {
  it("writes the config, ignores the cache and creates the units", async () => {
    const root = await repo({ "package.json": "{}", ".gitignore": "node_modules", "src/a.ts": FN });
    const plan = await planInit(root);
    expect(await applyInit(root, plan)).toBe(1);
    const config = JSON.parse(await readFile(join(root, ".poetics/config.json"), "utf8")) as Record<string, unknown>;
    expect(config).toMatchObject({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"] });
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("node_modules\n.poetics/cache/\n");
    expect(await readdir(join(root, ".poetics/units"))).toHaveLength(1);
    expect(formatInitPlan(plan, 1)).toMatch(/Wrote \.poetics\/config\.json and 1 unit\(s\) from a snapshot backfill/);
  });
});
