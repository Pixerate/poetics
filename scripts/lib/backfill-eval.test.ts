import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyIndex, planIndex } from "@poetics/cli";
import { contentWords, formatBackfillEval, runBackfillEval, score, versionCommits } from "./backfill-eval.ts";

const CONFIG = { include: ["src/**/*.ts"], exclude: [] };
const human = { kind: "human" } as const;

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
}

async function write(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

/** Code and unit files committed together, each change with its own hand-written rationale, as this repository records them. */
async function recordedRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-eval-src-"));
  git(root, "init", "-q", "-b", "main");
  await write(root, ".gitignore", ".poetics/cache/\n");
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], ...CONFIG }));
  const record = async (message: string, rationale: string) => {
    await applyIndex(root, await planIndex(root, CONFIG, { rationale }), human);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", message);
  };
  await write(root, "src/price.ts", "export function formatPrice(n: number): string {\n  return n.toFixed(2);\n}\n");
  await write(root, "src/tax.ts", "export function addTax(n: number): number {\n  return n * 1.2;\n}\n");
  await record("feat: add formatPrice and addTax for checkout prices", "Shows checkout prices with two decimals.");
  await write(root, "src/price.ts", "export function formatPrice(n: number): string {\n  return (Math.round(n * 100) / 100).toFixed(2);\n}\n");
  await record("fix: round prices half up", "Rounds half up so receipts match the till.");
  return root;
}

describe("contentWords and score", () => {
  it("keeps content words, folds plurals and drops stop words", () => {
    expect([...contentWords("Adds the prices for checkout, and rounds it.")].sort()).toEqual(["checkout", "price", "round"]);
  });

  it("measures how much of the recorded wording the inferred rationale has", () => {
    expect(score("checkout prices", "Shows checkout prices with two decimals.")).toEqual({ recall: 2 / 5, jaccard: 2 / 5 });
    expect(score("anything", "the and for")).toEqual({ recall: 0, jaccard: 0 });
  });
});

describe("versionCommits", () => {
  it("names the commit that added each version of a unit file", async () => {
    const root = await recordedRepo();
    const [first, second] = git(root, "log", "--reverse", "--format=%H").trim().split("\n");
    const file = git(root, "ls-files", ".poetics/units").split("\n").find((path) => git(root, "show", `HEAD:${path}`).includes("formatPrice"))!;
    expect(versionCommits(root, file)).toEqual([first, second]);
  });
});

describe("runBackfillEval", () => {
  it("infers every unit from a clone without its unit files, and pairs each with the version from the same commit", async () => {
    const root = await recordedRepo();
    const result = await runBackfillEval(root);
    expect([result.recorded, result.inferred, result.unpaired, result.fallback]).toEqual([2, 2, 0, 0]);
    const first = git(root, "log", "--reverse", "--format=%H").trim().split("\n")[0]!;
    // The declaration's header line was written in the first commit, so both units pair with their created version.
    // Its message names both units, which is the whole change speaking, not either unit: medium (ADR 0018).
    expect(result.pairs.map((p) => [p.unit, p.commit, p.confidence, p.inferred, p.recorded])).toEqual([
      ["src/price.ts#formatPrice", first, "medium", "add formatPrice and addTax for checkout prices", "Shows checkout prices with two decimals."],
      ["src/tax.ts#addTax", first, "medium", "add formatPrice and addTax for checkout prices", "Shows checkout prices with two decimals."],
    ]);
    expect(result.pairs[0]!.score.recall).toBeCloseTo(2 / 5);
    // The source repository keeps its unit files.
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("reports totals, scores by confidence and source, and the closest and furthest pairs", async () => {
    const result = await runBackfillEval(await recordedRepo());
    const text = formatBackfillEval(result, { date: "2026-11-10", commit: "0".repeat(40), drafted: false });
    expect(text).toMatch(/^# Backfill eval results\n/);
    expect(text).toContain("2 units are recorded by hand; the snapshot backfill inferred 2 from the code. 2 inferred versions have a recorded version from the same commit");
    expect(text).toContain("| All | 2 | 40% |");
    expect(text).toContain("| confidence: medium | 2 |");
    expect(text).toContain("| from: commit | 2 |");
    expect(text).toContain("  - recorded: Shows checkout prices with two decimals.");
  });
});
