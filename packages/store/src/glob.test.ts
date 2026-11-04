import { describe, expect, it } from "vitest";
import { createMatcher, globToRegExp } from "./glob.ts";

describe("globToRegExp", () => {
  const matches = (pattern: string, path: string) => globToRegExp(pattern).test(path);

  it("keeps * within one path segment", () => {
    expect(matches("packages/*/src/*.ts", "packages/core/src/uid.ts")).toBe(true);
    expect(matches("packages/*/src/*.ts", "packages/core/src/deep/uid.ts")).toBe(false);
  });

  it("lets ** cross directories, including none", () => {
    expect(matches("packages/*/src/**/*.ts", "packages/core/src/uid.ts")).toBe(true);
    expect(matches("packages/*/src/**/*.ts", "packages/core/src/a/b/uid.ts")).toBe(true);
    expect(matches("**/dist/**", "packages/core/dist/index.js")).toBe(true);
    expect(matches("**/*.test.ts", "uid.test.ts")).toBe(true);
  });

  it("expands braces and escapes dots", () => {
    expect(matches("src/**/*.{ts,tsx}", "src/App.tsx")).toBe(true);
    expect(matches("src/**/*.{ts,tsx}", "src/App.svelte")).toBe(false);
    expect(matches("*.ts", "a_ts")).toBe(false);
  });

  it("supports ? and treats an unclosed brace literally", () => {
    expect(matches("a?.ts", "ab.ts")).toBe(true);
    expect(matches("a{b.ts", "a{b.ts")).toBe(true);
  });
});

describe("createMatcher", () => {
  it("applies includes then excludes", () => {
    const match = createMatcher(["packages/*/src/**/*.ts"], ["**/*.test.ts"]);
    expect(match("packages/core/src/uid.ts")).toBe(true);
    expect(match("packages/core/src/uid.test.ts")).toBe(false);
    expect(match("scripts/validate.ts")).toBe(false);
  });
});
