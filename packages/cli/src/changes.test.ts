import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@poetics/store";
import { formatChanges } from "./changes.ts";

const SHA = "a".repeat(40);
const set: ChangeSet = {
  from: "b".repeat(40),
  to: "worktree",
  commits: [
    {
      commit: SHA,
      subject: "Fold formatRange into formatPrice",
      units: [
        {
          uid: "01JB8K0000000000000000000A",
          name: "formatRange",
          kind: "function",
          file: "src/format.ts",
          status: "removed",
          versions: [
            {
              contentHash: "git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
              provisional: true,
              change: "removed",
              actor: { kind: "human" },
              rationale: "Folded into formatPrice.",
              links: [{ kind: "github-issue", ref: "#12", url: "https://example.test/12" }, "docs/plan.md"],
            },
          ],
          lineage: [],
        },
        {
          uid: "01JB8K0000000000000000000B",
          name: "formatPrice",
          kind: "function",
          file: "src/price.ts",
          status: "changed",
          versions: [],
          lineage: [{ kind: "move", from: "src/format.ts" }],
        },
        { uid: "01JB8K0000000000000000000C", name: "gone", kind: "type", file: "src/gone.ts", status: "removed", versions: [], lineage: [] },
      ],
    },
  ],
  unrecorded: [{ commit: "c".repeat(40), subject: "Bump CI" }],
  decisions: ["docs/decisions/0010-removed-versions.md"],
  notes: ["01JB8N0000000000000000000N"],
};

describe("formatChanges", () => {
  it("renders commits, units, rationale, links and lineage", () => {
    expect(formatChanges(set)).toBe(
      [
        `Changes from bbbbbbb to worktree: 1 commit(s), 3 unit change(s)`,
        "",
        "aaaaaaa Fold formatRange into formatPrice",
        "  - formatRange (function, src/format.ts) removed",
        "      Folded into formatPrice.",
        "      links: https://example.test/12, docs/plan.md",
        "  ~ formatPrice (function, src/price.ts)",
        "      move from src/format.ts",
        "  - gone (type, src/gone.ts)",
        "      unit file deleted; no rationale recorded",
        "",
        "Commits that recorded no unit change:",
        "  ccccccc Bump CI",
        "",
        "Decisions: docs/decisions/0010-removed-versions.md",
        "",
        "Notes: 01JB8N0000000000000000000N",
      ].join("\n"),
    );
  });

  it("renders an empty range as a single line", () => {
    expect(formatChanges({ ...set, commits: [], unrecorded: [], decisions: [], notes: [] })).toBe(
      "Changes from bbbbbbb to worktree: 0 commit(s), 0 unit change(s)",
    );
  });
});
