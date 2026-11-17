import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOVED_CONTENT_HASH } from "@poetics/core";
import { createValidator, loadSchemaSet } from "./schemas.ts";
import { REPO_SCHEMAS, UID_A, defaultConfig, hash, makeNote, makeUnit } from "./test-helpers.ts";

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

  it("accepts a removed version only with the empty-blob hash and no other hashes", () => {
    const removed = () => {
      const unit = makeUnit(UID_A);
      unit.versions.push({
        contentHash: REMOVED_CONTENT_HASH,
        provisional: true,
        parent: hash("1"),
        change: "removed",
        actor: { kind: "human" },
        rationale: "Folded into formatRange.",
      });
      return unit;
    };
    expect(validator.unit(removed()).errors).toEqual([]);

    const wrongHash = removed();
    wrongHash.versions[1]!.contentHash = hash("2");
    expect(validator.unit(wrongHash).valid).toBe(false);

    const withInterface = removed();
    withInterface.versions[1]!.interfaceHash = hash("3");
    expect(validator.unit(withInterface).valid).toBe(false);

    const notProvisional = removed();
    delete notProvisional.versions[1]!.provisional;
    expect(validator.unit(notProvisional).valid).toBe(false);
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

describe("note schema", () => {
  it("accepts a minimal note and a fully anchored one", () => {
    expect(validator.note(makeNote()).errors).toEqual([]);
    const full = makeNote({
      kind: "workaround",
      anchors: {
        units: [{ uid: UID_A, observedAt: hash("1") }],
        paths: ["package.json"],
        dependencies: [{ name: "typescript", range: "^6" }],
        commands: ["pnpm ci"],
      },
      check: { kind: "test", ref: "scripts/scripts.test.ts", name: "x" },
      links: [{ kind: "decision", ref: "docs/decisions/0003-typescript-compiler-api.md" }],
      actor: { kind: "agent", tool: "claude-code", reviewed: false },
    });
    expect(validator.note(full).errors).toEqual([]);
  });

  it("requires resolvedBy on resolved notes and supersededBy on superseded ones", () => {
    expect(validator.note(makeNote({ status: "resolved" })).valid).toBe(false);
    expect(validator.note(makeNote({ status: "resolved", resolvedBy: { kind: "commit", ref: "abc1234" } })).valid).toBe(true);
    expect(validator.note(makeNote({ status: "superseded" })).valid).toBe(false);
  });

  it("rejects bad areas, kinds and anchor fields", () => {
    expect(validator.note(makeNote({ area: "Tooling" })).valid).toBe(false);
    expect(validator.note({ ...makeNote(), kind: "tip" }).valid).toBe(false);
    expect(validator.note(makeNote({ anchors: { units: [{ uid: "nope" }] } })).valid).toBe(false);
    expect(validator.note({ ...makeNote(), anchors: { files: [] } }).valid).toBe(false);
  });
});

describe("config coverage policy", () => {
  it("accepts ratios between 0 and 1 and rejects others", () => {
    const withCoverage = (coverage: object) => ({ ...defaultConfig(), policy: { coverage } });
    expect(validator.config(withCoverage({ tracked: 1, tested: 0.75 })).valid).toBe(true);
    expect(validator.config(withCoverage({ tracked: 1.5 })).valid).toBe(false);
    expect(validator.config(withCoverage({ lines: 0.5 })).valid).toBe(false);
  });
});

describe("adapter protocol schemas", () => {
  const fixture = async (file: string) => JSON.parse(await readFile(join(REPO_SCHEMAS, "fixtures/adapter/swift-basic", file), "utf8")) as Record<string, unknown>;
  const B3 = `b3:${"a".repeat(64)}`;
  const unit = (extra: Record<string, unknown> = {}) => ({
    key: "a.swift#f()",
    name: "f()",
    kind: "function",
    framework: "none",
    startLine: 1,
    endLine: 2,
    contentHash: B3,
    interfaceHash: B3,
    fingerprint: [],
    signatureText: "func f()",
    edges: [],
    unresolved: [],
    ...extra,
  });
  const response = (files: unknown[]) => ({ protocol: 1, adapter: { name: "swift", version: "0.1.0", rules: 1 }, files });

  it("accepts the swift-basic fixture", async () => {
    expect(validator.adapterRequest(await fixture("request.json"))).toEqual({ valid: true, errors: [] });
    expect(validator.adapterResponse(await fixture("response.json"))).toEqual({ valid: true, errors: [] });
  });

  it("rejects request paths that are absolute, leave the root or use backslashes", () => {
    for (const path of ["/abs.swift", "../out.swift", "a/../../out.swift", "a\\b.swift", ""]) {
      expect(validator.adapterRequest({ protocol: 1, root: "/r", files: [{ path }] }).valid, path).toBe(false);
    }
    expect(validator.adapterRequest({ protocol: 1, root: "/r", files: [{ path: "a/..b/c.swift" }] }).valid).toBe(true);
  });

  it("rejects another protocol version", () => {
    expect(validator.adapterRequest({ protocol: 2, root: "/r", files: [] }).valid).toBe(false);
    expect(validator.adapterResponse({ ...response([]), protocol: 2 }).valid).toBe(false);
  });

  it("needs exactly one of units and error for each file", () => {
    expect(validator.adapterResponse(response([{ path: "a.swift" }])).valid).toBe(false);
    expect(validator.adapterResponse(response([{ path: "a.swift", units: [], error: "x" }])).valid).toBe(false);
    expect(validator.adapterResponse(response([{ path: "a.swift", error: "x" }])).valid).toBe(true);
  });

  it("rejects git: hashes, keys without a file, unknown resolutions and unknown fields", () => {
    for (const bad of [
      unit({ contentHash: `git:${"a".repeat(40)}` }),
      unit({ key: "f()" }),
      unit({ edges: [{ to: "a.swift#g()", kind: "calls", resolution: "guessed" }] }),
      unit({ extra: true }),
    ]) {
      expect(validator.adapterResponse(response([{ path: "a.swift", units: [bad] }])).valid).toBe(false);
    }
  });

  it("takes kinds and frameworks from the unit schema, so a framework the store does not know is refused", () => {
    expect(validator.adapterResponse(response([{ path: "a.swift", units: [unit({ kind: "component", framework: "react" })] }])).valid).toBe(true);
    expect(validator.adapterResponse(response([{ path: "a.swift", units: [unit({ framework: "swiftui" })] }])).valid).toBe(false);
  });
});
