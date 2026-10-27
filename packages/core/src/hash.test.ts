import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { NotImplementedError } from "./errors.ts";
import { closureHash, contentHash, gitBlobHash, interfaceHash, isHash, isProvisional } from "./hash.ts";

describe("gitBlobHash", () => {
  it("matches git hash-object", () => {
    const source = "export function formatPrice(n: number) {\n  return n.toFixed(2);\n}\n";
    const expected = execFileSync("git", ["hash-object", "--stdin"], { input: source }).toString().trim();
    expect(gitBlobHash(source)).toBe(`git:${expected}`);
  });

  it("counts bytes, not characters, for non-ASCII source", () => {
    const source = "const price = '£1';\n";
    const expected = execFileSync("git", ["hash-object", "--stdin"], { input: source }).toString().trim();
    expect(gitBlobHash(source)).toBe(`git:${expected}`);
  });
});

describe("isHash / isProvisional", () => {
  it("accepts both hash families", () => {
    expect(isHash(`b3:${"a".repeat(64)}`)).toBe(true);
    expect(isHash(`git:${"a".repeat(40)}`)).toBe(true);
    expect(isHash(`sha1:${"a".repeat(40)}`)).toBe(false);
    expect(isHash(`b3:${"A".repeat(64)}`)).toBe(false);
  });

  it("flags git blob hashes as provisional", () => {
    expect(isProvisional(`git:${"a".repeat(40)}`)).toBe(true);
    expect(isProvisional(`b3:${"a".repeat(64)}`)).toBe(false);
  });
});

describe("indexer hashes", () => {
  it("are stubs until phase 1", () => {
    expect(() => contentHash({})).toThrow(NotImplementedError);
    expect(() => interfaceHash({})).toThrow(NotImplementedError);
    expect(() => closureHash(`b3:${"a".repeat(64)}`, [])).toThrow(NotImplementedError);
  });
});
