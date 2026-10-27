// The day-one store check: validates .poetics/ (units and notes) against schemas/ and the rules
// a schema cannot express. `poetics verify` takes this over in phase 1.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStore, createValidator, loadSchemaSet, storePaths } from "@poetics/store";
import type { CheckResult } from "@poetics/store";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export async function main(argv: readonly string[], io: Io): Promise<number> {
  const json = argv.includes("--json");
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1] ?? ".");

  const validator = createValidator(await loadSchemaSet(join(REPO_ROOT, "schemas")));
  const result = await checkStore(storePaths(root), validator);
  const errors = result.problems.filter((problem) => problem.severity === "error").length;

  if (json) io.out(JSON.stringify(result));
  else printHuman(result, errors, io);
  return errors > 0 ? 1 : 0;
}

function printHuman(result: CheckResult, errors: number, io: Io): void {
  for (const problem of result.problems) io.err(`${problem.severity}: ${problem.file}: ${problem.message}`);
  const warnings = result.problems.length - errors;
  io.out(`Checked ${result.units} unit(s) and ${result.notes} note(s): ${errors} error(s), ${warnings} warning(s).`);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  });
}
