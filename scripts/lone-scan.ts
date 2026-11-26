// The lone-pair history scan (ADR 0028, ADR 0030):
// `pnpm lone-scan [--fetch] [--only name] [--commits N]`.
// Walks each gate corpus's history back from its pinned commit and lists every file left with one unit removed and
// one created, the shape identity matching's stage 6 decides. --fetch clones each repository's full history, bare,
// into evals/lone-scan/.cache/ (nothing is checked out, installed or run). Writes evals/lone-scan/results.md and
// results.json.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusEntry } from "./lib/gate.ts";
import { formatScan, scanHistory } from "./lib/lone-scan.ts";
import type { ScanResult } from "./lib/lone-scan.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = join(REPO_ROOT, "evals", "lone-scan");

/** Clones a corpus's full history, bare, unless the cache already holds its pinned commit. */
export function fetchHistory(entry: CorpusEntry, cache: string): string {
  const dir = join(cache, `${entry.name}.git`);
  const has = () => {
    try {
      execFileSync("git", ["-C", dir, "cat-file", "-e", `${entry.commit}^{commit}`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  if (existsSync(dir) && has()) return dir;
  if (existsSync(dir)) execFileSync("git", ["-C", dir, "fetch", "-q", "origin"]);
  else execFileSync("git", ["clone", "-q", "--bare", `https://github.com/${entry.repo}.git`, dir]);
  return dir;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (flag: string, fallback: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? fallback : fallback);
  const commits = Number(value("--commits", "1500"));
  const only = argv.includes("--only") ? value("--only", "") : undefined;
  const { repos } = JSON.parse(await readFile(join(REPO_ROOT, "evals", "gate", "corpus.json"), "utf8")) as { repos: CorpusEntry[] };
  const cache = join(SCAN, ".cache");
  await mkdir(cache, { recursive: true });
  const results: ScanResult[] = [];
  for (const entry of repos.filter((r) => only === undefined || r.name === only)) {
    const dir = join(cache, `${entry.name}.git`);
    if (argv.includes("--fetch")) fetchHistory(entry, cache);
    else if (!existsSync(dir)) {
      console.error(`${entry.name}: not fetched; run pnpm lone-scan --fetch`);
      process.exitCode = 2;
      continue;
    }
    const work = await mkdtemp(join(tmpdir(), `poetics-lone-scan-${entry.name}-`));
    results.push(
      await scanHistory(dir, entry, {
        head: entry.commit,
        commits,
        work,
        onProgress: (done, total, pairs) => {
          if (done % 100 === 0) console.error(`${entry.name}: ${done}/${total} commits, ${pairs} lone pairs`);
        },
      }),
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  await writeFile(join(SCAN, "results.json"), `${JSON.stringify({ date, commits, results }, null, 2)}\n`);
  await writeFile(join(SCAN, "results.md"), formatScan(results, { date }));
  console.log(formatScan(results, { date }));
}
