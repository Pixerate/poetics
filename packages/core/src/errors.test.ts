import { describe, expect, it } from "vitest";
import { NotImplementedError, notImplemented } from "./errors.ts";

describe("notImplemented", () => {
  it("throws a NotImplementedError naming the API", () => {
    try {
      notImplemented("impactOf");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).api).toBe("impactOf");
      expect((error as Error).message).toContain("docs/plan.md");
    }
  });
});
