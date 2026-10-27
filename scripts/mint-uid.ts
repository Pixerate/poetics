// Prints new unit uids (ULIDs) for hand-written unit files: `pnpm mint-uid [count]`.
import { mintUid } from "@poetics/core";

export function mintUids(count: number): string[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Count must be a positive integer, got ${count}`);
  return Array.from({ length: count }, () => mintUid());
}

if (import.meta.main) {
  console.log(mintUids(Number(process.argv[2] ?? 1)).join("\n"));
}
