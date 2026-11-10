// The backfill eval (#16): run the snapshot backfill on a repository whose
// rationale was recorded by hand, and measure how much of that rationale the
// inferred one recovers, overall and by the confidence backfill gave it.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRemoved } from "@poetics/core";
import type { Inferred, Unit } from "@poetics/core";
import { planBackfill } from "@poetics/cli";
import type { Drafter } from "@poetics/cli";
import { parseUnit, readConfig, readUnitFiles, storePaths } from "@poetics/store";

/** One inferred version next to the recorded version from the same commit. */
export interface EvalPair {
  unit: string;
  commit: string;
  confidence: Inferred["confidence"];
  sources: Inferred["sources"];
  drafted: boolean;
  inferred: string;
  recorded: string;
  score: Score;
}

/** How much of `recorded`'s wording `inferred` has: recall of its content words, and their overlap both ways. */
export interface Score {
  recall: number;
  jaccard: number;
}

export interface BackfillEvalResult {
  /** Live units recorded by hand at HEAD. */
  recorded: number;
  /** Units the backfill created from the code. */
  inferred: number;
  /** Inferred versions with a recorded version from the same commit. */
  pairs: EvalPair[];
  /** Inferred versions whose commit recorded no version of the unit. */
  unpaired: number;
  /** Inferred versions with no evidence at all: the fallback rationale. */
  fallback: number;
}

/** Words too common to say why. */
const STOP = new Set(
  "the and for with that this from into when then than are was were has have had not but its it's can may only also each one any all its their there them they which what who why how out use used uses using our you your via per new adds add added".split(" "),
);

/** Lower-cased content words of three letters or more, stop words left out, with a crude plural fold. */
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
}

/** Recall of `recorded`'s content words in `inferred`, and the Jaccard overlap of the two sets. */
export function score(inferred: string, recorded: string): Score {
  const a = contentWords(inferred);
  const b = contentWords(recorded);
  if (b.size === 0) return { recall: 0, jaccard: 0 };
  let shared = 0;
  for (const word of b) if (a.has(word)) shared++;
  return { recall: shared / b.size, jaccard: shared / (a.size + b.size - shared) };
}

/**
 * The commit that added each version of a unit file, oldest version first:
 * the first commit, walking forward, whose file has more versions than before.
 */
export function versionCommits(root: string, path: string): string[] {
  const commits = git(root, "log", "--reverse", "--format=%H", "--", path).split("\n").filter(Boolean);
  const added: string[] = [];
  for (const sha of commits) {
    let versions = 0;
    try {
      versions = (JSON.parse(git(root, "show", `${sha}:${path}`)) as { versions?: unknown[] }).versions?.length ?? 0;
    } catch {
      continue;
    }
    while (added.length < versions) added.push(sha);
  }
  return added;
}

/**
 * Clones `source` with its history, removes the unit files from the clone's
 * working tree, and runs the snapshot backfill offline, so every unit is
 * inferred from the repository alone. Each inferred version is then paired
 * with the recorded version that was committed in the commit its evidence
 * came from, and scored against it.
 */
export async function runBackfillEval(source: string, options: { drafter?: Drafter } = {}): Promise<BackfillEvalResult> {
  const root = await mkdtemp(join(tmpdir(), "poetics-backfill-eval-"));
  try {
    git(source, "clone", "--quiet", "--no-hardlinks", source, root);
    const paths = storePaths(root);
    const recorded = (await readUnitFiles(paths)).map((file) => ({ unit: parseUnit(file), path: file.relativePath })).filter(({ unit }) => !isRemoved(unit));
    const byPlace = new Map(recorded.map((entry) => [place(entry.unit), entry]));
    await rm(paths.units, { recursive: true, force: true });
    const config = await readConfig(root);
    const plan = await planBackfill(root, config, options.drafter ? { drafter: options.drafter } : {});

    const result: BackfillEvalResult = { recorded: recorded.length, inferred: plan.created.length, pairs: [], unpaired: 0, fallback: 0 };
    for (const { unit } of plan.created) {
      const version = unit.versions[0]!;
      const inferred = version.inferred!;
      if (inferred.sources.length === 0) result.fallback++;
      const match = byPlace.get(place(unit));
      const at = match && version.commit ? versionCommits(root, match.path).indexOf(version.commit) : -1;
      if (!match || at === -1) {
        result.unpaired++;
        continue;
      }
      const truth = match.unit.versions[at]!.rationale;
      result.pairs.push({
        unit: `${unit.location.file}#${unit.name}`,
        commit: version.commit!,
        confidence: inferred.confidence,
        sources: inferred.sources,
        drafted: inferred.drafted,
        inferred: version.rationale,
        recorded: truth,
        score: score(version.rationale, truth),
      });
    }
    result.pairs.sort((a, b) => (a.unit < b.unit ? -1 : 1));
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The results as Markdown: totals, scores by confidence and by source, and the best and worst pairs. */
export function formatBackfillEval(result: BackfillEvalResult, meta: { date: string; commit: string; drafted: boolean }): string {
  const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const row = (label: string, pairs: EvalPair[]) => `| ${label} | ${pairs.length} | ${pct(mean(pairs.map((p) => p.score.recall)))} | ${pct(mean(pairs.map((p) => p.score.jaccard)))} | ${pct(pairs.filter((p) => p.score.recall >= 0.5).length / Math.max(1, pairs.length))} |`;
  const by = <K extends string>(key: (p: EvalPair) => K) => {
    const groups = new Map<K, EvalPair[]>();
    for (const p of result.pairs) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
    return [...groups].sort(([a], [b]) => (a < b ? -1 : 1));
  };
  // By overlap, not recall: recall alone rewards long text about the whole change.
  const ranked = [...result.pairs].sort((a, b) => b.score.jaccard - a.score.jaccard || (a.unit < b.unit ? -1 : 1));
  const example = (p: EvalPair) => [`- \`${p.unit}\` at \`${p.commit.slice(0, 7)}\`, ${p.confidence}, recall ${pct(p.score.recall)}, overlap ${pct(p.score.jaccard)}`, `  - inferred: ${oneLine(p.inferred)}`, `  - recorded: ${oneLine(p.recorded)}`];
  return [
    "# Backfill eval results",
    "",
    `Generated by \`pnpm eval:backfill${meta.drafted ? " --draft" : ""}\` on ${meta.date} at \`${meta.commit.slice(0, 7)}\`. See [README.md](README.md) for the method.`,
    "",
    `${result.recorded} units are recorded by hand; the snapshot backfill inferred ${result.inferred} from the code. ${result.pairs.length} inferred versions have a recorded version from the same commit to compare with; ${result.unpaired} have none. ${result.fallback} had no evidence at all.`,
    "",
    "Recall is the share of the recorded rationale's content words that the inferred rationale also has; overlap is the Jaccard index of the two sets of words.",
    "",
    "| | Pairs | Mean recall | Mean overlap | Recall ≥ 50% |",
    "| --- | --- | --- | --- | --- |",
    row("All", result.pairs),
    ...by((p) => `confidence: ${p.confidence}`).map(([label, pairs]) => row(label, pairs)),
    ...by((p) => `from: ${p.sources.filter((s) => s !== "test" && s !== "doc").join(" + ") || "nothing"}`).map(([label, pairs]) => row(label, pairs)),
    "",
    "## Closest (by overlap)",
    "",
    ...ranked.slice(0, 3).flatMap(example),
    "",
    "## Furthest (by overlap)",
    "",
    ...ranked.slice(-3).reverse().flatMap(example),
    "",
  ].join("\n");
}

function place(unit: Pick<Unit, "location" | "name" | "kind">): string {
  return `${unit.location.file}#${unit.name}#${unit.kind === "type"}`;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}
