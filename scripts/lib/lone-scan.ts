// The lone-pair history scan (ADR 0028, ADR 0030): walks a corpus's real history and lists every file in which
// identity matching is left with one unit on each side, the shape stage 6 decides. Each pair still needs a person to
// say whether it is the same unit; the scan only finds them and scores them.
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { matchIdentities } from "@poetics/core";
import type { CodeUnit, TrackedUnit } from "@poetics/core";
import { createMatcher } from "@poetics/store";
import { adaptersFor, indexWith, readsAny } from "@poetics/cli";
import type { AdaptedUnit } from "@poetics/cli";
import type { CorpusEntry } from "./gate.ts";

/** The floor stage 6 applies to a pair that changed its base name (ADR 0028). */
export const LONE_FLOOR = 0.2;

/** A unit as the scan needs it from an adapter. */
export type ScanUnit = Pick<AdaptedUnit, "key" | "name" | "kind" | "contentHash" | "fingerprint" | "owner"> & { span: { file: string } };

/** One file's lone leftover pair in one commit. */
export interface LonePair {
  commit: string;
  subject: string;
  file: string;
  from: string;
  to: string;
  score: number;
  /** Whether the names agree up to the first `(`, which pairs them at any score (ADR 0030). */
  keepsBaseName: boolean;
  /** Fingerprint entries before and after. */
  sizes: [number, number];
}

export interface ScanResult {
  name: string;
  repo: string;
  /** The commit the walk started from. */
  head: string;
  commits: number;
  /** Commits touching more files than `maxFiles`, or that an adapter failed on. */
  skipped: number;
  pairs: LonePair[];
}

/** A unit's name before any argument labels, as stage 6 compares them (ADR 0030). */
export function baseName(name: string): string {
  const paren = name.indexOf("(");
  return paren === -1 ? name : name.slice(0, paren);
}

/** Every lone pair matching would be left with between two snapshots of the same files, whatever its score. */
export function lonePairs(before: readonly ScanUnit[], after: readonly ScanUnit[]): Array<Omit<LonePair, "commit" | "subject">> {
  const code = (unit: ScanUnit): CodeUnit => ({
    key: unit.key,
    file: unit.span.file,
    name: unit.name,
    kind: unit.kind,
    contentHash: unit.contentHash,
    fingerprint: unit.fingerprint,
    ...(unit.owner !== undefined ? { owner: unit.owner } : {}),
  });
  // Keys stand in for uids, so owners named by key on the earlier side work as the store's owner uids would.
  const tracked = before.map((unit): TrackedUnit => ({ ...code(unit), uid: unit.key, ...(unit.owner !== undefined ? { ownerUid: unit.owner } : {}) }));
  const byKey = new Map([...before.map((unit) => [`b${unit.key}`, unit] as const), ...after.map((unit) => [`a${unit.key}`, unit] as const)]);
  return matchIdentities(tracked, after.map(code), [], { loneThreshold: 0 })
    .matched.filter((match) => match.via === "lone")
    .map((match) => {
      const [from, to] = [byKey.get(`b${match.uid}`)!, byKey.get(`a${match.key}`)!];
      return { file: to.span.file, from: from.name, to: to.name, score: match.score ?? 0, keepsBaseName: baseName(from.name) === baseName(to.name), sizes: [from.fingerprint.length, to.fingerprint.length] };
    });
}

/**
 * Walks `commits` non-merge commits back from `head` in the git repository at `gitDir`, indexing the files each one
 * modified, as they were before and after it, with the corpus's adapters.
 */
export async function scanHistory(
  gitDir: string,
  corpus: Pick<CorpusEntry, "name" | "repo" | "include" | "exclude" | "adapters">,
  options: { head: string; commits: number; work: string; maxFiles?: number; onProgress?: (done: number, total: number, pairs: number) => void },
): Promise<ScanResult> {
  const git = (...args: string[]) => execFileSync("git", ["-C", gitDir, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  const config = { adapters: corpus.adapters ? [...corpus.adapters] : ["typescript"] };
  const inScope = createMatcher(corpus.include, corpus.exclude);
  const commits = git("rev-list", "--no-merges", `--max-count=${options.commits}`, options.head).trim().split("\n").filter(Boolean);
  const result: ScanResult = { name: corpus.name, repo: corpus.repo, head: options.head, commits: commits.length, skipped: 0, pairs: [] };
  for (const [i, commit] of commits.entries()) {
    options.onProgress?.(i, commits.length, result.pairs.length);
    const parents = git("rev-list", "--parents", "-n", "1", commit).trim().split(" ").slice(1);
    if (parents.length !== 1) continue;
    const sides = { before: join(options.work, "before"), after: join(options.work, "after") };
    const probe = adaptersFor(sides.after, config);
    const files = git("diff", "--name-only", "--diff-filter=M", parents[0]!, commit)
      .trim()
      .split("\n")
      .filter((file) => file && inScope(file) && readsAny(probe, file));
    if (files.length === 0) continue;
    if (files.length > (options.maxFiles ?? 40)) {
      result.skipped++;
      continue;
    }
    for (const dir of Object.values(sides)) {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    }
    for (const file of files) {
      for (const [dir, rev] of [[sides.before, parents[0]!], [sides.after, commit]] as const) {
        await mkdir(dirname(join(dir, file)), { recursive: true });
        await writeFile(join(dir, file), git("show", `${rev}:${file}`));
      }
    }
    let before: AdaptedUnit[], after: AdaptedUnit[];
    try {
      before = indexWith(adaptersFor(sides.before, config), files);
      after = indexWith(adaptersFor(sides.after, config), files);
    } catch {
      result.skipped++;
      continue;
    }
    const subject = git("log", "-1", "--format=%s", commit).trim();
    for (const pair of lonePairs(before, after)) result.pairs.push({ commit: commit.slice(0, 9), subject, ...pair });
  }
  await rm(options.work, { recursive: true, force: true });
  return result;
}

/** The scan as Markdown: counts by how stage 6 decides each pair, then every pair for a person to judge. */
export function formatScan(results: readonly ScanResult[], meta: { date: string }): string {
  const bands = (pairs: readonly LonePair[]) => ({
    floor: pairs.filter((p) => p.score >= LONE_FLOOR),
    base: pairs.filter((p) => p.score < LONE_FLOOR && p.keepsBaseName),
    none: pairs.filter((p) => p.score < LONE_FLOOR && !p.keepsBaseName),
  });
  const lines = [
    "# Lone-pair history scan",
    "",
    `Generated by \`pnpm lone-scan\` on ${meta.date}. For each non-merge commit, the files it modified are indexed before and after it, and identity matching is run with no floor on stage 6. Each pair below is a file left with one unit removed and one created. See [README.md](README.md) for how to read it.`,
    "",
    "| Corpus | Commits | Skipped | Lone pairs | Matched at 0.2 or more | Matched below 0.2 by base name | Not matched |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    const b = bands(r.pairs);
    lines.push(`| ${r.name} | ${r.commits} | ${r.skipped} | ${r.pairs.length} | ${b.floor.length} | ${b.base.length} | ${b.none.length} |`);
  }
  for (const r of results) {
    const b = bands(r.pairs);
    lines.push("", `## ${r.name}`, "", `[${r.repo}](https://github.com/${r.repo}), ${r.commits} commits back from \`${r.head.slice(0, 7)}\`.`);
    const list = (title: string, pairs: readonly LonePair[]) => {
      if (pairs.length === 0) return;
      lines.push("", `### ${title} (${pairs.length})`, "", "| Score | Sizes | Commit | From | To | Subject |", "| --- | --- | --- | --- | --- | --- |");
      for (const p of [...pairs].sort((x, y) => x.score - y.score)) {
        const cell = (text: string) => text.replaceAll("|", "\\|");
        lines.push(`| ${p.score.toFixed(3)} | ${p.sizes.join(", ")} | [\`${p.commit.slice(0, 7)}\`](https://github.com/${r.repo}/commit/${p.commit}) | \`${cell(p.from)}\` | \`${cell(p.to)}\` | ${cell(p.subject.slice(0, 80))} |`);
      }
    };
    list("Matched at 0.2 or more", b.floor);
    list("Matched below 0.2 because they keep their base name", b.base);
    list("Not matched", b.none);
  }
  return `${lines.join("\n")}\n`;
}
