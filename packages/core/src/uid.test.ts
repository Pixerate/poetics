import { describe, expect, it } from "vitest";
import { isUid, mintUid, uidTime } from "./uid.ts";

describe("mintUid", () => {
  it("produces a 26-character Crockford ULID", () => {
    const uid = mintUid();
    expect(uid).toHaveLength(26);
    expect(isUid(uid)).toBe(true);
  });

  it("encodes the timestamp so uids sort by creation time", () => {
    const zeros = new Uint8Array(10);
    const earlier = mintUid(1_700_000_000_000, zeros);
    const later = mintUid(1_700_000_000_001, zeros);
    expect(earlier < later).toBe(true);
    expect(uidTime(earlier)).toBe(1_700_000_000_000);
  });

  it("is deterministic for fixed inputs", () => {
    expect(mintUid(0, new Uint8Array(10))).toBe("00000000000000000000000000");
    expect(mintUid(0, new Uint8Array(10).fill(255))).toBe("0000000000ZZZZZZZZZZZZZZZZ");
  });

  it("rejects out-of-range input", () => {
    expect(() => mintUid(-1)).toThrow(RangeError);
    expect(() => mintUid(2 ** 48)).toThrow(RangeError);
    expect(() => mintUid(0, new Uint8Array(9))).toThrow(RangeError);
  });
});

describe("isUid", () => {
  it("rejects ambiguous Crockford letters and wrong lengths", () => {
    expect(isUid("0000000000000000000000000I")).toBe(false);
    expect(isUid("0000000000000000000000000")).toBe(false);
    expect(isUid(42)).toBe(false);
  });
});
