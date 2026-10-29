import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { closureHash, contentHash, gitBlobHash, interfaceHash, isHash, isProvisional } from "./hash.ts";
import type { Hash } from "./types.ts";

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

const H = (c: string): Hash => `b3:${c.repeat(64)}`;

describe("contentHash", () => {
  it("is a b3: hash", () => {
    const hash = contentHash({ kind: "ReturnStatement" });
    expect(isHash(hash)).toBe(true);
    expect(isProvisional(hash)).toBe(false);
    expect(hash).toMatch(/^b3:/);
  });

  it("is stable and independent of key order", () => {
    expect(contentHash({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(contentHash({ b: [2, { d: 4, c: 3 }], a: 1 }));
  });

  it("changes when the tree changes", () => {
    expect(contentHash({ op: "+" })).not.toBe(contentHash({ op: "-" }));
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    expect(contentHash("1")).not.toBe(contentHash(1));
  });

  it("drops undefined properties, so absent and undefined fields agree", () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });

  it("rejects values JSON cannot round-trip", () => {
    expect(() => contentHash({ n: Number.NaN })).toThrow(TypeError);
    expect(() => contentHash([undefined])).toThrow(TypeError);
    expect(() => contentHash(1n)).toThrow(TypeError);
    expect(() => contentHash(new Date(0))).toThrow(TypeError);
    expect(() => contentHash(() => 1)).toThrow(TypeError);
  });
});

describe("hash encoding", () => {
  // Every stored b3: hash depends on this encoding; changing it needs a rehash migration.
  it("is pinned", () => {
    expect(contentHash({ a: 1 })).toBe("b3:666240675e239b9810c99fb56c04e8992c8417dc26ff3eb53d53d2ff5bc7aa26");
    expect(closureHash(contentHash({ a: 1 }), [])).toBe("b3:f778f6712bb94c2deb38b506443815e6e920d233e1c7c49b61b5b4f2d156600e");
  });
});

describe("interfaceHash", () => {
  it("never collides with the content hash of the same value", () => {
    const signature = { params: [{ name: "n", type: "number" }], returns: "string" };
    expect(interfaceHash(signature)).not.toBe(contentHash(signature));
    expect(interfaceHash(signature)).toBe(interfaceHash(structuredClone(signature)));
    expect(isHash(interfaceHash(signature))).toBe(true);
  });
});

describe("closureHash", () => {
  it("ignores the order dependencies are listed in", () => {
    expect(closureHash(H("a"), [H("b"), H("c")])).toBe(closureHash(H("a"), [H("c"), H("b")]));
  });

  it("changes when the unit or any dependency changes", () => {
    const base = closureHash(H("a"), [H("b")]);
    expect(closureHash(H("d"), [H("b")])).not.toBe(base);
    expect(closureHash(H("a"), [H("c")])).not.toBe(base);
    expect(closureHash(H("a"), [])).not.toBe(base);
  });

  it("differs from the content hash of a leaf", () => {
    expect(closureHash(H("a"), [])).not.toBe(H("a"));
    expect(isHash(closureHash(H("a"), []))).toBe(true);
  });

  it("accepts provisional hashes and rejects anything else", () => {
    expect(isHash(closureHash(`git:${"a".repeat(40)}`, []))).toBe(true);
    expect(() => closureHash("nope" as Hash, [])).toThrow(TypeError);
    expect(() => closureHash(H("a"), ["b3:short" as Hash])).toThrow(TypeError);
  });

  it("does not mutate its input", () => {
    const deps = [H("c"), H("b")];
    closureHash(H("a"), deps);
    expect(deps).toEqual([H("c"), H("b")]);
  });
});
