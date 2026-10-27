import { describe, expect, it } from "vitest";
import { renderGotchas } from "./gotchas.ts";
import { NOTE_ID, UID_A, UID_B, makeNote } from "./test-helpers.ts";

describe("renderGotchas", () => {
  it("renders a header even with no notes", () => {
    const out = renderGotchas([]);
    expect(out.startsWith("# GOTCHAS\n")).toBe(true);
    expect(out).toContain("Generated from .poetics/notes/");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("renders one note with symptoms, anchors, check and links", () => {
    const out = renderGotchas(
      [
        makeNote({
          title: "`pnpm ci` wipes node_modules",
          symptoms: ["Removing node_modules"],
          anchors: {
            commands: ["pnpm ci"],
            dependencies: [{ name: "pnpm", range: ">=10" }],
            paths: ["package.json"],
            units: [{ uid: UID_A }],
          },
          check: { kind: "test", ref: "scripts/scripts.test.ts", name: "preflight" },
          links: [{ kind: "decision", ref: "docs/decisions/0005-node-24-type-stripping.md" }, "https://example.com/x"],
        }),
      ],
      { unitNames: new Map([[UID_A, "formatPrice"]]) },
    );
    expect(out).toContain(
      [
        "## Tooling",
        "",
        "### `pnpm ci` wipes node_modules",
        "",
        "- **Symptom:** `Removing node_modules`",
        "- **Cause:** Because.",
        "- **Fix:** Do the other thing.",
        "- **Applies to:** `pnpm ci`, `pnpm@>=10`, `package.json`, `formatPrice`",
        "- **Caught by:** test `scripts/scripts.test.ts` (preflight)",
        "- **See:** [docs/decisions/0005-node-24-type-stripping.md](docs/decisions/0005-node-24-type-stripping.md), <https://example.com/x>",
        `- **Note:** \`${NOTE_ID}\``,
      ].join("\n"),
    );
  });

  it("orders known areas first, then others alphabetically, and notes by id", () => {
    const out = renderGotchas([
      makeNote({ id: UID_B, area: "zeta-area", title: "Z" }),
      makeNote({ id: UID_A, area: "releases", title: "R" }),
      makeNote({ id: NOTE_ID, area: "tooling", title: "T2" }),
      makeNote({ id: "01JB8K00000000000000000001", area: "tooling", title: "T1" }),
    ]);
    const headings = out.split("\n").filter((line) => line.startsWith("#"));
    expect(headings).toEqual(["# GOTCHAS", "## Tooling", "### T1", "### T2", "## Releases", "### R", "## Zeta area", "### Z"]);
  });

  it("labels workarounds and invariants", () => {
    expect(renderGotchas([makeNote({ kind: "invariant" })])).toContain("*Invariant.*");
    expect(renderGotchas([makeNote()])).not.toContain("*Gotcha.*");
  });

  it("lists resolved and superseded notes in a table instead of in full", () => {
    const out = renderGotchas([
      makeNote({ id: UID_A, title: "Old | thing", status: "resolved", resolvedBy: { kind: "commit", ref: "abc1234" } }),
      makeNote({ id: UID_B, title: "Older", status: "superseded", supersededBy: UID_A }),
    ]);
    expect(out).not.toContain("### Old");
    expect(out).toContain(`| Old \\| thing (\`${UID_A}\`) | Resolved by commit \`abc1234\` |`);
    expect(out).toContain(`| Older (\`${UID_B}\`) | Superseded by \`${UID_A}\` |`);
  });

  it("is deterministic regardless of input order", () => {
    const a = makeNote({ id: UID_A, title: "A" });
    const b = makeNote({ id: UID_B, title: "B" });
    expect(renderGotchas([a, b])).toBe(renderGotchas([b, a]));
  });

  it("keeps symptoms containing backticks readable", () => {
    expect(renderGotchas([makeNote({ symptoms: ["run `x`"] })])).toContain("`` run `x` ``");
  });
});
