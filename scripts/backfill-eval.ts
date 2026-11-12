// The backfill eval (#16): `pnpm eval:backfill [--draft]`. Runs the snapshot
// backfill on a clone of this repository with its unit files removed, and
// compares each inferred rationale with the one recorded by hand. --draft
// drafts through backfill.draft.command (ADR 0017). Writes
// evals/backfill/results.md and results.json.
//
// `pnpm eval:backfill --corpus [--fetch] [--only name]` (#64) instead backfills
// the late-adopting repositories in evals/backfill/corpus.json, snapshot and
// history, and writes corpus-results.md and corpus-results.json. --fetch clones
// each with its full history into evals/backfill/.cache/ (never installed or run).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandDrafter } from "@poetics/cli";
import { readConfig } from "@poetics/store";
import { formatBackfillEval, runBackfillEval } from "./lib/backfill-eval.ts";
import { formatCorpusBackfill, runCorpusBackfill } from "./lib/backfill-corpus.ts";
import type { BackfillCorpus, CorpusBackfillResult } from "./lib/backfill-corpus.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO_ROOT, "evals", "backfill");

/** A full clone of the corpus repository, fetched once; the pinned commit is checked out per run. */
function fetchCorpus(entry: BackfillCorpus, cache: string): string {
  const dir = join(cache, entry.name);
  if (!existsSync(join(dir, ".git"))) execFileSync("git", ["clone", "--quiet", `https://github.com/${entry.repo}.git`, dir]);
  return dir;
}

async function runCorpora(argv: string[]): Promise<void> {
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : undefined;
  const { repos } = JSON.parse(await readFile(join(OUT, "corpus.json"), "utf8")) as { repos: BackfillCorpus[] };
  const cache = join(OUT, ".cache");
  await mkdir(cache, { recursive: true });
  const results: CorpusBackfillResult[] = [];
  for (const entry of repos.filter((r) => only === undefined || r.name === only)) {
    const dir = join(cache, entry.name);
    if (argv.includes("--fetch")) fetchCorpus(entry, cache);
    else if (!existsSync(dir)) {
      console.error(`${entry.name}: not fetched; run pnpm eval:backfill --corpus --fetch`);
      process.exitCode = 2;
      continue;
    }
    console.error(`${entry.name}: backfilling…`);
    results.push(await runCorpusBackfill(dir, entry));
  }
  const date = new Date().toISOString().slice(0, 10);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  await writeFile(join(OUT, "corpus-results.json"), `${JSON.stringify({ date, commit, results }, null, 2)}\n`);
  const text = formatCorpusBackfill(results, { date, commit });
  await writeFile(join(OUT, "corpus-results.md"), text);
  console.log(text);
}

if (import.meta.main && process.argv.includes("--corpus")) {
  await runCorpora(process.argv.slice(2));
} else if (import.meta.main) {
  const draft = process.argv.includes("--draft");
  const command = (await readConfig(REPO_ROOT)).backfill?.draft?.command;
  if (draft && !command?.length) {
    console.error("--draft needs backfill.draft.command in .poetics/config.json (ADR 0017).");
    process.exit(2);
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  console.error(`Backfilling a clone of ${commit.slice(0, 7)}${draft ? " with drafts" : ""}…`);
  const result = await runBackfillEval(REPO_ROOT, draft ? { drafter: commandDrafter(command!, { cwd: REPO_ROOT }) } : {});
  const date = new Date().toISOString().slice(0, 10);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "results.json"), `${JSON.stringify({ date, commit, drafted: draft, ...result }, null, 2)}\n`);
  const text = formatBackfillEval(result, { date, commit, drafted: draft });
  await writeFile(join(OUT, "results.md"), text);
  console.log(text);
}
