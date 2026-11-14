import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Version } from "@poetics/core";
import { formatCorpusBackfill, runCorpusBackfill, versionStats } from "./backfill-corpus.ts";
import type { BackfillCorpus } from "./backfill-corpus.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Dev", "-c", "user.email=dev@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
}

async function write(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

/** A repository that never used Poetics: code and commit messages only, one export later deleted. */
async function lateRepo(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "poetics-corpus-src-"));
  git(root, "init", "-q", "-b", "main");
  await write(root, "src/price.ts", "export function formatPrice(n: number): string {\n  return n.toFixed(2);\n}\n");
  await write(root, "src/old.ts", "export function legacyTotal(n: number): number {\n  return n;\n}\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "initial commit");
  await write(root, "src/tax.ts", "/** Adds VAT at the standard rate. */\nexport function addTax(n: number): number {\n  return n * 1.2;\n}\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "feat: add VAT to checkout totals");
  await write(root, "src/price.ts", "export function formatPrice(n: number): string {\n  return (Math.round(n * 100) / 100).toFixed(2);\n}\n");
  git(root, "rm", "-q", "src/old.ts");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fix: round prices half up and drop the legacy total");
  return { root, head: git(root, "rev-parse", "HEAD").trim() };
}

const version = (rationale: string, confidence: "high" | "medium" | "low", sources: Array<"commit" | "doc" | "test">): Version => ({
  contentHash: `b3:${"0".repeat(64)}`,
  parent: null,
  change: "created",
  actor: { kind: "human" },
  rationale,
  inferred: { by: "backfill", confidence, sources, drafted: false, reviewed: false },
});

describe("versionStats", () => {
  it("counts confidence, evidence (tests left out), versions with none, and rationale length", () => {
    const stats = versionStats([
      version("initial commit", "medium", ["commit"]),
      version("Adds VAT at the standard rate. feat: add VAT to checkout totals", "high", ["doc", "commit", "test"]),
      version("Recorded by backfill with no evidence.", "low", []),
    ]);
    expect(stats.versions).toBe(3);
    expect(stats.byConfidence).toEqual({ high: 1, medium: 1, low: 1 });
    expect(stats.bySources).toEqual({ commit: 1, "commit + doc": 1, nothing: 1 });
    expect(stats.fallback).toBe(1);
    expect(stats.words.median).toBe(3);
  });

  it("is all zeros for no versions", () => {
    expect(versionStats([])).toEqual({ versions: 0, byConfidence: { high: 0, medium: 0, low: 0 }, bySources: {}, fallback: 0, words: { mean: 0, median: 0 } });
  });
});

describe("runCorpusBackfill", () => {
  it("backfills a late-adopting repository, snapshot then history, without touching the source", async () => {
    const { root, head } = await lateRepo();
    const corpus: BackfillCorpus = { name: "late", repo: "example/late", commit: head, include: ["src/**/*.ts"], exclude: [], adapters: ["typescript"] };
    const result = await runCorpusBackfill(root, corpus);
    expect(result.history).toEqual({ commits: 3, firstParent: 3 });
    expect(result.snapshot).toMatchObject({ units: 2, versions: 2, byKind: { function: 2 }, fallback: 0 });
    // addTax has a doc comment, so it is high. formatPrice survives "initial commit", which also introduced the
    // since-deleted legacyTotal, so that message is not about it alone (ADR 0022).
    expect(result.snapshot.byConfidence).toEqual({ high: 1, medium: 1, low: 0 });
    expect(result.snapshot.bySources).toEqual({ commit: 1, "comment + commit": 1 });
    // The walk reaches HEAD, the commit that recorded the snapshot, as well as the three before it.
    expect(result.walk.commits).toBe(4);
    expect(result.walk.removed).toBe(1);
    expect(result.walk.withPrehistory).toBeGreaterThanOrEqual(1);
    expect(result.examples.length).toBeGreaterThan(0);
    // The source repository is cloned, never written to.
    expect(git(root, "status", "--porcelain")).toBe("");

    const text = formatCorpusBackfill([result], { date: "2026-11-12", commit: "0".repeat(40) });
    expect(text).toMatch(/^# Backfill on late-adopting repositories\n/);
    expect(text).toContain("## late");
    expect(text).toContain("| Snapshot | 2 |");
    expect(text).toContain("1 deleted exports were recovered");
  }, 30_000);
});
