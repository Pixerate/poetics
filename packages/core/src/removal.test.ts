import { describe, expect, it } from "vitest";
import { gitBlobHash } from "./hash.ts";
import { REMOVED_CONTENT_HASH, isRemoved } from "./removal.ts";
import type { Version } from "./types.ts";

const version = (change: Version["change"]): Version => ({
  contentHash: gitBlobHash(change),
  change,
  actor: { kind: "human" },
  rationale: change,
});

describe("REMOVED_CONTENT_HASH", () => {
  it("is the git blob hash of empty source", () => {
    expect(REMOVED_CONTENT_HASH).toBe(gitBlobHash(""));
  });
});

describe("isRemoved", () => {
  it("is true only when the latest version is removed", () => {
    expect(isRemoved({ versions: [version("created"), version("removed")] })).toBe(true);
    expect(isRemoved({ versions: [version("created"), version("behaviour")] })).toBe(false);
    expect(isRemoved({ versions: [version("created")] })).toBe(false);
  });

  it("is false for a unit with no versions", () => {
    expect(isRemoved({ versions: [] })).toBe(false);
  });
});
