import type { Hash, Unit } from "./types.ts";

/**
 * The `contentHash` of a `removed` version: git's empty-blob hash, since the
 * unit's source is now empty. A sentinel rather than no hash, so versions stay
 * keyed by contentHash everywhere (ADR 0010).
 */
export const REMOVED_CONTENT_HASH: Hash = "git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

/** Whether a unit's latest version records its removal from the code. */
export function isRemoved(unit: Pick<Unit, "versions">): boolean {
  return unit.versions.at(-1)?.change === "removed";
}
