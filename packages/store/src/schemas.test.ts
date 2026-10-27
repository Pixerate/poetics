import { describe, expect, it } from "vitest";
import { createValidator, loadSchemaSet } from "./schemas.ts";
import { REPO_SCHEMAS, UID_A, defaultConfig, hash, makeUnit } from "./test-helpers.ts";

const validator = createValidator(await loadSchemaSet(REPO_SCHEMAS));

describe("unit schema", () => {
  it("accepts a minimal hand-written unit", () => {
    expect(validator.unit(makeUnit(UID_A))).toEqual({ valid: true, errors: [] });
  });

  it("accepts the plan's example shape", () => {
    const unit = makeUnit(UID_A, {
      kind: "component",
      framework: "svelte",
      lineage: [{ kind: "move", from: "src/components/PriceTag.svelte", commit: "9e8d7c6" }],
      docs: "Displays a price.",
      tests: [{ file: "src/lib/PriceTag.test.ts", name: "shows sale price", via: "coverage" }],
    });
    unit.versions.push({
      contentHash: hash("2", "b3"),
      interfaceHash: hash("3", "b3"),
      closureHash: hash("4", "b3"),
      parent: hash("1"),
      change: "behaviour",
      commit: "a1b2c3d",
      actor: { kind: "agent", tool: "claude-code", model: "m", session: "ses_8f", reviewed: false },
      rationale: "Show strikethrough price during sales",
      links: ["https://tracker.example/SHOP-412", { kind: "github-issue", ref: "#12" }],
      deps: { "01JB7Z00000000000000000000": hash("5", "b3") },
    });
    expect(validator.unit(unit).errors).toEqual([]);
  });

  it("rejects unknown fields, bad uids and bad hashes", () => {
    const bad = { ...makeUnit("not-a-ulid"), extra: true } as Record<string, unknown>;
    (bad["versions"] as Array<Record<string, unknown>>)[0]!["contentHash"] = "sha1:abc";
    const result = validator.unit(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/uid/);
    expect(result.errors.join("\n")).toMatch(/contentHash/);
    expect(result.errors.join("\n")).toMatch(/additional properties/);
  });

  it("requires agents to carry a reviewed flag", () => {
    const unit = makeUnit(UID_A);
    unit.versions[0]!.actor = { kind: "agent", tool: "claude-code" } as never;
    expect(validator.unit(unit).valid).toBe(false);
  });
});

describe("config and lock schemas", () => {
  it("accepts the default config", () => {
    expect(validator.config(defaultConfig()).valid).toBe(true);
  });

  it("rejects a config with no adapters", () => {
    expect(validator.config({ version: 1, adapters: [], include: ["src"] }).valid).toBe(false);
  });

  it("accepts a lock with pins keyed by uid", () => {
    expect(validator.lock({ version: 1, pins: { [UID_A]: { name: "PriceTag", closureHash: hash("a", "b3") } } }).valid).toBe(true);
    expect(validator.lock({ version: 1, pins: { nope: { name: "X", closureHash: hash("a", "b3") } } }).valid).toBe(false);
  });
});
