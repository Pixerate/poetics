// Writes site/public/data.json from this repository's .poetics/, code and git
// state, for the GitHub Pages demo: `pnpm site:data`.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNote, parseUnit, readNoteFiles, readUnitFiles, storePaths } from "@poetics/store";
import { readConfig } from "./lib/config.ts";
import { coverageFor } from "./coverage.ts";
import { discoverDeclarations } from "./lib/declarations.ts";
import { git } from "./lib/git.ts";
import { buildSiteData, parseDecision } from "./lib/site-data.ts";
import type { SiteDecision } from "../site/src/lib/types.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_URL = "https://github.com/Pixerate/poetics";

export async function exportSiteData(root: string, out: string): Promise<void> {
  const config = await readConfig(root);
  const paths = storePaths(root);
  const { declarations } = await discoverDeclarations(root, config);
  const sources = new Map<string, string>();
  for (const file of new Set(declarations.map((d) => d.file))) sources.set(file, await readFile(join(root, file), "utf8"));

  const decisions: SiteDecision[] = [];
  const decisionsDir = join(root, "docs", "decisions");
  for (const name of (await readdir(decisionsDir)).filter((n) => /^\d{4}-.+\.md$/.test(n))) {
    const decision = parseDecision(`docs/decisions/${name}`, await readFile(join(decisionsDir, name), "utf8"));
    if (decision) decisions.push(decision);
  }

  const data = buildSiteData({
    repoUrl: REPO_URL,
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    generatedAt: new Date().toISOString(),
    thresholds: config.policy?.coverage ?? {},
    coverage: await coverageFor(root),
    units: (await readUnitFiles(paths)).map(parseUnit),
    notes: (await readNoteFiles(paths)).map(parseNote),
    declarations,
    sources,
    decisions,
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(data));
}

if (import.meta.main) {
  const out = join(REPO_ROOT, "site", "public", "data.json");
  await exportSiteData(REPO_ROOT, out);
  console.log(`Wrote ${out}`);
}
