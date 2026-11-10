// The backfill eval (#16): `pnpm eval:backfill [--draft]`. Runs the snapshot
// backfill on a clone of this repository with its unit files removed, and
// compares each inferred rationale with the one recorded by hand. --draft
// drafts through backfill.draft.command (ADR 0017). Writes
// evals/backfill/results.md and results.json.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandDrafter } from "@poetics/cli";
import { readConfig } from "@poetics/store";
import { formatBackfillEval, runBackfillEval } from "./lib/backfill-eval.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO_ROOT, "evals", "backfill");

if (import.meta.main) {
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
