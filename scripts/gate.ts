// The identity gate (#26; phase 2's React gate):
// `pnpm gate [--fetch] [--rounds N] [--seed N] [--only name] [--adapters a,b]`.
// --adapters overrides each corpus's adapters, e.g. `typescript` to rerun phase 1.
// --fetch downloads each corpus repository at its pinned commit into
// evals/gate/.cache/ (shallow, source only; nothing is installed or run).
// Writes evals/gate/results.md and results.json.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatResults, runGate } from "./lib/gate.ts";
import type { CorpusEntry, GateResult } from "./lib/gate.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(REPO_ROOT, "evals", "gate");

/** Fetches one pinned commit, shallow, unless the cache already has it. */
export function fetchCorpus(entry: CorpusEntry, cache: string): string {
  const dir = join(cache, entry.name);
  const at = () => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (existsSync(join(dir, ".git")) && at() === entry.commit) return dir;
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "fetch", "-q", "--depth", "1", `https://github.com/${entry.repo}.git`, entry.commit]);
  execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", "FETCH_HEAD"]);
  return dir;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (flag: string, fallback: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? fallback : fallback);
  const rounds = Number(value("--rounds", "10"));
  const seed = Number(value("--seed", "26"));
  const only = argv.includes("--only") ? value("--only", "") : undefined;
  const adapters = argv.includes("--adapters") ? value("--adapters", "typescript").split(",") : undefined;
  const { repos } = JSON.parse(await readFile(join(GATE, "corpus.json"), "utf8")) as { repos: CorpusEntry[] };
  const cache = join(GATE, ".cache");
  await mkdir(cache, { recursive: true });
  const results: GateResult[] = [];
  for (const entry of repos.filter((r) => only === undefined || r.name === only)) {
    const dir = join(cache, entry.name);
    if (argv.includes("--fetch")) fetchCorpus(entry, cache);
    else if (!existsSync(dir)) {
      console.error(`${entry.name}: not fetched; run pnpm gate --fetch`);
      process.exitCode = 2;
      continue;
    }
    console.error(`${entry.name}: ${rounds} rounds…`);
    results.push(await runGate(entry, dir, { rounds, seed, ...(adapters ? { adapters } : {}) }));
  }
  const date = new Date().toISOString().slice(0, 10);
  await writeFile(join(GATE, "results.json"), `${JSON.stringify({ date, rounds, seed, results }, null, 2)}\n`);
  await writeFile(join(GATE, "results.md"), formatResults(results, { date, rounds, seed }));
  console.log(formatResults(results, { date, rounds, seed }));
}
