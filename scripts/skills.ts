// Mirrors .agents/skills/ (the source, in the Agent Skills format) to
// .claude/skills/ for runtimes that read only that directory (ADR 0023). With
// --check, exits 1 instead of writing when the mirror has drifted (CI runs this).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The skills source, relative to the repository root. */
export const SKILLS_SOURCE = ".agents/skills";
/** Directories kept identical to the source, for runtimes that read only their own. */
export const SKILLS_MIRRORS = [".claude/skills"] as const;

/** Every file under `dir`, as sorted paths relative to it; empty when `dir` is missing. */
async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** The paths that differ between source and mirror: changed, missing from the mirror, or extra in it. */
export async function skillsDrift(root: string, mirror: string): Promise<string[]> {
  const source = join(root, SKILLS_SOURCE);
  const target = join(root, mirror);
  const [want, have] = await Promise.all([filesIn(source), filesIn(target)]);
  const drift = new Set(have.filter((file) => !want.includes(file)));
  for (const file of want) {
    const [a, b] = await Promise.all([readFile(join(source, file)), readFile(join(target, file)).catch(() => null)]);
    if (!b || !a.equals(b)) drift.add(file);
  }
  return [...drift].sort();
}

/** Returns the drifted paths per mirror. Without `check`, rewrites each drifted mirror from the source first. */
export async function syncSkills(root: string, check: boolean): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  if ((await filesIn(join(root, SKILLS_SOURCE))).length === 0) throw new Error(`No skills in ${SKILLS_SOURCE}/.`);
  for (const mirror of SKILLS_MIRRORS) {
    const drift = await skillsDrift(root, mirror);
    result[mirror] = drift;
    if (check || drift.length === 0) continue;
    const target = join(root, mirror);
    await rm(target, { recursive: true, force: true });
    for (const file of await filesIn(join(root, SKILLS_SOURCE))) {
      await mkdir(dirname(join(target, file)), { recursive: true });
      await writeFile(join(target, file), await readFile(join(root, SKILLS_SOURCE, file)));
    }
  }
  return result;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1] ?? ".");
  const check = argv.includes("--check");
  const result = await syncSkills(root, check);
  const drifted = Object.entries(result).filter(([, files]) => files.length > 0);
  if (!check) console.log(drifted.length === 0 ? "Skill mirrors are up to date." : `Mirrored ${SKILLS_SOURCE}/ to ${drifted.map(([m]) => `${m}/`).join(", ")}.`);
  else if (drifted.length === 0) console.log("Skill mirrors are up to date.");
  else {
    for (const [mirror, files] of drifted) console.error(`${mirror}/ differs from ${SKILLS_SOURCE}/: ${files.join(", ")}`);
    console.error(`Edit skills in ${SKILLS_SOURCE}/ only, then run \`pnpm skills\` and commit the result.`);
    process.exitCode = 1;
  }
}
