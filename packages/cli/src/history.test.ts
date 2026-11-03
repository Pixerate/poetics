import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import { formatLog, formatWhy } from "./history.ts";

const unit: Unit = {
  uid: "01JB8K0000000000000000000A",
  kind: "function",
  framework: "none",
  name: "formatPrice",
  location: { file: "src/format.ts" },
  versions: [
    { contentHash: `git:${"1".repeat(40)}`, parent: null, change: "created", actor: { kind: "human" }, rationale: "Show prices in the cart." },
    {
      contentHash: `git:${"2".repeat(40)}`,
      parent: `git:${"1".repeat(40)}`,
      change: "behaviour",
      commit: "a".repeat(40),
      actor: { kind: "agent", tool: "claude-code", model: "claude-opus-5-5", reviewed: false },
      rationale: "Round half up, as finance asked.",
      links: [{ kind: "github-issue", ref: "#12", url: "https://example.test/12" }, "docs/plan.md"],
    },
  ],
  lineage: [{ kind: "rename", from: "fmtPrice", commit: "b".repeat(40) }],
};

describe("formatLog", () => {
  it("lists versions newest first with hash, commit, author and links", () => {
    expect(formatLog(unit)).toBe(
      [
        "formatPrice (function, src/format.ts) 01JB8K0000000000000000000A: 2 version(s)",
        "",
        "#1 behaviour git:22222222 aaaaaaa by claude-code (claude-opus-5-5), unreviewed",
        "   Round half up, as finance asked.",
        "   links: https://example.test/12, docs/plan.md",
        "",
        "#0 created git:11111111 by human",
        "   Show prices in the cart.",
        "",
        "Lineage:",
        "  rename from fmtPrice in bbbbbbb",
      ].join("\n"),
    );
  });
});

describe("formatWhy", () => {
  it("tells the rationale oldest first, then the lineage", () => {
    expect(formatWhy(unit)).toBe(
      [
        "Why formatPrice (src/format.ts) is the way it is:",
        "",
        "1. created",
        "   Show prices in the cart.",
        "",
        "2. behaviour",
        "   Round half up, as finance asked.",
        "   links: https://example.test/12, docs/plan.md",
        "",
        "Along the way:",
        "  rename from fmtPrice in bbbbbbb",
      ].join("\n"),
    );
  });

  it("leaves out lineage when there is none", () => {
    expect(formatWhy({ ...unit, lineage: [] })).not.toContain("Along the way");
  });
});
