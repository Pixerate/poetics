// The backfill eval on a repository that adopts Poetics late (#64): with no
// recorded rationale to compare against, it measures what backfill infers from
// the repository alone. That covers the units it creates, the evidence each
// rationale rests on, the confidence it gives, and what a history walk adds,
// with how long each takes.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Inferred, Version } from "@poetics/core";
import { applyBackfill, planBackfill, planPrehistory } from "@poetics/cli";
import type { PoeticsConfig } from "@poetics/store";
import { contentWords } from "./backfill-eval.ts";

/** A repository pinned to a commit, with the scope and adapters to backfill it with. */
export interface BackfillCorpus {
  name: string;
  repo: string;
  commit: string;
  include: string[];
  exclude: string[];
  adapters: string[];
}

/** How many versions had each confidence, and what their rationale rested on. */
export interface VersionStats {
  versions: number;
  byConfidence: Record<Inferred["confidence"], number>;
  /** By the evidence a rationale rested on, `test` left out (it says where a unit is tested, not why it exists). */
  bySources: Record<string, number>;
  /** Versions with no evidence at all, whose rationale is the fallback. */
  fallback: number;
  /** Content words in the rationale. */
  words: { mean: number; median: number };
}

export interface CorpusBackfillResult {
  corpus: Pick<BackfillCorpus, "name" | "repo" | "commit" | "adapters">;
  history: { commits: number; firstParent: number };
  /** The snapshot backfill: one created version per unit in scope. */
  snapshot: VersionStats & { units: number; byKind: Record<string, number>; candidateNotes: number; ms: number };
  /** The history walk over every first-parent commit, after the snapshot was recorded and committed. */
  walk: VersionStats & { commits: number; withPrehistory: number; stopped: number; removed: number; ms: number };
  /** A few inferred rationales of each confidence, for reading. */
  examples: Array<{ unit: string; confidence: Inferred["confidence"]; sources: string[]; rationale: string }>;
}

/** Counts, confidence, evidence and length over a list of inferred versions. */
export function versionStats(versions: readonly Version[]): VersionStats {
  const stats: VersionStats = { versions: versions.length, byConfidence: { high: 0, medium: 0, low: 0 }, bySources: {}, fallback: 0, words: { mean: 0, median: 0 } };
  const lengths: number[] = [];
  for (const version of versions) {
    const inferred = version.inferred;
    if (!inferred) continue;
    stats.byConfidence[inferred.confidence]++;
    const sources = inferred.sources.filter((source) => source !== "test");
    if (sources.length === 0) stats.fallback++;
    const label = sources.length === 0 ? "nothing" : [...sources].sort().join(" + ");
    stats.bySources[label] = (stats.bySources[label] ?? 0) + 1;
    lengths.push(contentWords(version.rationale).size);
  }
  lengths.sort((a, b) => a - b);
  stats.words = { mean: lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length, median: lengths[Math.floor(lengths.length / 2)] ?? 0 };
  return stats;
}

/**
 * Clones `source` (a full clone of the corpus repository) at the corpus commit,
 * writes a config for its scope, and runs the snapshot backfill offline. Then
 * it records and commits the units and walks the first-parent history for
 * their prehistory, deletions included. The clone is thrown away.
 */
export async function runCorpusBackfill(source: string, corpus: BackfillCorpus): Promise<CorpusBackfillResult> {
  const root = await mkdtemp(join(tmpdir(), `poetics-backfill-${corpus.name}-`));
  try {
    git(source, "clone", "--quiet", "--no-hardlinks", source, root);
    git(root, "checkout", "--quiet", "--detach", corpus.commit);
    const config: PoeticsConfig = { include: corpus.include, exclude: corpus.exclude, adapters: corpus.adapters };
    await write(root, ".poetics/config.json", JSON.stringify({ version: 1, ...config }, null, 2));
    await write(root, ".poetics/.gitignore", "cache/\n");
    const history = {
      commits: Number(git(root, "rev-list", "--count", "HEAD").trim()),
      firstParent: Number(git(root, "rev-list", "--count", "--first-parent", "HEAD").trim()),
    };

    let started = performance.now();
    const plan = await planBackfill(root, config);
    const snapshotMs = Math.round(performance.now() - started);
    const byKind: Record<string, number> = {};
    for (const { unit } of plan.created) byKind[unit.kind] = (byKind[unit.kind] ?? 0) + 1;
    const created = plan.created.map(({ unit }) => unit.versions[0]!);

    // History mode reconstructs what came before each unit file was first committed, so the snapshot is committed first.
    await applyBackfill(root, plan);
    git(root, "add", "-A");
    git(root, "-c", "user.name=Eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Adopt Poetics");
    started = performance.now();
    const walk = await planPrehistory(root, config, { includeRemoved: true });
    const walkMs = Math.round(performance.now() - started);
    const prehistory = walk.units.flatMap((entry) => entry.prehistory);

    const examples: CorpusBackfillResult["examples"] = [];
    for (const confidence of ["high", "medium", "low"] as const) {
      for (const { unit } of plan.created.filter(({ unit }) => unit.versions[0]!.inferred?.confidence === confidence).slice(0, 2)) {
        const version = unit.versions[0]!;
        examples.push({ unit: `${unit.location.file}#${unit.name}`, confidence, sources: version.inferred!.sources, rationale: version.rationale });
      }
    }
    return {
      corpus: { name: corpus.name, repo: corpus.repo, commit: corpus.commit, adapters: corpus.adapters },
      history,
      snapshot: { ...versionStats(created), units: plan.created.length, byKind, candidateNotes: plan.candidateNotes.length, ms: snapshotMs },
      walk: {
        ...versionStats(prehistory),
        commits: walk.commits,
        withPrehistory: walk.units.filter((entry) => entry.prehistory.length > 0).length,
        stopped: walk.units.filter((entry) => entry.stoppedAt).length,
        removed: walk.removed.length,
        ms: walkMs,
      },
      examples,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The corpus results as Markdown. */
export function formatCorpusBackfill(results: readonly CorpusBackfillResult[], meta: { date: string; commit: string }): string {
  const pct = (n: number, of: number) => `${of === 0 ? 0 : Math.round((n / of) * 100)}%`;
  const stats = (label: string, s: VersionStats) => [
    `| ${label} | ${s.versions} | ${s.byConfidence.high} (${pct(s.byConfidence.high, s.versions)}) | ${s.byConfidence.medium} (${pct(s.byConfidence.medium, s.versions)}) | ${s.byConfidence.low} (${pct(s.byConfidence.low, s.versions)}) | ${s.fallback} | ${s.words.mean.toFixed(1)} / ${s.words.median} |`,
  ];
  const sources = (s: VersionStats) =>
    Object.entries(s.bySources)
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
      .map(([label, n]) => `${label} ${n}`)
      .join(", ");
  const lines = [
    "# Backfill on late-adopting repositories",
    "",
    `Generated by \`pnpm eval:backfill --corpus\` on ${meta.date} at \`${meta.commit.slice(0, 7)}\`, offline (no pull requests or issues). See [README.md](README.md) for the method.`,
    "",
  ];
  for (const r of results) {
    const kinds = Object.entries(r.snapshot.byKind)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([kind, n]) => `${n} ${kind}`)
      .join(", ");
    lines.push(
      `## ${r.corpus.name}`,
      "",
      `[${r.corpus.repo}](https://github.com/${r.corpus.repo}/tree/${r.corpus.commit}) at \`${r.corpus.commit.slice(0, 7)}\`, adapters ${r.corpus.adapters.join(", ")}: ${r.history.commits} commits, ${r.history.firstParent} on the first-parent line. The snapshot created ${r.snapshot.units} units (${kinds}) in ${r.snapshot.ms} ms, with ${r.snapshot.candidateNotes} candidate notes. The history walk over ${r.walk.commits} commits (the one that recorded the snapshot included) took ${r.walk.ms} ms: ${r.walk.withPrehistory} units gained prehistory, ${r.walk.stopped} stopped at an ambiguous match, and ${r.walk.removed} deleted exports were recovered.`,
      "",
      "| | Versions | High | Medium | Low | No evidence | Content words (mean / median) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...stats("Snapshot", r.snapshot),
      ...stats("History walk", r.walk),
      "",
      `Snapshot evidence: ${sources(r.snapshot)}.`,
      "",
      `History evidence: ${sources(r.walk)}.`,
      "",
      "Examples:",
      "",
      ...r.examples.flatMap((e) => [`- \`${e.unit}\`, ${e.confidence}, from ${e.sources.join(" + ") || "nothing"}: ${oneLine(e.rationale)}`]),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

async function write(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
