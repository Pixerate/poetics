// Prints the provisional hash of a unit's source text for hand-written version
// entries: `pnpm provisional-hash <file> <startLine> <endLine>` (1-based, inclusive).
// The text is the declaration from `export` to its closing brace, without the
// trailing newline, so it matches what the seed units were hashed from.
import { readFile } from "node:fs/promises";
import { gitBlobHash } from "@poetics/core";
import type { Hash } from "@poetics/core";

export function provisionalHash(source: string, startLine: number, endLine: number): Hash {
  const lines = source.split("\n");
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw new RangeError(`Line range ${startLine}-${endLine} is outside 1-${lines.length}`);
  }
  return gitBlobHash(lines.slice(startLine - 1, endLine).join("\n"));
}

if (import.meta.main) {
  const [file, start, end] = process.argv.slice(2);
  if (!file || !start || !end) {
    console.error("Usage: pnpm provisional-hash <file> <startLine> <endLine>");
    process.exitCode = 2;
  } else {
    console.log(provisionalHash(await readFile(file, "utf8"), Number(start), Number(end)));
  }
}
