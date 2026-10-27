// Checks that a change recorded itself in .poetics/: `pnpm poetics:check
// [--since <ref>] [--json]`. The default compares the working tree with HEAD
// (before committing); CI passes the pull request's base branch.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkChange } from "./lib/change.ts";
import type { ChangeReport } from "./lib/change.ts";
import { readConfig } from "./lib/config.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export async function main(argv: readonly string[], io: Io, root = REPO_ROOT): Promise<number> {
  const json = argv.includes("--json");
  const sinceFlag = argv.indexOf("--since");
  const since = sinceFlag === -1 ? "HEAD" : (argv[sinceFlag + 1] ?? "HEAD");
  const report = await checkChange(root, since, await readConfig(root));
  const errors = report.findings.filter((f) => f.severity === "error").length;
  if (json) io.out(JSON.stringify(report));
  else printHuman(report, errors, since, io);
  return errors > 0 ? 1 : 0;
}

function printHuman(report: ChangeReport, errors: number, since: string, io: Io): void {
  for (const f of report.findings) io.err(`${f.severity}: ${f.kind}: ${f.file}: ${f.message}`);
  const warnings = report.findings.length - errors;
  io.out(
    `Poetics check since ${since} (${report.base.slice(0, 7)}): ${report.changedCodeFiles.length} code file(s), ` +
      `${report.changedUnits} unit file(s) changed; ${errors} error(s), ${warnings} warning(s).`,
  );
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  });
}
