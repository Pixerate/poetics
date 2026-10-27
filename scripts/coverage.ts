// Reports how well Poetics covers this codebase: `pnpm poetics:coverage [--json]`.
// Exits 1 when a metric is below its threshold in .poetics/config.json policy.coverage.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNote, parseUnit, readNoteFiles, readUnitFiles, storePaths } from "@poetics/store";
import { readConfig } from "./lib/config.ts";
import { computeCoverage, formatCoverage } from "./lib/coverage.ts";
import type { CoverageReport } from "./lib/coverage.ts";
import { discoverDeclarations, filesInScope } from "./lib/declarations.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function coverageFor(root: string): Promise<CoverageReport> {
  const config = await readConfig(root);
  const paths = storePaths(root);
  const { declarations, unsupported } = await discoverDeclarations(root, config);
  const { parseable } = await filesInScope(root, config);
  const units = (await readUnitFiles(paths)).map(parseUnit);
  const notes = (await readNoteFiles(paths)).map(parseNote);
  return computeCoverage(declarations, units, notes, new Set(parseable), unsupported, config.policy?.coverage);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const report = await coverageFor(rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1] ?? "."));
  console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : formatCoverage(report));
  if (report.failures.length > 0) process.exitCode = 1;
}
