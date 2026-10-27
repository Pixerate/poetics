// Generates GOTCHAS.md from .poetics/notes/. With --check, exits 1 instead of
// writing when the committed file is out of date (CI runs this).
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNote, parseUnit, readNoteFiles, readUnitFiles, renderGotchas, storePaths } from "@poetics/store";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildGotchas(root: string): Promise<string> {
  const paths = storePaths(root);
  const notes = (await readNoteFiles(paths)).map(parseNote);
  const unitNames = new Map((await readUnitFiles(paths)).map(parseUnit).map((unit) => [unit.uid, unit.name]));
  return renderGotchas(notes, { unitNames });
}

/** Returns true when GOTCHAS.md already matched (or, without check, was written). */
export async function syncGotchas(root: string, check: boolean): Promise<boolean> {
  const target = join(root, "GOTCHAS.md");
  const expected = await buildGotchas(root);
  const current = await readFile(target, "utf8").catch(() => "");
  if (current === expected) return true;
  if (check) return false;
  await writeFile(target, expected);
  return true;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1] ?? ".");
  const check = argv.includes("--check");
  if (await syncGotchas(root, check)) {
    console.log(check ? "GOTCHAS.md is up to date." : "GOTCHAS.md written.");
  } else {
    console.error("GOTCHAS.md is out of date with .poetics/notes/. Run `pnpm gotchas` and commit the result.");
    process.exitCode = 1;
  }
}
