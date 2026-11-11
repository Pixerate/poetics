import { describe, expect, it } from "vitest";
import { decodeMappings, offsetMapper } from "./source-map.ts";

describe("decodeMappings", () => {
  it("decodes VLQ segments per line, keeping original positions across lines", () => {
    // Line 0: column 0 → original 0:0, column 4 → 0:2. Line 1: column 2 → 1:0. Line 2: a one-field segment maps nothing.
    expect(decodeMappings("AAAA,IAAE;EACF;A")).toEqual([
      [
        { column: 0, line: 0, originalColumn: 0 },
        { column: 4, line: 0, originalColumn: 2 },
      ],
      [{ column: 2, line: 1, originalColumn: 0 }],
      [],
    ]);
  });

  it("refuses characters outside base64", () => {
    expect(() => decodeMappings("A!")).toThrow("Invalid source map character: !");
  });
});

describe("offsetMapper", () => {
  it("maps through the nearest segment before an offset, and leaves generated-only code unmapped", () => {
    const original = "ab\ncd";
    const generated = "XXab\nYYcd";
    // Line 0: column 2 → 0:0. Line 1: column 2 → 1:0.
    const map = offsetMapper("EAAA;EACA", generated, original);
    expect(map(2)).toBe(0);
    expect(map(3)).toBe(1);
    expect(map(7)).toBe(3);
    expect(map(0)).toBeUndefined();
    expect(map(5)).toBeUndefined();
    expect(map(99)).toBeUndefined();
  });
});
