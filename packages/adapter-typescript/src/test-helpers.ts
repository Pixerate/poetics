import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway ESM project with `files` written under its root. */
export function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "poetics-ts-"));
  writeFiles(root, { "package.json": `{ "type": "module" }`, ...files });
  return root;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}
